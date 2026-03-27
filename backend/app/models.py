"""
Simplified Database Models for IoT Access Control System

Tables:
- users: User accounts
- houses: House entities
- house_memberships: User ↔ House relationship with roles
- credentials: Combined credential storage + auth method settings
- registration_requests: Unified registration request tracking
- otp_codes: One-time passwords
- access_logs: Access audit trail
- join_requests: House join requests
"""

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum as SQLEnum, Integer
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
import uuid

from .database import Base


def generate_uuid():
    return str(uuid.uuid4())


# ═══════════════════════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════════════════════

class UserRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class UserStatus(str, enum.Enum):
    active = "active"
    blocked = "blocked"
    pending = "pending"


class LogResult(str, enum.Enum):
    success = "success"
    failed = "failed"
    alert = "alert"


class JoinRequestStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class CredentialType(str, enum.Enum):
    rfid = "rfid"
    fingerprint = "fingerprint"
    keypad = "keypad"
    otp = "otp"


class RegistrationStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"


# ═══════════════════════════════════════════════════════════════════════════════
# Core Models
# ═══════════════════════════════════════════════════════════════════════════════

class User(Base):
    """User account - can belong to multiple houses."""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    full_name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20), nullable=True)
    address = Column(String(255), nullable=True)
    dob = Column(String(20), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)

    memberships = relationship("HouseMembership", back_populates="user")
    access_logs = relationship(
        "AccessLog",
        back_populates="user",
        primaryjoin="User.id == foreign(AccessLog.user_id)",
    )


class House(Base):
    """House entity - contains members and their credentials."""
    __tablename__ = "houses"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False)
    code = Column(String(20), unique=True, nullable=False, index=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    lockdown = Column(Boolean, default=False)
    lockdown_by = Column(String, ForeignKey("users.id"), nullable=True)
    lockdown_at = Column(DateTime, nullable=True)

    memberships = relationship("HouseMembership", back_populates="house")


class HouseMembership(Base):
    """User ↔ House relationship with per-house role and status."""
    __tablename__ = "house_memberships"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    house_id = Column(String, ForeignKey("houses.id", ondelete="CASCADE"), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.member)
    is_primary_admin = Column(Boolean, default=False)
    status = Column(SQLEnum(UserStatus), default=UserStatus.pending)
    joined_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="memberships")
    house = relationship("House", back_populates="memberships")
    credentials = relationship("Credential", back_populates="membership", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════════════
# Credentials (Merged: credentials + auth_methods)
# ═══════════════════════════════════════════════════════════════════════════════

class Credential(Base):
    """
    Combined credential storage and auth method settings.

    Each membership has one row per credential type (rfid, fingerprint, keypad, otp).
    - credential_value: The actual secret (RFID UID, PIN, fingerprint ID)
    - enabled: Whether this method is active for authentication
    - priority: Order in multi-factor authentication sequence
    """
    __tablename__ = "credentials"

    id = Column(String, primary_key=True, default=generate_uuid)
    membership_id = Column(String, ForeignKey("house_memberships.id", ondelete="CASCADE"), nullable=False)
    type = Column(SQLEnum(CredentialType), nullable=False)
    credential_value = Column(String(500), nullable=True)
    enabled = Column(Boolean, default=False)
    priority = Column(Integer, default=0)
    registered_at = Column(DateTime, nullable=True)

    membership = relationship("HouseMembership", back_populates="credentials")

    @property
    def registered(self) -> bool:
        """A credential is registered if it has a value."""
        return self.credential_value is not None and self.credential_value != ""


# ═══════════════════════════════════════════════════════════════════════════════
# Registration Requests (Unified)
# ═══════════════════════════════════════════════════════════════════════════════

class RegistrationRequest(Base):
    """
    Unified registration request for all credential types.

    Replaces: fingerprint_registration_requests, rfid_registration_requests,
              credential_registration_requests
    """
    __tablename__ = "registration_requests"

    id = Column(String, primary_key=True, default=generate_uuid)
    membership_id = Column(String, ForeignKey("house_memberships.id", ondelete="CASCADE"), nullable=False)
    house_id = Column(String, ForeignKey("houses.id", ondelete="CASCADE"), nullable=False)
    requested_by_user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    credential_type = Column(SQLEnum(CredentialType), nullable=False)
    status = Column(SQLEnum(RegistrationStatus), default=RegistrationStatus.pending, nullable=False)

    # Type-specific data (fingerprint_id for fingerprint, tag_uid for rfid, etc.)
    extra_data = Column(String(500), nullable=True)

    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    membership = relationship("HouseMembership")
    house = relationship("House")
    requested_by = relationship("User")


# ═══════════════════════════════════════════════════════════════════════════════
# OTP Codes
# ═══════════════════════════════════════════════════════════════════════════════

class OTPCode(Base):
    """One-time password for door access."""
    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    code = Column(String(10), index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ═══════════════════════════════════════════════════════════════════════════════
# Access Logs
# ═══════════════════════════════════════════════════════════════════════════════

class AccessLog(Base):
    """Audit trail for all access attempts and system events."""
    __tablename__ = "access_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, nullable=False)  # User UUID or "unknown"/"system"
    house_id = Column(String, ForeignKey("houses.id"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    action = Column(String(100), nullable=False)
    method = Column(String(50), nullable=False)
    result = Column(SQLEnum(LogResult), default=LogResult.success)
    category = Column(String(50), nullable=True)  # "access", "system", "account"
    ip_address = Column(String(50), nullable=True)
    device_id = Column(String(100), nullable=True)

    user = relationship(
        "User",
        back_populates="access_logs",
        primaryjoin="foreign(AccessLog.user_id) == User.id",
        foreign_keys=[user_id],
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Join Requests
# ═══════════════════════════════════════════════════════════════════════════════

class JoinRequest(Base):
    """Request to join a house (requires admin approval)."""
    __tablename__ = "join_requests"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    house_code = Column(String(20), nullable=False)
    requested_at = Column(DateTime, default=datetime.utcnow)
    status = Column(SQLEnum(JoinRequestStatus), default=JoinRequestStatus.pending)
    reviewed_by = Column(String, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
