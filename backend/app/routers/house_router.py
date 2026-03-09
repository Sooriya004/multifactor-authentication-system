from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import secrets
import string

from ..database import get_db
from ..models import User, House, HouseMembership, JoinRequest, UserRole, UserStatus, JoinRequestStatus
from ..auth import get_current_user

router = APIRouter(prefix="/houses", tags=["Houses"])


def generate_house_code() -> str:
    chars = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(chars) for _ in range(4))
    return f"NEST-{code}"


@router.post("/create")
async def create_house(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = data.get("name", "My House").strip()
    if not name:
        raise HTTPException(status_code=400, detail="House name is required")

    house_code = generate_house_code()
    while db.query(House).filter(House.code == house_code).first():
        house_code = generate_house_code()

    house = House(name=name, code=house_code, created_by=current_user.id)
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

    return {
        "house_id": house.id,
        "house_code": house_code,
        "house_name": name,
        "role": "admin",
        "is_primary_admin": True,
        "status": "active",
    }


@router.post("/join")
async def join_house(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    house_code = (data.get("house_code") or "").strip().upper()
    if not house_code:
        raise HTTPException(status_code=400, detail="House code is required")

    house = db.query(House).filter(House.code == house_code).first()
    if not house:
        raise HTTPException(status_code=404, detail="Invalid house code")

    existing = db.query(HouseMembership).filter(
        HouseMembership.user_id == current_user.id,
        HouseMembership.house_id == house.id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="You are already a member of this house")

    membership = HouseMembership(
        user_id=current_user.id,
        house_id=house.id,
        role=UserRole.member,
        is_primary_admin=False,
        status=UserStatus.pending,
    )
    db.add(membership)

    join_request = JoinRequest(
        user_id=current_user.id,
        house_code=house.code,
        status=JoinRequestStatus.pending,
    )
    db.add(join_request)
    db.commit()

    return {
        "house_id": house.id,
        "house_name": house.name,
        "house_code": house.code,
        "status": "pending",
        "message": "Join request sent. Waiting for admin approval.",
    }
