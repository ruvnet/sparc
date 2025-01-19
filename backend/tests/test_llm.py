import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from google.api_core import exceptions as google_exceptions

from app.services.llm.factory import LLMFactory
from app.services.llm.gemini import GeminiService, GeminiServiceError

def test_llm_factory_create():
    """Test LLM factory creation."""
    with patch('app.services.llm.factory.LLMFactory._services', {'invalid_provider': None}):
        with pytest.raises(GeminiServiceError):
            LLMFactory.create("invalid_provider", "fake_key")


@pytest.mark.asyncio
async def test_gemini_service_complete():
    """Test Gemini service completion."""
    service = GeminiService("fake_key")
    
    mock_response = MagicMock()
    mock_response.text = "Test response"
    service.model = MagicMock()
    service.model.generate_content.return_value = mock_response

    response = await service.complete("Test prompt")
    assert response == "Test response"
    service.model.generate_content.assert_called_once_with("Test prompt")

@pytest.mark.asyncio
async def test_gemini_service_stream():
    """Test Gemini service streaming."""
    service = GeminiService("fake_key")
    
    mock_chunk = MagicMock()
    mock_chunk.text = "Test chunk"
    mock_response = AsyncMock()
    mock_response.__aiter__.return_value = [mock_chunk].__aiter__()

    service.model = MagicMock()
    service.model.generate_content.return_value = mock_response

    chunks = []
    async for chunk in service.stream("Test prompt"):
        chunks.append(chunk)

    assert chunks == ["Test chunk"]
    service.model.generate_content.assert_called_once_with("Test prompt", stream=True)
