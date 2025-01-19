from sqlalchemy import Column, Integer, String, DateTime, Boolean, func
from sqlalchemy.orm import relationship
from datetime import datetime
from cryptography.fernet import Fernet
from ..database import Base
from ..config import Settings

settings = Settings()
fernet = Fernet(settings.API_KEY_ENCRYPTION_KEY.encode())

class APIKey(Base):
    """Model for storing API keys"""
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True, nullable=False)
    provider = Column(String, nullable=False)
    user_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    last_used = Column(DateTime, nullable=True)
    usage_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    @property
    def decrypted_key(self) -> str:
        """Decrypt and return the API key"""
        return fernet.decrypt(self.key.encode()).decode()

    @classmethod
    def encrypt_key(cls, key: str) -> str:
        """Encrypt an API key"""
        return fernet.encrypt(key.encode()).decode()
