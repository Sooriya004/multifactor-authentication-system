from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .routers import auth_router, users_router, logs_router, credentials_router, esp_router, house_router

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="FortiNest API",
    description="Smart Access Management Backend",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(logs_router.router)
app.include_router(credentials_router.router)
app.include_router(esp_router.router)
app.include_router(house_router.router)

@app.get("/")
async def root():
    return {"message": "FortiNest API", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
