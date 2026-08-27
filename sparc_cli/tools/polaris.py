"""Tool for enhancing LLM interactions with PolarisOne token weighting."""

from typing import Any, Protocol

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

from ..llm import initialize_llm
from ..polaris import create_polaris_model


class PolarisModel(Protocol):
    """Minimal injectable contract required by :class:`PolarisTool`."""

    def generate_with_weights(self, messages: list[HumanMessage]) -> tuple[str, list[tuple[str, float]]]: ...


class PolarisTool:
    """Tool that adds PolarisOne's token weighting capabilities to LLM interactions."""

    def __init__(
        self,
        polaris_model: PolarisModel | None = None,
        *,
        base_model: BaseChatModel | None = None,
        provider: str = "openai",
        model_name: str = "gpt-3.5-turbo",
    ) -> None:
        """Initialize lazily, with explicit injection for offline callers/tests."""

        if polaris_model is not None and base_model is not None:
            raise ValueError("Provide polaris_model or base_model, not both")
        if polaris_model is not None:
            self.polaris_model = polaris_model
            return
        model = base_model or initialize_llm(provider, model_name)
        self.polaris_model = create_polaris_model(model)
    
    def __call__(self, text: str) -> dict[str, Any]:
        """Process text using PolarisOne's token weighting.
        
        Args:
            text: Input text to process
            
        Returns:
            Dict containing:
                response: Generated response text
                token_weights: List of (token, weight) tuples
        """
        if not isinstance(text, str) or not text.strip():
            raise ValueError("text must be a non-empty string")
        if len(text) > 16_384:
            raise ValueError("text exceeds 16,384 characters")

        messages = [HumanMessage(content=text)]
        response, token_weights = self.polaris_model.generate_with_weights(messages)
        
        return {
            "response": response,
            "token_weights": token_weights
        }
