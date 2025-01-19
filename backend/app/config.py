from pydantic_settings import BaseSettings
from typing import List
from datetime import timedelta

class Settings(BaseSettings):
    """Application settings."""
    
    # API Configuration
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "SPARC API"
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000"]
    
    # LLM Configuration
    GOOGLE_API_KEY: str
    DEFAULT_MODEL: str = "gemini-pro"
    
    # API Key Configuration
    API_KEY_ENCRYPTION_KEY: str
    API_KEY_EXPIRATION: timedelta = timedelta(days=90)
    API_RATE_LIMIT_MINUTE: int = 60
    API_RATE_LIMIT_HOUR: int = 1000
    API_RATE_LIMIT_DAY: int = 10000
    
    class Config:
        env_file = ".env"
        case_sensitive = True
