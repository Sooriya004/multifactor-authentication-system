from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./mfa_sys.db"
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # Email settings (Gmail SMTP)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None  # Your Gmail address
    SMTP_PASSWORD: Optional[str] = None  # Gmail App Password
    ALERT_EMAIL_ENABLED: bool = False  # Set to True when configured

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
