"""
IoT Access Control API - FastAPI Backend
Supports configurable single-method or multi-stage sequential MFA for ESP32 devices.
"""

from datetime import datetime
from typing import Dict, Optional, List
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .models import (
    Credential,
    CredentialType,
    OTPCode,
    AccessLog,
    LogResult,
    House,
    HouseMembership,
    UserStatus,
    User,
    get_ist_now,
)
from .credential_utils import normalize_rfid_tag
from .email_service import send_breakin_alert

# Import routers
from .routers import auth_router, users_router, house_router, logs_router, credentials_router, esp_router

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="IoT Access Control API",
    description="ESP32 verification backend with configurable single-step or staged MFA",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(house_router.router)
app.include_router(logs_router.router)
app.include_router(credentials_router.router)
app.include_router(esp_router.router)


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURABLE AUTHENTICATION ORDER
# ═══════════════════════════════════════════════════════════════════════════════
# Hardcoded active method order. Change this to configure system-wide authentication.
# Single-method mode: ["rfid"] or ["keypad"] or ["otp"] or ["fingerprint"]
# Multi-stage mode: ["rfid", "keypad"] or ["fingerprint", "otp"], etc.
# ═══════════════════════════════════════════════════════════════════════════════
ACTIVE_AUTH_ORDER = ["rfid", "keypad"]


# In-memory session store for multi-stage authentication.
# Maps session_id -> {"user_id": str|None, "house_id": str|None, "last_verified_step": int, "created_at": datetime}
ACTIVE_SESSIONS: Dict[str, Dict[str, object]] = {}

# In-memory failed-attempt streak per house for security alerts.
FAILED_STREAK_BY_HOUSE: Dict[str, int] = {}
# Track unknown credential attempts globally
UNKNOWN_CREDENTIAL_FAILURES: int = 0
FAILED_ALERT_THRESHOLD = 3

# Session timeout in seconds (5 minutes)
SESSION_TIMEOUT_SECONDS = 300


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas
# ═══════════════════════════════════════════════════════════════════════════════

class DeviceConfigResponse(BaseModel):
    """Response for GET /api/device/config"""
    order: list[str]


class VerifyRequest(BaseModel):
    """Request body for POST /api/auth/verify"""
    method_used: str = Field(..., min_length=1, description="Authentication method: rfid, keypad, fingerprint, or otp")
    payload: str = Field(..., min_length=1, description="The credential value to verify")
    step: int = Field(..., ge=1, description="Current authentication step (1-indexed)")
    session_id: Optional[str] = Field(None, description="Session ID for multi-stage auth (required for step > 1)")


class VerifyResponse(BaseModel):
    """Response for POST /api/auth/verify"""
    status: str  # "success", "failure", or "authenticating"
    session_id: Optional[str] = None
    message: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════════

def _get_active_order() -> list[str]:
    """Get and normalize the active authentication order (hardcoded fallback)."""
    return [m.strip().lower() for m in ACTIVE_AUTH_ORDER if m and m.strip()]


def _get_active_order_from_db(db: Session) -> list[str]:
    """Get authentication order from database. Falls back to hardcoded if no config."""
    # Get the first active membership to read config from
    first_membership = (
        db.query(HouseMembership)
        .filter(HouseMembership.status == "active")
        .first()
    )

    if not first_membership:
        print("[CONFIG] No active membership, using hardcoded")
        return _get_active_order()

    print(f"[CONFIG] Reading from membership: {first_membership.id}")

    # Get enabled credentials ordered by priority
    credentials = (
        db.query(Credential)
        .filter(
            Credential.membership_id == first_membership.id,
            Credential.enabled == True,
        )
        .order_by(Credential.priority)
        .all()
    )

    for c in credentials:
        print(f"[CONFIG]   {c.type.value} priority={c.priority}")

    # Extract method types in priority order
    order = [c.type.value for c in credentials if c.type.value in ["rfid", "keypad", "otp", "fingerprint"]]

    print(f"[CONFIG] Final order: {order}")
    return order if order else _get_active_order()


def _normalize_method(method: str) -> str:
    """Normalize method name (e.g., 'pin' -> 'keypad')."""
    method = (method or "").strip().lower()
    if method == "pin":
        return "keypad"
    return method


def _clean_expired_sessions() -> None:
    """Remove expired sessions from the in-memory store."""
    now = get_ist_now()
    expired = [
        sid for sid, data in ACTIVE_SESSIONS.items()
        if (now - data.get("created_at", now)).total_seconds() > SESSION_TIMEOUT_SECONDS
    ]
    for sid in expired:
        ACTIVE_SESSIONS.pop(sid, None)


def _find_user_id_by_credential(db: Session, method_used: str, payload: str) -> Optional[tuple[str, str]]:
    """
    Find the user_id associated with a credential.
    Returns (user_id, house_id) if found and valid, otherwise None.
    """
    try:
        cred_type = CredentialType(method_used)
    except ValueError:
        return None

    # Normalize RFID payload
    if method_used == "rfid":
        payload = normalize_rfid_tag(payload) or payload

    # Query the Credential table joined with HouseMembership to get user_id
    # Note: `registered` is now a property, so we check credential_value is not null
    result = (
        db.query(Credential, HouseMembership.user_id, HouseMembership.house_id)
        .join(HouseMembership, Credential.membership_id == HouseMembership.id)
        .filter(
            Credential.type == cred_type,
            Credential.credential_value == payload,
            Credential.credential_value.isnot(None),
            HouseMembership.status == UserStatus.active,
        )
        .first()
    )

    if result:
        return str(result[1]), str(result[2])
    return None


def _is_house_locked(db: Session, house_id: Optional[str]) -> bool:
    """Check whether a house is currently in lockdown mode."""
    if not house_id:
        return False
    house = db.query(House).filter(House.id == house_id).first()
    return bool(house and house.lockdown)


def _verify_otp(db: Session, payload: str) -> bool:
    """
    Verify an OTP code. Burns (deletes) the OTP if valid.
    Returns True if valid and not expired, False otherwise.
    """
    otp = db.query(OTPCode).filter(OTPCode.code == payload).first()
    if not otp:
        return False

    # Compare as naive datetimes to handle legacy data
    now = get_ist_now().replace(tzinfo=None)
    expires = otp.expires_at.replace(tzinfo=None) if otp.expires_at.tzinfo else otp.expires_at
    
    if now >= expires:
        # OTP expired - optionally clean it up
        db.delete(otp)
        db.commit()
        return False

    # Burn the OTP (one-time use)
    db.delete(otp)
    db.commit()
    return True


def _get_house_admin_emails(db: Session, house_id: str) -> List[str]:
    """Get email addresses of all admins/owners for a house."""
    memberships = db.query(HouseMembership).filter(
        HouseMembership.house_id == house_id,
        HouseMembership.role.in_(["owner", "admin"]),
        HouseMembership.status == UserStatus.active
    ).all()
    
    emails = []
    for membership in memberships:
        user = db.query(User).filter(User.id == membership.user_id).first()
        if user and user.email:
            emails.append(user.email)
    return emails


def _register_failed_attempt_alert_if_needed(db: Session, house_id: str, method_used: str = None) -> None:
    """Raise a security alert log if failed unlock attempts hit threshold."""
    streak = FAILED_STREAK_BY_HOUSE.get(house_id, 0) + 1
    FAILED_STREAK_BY_HOUSE[house_id] = streak

    if streak >= FAILED_ALERT_THRESHOLD:
        db.add(AccessLog(
            user_id="system",
            house_id=house_id,
            action=f"Security Alert: {FAILED_ALERT_THRESHOLD} consecutive failed unlock attempts",
            method="security_monitor",
            result=LogResult.alert,
            category="system",
        ))
        
        # Send email alert to house admins
        house = db.query(House).filter(House.id == house_id).first()
        if house:
            admin_emails = _get_house_admin_emails(db, house_id)
            send_breakin_alert(
                recipient_emails=admin_emails,
                house_name=house.name,
                failed_attempts=FAILED_ALERT_THRESHOLD,
                last_method=method_used
            )
        
        # Reset so we alert once per streak sequence.
        FAILED_STREAK_BY_HOUSE[house_id] = 0


def _add_access_log(
    db: Session,
    user_id: Optional[str],
    house_id: Optional[str],
    method_used: str,
    status: str,
    action: Optional[str] = None,
    credential_payload: Optional[str] = None,
) -> None:
    """Add an entry to the access log."""
    global UNKNOWN_CREDENTIAL_FAILURES
    
    resolved_action = action or ("Door Unlocked" if status == "success" else "Door Unlock Failed")
    log = AccessLog(
        user_id=user_id or "unknown",
        house_id=house_id,
        action=resolved_action,
        method=method_used,
        result=LogResult.success if status == "success" else LogResult.failed,
        category="unlock",
        credential_payload=credential_payload[:100] if credential_payload else None,
    )
    db.add(log)

    if status == "success":
        # Reset counters on success
        UNKNOWN_CREDENTIAL_FAILURES = 0
        if house_id:
            FAILED_STREAK_BY_HOUSE[house_id] = 0
    elif status == "failure":
        if house_id:
            _register_failed_attempt_alert_if_needed(db, house_id, method_used)
        elif credential_payload:
            # Unknown credential - track globally and alert all admins after threshold
            UNKNOWN_CREDENTIAL_FAILURES += 1
            if UNKNOWN_CREDENTIAL_FAILURES >= FAILED_ALERT_THRESHOLD:
                _register_unknown_credential_alert(db, method_used, credential_payload)
                UNKNOWN_CREDENTIAL_FAILURES = 0


def _register_unknown_credential_alert(db: Session, method: str, payload: str) -> None:
    """Send alert to all system admins when unknown credentials hit threshold."""
    # Get all house owners/admins to alert
    all_admin_emails = set()
    houses = db.query(House).all()
    for house in houses:
        admins = (
            db.query(User)
            .join(HouseMembership, HouseMembership.user_id == User.id)
            .filter(
                HouseMembership.house_id == house.id,
                HouseMembership.role.in_(["owner", "admin"]),
            )
            .all()
        )
        for admin in admins:
            if admin.email:
                all_admin_emails.add(admin.email)
    
    if all_admin_emails:
        send_breakin_alert(
            list(all_admin_emails),
            "SYSTEM (Unknown Credential)",
            FAILED_ALERT_THRESHOLD,
            method
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Core Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
def root():
    """API root - health check."""
    return {"message": "IoT Access Control API", "version": "2.0.0"}


@app.get("/health")
def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/device/config", response_model=DeviceConfigResponse)
def get_device_config(db: Session = Depends(get_db)):
    """
    GET /api/device/config

    Returns the current authentication configuration for ESP32 devices.
    Reads enabled methods from the database, ordered by priority.

    Examples:
    - Single method: {"order": ["rfid"]} - Only RFID required
    - Multi-stage: {"order": ["rfid", "keypad"]} - RFID first, then keypad PIN
    """
    order = _get_active_order_from_db(db)
    return DeviceConfigResponse(order=order)


@app.post("/api/auth/verify", response_model=VerifyResponse)
def verify_auth(request: VerifyRequest, db: Session = Depends(get_db)):
    """
    POST /api/auth/verify

    Verifies a single authentication factor sent by the ESP32.

    Request:
    - method_used: "rfid" | "keypad" | "fingerprint" | "otp"
    - payload: The credential value (RFID UID, PIN, fingerprint ID, or OTP code)
    - step: Current step number (1-indexed)
    - session_id: Required for step > 1 (returned from step 1 in multi-stage mode)

    Response:
    - {"status": "success"} - Authentication complete, unlock the door
    - {"status": "failure"} - Authentication failed
    - {"status": "authenticating", "session_id": "..."} - Proceed to next step
    """
    # Clean up expired sessions periodically
    _clean_expired_sessions()

    method_used = _normalize_method(request.method_used)
    payload = request.payload.strip()
    order = _get_active_order_from_db(db)
    total_steps = len(order)

    # Validate method
    allowed_methods = {"rfid", "keypad", "fingerprint", "otp"}
    if method_used not in allowed_methods:
        _add_access_log(db, None, None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    # Validate step number
    if request.step < 1 or request.step > total_steps:
        _add_access_log(db, None, None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    # Validate that the method matches the expected method for this step
    expected_method = order[request.step - 1]
    if method_used != expected_method:
        _add_access_log(db, None, None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    # ─── STEP 1 ─────────────────────────────────────────────────────────────
    if request.step == 1:
        # OTP verification (step 1)
        if method_used == "otp":
            if _verify_otp(db, payload):
                if total_steps == 1:
                    _add_access_log(db, None, None, method_used, "success")
                    db.commit()
                    return VerifyResponse(status="success")
                else:
                    # OTP valid but more steps needed
                    session_id = str(uuid4())
                    ACTIVE_SESSIONS[session_id] = {
                        "user_id": None,  # OTP doesn't bind to a specific user
                        "house_id": None,
                        "last_verified_step": 1,
                        "created_at": get_ist_now(),
                    }
                    db.commit()
                    return VerifyResponse(status="authenticating", session_id=session_id)
            else:
                _add_access_log(db, None, None, method_used, "failure", credential_payload=payload)
                db.commit()
                return VerifyResponse(status="failure")

        # Credential-based verification (RFID, keypad, fingerprint)
        matched = _find_user_id_by_credential(db, method_used, payload)
        if not matched:
            _add_access_log(db, None, None, method_used, "failure", credential_payload=payload)
            db.commit()
            return VerifyResponse(status="failure")

        user_id, house_id = matched

        if _is_house_locked(db, house_id):
            _add_access_log(
                db,
                user_id,
                house_id,
                method_used,
                "failure",
                action="Door Unlock Blocked (Lockdown)",
            )
            db.commit()
            return VerifyResponse(status="failure", message="House is in lockdown")

        # Single-step mode: immediate success
        if total_steps == 1:
            _add_access_log(db, user_id, house_id, method_used, "success")
            db.commit()
            return VerifyResponse(status="success")

        # Multi-stage mode: create session and continue
        session_id = str(uuid4())
        ACTIVE_SESSIONS[session_id] = {
            "user_id": user_id,
            "house_id": house_id,
            "last_verified_step": 1,
            "created_at": get_ist_now(),
        }
        db.commit()
        return VerifyResponse(status="authenticating", session_id=session_id)

    # ─── STEP 2+ ────────────────────────────────────────────────────────────
    # Require session_id for subsequent steps
    if not request.session_id:
        _add_access_log(db, None, None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    session_data = ACTIVE_SESSIONS.get(request.session_id)
    if not session_data:
        _add_access_log(db, None, None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    # Validate step sequence
    last_verified_step = int(session_data["last_verified_step"])
    if request.step != last_verified_step + 1:
        _add_access_log(db, str(session_data.get("user_id")) if session_data.get("user_id") else None, str(session_data.get("house_id")) if session_data.get("house_id") else None, method_used, "failure")
        db.commit()
        return VerifyResponse(status="failure")

    session_user_id = session_data.get("user_id")
    session_house_id = session_data.get("house_id")

    if _is_house_locked(db, str(session_house_id) if session_house_id else None):
        _add_access_log(
            db,
            str(session_user_id) if session_user_id else None,
            str(session_house_id) if session_house_id else None,
            method_used,
            "failure",
            action="Door Unlock Blocked (Lockdown)",
        )
        db.commit()
        return VerifyResponse(status="failure", message="House is in lockdown")

    # OTP verification (step 2+)
    if method_used == "otp":
        if not _verify_otp(db, payload):
            _add_access_log(db, str(session_user_id) if session_user_id else None, str(session_house_id) if session_house_id else None, method_used, "failure")
            db.commit()
            return VerifyResponse(status="failure")
        verified_user_id = session_user_id
        verified_house_id = session_house_id
    else:
        # Credential-based verification
        matched = _find_user_id_by_credential(db, method_used, payload)
        if not matched:
            _add_access_log(db, str(session_user_id) if session_user_id else None, str(session_house_id) if session_house_id else None, method_used, "failure")
            db.commit()
            return VerifyResponse(status="failure")

        verified_user_id, verified_house_id = matched

        if _is_house_locked(db, str(verified_house_id) if verified_house_id else None):
            _add_access_log(
                db,
                str(verified_user_id) if verified_user_id else None,
                str(verified_house_id) if verified_house_id else None,
                method_used,
                "failure",
                action="Door Unlock Blocked (Lockdown)",
            )
            db.commit()
            return VerifyResponse(status="failure", message="House is in lockdown")

        # For non-OTP methods, verify same user if session has a user
        if session_user_id and verified_user_id and str(verified_user_id) != str(session_user_id):
            _add_access_log(db, str(session_user_id), str(session_house_id) if session_house_id else None, method_used, "failure")
            db.commit()
            return VerifyResponse(status="failure")

        if session_house_id and verified_house_id and str(verified_house_id) != str(session_house_id):
            _add_access_log(db, str(session_user_id) if session_user_id else None, str(session_house_id), method_used, "failure")
            db.commit()
            return VerifyResponse(status="failure")

    # Check if this is the final step
    if request.step == total_steps:
        # Clear the session
        ACTIVE_SESSIONS.pop(request.session_id, None)
        _add_access_log(
            db,
            str(verified_user_id) if verified_user_id else (str(session_user_id) if session_user_id else None),
            str(verified_house_id) if verified_house_id else (str(session_house_id) if session_house_id else None),
            method_used,
            "success",
        )
        db.commit()
        return VerifyResponse(status="success")

    # More steps remaining - update session
    session_data["last_verified_step"] = request.step
    if verified_user_id:
        session_data["user_id"] = verified_user_id
    if verified_house_id:
        session_data["house_id"] = verified_house_id
    db.commit()
    return VerifyResponse(status="authenticating", session_id=request.session_id)
