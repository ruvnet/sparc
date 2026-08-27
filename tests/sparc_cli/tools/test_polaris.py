from unittest.mock import Mock, patch

import pytest

from sparc_cli.tools.polaris import PolarisTool


class StubPolarisModel:
    def generate_with_weights(self, messages):
        assert messages[0].content == "What is the capital of France?"
        return "Paris", [("capital", 0.8), ("France", 1.0)]


def test_polaris_tool_supports_offline_dependency_injection():
    tool = PolarisTool(polaris_model=StubPolarisModel())

    result = tool("What is the capital of France?")

    assert result == {
        "response": "Paris",
        "token_weights": [("capital", 0.8), ("France", 1.0)],
    }


def test_polaris_tool_has_no_import_time_model_construction():
    with patch("sparc_cli.tools.polaris.initialize_llm") as initialize:
        model = Mock()
        wrapper = Mock()
        initialize.return_value = model
        with patch("sparc_cli.tools.polaris.create_polaris_model", return_value=wrapper):
            tool = PolarisTool(provider="anthropic", model_name="claude-test")

    initialize.assert_called_once_with("anthropic", "claude-test")
    assert tool.polaris_model is wrapper


@pytest.mark.parametrize("text", ["", "   ", None])
def test_polaris_tool_rejects_empty_input(text):
    with pytest.raises(ValueError, match="non-empty"):
        PolarisTool(polaris_model=StubPolarisModel())(text)


def test_polaris_tool_rejects_ambiguous_model_injection():
    with pytest.raises(ValueError, match="not both"):
        PolarisTool(polaris_model=StubPolarisModel(), base_model=Mock())
