from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Changed to MFA sys
SQLALCHEMY_DATABASE_URL = "sqlite:///./mfa_sys.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()