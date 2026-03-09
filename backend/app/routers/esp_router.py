from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import random
import json

from ..database import get_db
from ..models import (
    Credential, AccessLog, OTPCode, User, AuthMethod,
    CredentialType, LogResult, UnlockSession, UnlockSessionStatus,
)
from ..schemas import (
    AuthRequest, OTPResponse, ESPAuthResponse,
    UnlockSessionResponse, UnlockSessionUpdate,
)
from ..auth import get_current_active_user, get_current_admin

router = APIRouter(prefix="/api", tags=["ESP32 Hardware"])


# ─── Unlock Sessions (Web → ESP32) ──────────────────────────────

@router.post("/unlock/request", response_model=UnlockSessionResponse)
def create_unlock_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    User clicks 'Unlock Door' on the web app.
    Creates a session the ESP32 polls for and begins the auth sequence.
    """
    # Get user's enabled auth methods in priority order
    methods = (
        db.query(AuthMethod)
        .filter(AuthMethod.user_id == current_user.id, AuthMethod.enabled == True)
        .order_by(AuthMethod.priority)
        .all()
    )

    if not methods:
        raise HTTPException(status_code=400, detail="No authentication methods enabled. Configure them in Auth Settings.")

    method_list = [m.type.value for m in methods]

    session = UnlockSession(
        user_id=current_user.id,
        house_id=current_user.house_id,
        status=UnlockSessionStatus.pending,
        auth_methods=json.dumps(method_list),
        current_method=None,
        expires_at=datetime.utcnow() + timedelta(minutes=2),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return UnlockSessionResponse(
        id=session.id,
        user_id=session.user_id,
        status=session.status,
        auth_methods=method_list,
        current_method=session.current_method,
        created_at=session.created_at,
        expires_at=session.expires_at,
        completed_at=session.completed_at,
    )


@router.get("/unlock/{session_id}", response_model=UnlockSessionResponse)
def get_unlock_session(
    session_id: str,
    db: Session = Depends(get_db),
):
    """Poll endpoint — both web app and ESP32 use this to check session status."""
    session = db.query(UnlockSession).filter(UnlockSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Auto-expire
    if session.status == UnlockSessionStatus.pending and datetime.utcnow() > session.expires_at:
        session.status = UnlockSessionStatus.expired
        db.commit()

    return UnlockSessionResponse(
        id=session.id,
        user_id=session.user_id,
        status=session.status,
        auth_methods=json.loads(session.auth_methods),
        current_method=session.current_method,
        created_at=session.created_at,
        expires_at=session.expires_at,
        completed_at=session.completed_at,
    )


@router.patch("/unlock/{session_id}", response_model=UnlockSessionResponse)
def update_unlock_session(
    session_id: str,
    update: UnlockSessionUpdate,
    db: Session = Depends(get_db),
):
    """
    ESP32 calls this to update session status as it progresses:
    pending → authenticating → success/failed
    """
    session = db.query(UnlockSession).filter(UnlockSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = update.status
    if update.current_method:
        session.current_method = update.current_method

    if update.status in (UnlockSessionStatus.success, UnlockSessionStatus.failed):
        session.completed_at = datetime.utcnow()
        # Log the result
        user = db.query(User).filter(User.id == session.user_id).first()
        log = AccessLog(
            user_id=session.user_id,
            house_id=session.house_id,
            action="door_unlock",
            method=session.current_method or "web_unlock",
            result=LogResult.success if update.status == UnlockSessionStatus.success else LogResult.failed,
        )
        db.add(log)

    db.commit()
    db.refresh(session)

    return UnlockSessionResponse(
        id=session.id,
        user_id=session.user_id,
        status=session.status,
        auth_methods=json.loads(session.auth_methods),
        current_method=session.current_method,
        created_at=session.created_at,
        expires_at=session.expires_at,
        completed_at=session.completed_at,
    )


@router.post("/unlock/{session_id}/cancel")
def cancel_unlock_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """User cancels an in-progress unlock request."""
    session = db.query(UnlockSession).filter(
        UnlockSession.id == session_id,
        UnlockSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = UnlockSessionStatus.cancelled
    session.completed_at = datetime.utcnow()
    db.commit()
    return {"message": "Unlock session cancelled"}


@router.get("/unlock/pending/next")
def get_next_pending_session(db: Session = Depends(get_db)):
    """
    ESP32 polls this to check if there's an unlock request waiting.
    Returns the oldest pending session or 204 if none.
    """
    session = (
        db.query(UnlockSession)
        .filter(
            UnlockSession.status == UnlockSessionStatus.pending,
            UnlockSession.expires_at > datetime.utcnow(),
        )
        .order_by(UnlockSession.created_at)
        .first()
    )

    if not session:
        return {"status": "none"}

    user = db.query(User).filter(User.id == session.user_id).first()
    return {
        "status": "pending",
        "session_id": session.id,
        "user_name": user.full_name if user else "Unknown",
        "auth_methods": json.loads(session.auth_methods),
    }


# ─── Direct ESP32 Auth (sensor-initiated) ───────────────────────

@router.post("/auth/verify", response_model=ESPAuthResponse)
def verify_authentication(request: AuthRequest, db: Session = Depends(get_db)):
    """
    ESP32 endpoint — receives method + payload from sensors,
    verifies against the database, logs the attempt, returns unlock/none.
    """
    # --- OTP Logic ---
    if request.method_used == "otp":
        valid_otp = db.query(OTPCode).filter(OTPCode.code == request.payload).first()

        if valid_otp and datetime.now() < valid_otp.expires_at:
            log = AccessLog(
                user_id=None, house_id=None,
                action="door_unlock", method="otp", result=LogResult.success,
            )
            db.add(log)
            db.delete(valid_otp)
            db.commit()
            return {"status": "success", "action": "unlock"}

        log = AccessLog(
            user_id=None, house_id=None,
            action="door_unlock", method="otp", result=LogResult.failed,
        )
        db.add(log)
        db.commit()
        return {"status": "failure", "action": "none"}

    # --- Standard credential logic ---
    valid_cred = (
        db.query(Credential)
        .filter(
            Credential.type == request.method_used,
            Credential.credential_value == request.payload,
            Credential.registered == True,
        )
        .first()
    )

    if valid_cred:
        user = db.query(User).filter(User.id == valid_cred.user_id).first()
        log = AccessLog(
            user_id=valid_cred.user_id,
            house_id=user.house_id if user else None,
            action="door_unlock", method=request.method_used, result=LogResult.success,
        )
        db.add(log)
        db.commit()
        return {"status": "success", "action": "unlock"}

    log = AccessLog(
        user_id=None, house_id=None,
        action="door_unlock", method=request.method_used, result=LogResult.failed,
    )
    db.add(log)
    db.commit()
    return {"status": "failure", "action": "none"}


@router.get("/otp/generate", response_model=OTPResponse)
def generate_otp(db: Session = Depends(get_db)):
    """Generate a 6-digit OTP valid for 5 minutes."""
    new_code = str(random.randint(100000, 999999))
    expiration_time = datetime.now() + timedelta(minutes=5)
    db_otp = OTPCode(code=new_code, expires_at=expiration_time)
    db.add(db_otp)
    db.commit()
    return {"status": "success", "otp": new_code, "expires_in": "5 minutes"}


@router.get("/esp/status")
def esp_status():
    """Health check for ESP32 connectivity."""
    return {"status": "online", "message": "FortiNest ESP32 API is running"}


@router.post("/esp/emergency-unlock")
def emergency_unlock(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Admin-only emergency remote unlock."""
    log = AccessLog(
        user_id=current_user.id,
        house_id=current_user.house_id,
        action="emergency_unlock", method="admin_override", result=LogResult.success,
    )
    db.add(log)
    db.commit()
    return {"status": "success", "action": "unlock"}
