"""
Credentials Router - Manages user credentials and authentication method settings.

With the simplified schema, credentials now include both:
- The actual credential value (RFID UID, PIN, fingerprint ID)
- Auth method settings (enabled, priority)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import (
    User,
    HouseMembership,
    Credential,
    CredentialType,
    RegistrationRequest,
    RegistrationStatus,
    AccessLog,
    LogResult,
)
from ..schemas import (
    CredentialResponse,
    CredentialCreate,
    AuthMethodResponse,
    AuthMethodUpdate,
    FingerprintRegisterStartResponse,
    RFIDRegisterStartResponse,
)
from ..auth import get_current_active_user, get_house_id_header, get_membership, require_admin_membership
from ..credential_utils import normalize_rfid_tag

router = APIRouter(prefix="/credentials", tags=["Credentials & Auth Methods"])


def _get_membership_id(db: Session, user: User, house_id: Optional[str]) -> str:
    m = get_membership(db, user, house_id)
    return m.id


def _ensure_all_credential_types(db: Session, membership_id: str) -> None:
    """Ensure all credential types exist for a membership."""
    existing = db.query(Credential).filter(Credential.membership_id == membership_id).all()
    existing_types = {c.type for c in existing}

    priority = len(existing) + 1
    for cred_type in CredentialType:
        if cred_type not in existing_types:
            db.add(Credential(
                membership_id=membership_id,
                type=cred_type,
                enabled=False,
                priority=priority,
            ))
            priority += 1
    db.commit()


def _next_fingerprint_id(db: Session, house_id: str) -> int:
    """Find the next available fingerprint ID for a house."""
    used_ids = set()

    # Get registered fingerprint IDs
    registered_fingerprints = (
        db.query(Credential.credential_value)
        .join(HouseMembership, Credential.membership_id == HouseMembership.id)
        .filter(
            HouseMembership.house_id == house_id,
            Credential.type == CredentialType.fingerprint,
            Credential.credential_value.isnot(None),
        )
        .all()
    )
    for (value,) in registered_fingerprints:
        if value and str(value).isdigit():
            used_ids.add(int(value))

    # Get pending fingerprint registration request IDs
    pending_requests = (
        db.query(RegistrationRequest.extra_data)
        .filter(
            RegistrationRequest.house_id == house_id,
            RegistrationRequest.credential_type == CredentialType.fingerprint,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .all()
    )
    for (extra_data,) in pending_requests:
        if extra_data and str(extra_data).isdigit():
            used_ids.add(int(extra_data))

    next_id = 1
    while next_id in used_ids:
        next_id += 1
    return next_id


# ═══════════════════════════════════════════════════════════════════════════════
# Credential Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/", response_model=List[CredentialResponse])
async def get_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Get all credentials for the current user's membership."""
    mid = _get_membership_id(db, current_user, x_house_id)
    _ensure_all_credential_types(db, mid)

    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()
    return [
        CredentialResponse(
            id=c.id,
            type=c.type,
            registered=c.registered,
            registered_at=c.registered_at,
            has_credential_value=bool(c.credential_value),
        )
        for c in credentials
    ]


@router.post("/fingerprint/register-request", response_model=FingerprintRegisterStartResponse)
async def request_fingerprint_registration(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Request fingerprint registration - ESP32 will handle the actual enrollment."""
    membership = get_membership(db, current_user, x_house_id)

    # Check for existing pending request
    existing_pending = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.membership_id == membership.id,
            RegistrationRequest.credential_type == CredentialType.fingerprint,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at.desc())
        .first()
    )
    if existing_pending:
        return FingerprintRegisterStartResponse(
            message="Fingerprint registration already pending",
            register_fingerprint=True,
            fingerprint_id=int(existing_pending.extra_data) if existing_pending.extra_data else 1,
        )

    fingerprint_id = _next_fingerprint_id(db, membership.house_id)
    request = RegistrationRequest(
        membership_id=membership.id,
        house_id=membership.house_id,
        requested_by_user_id=current_user.id,
        credential_type=CredentialType.fingerprint,
        status=RegistrationStatus.pending,
        extra_data=str(fingerprint_id),
    )
    db.add(request)
    db.add(AccessLog(
        user_id=current_user.id,
        house_id=membership.house_id,
        action=f"Fingerprint registration requested (ID {fingerprint_id})",
        method="web_portal",
        result=LogResult.success,
        category="system",
    ))
    db.commit()

    return FingerprintRegisterStartResponse(
        message="Fingerprint registration requested. Please use the ESP32 scanner.",
        register_fingerprint=True,
        fingerprint_id=fingerprint_id,
    )


@router.post("/rfid/register-request", response_model=RFIDRegisterStartResponse)
async def request_rfid_registration(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Request RFID registration - ESP32 will handle the tag scan."""
    membership = get_membership(db, current_user, x_house_id)

    # Check for existing pending request
    existing_pending = (
        db.query(RegistrationRequest)
        .filter(
            RegistrationRequest.membership_id == membership.id,
            RegistrationRequest.credential_type == CredentialType.rfid,
            RegistrationRequest.status == RegistrationStatus.pending,
        )
        .order_by(RegistrationRequest.requested_at.desc())
        .first()
    )
    if existing_pending:
        return RFIDRegisterStartResponse(
            message="RFID registration already pending",
            register_rfid=True,
        )

    request = RegistrationRequest(
        membership_id=membership.id,
        house_id=membership.house_id,
        requested_by_user_id=current_user.id,
        credential_type=CredentialType.rfid,
        status=RegistrationStatus.pending,
    )
    db.add(request)
    db.add(AccessLog(
        user_id=current_user.id,
        house_id=membership.house_id,
        action="RFID registration requested",
        method="web_portal",
        result=LogResult.success,
        category="system",
    ))
    db.commit()

    return RFIDRegisterStartResponse(
        message="RFID registration requested. Please scan your RFID tag on the ESP32 reader.",
        register_rfid=True,
    )


@router.post("/{cred_type}/register", response_model=CredentialResponse)
async def register_credential(
    cred_type: CredentialType,
    cred_data: CredentialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Register a credential (keypad PIN, RFID tag, etc.)."""
    if cred_type == CredentialType.fingerprint:
        raise HTTPException(
            status_code=400,
            detail="Fingerprint registration must be completed from device flow",
        )

    mid = _get_membership_id(db, current_user, x_house_id)
    _ensure_all_credential_types(db, mid)

    credential = db.query(Credential).filter(
        Credential.membership_id == mid,
        Credential.type == cred_type,
    ).first()

    if not credential:
        credential = Credential(membership_id=mid, type=cred_type)
        db.add(credential)

    if cred_type == CredentialType.rfid:
        raw_tag = (cred_data.credential_value or cred_data.data or "").strip()
        normalized_tag = normalize_rfid_tag(raw_tag)
        if not normalized_tag:
            raise HTTPException(status_code=400, detail="RFID tag UID is required")
        credential.credential_value = normalized_tag
    else:
        credential.credential_value = cred_data.credential_value or cred_data.data

    credential.registered_at = datetime.utcnow()
    db.commit()
    db.refresh(credential)

    return CredentialResponse(
        id=credential.id,
        type=credential.type,
        registered=credential.registered,
        registered_at=credential.registered_at,
        has_credential_value=bool(credential.credential_value),
    )


@router.delete("/{cred_type}")
async def unregister_credential(
    cred_type: CredentialType,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Unregister a credential."""
    mid = _get_membership_id(db, current_user, x_house_id)
    credential = db.query(Credential).filter(
        Credential.membership_id == mid,
        Credential.type == cred_type,
    ).first()

    if credential:
        credential.credential_value = None
        credential.registered_at = None
        db.commit()

    return {"message": "Credential unregistered"}


# ═══════════════════════════════════════════════════════════════════════════════
# Auth Method Endpoints (now part of credentials table)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/auth-methods", response_model=List[AuthMethodResponse])
async def get_auth_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Get auth method settings for the active house (admin only)."""
    m = require_admin_membership(db, current_user, x_house_id)
    mid = m.id
    _ensure_all_credential_types(db, mid)

    credentials = (
        db.query(Credential)
        .filter(Credential.membership_id == mid)
        .order_by(Credential.priority)
        .all()
    )

    return [
        AuthMethodResponse(
            id=c.id,
            type=c.type,
            enabled=c.enabled,
            priority=c.priority,
            # OTP is always available (generated dynamically), others need a stored value
            has_credential=c.type == CredentialType.otp or c.registered,
        )
        for c in credentials
    ]


@router.put("/auth-methods", response_model=List[AuthMethodResponse])
async def update_auth_methods(
    methods: List[AuthMethodUpdate],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    """Update auth method settings (enabled/priority) for active house (admin only)."""
    m = require_admin_membership(db, current_user, x_house_id)
    mid = m.id
    _ensure_all_credential_types(db, mid)

    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()
    cred_map = {c.type: c for c in credentials}

    for mu in methods:
        credential = cred_map.get(mu.type)
        if credential:
            # Can only enable if credential is registered (or OTP which is always available)
            has_credential = mu.type == CredentialType.otp or credential.registered
            if mu.enabled and not has_credential:
                continue  # Can't enable without a credential
            credential.enabled = mu.enabled
            credential.priority = mu.priority

    db.commit()

    updated = (
        db.query(Credential)
        .filter(Credential.membership_id == mid)
        .order_by(Credential.priority)
        .all()
    )

    return [
        AuthMethodResponse(
            id=c.id,
            type=c.type,
            enabled=c.enabled,
            priority=c.priority,
            has_credential=c.type == CredentialType.otp or c.registered,
        )
        for c in updated
    ]
