from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import secrets
import string

from ..database import get_db
from ..models import User, House, HouseMembership, JoinRequest, UserRole, UserStatus, JoinRequestStatus
from ..schemas import UserCreate, UserLogin, UserResponse, MembershipResponse, Token
from ..auth import verify_password, get_password_hash, create_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])

def generate_house_code() -> str:
    chars = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(chars) for _ in range(4))
    return f"NEST-{code}"

def build_user_response(user: User, db: Session) -> dict:
    memberships = db.query(HouseMembership).filter(HouseMembership.user_id == user.id).all()
    membership_list = []
    for m in memberships:
        house = db.query(House).filter(House.id == m.house_id).first()
        membership_list.append(MembershipResponse(
            id=m.id,
            house_id=m.house_id,
            house_name=house.name if house else "Unknown",
            house_code=house.code if house else "",
            role=m.role,
            is_primary_admin=m.is_primary_admin,
            status=m.status,
            joined_at=m.joined_at,
        ))

    # Legacy compat: pick first active membership for role/house_id
    active = next((m for m in membership_list if m.status == UserStatus.active), None)
    return UserResponse(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        memberships=membership_list,
        role=active.role if active else None,
        is_primary_admin=active.is_primary_admin if active else False,
        status=active.status if active else None,
        house_id=active.house_id if active else None,
        house_code=active.house_code if active else None,
        joined_at=user.joined_at,
    ).model_dump()

@router.post("/signup", response_model=dict)
async def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user_data.password)

    user = User(
        full_name=user_data.full_name,
        email=user_data.email,
        phone=user_data.phone,
        address=user_data.address,
        dob=user_data.dob,
        hashed_password=hashed_password,
    )
    db.add(user)
    db.flush()

    if user_data.role == UserRole.admin:
        house_code = generate_house_code()
        while db.query(House).filter(House.code == house_code).first():
            house_code = generate_house_code()

        house = House(name="My House", code=house_code, created_by=user.id)
        db.add(house)
        db.flush()

        membership = HouseMembership(
            user_id=user.id,
            house_id=house.id,
            role=UserRole.admin,
            is_primary_admin=True,
            status=UserStatus.active,
        )
        db.add(membership)
        db.commit()
        db.refresh(user)

        token = create_access_token(data={"sub": user.id})
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": build_user_response(user, db),
            "house_code": house_code,
        }
    else:
        if not user_data.house_code:
            raise HTTPException(status_code=400, detail="House code required for members")

        house = db.query(House).filter(House.code == user_data.house_code.upper()).first()
        if not house:
            raise HTTPException(status_code=404, detail="Invalid house code")

        membership = HouseMembership(
            user_id=user.id,
            house_id=house.id,
            role=UserRole.member,
            is_primary_admin=False,
            status=UserStatus.pending,
        )
        db.add(membership)

        join_request = JoinRequest(user_id=user.id, house_code=house.code, status=JoinRequestStatus.pending)
        db.add(join_request)
        db.commit()
        db.refresh(user)

        token = create_access_token(data={"sub": user.id})
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": build_user_response(user, db),
            "pending_approval": True,
        }

@router.post("/login", response_model=dict)
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()

    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    token = create_access_token(data={"sub": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": build_user_response(user, db),
    }

@router.get("/me", response_model=dict)
async def get_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(__import__('app.auth', fromlist=['get_current_user']).get_current_user)
):
    return build_user_response(current_user, db)
