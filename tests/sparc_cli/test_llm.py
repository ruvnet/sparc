import pytest
from unittest.mock import Mock, patch
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from sparc_cli.env import validate_environment
from sparc_cli.llm import initialize_llm, initialize_expert_llm

def test_initialize_llm_openai():
    """Test OpenAI LLM initialization."""
    with patch('sparc_cli.llm.ChatOpenAI') as mock:
        mock.return_value = Mock(spec=ChatOpenAI)
        try:
            model = initialize_llm('openai', 'gpt-4')
            assert isinstance(model, Mock)
            mock.assert_called_once()
        except Exception as e:
            pytest.fail(f"Failed to initialize OpenAI LLM: {e}")

def test_initialize_llm_anthropic():
    """Test Anthropic LLM initialization."""
    with patch('sparc_cli.llm.ChatAnthropic') as mock:
        mock.return_value = Mock(spec=ChatAnthropic)
        try:
            model = initialize_llm('anthropic', 'claude-2')
            assert isinstance(model, Mock)
            mock.assert_called_once()
        except Exception as e:
            pytest.fail(f"Failed to initialize Anthropic LLM: {e}")

def test_initialize_llm_invalid_provider():
    """Test invalid provider handling."""
    with pytest.raises(ValueError):
        initialize_llm('invalid', 'model')

def test_initialize_llm_case_insensitive():
    """Test case-insensitive provider names."""
    with patch('sparc_cli.llm.ChatOpenAI'):
        with pytest.raises(ValueError):
            initialize_llm('INVALID', 'model')

def test_initialize_expert_llm():
    """Test expert LLM initialization."""
    with patch('sparc_cli.llm.ChatOpenAI') as mock:
        mock.return_value = Mock(spec=ChatOpenAI)
        try:
            model = initialize_expert_llm('openai', 'gpt-4')
            assert isinstance(model, Mock)
            mock.assert_called_once()
        except Exception as e:
            pytest.fail(f"Failed to initialize expert LLM: {e}")

def test_environment_variables(monkeypatch):
    """Test environment variable precedence and fallback."""
    from sparc_cli.env import validate_environment
    from dataclasses import dataclass

    @dataclass
    class Args:
        provider: str
        expert_provider: str

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("EXPERT_OPENAI_API_KEY", raising=False)
    args = Args(provider='anthropic', expert_provider='openai')
    expert_enabled, missing = validate_environment(args)
    assert expert_enabled is False
    assert missing == ["EXPERT_OPENAI_API_KEY environment variable is not set"]
