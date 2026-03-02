from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    role = Column(String, default="user") 

# NEW TABLE: This links a user to their specific credentials
class AuthenticationMethod(Base):
    __tablename__ = "auth_methods"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    method_type = Column(String)      # 'keypad', 'rfid', 'fingerprint'
    credential_value = Column(String) # The actual PIN, RFID tag UID, etc.

class AccessLog(Base):
    __tablename__ = "access_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    method_used = Column(String) 
    status = Column(String) 
    timestamp = Column(DateTime(timezone=True), server_default=func.now())


class OTPCode(Base):
    __tablename__ = "otp_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, index=True)
    # We will use this to track when the OTP expires
    expires_at = Column(DateTime)