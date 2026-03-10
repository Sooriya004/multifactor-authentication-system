from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import (
    User,
    HouseMembership,
    Credential,
    AuthMethod,
    CredentialType,
    FingerprintRegistrationRequest,
    FingerprintRegistrationStatus,
    AccessLog,
    LogResult,
)
from ..schemas import (
    CredentialResponse,
    CredentialCreate,
    AuthMethodResponse,
    AuthMethodUpdate,
    FingerprintRegisterStartResponse,
)
from ..auth import get_current_active_user, get_house_id_header, get_membership

router = APIRouter(prefix="/credentials", tags=["Credentials & Auth Methods"])


def _get_membership_id(db: Session, user: User, house_id: Optional[str]) -> str:
    m = get_membership(db, user, house_id)
    return m.id


def _next_fingerprint_id(db: Session, house_id: str) -> int:
    used_ids = set()

    registered_fingerprints = (
        db.query(Credential.credential_value)
        .join(HouseMembership, Credential.membership_id == HouseMembership.id)
        .filter(
            HouseMembership.house_id == house_id,
            Credential.type == CredentialType.fingerprint,
            Credential.registered == True,  # noqa: E712
            Credential.credential_value.isnot(None),
        )
        .all()
    )
    for (value,) in registered_fingerprints:
        if value and str(value).isdigit():
            used_ids.add(int(value))

    pending_requests = (
        db.query(FingerprintRegistrationRequest.fingerprint_id)
        .filter(
            FingerprintRegistrationRequest.house_id == house_id,
            FingerprintRegistrationRequest.status == FingerprintRegistrationStatus.pending,
        )
        .all()
    )
    for (fingerprint_id,) in pending_requests:
        used_ids.add(int(fingerprint_id))

    next_id = 1
    while next_id in used_ids:
        next_id += 1
    return next_id


@router.get("/", response_model=List[CredentialResponse])
async def get_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    mid = _get_membership_id(db, current_user, x_house_id)
    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()

    existing_types = {c.type for c in credentials}
    for cred_type in CredentialType:
        if cred_type not in existing_types:
            db.add(Credential(membership_id=mid, type=cred_type, registered=False))
    db.commit()

    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()
    return [CredentialResponse(
        id=c.id, type=c.type, registered=c.registered,
        registered_at=c.registered_at, has_credential_value=bool(c.credential_value),
    ) for c in credentials]


@router.post("/fingerprint/register-request", response_model=FingerprintRegisterStartResponse)
async def request_fingerprint_registration(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    membership = get_membership(db, current_user, x_house_id)

    existing_pending = (
        db.query(FingerprintRegistrationRequest)
        .filter(
            FingerprintRegistrationRequest.membership_id == membership.id,
            FingerprintRegistrationRequest.status == FingerprintRegistrationStatus.pending,
        )
        .order_by(FingerprintRegistrationRequest.requested_at.desc())
        .first()
    )
    if existing_pending:
        return FingerprintRegisterStartResponse(
            message="Fingerprint registration already pending",
            register_fingerprint=True,
            fingerprint_id=existing_pending.fingerprint_id,
        )

    fingerprint_id = _next_fingerprint_id(db, membership.house_id)
    request = FingerprintRegistrationRequest(
        membership_id=membership.id,
        house_id=membership.house_id,
        requested_by_user_id=current_user.id,
        fingerprint_id=fingerprint_id,
        status=FingerprintRegistrationStatus.pending,
    )
    db.add(request)
    db.add(
        AccessLog(
            user_id=current_user.id,
            house_id=membership.house_id,
            action=f"Fingerprint registration requested (ID {fingerprint_id})",
            method="web_portal",
            result=LogResult.success,
            category="system",
        )
    )
    db.commit()

    return FingerprintRegisterStartResponse(
        message="Fingerprint registration requested. Please use the ESP32 scanner.",
        register_fingerprint=True,
        fingerprint_id=fingerprint_id,
    )


@router.post("/{cred_type}/register", response_model=CredentialResponse)
async def register_credential(
    cred_type: CredentialType,
    cred_data: CredentialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    if cred_type == CredentialType.fingerprint:
        raise HTTPException(
            status_code=400,
            detail="Fingerprint registration must be completed from device flow",
        )

    mid = _get_membership_id(db, current_user, x_house_id)
    credential = db.query(Credential).filter(
        Credential.membership_id == mid, Credential.type == cred_type
    ).first()

    if not credential:
        credential = Credential(membership_id=mid, type=cred_type)
        db.add(credential)

    credential.data = cred_data.data
    credential.credential_value = cred_data.credential_value
    credential.registered = True
    credential.registered_at = datetime.utcnow()

    db.commit()
    db.refresh(credential)
    return CredentialResponse(
        id=credential.id, type=credential.type, registered=credential.registered,
        registered_at=credential.registered_at, has_credential_value=bool(credential.credential_value),
    )


@router.delete("/{cred_type}")
async def unregister_credential(
    cred_type: CredentialType,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    mid = _get_membership_id(db, current_user, x_house_id)
    credential = db.query(Credential).filter(
        Credential.membership_id == mid, Credential.type == cred_type
    ).first()
    if credential:
        credential.registered = False
        credential.data = None
        credential.credential_value = None
        credential.registered_at = None
        db.commit()
    return {"message": "Credential unregistered"}


@router.get("/auth-methods", response_model=List[AuthMethodResponse])
async def get_auth_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    mid = _get_membership_id(db, current_user, x_house_id)
    methods = db.query(AuthMethod).filter(AuthMethod.membership_id == mid).all()
    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()
    cred_map = {c.type: c.registered for c in credentials}

    existing_types = {m.type for m in methods}
    priority = len(methods) + 1
    for method_type in CredentialType:
        if method_type not in existing_types:
            db.add(AuthMethod(membership_id=mid, type=method_type, enabled=False, priority=priority))
            priority += 1
    db.commit()

    methods = db.query(AuthMethod).filter(AuthMethod.membership_id == mid).order_by(AuthMethod.priority).all()
    return [AuthMethodResponse(
        id=m.id, type=m.type, enabled=m.enabled,
        priority=m.priority, has_credential=cred_map.get(m.type, False),
    ) for m in methods]


@router.put("/auth-methods", response_model=List[AuthMethodResponse])
async def update_auth_methods(
    methods: List[AuthMethodUpdate],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    mid = _get_membership_id(db, current_user, x_house_id)
    credentials = db.query(Credential).filter(Credential.membership_id == mid).all()
    cred_map = {c.type: c.registered for c in credentials}

    for mu in methods:
        method = db.query(AuthMethod).filter(
            AuthMethod.membership_id == mid, AuthMethod.type == mu.type
        ).first()
        if method:
            if mu.enabled and not cred_map.get(mu.type, False):
                continue
            method.enabled = mu.enabled
            method.priority = mu.priority
    db.commit()

    methods_db = db.query(AuthMethod).filter(AuthMethod.membership_id == mid).order_by(AuthMethod.priority).all()
    return [AuthMethodResponse(
        id=m.id, type=m.type, enabled=m.enabled,
        priority=m.priority, has_credential=cred_map.get(m.type, False),
    ) for m in methods_db]
