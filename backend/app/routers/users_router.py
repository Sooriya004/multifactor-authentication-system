from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from ..database import get_db
from ..models import User, House, HouseMembership, JoinRequest, AccessLog, UserRole, UserStatus, JoinRequestStatus
from ..schemas import UserResponse, MembershipResponse, UserRoleUpdate, UserStatusUpdate, UserUpdate, JoinRequestResponse, PasswordChange, EmailChange
from ..auth import get_current_active_user, get_house_id_header, get_membership, require_admin_membership, verify_password, get_password_hash

router = APIRouter(prefix="/users", tags=["User Management"])


def _member_response(m: HouseMembership, user: User, house: House) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "role": m.role,
        "is_primary_admin": m.is_primary_admin,
        "status": m.status,
        "house_id": m.house_id,
        "house_code": house.code if house else None,
        "joined_at": m.joined_at,
    }


@router.get("/")
async def get_house_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    membership = require_admin_membership(db, current_user, x_house_id)
    house = db.query(House).filter(House.id == membership.house_id).first()

    members = db.query(HouseMembership).filter(
        HouseMembership.house_id == membership.house_id,
        HouseMembership.status != UserStatus.pending,
    ).all()

    result = []
    for m in members:
        user = db.query(User).filter(User.id == m.user_id).first()
        if user:
            result.append(_member_response(m, user, house))
    return result


@router.get("/join-requests")
async def get_join_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    membership = require_admin_membership(db, current_user, x_house_id)
    house = db.query(House).filter(House.id == membership.house_id).first()
    if not house:
        return []

    requests = db.query(JoinRequest).filter(
        JoinRequest.house_code == house.code,
        JoinRequest.status == JoinRequestStatus.pending,
    ).all()

    result = []
    for req in requests:
        user = db.query(User).filter(User.id == req.user_id).first()
        if user:
            result.append(JoinRequestResponse(
                id=req.id, user_id=req.user_id, user_name=user.full_name,
                user_email=user.email, house_code=req.house_code,
                requested_at=req.requested_at, status=req.status.value,
            ))
    return result


@router.post("/join-requests/{request_id}/approve")
async def approve_join_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    admin_m = require_admin_membership(db, current_user, x_house_id)
    join_req = db.query(JoinRequest).filter(JoinRequest.id == request_id).first()
    if not join_req:
        raise HTTPException(status_code=404, detail="Join request not found")

    house = db.query(House).filter(House.id == admin_m.house_id).first()
    if not house or join_req.house_code != house.code:
        raise HTTPException(status_code=403, detail="Not authorized")

    join_req.status = JoinRequestStatus.approved
    join_req.reviewed_by = current_user.id
    join_req.reviewed_at = datetime.utcnow()

    # Activate membership
    m = db.query(HouseMembership).filter(
        HouseMembership.user_id == join_req.user_id,
        HouseMembership.house_id == house.id,
    ).first()
    if m:
        m.status = UserStatus.active

    db.commit()
    return {"message": "Join request approved"}


@router.post("/join-requests/{request_id}/reject")
async def reject_join_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    admin_m = require_admin_membership(db, current_user, x_house_id)
    join_req = db.query(JoinRequest).filter(JoinRequest.id == request_id).first()
    if not join_req:
        raise HTTPException(status_code=404, detail="Join request not found")

    house = db.query(House).filter(House.id == admin_m.house_id).first()
    if not house or join_req.house_code != house.code:
        raise HTTPException(status_code=403, detail="Not authorized")

    join_req.status = JoinRequestStatus.rejected
    join_req.reviewed_by = current_user.id
    join_req.reviewed_at = datetime.utcnow()

    # Remove membership
    m = db.query(HouseMembership).filter(
        HouseMembership.user_id == join_req.user_id,
        HouseMembership.house_id == house.id,
    ).first()
    if m:
        db.delete(m)

    db.commit()
    return {"message": "Join request rejected"}


@router.patch("/{user_id}/role")
async def update_user_role(
    user_id: str,
    role_update: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    admin_m = require_admin_membership(db, current_user, x_house_id)
    target_m = db.query(HouseMembership).filter(
        HouseMembership.user_id == user_id,
        HouseMembership.house_id == admin_m.house_id,
    ).first()
    if not target_m:
        raise HTTPException(status_code=404, detail="User not found in this house")

    if target_m.is_primary_admin and role_update.role == UserRole.member:
        raise HTTPException(status_code=400, detail="Cannot demote primary admin")

    target_m.role = role_update.role
    db.commit()
    return {"message": f"User role updated to {role_update.role.value}"}


@router.patch("/{user_id}/status")
async def update_user_status(
    user_id: str,
    status_update: UserStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    admin_m = require_admin_membership(db, current_user, x_house_id)
    target_m = db.query(HouseMembership).filter(
        HouseMembership.user_id == user_id,
        HouseMembership.house_id == admin_m.house_id,
    ).first()
    if not target_m:
        raise HTTPException(status_code=404, detail="User not found in this house")
    if target_m.is_primary_admin:
        raise HTTPException(status_code=400, detail="Cannot modify primary admin status")

    target_m.status = status_update.status
    db.commit()
    return {"message": f"User status updated to {status_update.status.value}"}


@router.delete("/{user_id}")
async def remove_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    admin_m = require_admin_membership(db, current_user, x_house_id)
    target_m = db.query(HouseMembership).filter(
        HouseMembership.user_id == user_id,
        HouseMembership.house_id == admin_m.house_id,
    ).first()
    if not target_m:
        raise HTTPException(status_code=404, detail="User not found in this house")
    if target_m.is_primary_admin:
        raise HTTPException(status_code=400, detail="Cannot remove primary admin")

    db.delete(target_m)
    db.commit()
    return {"message": "User removed from house"}


@router.post("/self-block")
async def self_block(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    m = get_membership(db, current_user, x_house_id)
    if m.is_primary_admin:
        raise HTTPException(status_code=400, detail="Primary admin cannot self-block")

    m.status = UserStatus.blocked
    db.commit()
    return {"message": "Account blocked in this house. Contact admin to unblock."}


@router.patch("/profile")
async def update_profile(
    updates: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    changed = []
    if updates.full_name is not None and updates.full_name != current_user.full_name:
        current_user.full_name = updates.full_name
        changed.append("name")
    if updates.phone is not None and updates.phone != current_user.phone:
        current_user.phone = updates.phone
        changed.append("phone")
    if updates.address is not None and updates.address != current_user.address:
        current_user.address = updates.address
        changed.append("address")
    if updates.dob is not None and updates.dob != current_user.dob:
        current_user.dob = updates.dob
        changed.append("dob")

    if changed:
        m = get_membership(db, current_user, x_house_id)
        log = AccessLog(
            user_id=current_user.id, house_id=m.house_id,
            action=f"Profile Updated ({', '.join(changed)})",
            method="Dashboard", category="account",
        )
        db.add(log)

    db.commit()
    return {"message": "Profile updated"}


@router.post("/transfer-primary-admin")
async def transfer_primary_admin(
    target_user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    my_m = get_membership(db, current_user, x_house_id)
    if not my_m.is_primary_admin:
        raise HTTPException(status_code=403, detail="Only primary admin can transfer this role")

    target_m = db.query(HouseMembership).filter(
        HouseMembership.user_id == target_user_id,
        HouseMembership.house_id == my_m.house_id,
    ).first()
    if not target_m:
        raise HTTPException(status_code=404, detail="User not found in your house")
    if target_m.role != UserRole.admin:
        raise HTTPException(status_code=400, detail="Target must be an admin first")
    if target_m.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You are already the primary admin")

    my_m.is_primary_admin = False
    target_m.is_primary_admin = True

    target_user = db.query(User).filter(User.id == target_user_id).first()
    log = AccessLog(
        user_id=current_user.id, house_id=my_m.house_id,
        action=f"Primary Admin Transfer → {target_user.full_name if target_user else 'Unknown'}",
        method="Dashboard", category="account",
    )
    db.add(log)
    db.commit()
    return {"message": f"Primary admin transferred"}


@router.patch("/change-email")
async def change_email(
    data: EmailChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not verify_password(data.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")

    existing = db.query(User).filter(User.email == data.new_email, User.id != current_user.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already in use")

    current_user.email = data.new_email
    db.commit()
    return {"message": "Email updated"}


@router.patch("/change-password")
async def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"message": "Password updated"}


# ─── Houses: list user's houses, create/join ────────────────────

@router.get("/houses")
async def get_my_houses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all houses the current user is a member of."""
    memberships = db.query(HouseMembership).filter(HouseMembership.user_id == current_user.id).all()
    result = []
    for m in memberships:
        house = db.query(House).filter(House.id == m.house_id).first()
        if house:
            result.append({
                "id": house.id,
                "name": house.name,
                "code": house.code,
                "role": m.role.value,
                "is_primary_admin": m.is_primary_admin,
                "status": m.status.value,
                "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            })
    return result


@router.post("/houses/create")
async def create_house(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new house and become its primary admin."""
    import secrets, string
    chars = string.ascii_uppercase + string.digits
    house_code = f"NEST-{''.join(secrets.choice(chars) for _ in range(4))}"
    while db.query(House).filter(House.code == house_code).first():
        house_code = f"NEST-{''.join(secrets.choice(chars) for _ in range(4))}"

    house = House(name="My House", code=house_code, created_by=current_user.id)
    db.add(house)
    db.flush()

    membership = HouseMembership(
        user_id=current_user.id,
        house_id=house.id,
        role=UserRole.admin,
        is_primary_admin=True,
        status=UserStatus.active,
    )
    db.add(membership)
    db.commit()

    return {"id": house.id, "name": house.name, "code": house_code, "message": "House created"}


@router.post("/houses/join")
async def join_house(
    house_code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Request to join another house."""
    house = db.query(House).filter(House.code == house_code.upper()).first()
    if not house:
        raise HTTPException(status_code=404, detail="Invalid house code")

    existing = db.query(HouseMembership).filter(
        HouseMembership.user_id == current_user.id,
        HouseMembership.house_id == house.id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already a member of this house")

    membership = HouseMembership(
        user_id=current_user.id,
        house_id=house.id,
        role=UserRole.member,
        is_primary_admin=False,
        status=UserStatus.pending,
    )
    db.add(membership)

    join_request = JoinRequest(user_id=current_user.id, house_code=house.code, status=JoinRequestStatus.pending)
    db.add(join_request)
    db.commit()

    return {"message": "Join request sent", "pending_approval": True}
