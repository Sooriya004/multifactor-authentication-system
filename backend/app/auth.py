from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from .config import get_settings
from .models import User, HouseMembership

settings = get_settings()
# NOTE:
# passlib==1.7.4 + bcrypt>=5 causes runtime failures on hash/verify.
# Use pbkdf2_sha256 to keep password hashing stable without external bcrypt backend coupling.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
security = HTTPBearer()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token = credentials.credentials
    user_id = decode_token(token)

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user

def get_house_id_header(x_house_id: Optional[str] = Header(None)) -> Optional[str]:
    return x_house_id

def get_membership(
    db: Session, user: User, house_id: Optional[str]
) -> HouseMembership:
    """Get a user's membership for a specific house. Raises 403 if not a member."""
    if not house_id:
        # Default to first active membership
        m = db.query(HouseMembership).filter(
            HouseMembership.user_id == user.id,
            HouseMembership.status == "active"
        ).first()
        if not m:
            raise HTTPException(status_code=403, detail="No active house membership")
        return m

    m = db.query(HouseMembership).filter(
        HouseMembership.user_id == user.id,
        HouseMembership.house_id == house_id,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this house")
    if m.status == "blocked":
        raise HTTPException(status_code=403, detail="Account is blocked in this house")
    return m

def require_admin_membership(
    db: Session, user: User, house_id: Optional[str]
) -> HouseMembership:
    """Get membership and ensure user is admin in this house."""
    m = get_membership(db, user, house_id)
    if m.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required in this house")
    return m
