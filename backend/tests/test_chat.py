import pytest
from fastapi.testclient import TestClient
from fastapi import status
from app.main import app
from app.services.llm.base import BaseLLMService
from app.models.chat import ChatRequest, ChatResponse
from unittest.mock import AsyncMock, patch

client = TestClient(app)

@pytest.fixture
def mock_llm_service():
    with patch('app.services.llm.factory.get_llm_service') as mock:
        service = AsyncMock(spec=BaseLLMService)
        service.complete.return_value = "Mock response"
        service.stream.return_value = AsyncMock(__aiter__=lambda _: iter(["Mock stream response"]))
        mock.return_value = service
        yield service

def test_create_completion(mock_llm_service):
    """Test chat completion endpoint."""
    request = ChatRequest(prompt="Test prompt", stream=False)
    response = client.post(
        "/api/v1/chat/complete",
        json=request.dict()
    )
    assert response.status_code == status.HTTP_200_OK
    result = ChatResponse.parse_obj(response.json())
    assert result.response == "Mock response"
    mock_llm_service.complete.assert_called_once_with(prompt="Test prompt")

def test_create_completion_streaming(mock_llm_service):
    """Test streaming chat completion."""
    request = ChatRequest(prompt="Test prompt", stream=True)
    response = client.post(
        "/api/v1/chat/complete",
        json=request.dict()
    )
    assert response.status_code == status.HTTP_200_OK
    assert 'text/event-stream' in response.headers['content-type']
    mock_llm_service.stream.assert_called_once_with(prompt="Test prompt")

def test_chat_validation_error():
    """Test chat endpoint with validation error."""
    response = client.post(
        "/api/v1/chat/complete",
        json={"prompt": "", "stream": False}
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    error = response.json()
    assert "detail" in error
    assert any("prompt" in e["loc"] for e in error["detail"])

@pytest.mark.asyncio
async def test_chat_streaming_error(mock_llm_service):
    """Test streaming chat with error."""
    mock_llm_service.stream.side_effect = Exception("Test error")
    request = ChatRequest(prompt="Test prompt", stream=True)
    response = client.post(
        "/api/v1/chat/complete",
        json=request.dict()
    )
    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    error = response.json()
    assert "detail" in error
