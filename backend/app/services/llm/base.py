from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

class BaseLLMService(ABC):
    """Abstract base class for LLM services."""
    
    @abstractmethod
    async def complete(self, prompt: str, **kwargs) -> str:
        """Generate a completion for the given prompt."""
        pass
    
    @abstractmethod
    async def stream(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        """Stream completions for the given prompt."""
        pass
