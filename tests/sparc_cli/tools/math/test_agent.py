import pytest
from langchain_core.language_models.fake import FakeListLLM

from sparc_cli.tools.math.agent import MathAgent, ReActMathAgent
from sparc_cli.tools.math.evaluator import CalculatorTool


def test_compatibility_name_and_lcel_chains_are_available():
    agent = ReActMathAgent(FakeListLLM(responses=["analysis", "NONE", "4"]))

    assert isinstance(agent, MathAgent)
    assert agent.agent_chain is agent.reasoning_chain


def test_agent_routes_only_an_exact_supplied_tool_name():
    llm = FakeListLLM(responses=["arithmetic", "calculator"])
    agent = MathAgent(llm, [CalculatorTool()])

    result = agent.run("2 + 2")

    assert result["solution"] == "4"
    assert result["tools_used"] == ["calculator"]
    assert result["confidence"] == 1.0
    assert [step["stage"] for step in result["steps"]] == [
        "analysis",
        "tool_selection",
        "solution",
    ]


def test_agent_does_not_route_ambiguous_model_text():
    llm = FakeListLLM(
        responses=["arithmetic", "Do not use calculator", "model answer"]
    )
    agent = MathAgent(llm, [CalculatorTool()])

    result = agent.run("2 + 2")

    assert result["solution"] == "model answer"
    assert result["tools_used"] == []
    assert result["confidence"] == 0.5


@pytest.mark.parametrize("problem", ["", "   ", None])
def test_agent_rejects_empty_or_non_string_problems(problem):
    agent = MathAgent(FakeListLLM(responses=[]))
    with pytest.raises(ValueError, match="non-empty"):
        agent.run(problem)


def test_agent_returns_a_structured_failure_without_invoking_a_tool():
    llm = FakeListLLM(responses=["analysis", "calculator"])
    agent = MathAgent(llm, [CalculatorTool()])

    result = agent.run("1 / 0")

    assert "error" in result
    assert result["tools_used"] == []
    assert result["confidence"] == 0.0
