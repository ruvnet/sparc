from fastapi import Depends, HTTPException, status
from .services.llm.factory import LLMFactory
from .config import Settings

settings = Settings()

def get_llm_service():
    """Dependency for LLM service."""
    try:
        return LLMFactory.create("gemini", settings.GOOGLE_API_KEY)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"LLM service unavailable: {str(e)}"
        )
