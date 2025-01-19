from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from typing import List, Optional
from ..dependencies.auth import get_current_user_id
from ..database import get_db
from ..services.api_key import APIKeyService
from ..models.api_key import APIKey
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/v1/keys", tags=["api-keys"])

class APIKeyCreate(BaseModel):
    provider: str

class APIKeyResponse(BaseModel):
    id: int
    provider: str
    created_at: datetime
    last_used: Optional[datetime]
    usage_count: int
    is_active: bool

    class Config:
        from_attributes = True

@router.post("/", response_model=APIKeyResponse)
async def create_api_key(
    key_create: APIKeyCreate,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Create a new API key"""
    service = APIKeyService(db)
    key = service.create_key(current_user_id, key_create.provider)
    return key

@router.get("/", response_model=List[APIKeyResponse])
async def list_api_keys(
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """List all API keys for the current user"""
    service = APIKeyService(db)
    return service.list_keys(current_user_id)

@router.delete("/{key_id}")
async def delete_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Delete an API key"""
    service = APIKeyService(db)
    if not service.delete_key(key_id, current_user_id):
        raise HTTPException(status_code=404, detail="API key not found")
    return {"status": "success"}

@router.post("/{key_id}/rotate")
async def rotate_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    current_user_id: int = Depends(get_current_user_id)
):
    """Rotate an API key"""
    service = APIKeyService(db)
    key = service.rotate_key(key_id, current_user_id)
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"status": "success"}

# Middleware for API key validation
api_key_header = APIKeyHeader(name="X-API-Key")

async def validate_api_key(
    api_key: str = Security(api_key_header),
    db: Session = Depends(get_db)
):
    service = APIKeyService(db)
    key = service.validate_key(api_key)
    
    if not key:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )
    
    if not service.check_rate_limit(key):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded"
        )
    
    return key
