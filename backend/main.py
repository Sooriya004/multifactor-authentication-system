from fastapi import FastAPI, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import engine, SessionLocal
import models
import random
from datetime import datetime, timedelta

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="MFA sys API", description="Backend for ESP32 Multi-Auth System")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class AuthRequest(BaseModel):
    method_used: str  
    payload: str      

class CreateUserRequest(BaseModel):
    name: str
    pin: str

@app.get("/")
def health_check():
    return {"status": "online", "message": "MFA sys API is running!"}

# --- THE ESP32 ENDPOINT ---
@app.post("/api/auth/verify")
def verify_authentication(request: AuthRequest, db: Session = Depends(get_db)):
    
    # --- 1. OTP LOGIC ---
    if request.method_used == "otp":
        # Search for the OTP in the database
        valid_otp = db.query(models.OTPCode).filter(models.OTPCode.code == request.payload).first()
        
        # Check if it exists AND if the current time is before the expiration time
        if valid_otp and datetime.now() < valid_otp.expires_at:
            # Log the success (user_id is null because it's a guest OTP)
            new_log = models.AccessLog(method_used="otp", status="success")
            db.add(new_log)
            
            # Burn the OTP so it can't be reused!
            db.delete(valid_otp)
            db.commit()
            
            return {"status": "success", "action": "unlock"}
        else:
            # If it doesn't exist or is expired
            new_log = models.AccessLog(method_used="otp", status="failure")
            db.add(new_log)
            db.commit()
            
            return {"status": "failure", "action": "none"}

    # --- 2. STANDARD LOGIC (Keypad PIN, RFID, Fingerprint) ---
    valid_auth = db.query(models.AuthenticationMethod).filter(
        models.AuthenticationMethod.method_type == request.method_used,
        models.AuthenticationMethod.credential_value == request.payload
    ).first()

    if valid_auth:
        new_log = models.AccessLog(user_id=valid_auth.user_id, method_used=request.method_used, status="success")
        db.add(new_log)
        db.commit()
        return {"status": "success", "action": "unlock"}
        
    else:
        new_log = models.AccessLog(method_used=request.method_used, status="failure")
        db.add(new_log)
        db.commit()
        return {"status": "failure", "action": "none"}


# --- NEW: GENERATE OTP ENDPOINT (For the Web App) ---
@app.get("/api/otp/generate")
def generate_otp(db: Session = Depends(get_db)):
    # Generate a random 6-digit number
    new_code = str(random.randint(100000, 999999))
    
    # Set expiration time to 5 minutes from right now
    expiration_time = datetime.now() + timedelta(minutes=5)
    
    # Save it to the database
    db_otp = models.OTPCode(code=new_code, expires_at=expiration_time)
    db.add(db_otp)
    db.commit()
    
    return {
        "status": "success", 
        "otp": new_code, 
        "expires_in": "5 minutes"
    }

# --- HELPER ENDPOINTS ---
@app.post("/api/users/add_test_user")
def add_test_user(request: CreateUserRequest, db: Session = Depends(get_db)):
    new_user = models.User(name=request.name)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    new_pin = models.AuthenticationMethod(user_id=new_user.id, method_type="keypad", credential_value=request.pin)
    db.add(new_pin)
    db.commit()
    return {"message": f"Added user {request.name} with PIN {request.pin}"}

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user_to_delete = db.query(models.User).filter(models.User.id == user_id).first()
    if not user_to_delete:
        return {"status": "error", "message": "User not found"}
    db.query(models.AuthenticationMethod).filter(models.AuthenticationMethod.user_id == user_id).delete()
    db.delete(user_to_delete)
    db.commit()
    return {"status": "success", "message": f"User {user_to_delete.name} deleted completely."}