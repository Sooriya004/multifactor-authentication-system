"""
ESP32 Hardware Router - Handles device registration and OTP generation.

Endpoints for:
- Device registration (fingerprint, RFID)
- OTP generation
- ESP32 status/health checks
- Lockdown management
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import Optional
import random

from ..database import get_db
from ..models import (
    Credential,
    AccessLog,
    OTPCode,
    User,
    House,
    CredentialType,
    LogResult,
    RegistrationRequest,
    RegistrationStatus,
    get_ist_now,
)
from ..schemas import (
    OTPResponse,
    DeviceRegisterCompleteRequest,
    DeviceRegisterCompleteResponse,
    DeviceRFIDRegisterCompleteRequest,
)
from ..auth import get_current_active_user, get_house_id_header, get_membership, require_admin_membership
from ..credential_utils import normalize_rfid_tag

router = APIRouter(prefix="/api", tags=["ESP32 Hardware"])


# ═══════════════════════════════════════════════════════════════════════════════
# Device Registration Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/device/register_check")
def device_register_check(db: Session = Depends(get_db)):
    """
    ESP32 polls this to check if there are pending registration requests.
    Returns flags for fingerprint and RFID registration.
    """
    pending_fingerprint = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.credential_type == CredentialType.fingerprint,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at)
        .first()
    )

    pending_rfid = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.credential_type == CredentialType.rfid,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at)
        .first()
    )

    return {
        "register_fingerprint": bool(pending_fingerprint),
        "fingerprint_id": int(pending_fingerprint.extra_data) if pending_fingerprint and pending_fingerprint.extra_data else None,
        "register_rfid": bool(pending_rfid),
    }


@router.post("/device/register_complete", response_model=DeviceRegisterCompleteResponse)
def device_register_complete(
    payload: DeviceRegisterCompleteRequest,
    db: Session = Depends(get_db),
):
    """
    ESP32 calls this after enrolling a fingerprint template.
    Updates the registration request and creates/updates the credential.
    """
    pending = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.credential_type == CredentialType.fingerprint,
            RegistrationRequest.extra_data == str(payload.fingerprint_id),
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at)
        .first()
    )

    if not pending:
        raise HTTPException(status_code=404, detail="No pending registration found for fingerprint ID")

    pending.status = RegistrationStatus.completed if payload.success else RegistrationStatus.failed
    pending.completed_at = get_ist_now()

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
        credential.registered_at = get_ist_now()

    db.add(AccessLog(
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
    ))

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


@router.post("/device/rfid/register_complete")
def device_rfid_register_complete(
    payload: DeviceRFIDRegisterCompleteRequest,
    db: Session = Depends(get_db),
):
    """
    ESP32 calls this after scanning an RFID tag for registration.
    """
    normalized_tag = normalize_rfid_tag(payload.tag_uid)

    pending = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.credential_type == CredentialType.rfid,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at)
        .first()
    )

    if pending:
        pending.completed_at = get_ist_now()

        if payload.success and normalized_tag:
            pending.status = RegistrationStatus.completed
            pending.extra_data = normalized_tag

            credential = (
                db.query(Credential)
                .filter(
                    Credential.membership_id == pending.membership_id,
                    Credential.type == CredentialType.rfid,
                )
                .first()
            )
            if not credential:
                credential = Credential(
                    membership_id=pending.membership_id,
                    type=CredentialType.rfid,
                )
                db.add(credential)

            credential.credential_value = normalized_tag
            credential.registered_at = get_ist_now()

            db.add(AccessLog(
                user_id=pending.requested_by_user_id,
                house_id=pending.house_id,
                action=f"RFID tag registered ({normalized_tag})",
                method="rfid",
                result=LogResult.success,
                category="system",
            ))
        else:
            pending.status = RegistrationStatus.failed
            if normalized_tag:
                pending.extra_data = normalized_tag

        db.commit()

    return {"status": "stored"}


# ═══════════════════════════════════════════════════════════════════════════════
# OTP Generation
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/otp/generate", response_model=OTPResponse)
def generate_otp(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Generate a 6-digit OTP valid for 5 minutes. Admin only."""
    m = require_admin_membership(db, current_user, x_house_id)

    new_code = str(random.randint(100000, 999999))
    expiration_time = get_ist_now() + timedelta(minutes=5)
    db_otp = OTPCode(code=new_code, expires_at=expiration_time)
    db.add(db_otp)

    db.add(AccessLog(
        user_id=current_user.id,
        house_id=m.house_id,
        action="OTP Generated",
        method="Dashboard",
        result=LogResult.success,
        category="system",
    ))
    db.commit()

    return {"status": "success", "otp": new_code, "expires_in": "5 minutes"}


# ═══════════════════════════════════════════════════════════════════════════════
# ESP32 Status
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/esp/status")
def esp_status():
    """Health check for ESP32 connectivity."""
    return {"status": "online", "message": "FortiNest ESP32 API is running"}


# ═══════════════════════════════════════════════════════════════════════════════
# Lockdown Management
# ═══════════════════════════════════════════════════════════════════════════════

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
    """Toggle lockdown - primary admin only."""
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
        house.lockdown_at = get_ist_now()
        action = "Lockdown Activated"
    else:
        house.lockdown_by = None
        house.lockdown_at = None
        action = "Lockdown Lifted"

    db.add(AccessLog(
        user_id=current_user.id,
        house_id=m.house_id,
        action=action,
        method="Dashboard",
        result=LogResult.success,
        category="system",
    ))
    db.commit()

    return {"message": action, "lockdown": house.lockdown}
