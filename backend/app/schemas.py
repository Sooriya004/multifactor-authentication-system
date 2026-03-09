from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    admin = "admin"
    member = "member"

class UserStatus(str, Enum):
    active = "active"
    blocked = "blocked"
    pending = "pending"

class LogResult(str, Enum):
    success = "success"
    failed = "failed"
    alert = "alert"

class CredentialType(str, Enum):
    rfid = "rfid"
    fingerprint = "fingerprint"
    keypad = "keypad"
    otp = "otp"

# Auth schemas
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    user_id: Optional[str] = None

class UserCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)
    phone: Optional[str] = None
    address: Optional[str] = None
    dob: Optional[str] = None
    role: UserRole
    house_code: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

# Membership response — represents user-in-a-house
class MembershipResponse(BaseModel):
    id: str
    house_id: str
    house_name: str
    house_code: str
    role: UserRole
    is_primary_admin: bool
    status: UserStatus
    joined_at: datetime

    class Config:
        from_attributes = True

class UserResponse(BaseModel):
    id: str
    full_name: str
    email: str
    phone: Optional[str]
    memberships: List[MembershipResponse] = []
    # Legacy compat fields (for active house context)
    role: Optional[UserRole] = None
    is_primary_admin: Optional[bool] = None
    status: Optional[UserStatus] = None
    house_id: Optional[str] = None
    house_code: Optional[str] = None
    joined_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    dob: Optional[str] = None

class EmailChange(BaseModel):
    new_email: EmailStr
    password: str

class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

# House schemas
class HouseCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class HouseResponse(BaseModel):
    id: str
    name: str
    code: str
    created_at: datetime

    class Config:
        from_attributes = True

# Credential schemas
class CredentialCreate(BaseModel):
    type: CredentialType
    data: Optional[str] = None
    credential_value: Optional[str] = None

class CredentialResponse(BaseModel):
    id: str
    type: CredentialType
    registered: bool
    registered_at: Optional[datetime]
    has_credential_value: bool = False

    class Config:
        from_attributes = True

# ESP32 schemas
class AuthRequest(BaseModel):
    method_used: str
    payload: str

class ESPAuthResponse(BaseModel):
    status: str
    action: str

class OTPResponse(BaseModel):
    status: str
    otp: str
    expires_in: str

# Auth Method schemas
class AuthMethodUpdate(BaseModel):
    type: CredentialType
    enabled: bool
    priority: int

class AuthMethodResponse(BaseModel):
    id: str
    type: CredentialType
    enabled: bool
    priority: int
    has_credential: bool = False

    class Config:
        from_attributes = True

# Access Log schemas
class AccessLogCreate(BaseModel):
    action: str
    method: str
    result: LogResult = LogResult.success
    category: Optional[str] = None
    ip_address: Optional[str] = None
    device_id: Optional[str] = None

class AccessLogResponse(BaseModel):
    id: str
    user_id: str
    user_name: str = ""
    timestamp: datetime
    action: str
    method: str
    result: LogResult
    category: Optional[str] = None
    ip_address: Optional[str]
    device_id: Optional[str]

    class Config:
        from_attributes = True

# Join Request schemas
class JoinRequestResponse(BaseModel):
    id: str
    user_id: str
    user_name: str = ""
    user_email: str = ""
    house_code: str
    requested_at: datetime
    status: str

    class Config:
        from_attributes = True

# User management actions
class UserRoleUpdate(BaseModel):
    role: UserRole

class UserStatusUpdate(BaseModel):
    status: UserStatus

# Unlock Session schemas
class UnlockSessionStatus(str, Enum):
    pending = "pending"
    authenticating = "authenticating"
    success = "success"
    failed = "failed"
    expired = "expired"
    cancelled = "cancelled"

class UnlockSessionResponse(BaseModel):
    id: str
    user_id: str
    status: UnlockSessionStatus
    auth_methods: List[str]
    current_method: Optional[str] = None
    created_at: datetime
    expires_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class UnlockSessionUpdate(BaseModel):
    status: UnlockSessionStatus
    current_method: Optional[str] = None
