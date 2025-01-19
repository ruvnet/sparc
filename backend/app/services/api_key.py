from datetime import datetime, timedelta
from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException
from ..models.api_key import APIKey
from ..config import Settings
import secrets

settings = Settings()

class APIKeyService:
    def __init__(self, db: Session):
        self.db = db

    def create_key(self, user_id: int, provider: str) -> APIKey:
        """Create a new API key"""
        key = secrets.token_urlsafe(32)
        encrypted_key = APIKey.encrypt_key(key)
        
        db_key = APIKey(
            key=encrypted_key,
            provider=provider,
            user_id=user_id
        )
        
        self.db.add(db_key)
        self.db.commit()
        self.db.refresh(db_key)
        return db_key

    def get_key(self, key_id: int, user_id: int) -> Optional[APIKey]:
        """Retrieve an API key"""
        return self.db.query(APIKey).filter(
            APIKey.id == key_id,
            APIKey.user_id == user_id
        ).first()

    def list_keys(self, user_id: int) -> List[APIKey]:
        """List all API keys for a user"""
        return self.db.query(APIKey).filter(APIKey.user_id == user_id).all()

    def delete_key(self, key_id: int, user_id: int) -> bool:
        """Delete an API key"""
        key = self.get_key(key_id, user_id)
        if not key:
            return False
        
        self.db.delete(key)
        self.db.commit()
        return True

    def validate_key(self, key: str) -> Optional[APIKey]:
        """Validate an API key and update usage metrics"""
        db_key = self.db.query(APIKey).filter(APIKey.key == APIKey.encrypt_key(key)).first()
        
        if not db_key or not db_key.is_active:
            return None

        # Update usage metrics
        db_key.last_used = datetime.utcnow()
        db_key.usage_count += 1
        self.db.commit()
        
        return db_key

    def check_rate_limit(self, key: APIKey) -> bool:
        """Check if key has exceeded rate limits"""
        now = datetime.utcnow()
        
        # Implement rate limiting logic here
        minute_usage = self.db.query(APIKey).filter(
            APIKey.id == key.id,
            APIKey.last_used >= now - timedelta(minutes=1)
        ).count()
        
        if minute_usage > settings.API_RATE_LIMIT_MINUTE:
            return False
            
        return True

    def rotate_key(self, key_id: int, user_id: int) -> Optional[APIKey]:
        """Rotate an API key"""
        key = self.get_key(key_id, user_id)
        if not key:
            return None
            
        new_key = secrets.token_urlsafe(32)
        key.key = APIKey.encrypt_key(new_key)
        key.created_at = datetime.utcnow()
        
        self.db.commit()
        return key
