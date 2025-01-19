from typing import Optional
from pydantic import BaseModel, validator
from fastapi import HTTPException
from ..services.llm.factory import LLMFactory

class ValidationError(Exception):
    """Custom validation error."""
    pass

def validate_prompt(prompt: str) -> str:
    """Validate chat prompt."""
    if not prompt or not prompt.strip():
        raise ValidationError("Prompt cannot be empty")
    return prompt.strip()

def validate_api_key(api_key: str, provider: str) -> bool:
    """Validate API key for the given provider.
    
    Args:
        api_key: API key to validate
        provider: LLM provider name
        
    Returns:
        bool: True if valid
        
    Raises:
        HTTPException: If validation fails
    """
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="API key is required"
        )
        
    if provider not in LLMFactory._services:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider: {provider}"
        )
        
    return True
