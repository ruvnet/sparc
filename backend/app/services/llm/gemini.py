import logging
import google.generativeai as genai
from typing import AsyncIterator
from google.api_core import exceptions as google_exceptions
from .base import BaseLLMService
from ...utils.retry import async_retry

logger = logging.getLogger(__name__)

class GeminiServiceError(Exception):
    """Base exception for Gemini service errors"""
    pass

class GeminiService(BaseLLMService):
    """Google Gemini LLM service implementation."""
    
    def __init__(self, api_key: str, model: str = "gemini-pro"):
        try:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(model)
        except Exception as e:
            raise GeminiServiceError(f"Failed to initialize Gemini service: {str(e)}")
    
    @async_retry(
        retries=3,
        delay=1.0,
        exceptions=(
            google_exceptions.ResourceExhausted,
            google_exceptions.ServiceUnavailable,
            google_exceptions.DeadlineExceeded
        )
    )
    async def complete(self, prompt: str, **kwargs) -> str:
        try:
            response = self.model.generate_content(prompt)
            if not response.text:
                raise GeminiServiceError("Empty response received")
            return response.text
        except Exception as e:
            if isinstance(e, GeminiServiceError):
                raise
            raise GeminiServiceError(f"Completion failed: {str(e)}") from e
    
    async def stream(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        try:
            response = self.model.generate_content(prompt, stream=True)
            async for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            raise GeminiServiceError(f"Stream generation failed: {str(e)}") from e
