from typing import Any

import pytest

from sparc_cli.tools.math.evaluator import (
    CalculatorTool,
    MathBenchmarkEvaluator,
    MathOdysseyEvaluator,
    NuminaMathEvaluator,
    SymbolicSolverTool,
)
from sparc_cli.tools.math.models import BenchmarkRequest, BenchmarkResponse


class StubEvaluator(MathBenchmarkEvaluator):
    def setup_tools(self) -> None:
        self.tools = []

    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        return self.process_results(request.problem_id, 4, {"valid": True})


def request(
    expression: str,
    expected_type: str = "numerical",
    expected: Any = 4,
) -> BenchmarkRequest:
    return BenchmarkRequest(
        problem_id="case-1",
        problem_text=expression,
        expected_type=expected_type,
        metadata={"expected_answer": expected},
    )


def test_base_evaluator_uses_the_shared_response_model():
    response = StubEvaluator().evaluate_problem(request("2 + 2"))
    assert isinstance(response, BenchmarkResponse)
    assert response.is_valid
    assert response.metadata == {"evaluator": "StubEvaluator"}


@pytest.mark.parametrize(
    ("expression", "expected", "answer"),
    [
        ("4 * 2", 8, "8"),
        ("16 / 2", 8, "8"),
        ("sqrt(9) + log(E)", 4, "4"),
        ("0", 0, "0"),
    ],
)
def test_numina_evaluator_calculates_and_validates(expression, expected, answer):
    response = NuminaMathEvaluator().evaluate_problem(request(expression, expected=expected))

    assert response.answer == answer
    assert response.is_valid


def test_numina_evaluator_distinguishes_missing_expected_answer_from_zero():
    response = NuminaMathEvaluator().evaluate_problem(
        BenchmarkRequest("case-1", "0", "numerical")
    )
    assert response.answer == "0"
    assert response.validation_result["valid"] is None


def test_evaluator_returns_structured_failure_for_invalid_input():
    response = NuminaMathEvaluator().evaluate_problem(request("1 / 0"))
    assert response.answer is None
    assert response.validation_result["valid"] is False
    assert "error" in response.validation_result["message"].lower()


def test_odyssey_evaluator_simplifies_and_validates_symbolic_expressions():
    response = MathOdysseyEvaluator().evaluate_problem(
        request("x + x", "symbolic", "2 * x")
    )
    assert response.answer == "2*x"
    assert response.is_valid


def test_tools_support_bounded_equations():
    assert CalculatorTool().invoke("x**2 - 4 = 0") == "x = -2 or 2"
    assert SymbolicSolverTool().invoke("2*x + 3 = 7") == "x = 2"


@pytest.mark.parametrize(
    "payload",
    [
        "__import__('os').system('echo exploited')",
        "(1).__class__.__mro__",
        "open('/tmp/sparc-owned', 'w')",
        "(lambda: 1)()",
        "sin.__globals__",
    ],
)
def test_tools_reject_python_execution_primitives(payload):
    with pytest.raises(ValueError):
        CalculatorTool().invoke(payload)
    with pytest.raises(ValueError):
        SymbolicSolverTool().invoke(payload)


def test_symbolic_solver_does_not_execute_payload(tmp_path):
    marker = tmp_path / "sympify-payload"
    payload = f"__import__('pathlib').Path({str(marker)!r}).write_text('owned')"

    with pytest.raises(ValueError):
        SymbolicSolverTool().invoke(payload)

    assert not marker.exists()


@pytest.mark.parametrize(
    "expression",
    [
        "x**101",
        "9" * 65,
        "+".join("x" for _ in range(200)),
    ],
)
def test_symbolic_solver_enforces_complexity_limits(expression):
    with pytest.raises(ValueError):
        SymbolicSolverTool().invoke(expression)
