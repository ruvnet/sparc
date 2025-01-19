import logging
from typing import Dict, Type, List, Optional
from .base import BaseLLMService
from .gemini import GeminiService, GeminiServiceError

logger = logging.getLogger(__name__)

class LLMFactoryError(Exception):
    """Base exception for LLM factory errors"""
    pass

class LLMFactory:
    """Factory for creating LLM service instances with fallback support."""
    
    _services: Dict[str, Type[BaseLLMService]] = {
        "gemini": GeminiService
    }
    
    @classmethod
    def create(
        cls,
        provider: str,
        api_key: str,
        fallback_providers: Optional[List[str]] = None,
        **kwargs
    ) -> BaseLLMService:
        """
        Create an LLM service instance with optional fallbacks.
        
        Args:
            provider: Primary LLM provider name
            api_key: API key for the provider
            fallback_providers: Optional list of fallback providers
            **kwargs: Additional provider-specific arguments
        
        Returns:
            BaseLLMService: Configured LLM service instance
        
        Raises:
            LLMFactoryError: If no working provider could be initialized
        """
        providers_to_try = [provider]
        if fallback_providers:
            providers_to_try.extend(fallback_providers)
        
        last_error = None
        for provider_name in providers_to_try:
            if provider_name not in cls._services:
                logger.warning(f"Unsupported LLM provider: {provider_name}")
                continue
            
            try:
                service_class = cls._services[provider_name]
                return service_class(api_key=api_key, **kwargs)
            except Exception as e:
                last_error = e
                logger.error(
                    f"Failed to initialize {provider_name} service: {str(e)}, "
                    f"trying next provider..."
                )
        
        raise LLMFactoryError(
            f"Failed to initialize any LLM provider from {providers_to_try}"
        ) from last_error

def get_llm_service(api_key: str, provider: str = "gemini", **kwargs) -> BaseLLMService:
    """Get an instance of an LLM service.
    
    Args:
        api_key: Provider API key
        provider: Provider name (default: gemini)
        **kwargs: Additional provider-specific arguments
        
    Returns:
        BaseLLMService: Configured LLM service
        
    Raises:
        LLMFactoryError: If provider initialization fails
    """
    return LLMFactory.create(provider, api_key, **kwargs)
