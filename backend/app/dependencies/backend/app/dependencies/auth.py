from fastapi import Depends, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from starlette.status import HTTP_403_FORBIDDEN

# Define API key header field name
API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)

# In a real application, this would be stored securely (e.g., in a database or environment variable)
# This is just for demonstration
VALID_API_KEYS = {
    "test-api-key-1": "user1",
    "test-api-key-2": "user2"
}

async def get_current_user_id(api_key: str = Depends(API_KEY_HEADER)) -> str:
    """
    Dependency to get the current user ID from the API key.
    
    Args:
        api_key: The API key from the request header
        
    Returns:
        str: The user ID associated with the API key
        
    Raises:
        HTTPException: If the API key is invalid or missing
    """
    if not api_key:
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN,
            detail="No API key provided"
        )
    
    if api_key not in VALID_API_KEYS:
        raise HTTPException(
            status_code=HTTP_403_FORBIDDEN,
            detail="Invalid API key"
        )
    
    return VALID_API_KEYS[api_key]
