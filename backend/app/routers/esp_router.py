from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional
import random
import json

from ..database import get_db
from ..models import (
    Credential, AccessLog, OTPCode, User, AuthMethod, House,
    HouseMembership, CredentialType, LogResult, UnlockSession, UnlockSessionStatus,
    UserStatus, FingerprintRegistrationRequest, FingerprintRegistrationStatus,
    CredentialRegistrationRequest, CredentialRegistrationStatus,
)
from ..schemas import (
    AuthRequest, OTPResponse, ESPAuthResponse,
    UnlockSessionResponse, UnlockSessionUpdate,
    DeviceRegisterCheckResponse, DeviceRegisterCompleteRequest, DeviceRegisterCompleteResponse,
    DeviceCredentialCheckResponse, DeviceCredentialCompleteRequest, DeviceCredentialCompleteResponse,
)
from ..auth import get_current_active_user, get_house_id_header, get_membership, require_admin_membership

router = APIRouter(prefix="/api", tags=["ESP32 Hardware"])


# ─── Unlock Sessions (Web → ESP32) ──────────────────────────────

@router.post("/unlock/request", response_model=UnlockSessionResponse)
def create_unlock_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """
    User clicks 'Unlock Door' on the web app.
    Creates a session the ESP32 polls for and begins the auth sequence.
    """
    m = get_membership(db, current_user, x_house_id)

    # Check lockdown
    house = db.query(House).filter(House.id == m.house_id).first()
    if house and house.lockdown:
        raise HTTPException(status_code=403, detail="House is in lockdown. All access is blocked.")

    # Get user's enabled auth methods in priority order (per membership)
    methods = (
        db.query(AuthMethod)
        .filter(AuthMethod.membership_id == m.id, AuthMethod.enabled == True)
        .order_by(AuthMethod.priority)
        .all()
    )

    if not methods:
        raise HTTPException(status_code=400, detail="No authentication methods enabled. Configure them in Auth Settings.")

    method_list = [mt.type.value for mt in methods]
    first_method = method_list[0] if method_list else None

    session = UnlockSession(
        user_id=current_user.id,
        house_id=m.house_id,
        status=UnlockSessionStatus.pending,
        auth_methods=json.dumps(method_list),
        current_method=first_method,
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

    methods = json.loads(session.auth_methods)
    current_method = update.current_method or session.current_method or (methods[0] if methods else None)

    if update.status == UnlockSessionStatus.success:
        # Current method succeeded; advance if more methods remain
        if current_method in methods:
            idx = methods.index(current_method)
            if idx + 1 < len(methods):
                session.status = UnlockSessionStatus.authenticating
                session.current_method = methods[idx + 1]
            else:
                session.status = UnlockSessionStatus.success
                session.current_method = current_method
                session.completed_at = datetime.utcnow()
                db.add(
                    AccessLog(
                        user_id=session.user_id,
                        house_id=session.house_id,
                        action="door_access",
                        method=current_method or "web_unlock",
                        result=LogResult.success,
                        category="access",
                    )
                )
        else:
            session.status = UnlockSessionStatus.success
            session.completed_at = datetime.utcnow()
    elif update.status == UnlockSessionStatus.failed:
        session.status = UnlockSessionStatus.failed
        session.current_method = current_method
        session.completed_at = datetime.utcnow()
        db.add(
            AccessLog(
                user_id=session.user_id,
                house_id=session.house_id,
                action="door_access",
                method=current_method or "web_unlock",
                result=LogResult.failed,
                category="access",
            )
        )
    else:
        session.status = update.status
        if current_method:
            session.current_method = current_method

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
        "current_method": session.current_method,
    }


# ─── Direct ESP32 Auth (sensor-initiated) ───────────────────────

@router.get("/device/register_check", response_model=DeviceRegisterCheckResponse)
def device_register_check(db: Session = Depends(get_db)):
    """
    ESP32 polling endpoint.
    Returns the next pending fingerprint registration request, if any.
    """
    pending = (
        db.query(FingerprintRegistrationRequest)
        .filter(FingerprintRegistrationRequest.status == FingerprintRegistrationStatus.pending)
        .order_by(FingerprintRegistrationRequest.requested_at)
        .first()
    )

    if not pending:
        return DeviceRegisterCheckResponse(register_fingerprint=False)

    return DeviceRegisterCheckResponse(
        register_fingerprint=True,
        fingerprint_id=pending.fingerprint_id,
    )


@router.get("/device/credential_check", response_model=DeviceCredentialCheckResponse)
def device_credential_check(db: Session = Depends(get_db)):
    """
    ESP32 polling endpoint for RFID/Keypad registration.
    Returns the next pending credential registration request, if any.
    """
    pending = (
        db.query(CredentialRegistrationRequest)
        .filter(CredentialRegistrationRequest.status == CredentialRegistrationStatus.pending)
        .order_by(CredentialRegistrationRequest.requested_at)
        .first()
    )

    if not pending:
        return DeviceCredentialCheckResponse(register_credential=False)

    return DeviceCredentialCheckResponse(
        register_credential=True,
        credential_type=pending.credential_type,
        request_id=pending.id,
    )


@router.post("/device/register_complete", response_model=DeviceRegisterCompleteResponse)
def device_register_complete(
    payload: DeviceRegisterCompleteRequest,
    db: Session = Depends(get_db),
):
    """
    ESP32 completion callback after enrolling a fingerprint template.
    """
    pending = (
        db.query(FingerprintRegistrationRequest)
        .filter(
            FingerprintRegistrationRequest.fingerprint_id == payload.fingerprint_id,
            FingerprintRegistrationRequest.status == FingerprintRegistrationStatus.pending,
        )
        .order_by(FingerprintRegistrationRequest.requested_at)
        .first()
    )
    if not pending:
        raise HTTPException(status_code=404, detail="No pending registration found for fingerprint ID")

    pending.status = (
        FingerprintRegistrationStatus.completed if payload.success else FingerprintRegistrationStatus.failed
    )
    pending.completed_at = datetime.utcnow()

    if payload.success:
        credential = (
            db.query(Credential)
            .filter(
                Credential.membership_id == pending.membership_id,
                Credential.type == CredentialType.fingerprint,
            )
            .first()
        )
        if not credential:
            credential = Credential(
                membership_id=pending.membership_id,
                type=CredentialType.fingerprint,
            )
            db.add(credential)

        credential.credential_value = str(payload.fingerprint_id)
        credential.data = f"fingerprint_template:{payload.fingerprint_id}"
        credential.registered = True
        credential.registered_at = datetime.utcnow()

    db.add(
        AccessLog(
            user_id=pending.requested_by_user_id,
            house_id=pending.house_id,
            action=(
                f"Fingerprint registered (ID {payload.fingerprint_id})"
                if payload.success
                else f"Fingerprint registration failed (ID {payload.fingerprint_id})"
            ),
            method="fingerprint",
            result=LogResult.success if payload.success else LogResult.failed,
            category="system",
        )
    )

    db.commit()
    return DeviceRegisterCompleteResponse(
        status="success" if payload.success else "failure",
        message=(
            "Fingerprint registered and stored"
            if payload.success
            else "Fingerprint registration marked as failed"
        ),
        fingerprint_id=payload.fingerprint_id,
    )


@router.post("/device/credential_complete", response_model=DeviceCredentialCompleteResponse)
def device_credential_complete(
    payload: DeviceCredentialCompleteRequest,
    db: Session = Depends(get_db),
):
    """
    ESP32 completion callback after enrolling RFID/Keypad credentials.
    """
    pending = (
        db.query(CredentialRegistrationRequest)
        .filter(
            CredentialRegistrationRequest.id == payload.request_id,
            CredentialRegistrationRequest.credential_type == payload.credential_type,
            CredentialRegistrationRequest.status == CredentialRegistrationStatus.pending,
        )
        .order_by(CredentialRegistrationRequest.requested_at)
        .first()
    )
    if not pending:
        raise HTTPException(status_code=404, detail="No pending registration found for this request")

    pending.status = (
        CredentialRegistrationStatus.completed if payload.success else CredentialRegistrationStatus.failed
    )
    pending.completed_at = datetime.utcnow()

    if payload.success:
        credential = (
            db.query(Credential)
            .filter(
                Credential.membership_id == pending.membership_id,
                Credential.type == payload.credential_type,
            )
            .first()
        )
        if not credential:
            credential = Credential(
                membership_id=pending.membership_id,
                type=payload.credential_type,
            )
            db.add(credential)

        credential.credential_value = payload.credential_value
        credential.data = f"{payload.credential_type.value}:{payload.credential_value}"
        credential.registered = True
        credential.registered_at = datetime.utcnow()

    db.add(
        AccessLog(
            user_id=pending.requested_by_user_id,
            house_id=pending.house_id,
            action=(
                f"{payload.credential_type.value.upper()} registered"
                if payload.success
                else f"{payload.credential_type.value.upper()} registration failed"
            ),
            method=payload.credential_type.value,
            result=LogResult.success if payload.success else LogResult.failed,
            category="system",
        )
    )

    db.commit()
    return DeviceCredentialCompleteResponse(
        status="success" if payload.success else "failure",
        message=(
            f"{payload.credential_type.value.upper()} registered and stored"
            if payload.success
            else f"{payload.credential_type.value.upper()} registration marked as failed"
        ),
        credential_type=payload.credential_type,
    )


@router.post("/auth/verify", response_model=ESPAuthResponse)
def verify_authentication(request: AuthRequest, db: Session = Depends(get_db)):
    """
    ESP32 endpoint — receives method + payload from sensors,
    verifies against the database, logs the attempt, returns unlock/none.
    """
    method_used = request.method_used.strip().lower()

    if method_used == "otp":
        valid_otp = db.query(OTPCode).filter(OTPCode.code == request.payload).first()
        if valid_otp and datetime.utcnow() < valid_otp.expires_at:
            db.add(
                AccessLog(
                    user_id="system",
                    house_id=None,
                    action="door_access",
                    method="otp",
                    result=LogResult.success,
                    category="access",
                )
            )
            db.delete(valid_otp)
            db.commit()
            return {"status": "success", "action": "unlock"}

        db.add(
            AccessLog(
                user_id="system",
                house_id=None,
                action="door_access",
                method="otp",
                result=LogResult.failed,
                category="access",
            )
        )
        db.commit()
        return {"status": "failure", "action": "none"}

    if method_used == "pin":
        credential_type = CredentialType.keypad
        log_method = "pin"
    elif method_used in {"keypad", "fingerprint", "rfid"}:
        credential_type = CredentialType(method_used)
        log_method = method_used
    else:
        raise HTTPException(status_code=400, detail="Unsupported auth method")

    valid_cred = (
        db.query(Credential)
        .filter(
            Credential.type == credential_type,
            Credential.credential_value == request.payload,
            Credential.registered == True,  # noqa: E712
        )
        .first()
    )

    if valid_cred:
        membership = db.query(HouseMembership).filter(HouseMembership.id == valid_cred.membership_id).first()
        if membership:
            if membership.status == UserStatus.blocked:
                db.add(
                    AccessLog(
                        user_id=membership.user_id,
                        house_id=membership.house_id,
                        action="door_access",
                        method=log_method,
                        result=LogResult.failed,
                        category="access",
                    )
                )
                db.commit()
                return {"status": "failure", "action": "none"}

            house = db.query(House).filter(House.id == membership.house_id).first()
            if house and house.lockdown:
                db.add(
                    AccessLog(
                        user_id=membership.user_id,
                        house_id=membership.house_id,
                        action="door_access",
                        method=log_method,
                        result=LogResult.failed,
                        category="access",
                    )
                )
                db.commit()
                return {"status": "failure", "action": "none"}

            db.add(
                AccessLog(
                    user_id=membership.user_id,
                    house_id=membership.house_id,
                    action="door_access",
                    method=log_method,
                    result=LogResult.success,
                    category="access",
                )
            )
            db.commit()
            return {"status": "success", "action": "unlock"}

    db.add(
        AccessLog(
            user_id="system",
            house_id=None,
            action="door_access",
            method=log_method,
            result=LogResult.failed,
            category="access",
        )
    )
    db.commit()
    return {"status": "failure", "action": "none"}


@router.get("/otp/generate", response_model=OTPResponse)
def generate_otp(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Generate a 6-digit OTP valid for 5 minutes. Admin only."""
    m = require_admin_membership(db, current_user, x_house_id)

    new_code = str(random.randint(100000, 999999))
    expiration_time = datetime.utcnow() + timedelta(minutes=5)
    db_otp = OTPCode(code=new_code, expires_at=expiration_time)
    db.add(db_otp)

    # Log OTP generation
    log = AccessLog(
        user_id=current_user.id,
        house_id=m.house_id,
        action="OTP Generated",
        method="Dashboard",
        result=LogResult.success,
        category="system",
    )
    db.add(log)
    db.commit()

    return {"status": "success", "otp": new_code, "expires_in": "5 minutes"}


@router.get("/esp/status")
def esp_status():
    """Health check for ESP32 connectivity."""
    return {"status": "online", "message": "FortiNest ESP32 API is running"}


@router.post("/esp/emergency-unlock")
def emergency_unlock(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Admin-only emergency remote unlock."""
    m = require_admin_membership(db, current_user, x_house_id)

    # Check lockdown
    house = db.query(House).filter(House.id == m.house_id).first()
    if house and house.lockdown:
        raise HTTPException(status_code=403, detail="Cannot emergency unlock during lockdown")

    log = AccessLog(
        user_id=current_user.id,
        house_id=m.house_id,
        action="Emergency Unlock", method="admin_override", result=LogResult.success,
        category="access",
    )
    db.add(log)
    db.commit()
    return {"status": "success", "action": "unlock"}


# ─── Lockdown Management ────────────────────────────────────────

@router.get("/house/lockdown")
def get_lockdown_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Get lockdown status for the active house."""
    m = get_membership(db, current_user, x_house_id)
    house = db.query(House).filter(House.id == m.house_id).first()
    if not house:
        raise HTTPException(status_code=404, detail="House not found")

    lockdown_user = None
    if house.lockdown_by:
        u = db.query(User).filter(User.id == house.lockdown_by).first()
        lockdown_user = u.full_name if u else house.lockdown_by

    return {
        "lockdown": house.lockdown,
        "lockdown_by": lockdown_user,
        "lockdown_at": house.lockdown_at.isoformat() if house.lockdown_at else None,
    }


@router.post("/house/lockdown")
def set_lockdown(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Toggle lockdown — primary admin only."""
    m = get_membership(db, current_user, x_house_id)
    if not m.is_primary_admin:
        raise HTTPException(status_code=403, detail="Only the primary admin can control lockdown")

    house = db.query(House).filter(House.id == m.house_id).first()
    if not house:
        raise HTTPException(status_code=404, detail="House not found")

    active = data.get("active", not house.lockdown)
    house.lockdown = active

    if active:
        house.lockdown_by = current_user.id
        house.lockdown_at = datetime.utcnow()
        action = "Lockdown Activated"
    else:
        house.lockdown_by = None
        house.lockdown_at = None
        action = "Lockdown Lifted"

    log = AccessLog(
        user_id=current_user.id,
        house_id=m.house_id,
        action=action,
        method="Dashboard",
        result=LogResult.success,
        category="system",
    )
    db.add(log)
    db.commit()

    return {"message": action, "lockdown": house.lockdown}
