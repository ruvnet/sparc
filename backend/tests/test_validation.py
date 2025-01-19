import pytest
from app.utils.validation import validate_api_key
from fastapi import HTTPException

def test_valid_api_key():
    """Test valid API key validation."""
    result = validate_api_key("valid_key", "gemini")
    assert result is True

def test_invalid_api_key():
    """Test invalid API key validation."""
    with pytest.raises(HTTPException) as exc:
        validate_api_key("", "gemini")
    assert exc.value.status_code == 401

def test_invalid_provider():
    """Test invalid provider validation."""
    with pytest.raises(HTTPException) as exc:
        validate_api_key("valid_key", "invalid_provider")
    assert exc.value.status_code == 400
