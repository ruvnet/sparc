"""Bounded math tools and benchmark evaluators."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Sequence

import sympy
from langchain_core.language_models import BaseLanguageModel
from langchain_core.tools import BaseTool
from pydantic import Field

from .models import BenchmarkRequest, BenchmarkResponse
from .safe_parser import (
    evaluate_numeric_expression,
    parse_math_equation,
    parse_math_expression,
)
from .validator import MathValidator

logger = logging.getLogger(__name__)


class SparcBaseTool(BaseTool):
    """Base class that makes the public tool metadata explicit."""

    name: str = Field(description="The name of the tool")
    description: str = Field(description="The description of the tool")


class MathBenchmarkEvaluator(ABC):
    """Base class for deterministic math benchmark evaluation."""

    def __init__(
        self,
        llm: BaseLanguageModel | None = None,
        tools: Sequence[BaseTool] | None = None,
    ) -> None:
        self.llm = llm
        self.tools = list(tools or ())
        self.validator = MathValidator()
        self.setup_tools()

    @abstractmethod
    def setup_tools(self) -> None:
        """Configure the evaluator's deterministic tools."""

    @abstractmethod
    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        """Evaluate one benchmark request."""

    def process_results(
        self,
        problem_id: str,
        answer: Any,
        validation_result: dict[str, Any],
    ) -> BenchmarkResponse:
        """Build the stable response contract."""

        return BenchmarkResponse(
            problem_id=problem_id,
            answer=answer,
            validation_result=validation_result,
            metadata={"evaluator": self.__class__.__name__},
        )

    def validate_solution(
        self,
        answer: Any,
        expected: Any,
        answer_type: str,
    ) -> dict[str, Any]:
        """Validate a supported answer type without coercing unknown types."""

        if answer_type == "numerical":
            valid, message = self.validator.validate_numerical(answer, expected)
        elif answer_type == "symbolic":
            valid, message = self.validator.validate_symbolic(answer, expected)
        elif answer_type == "matrix":
            valid, message = self.validator.validate_matrix(answer, expected)
        else:
            valid, message = False, f"Unknown answer type: {answer_type}"

        return {"valid": valid, "message": message, "type": answer_type}

    def _validation_for(
        self,
        request: BenchmarkRequest,
        answer: Any,
    ) -> dict[str, Any]:
        if "expected_answer" not in request.metadata:
            return {"valid": None, "message": "No expected answer provided"}
        return self.validate_solution(
            answer,
            request.metadata["expected_answer"],
            request.expected_type,
        )


class NuminaMathEvaluator(MathBenchmarkEvaluator):
    """Evaluate bounded scalar expressions directly."""

    def setup_tools(self) -> None:
        self.calculator = CalculatorTool()
        self.tools.append(self.calculator)

    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        try:
            answer = self.calculator.invoke(request.problem_text)
            validation = self._validation_for(request, answer)
            return self.process_results(request.problem_id, answer, validation)
        except Exception as exc:
            logger.info("Numerical evaluation failed: %s", exc)
            return self.process_results(
                request.problem_id,
                None,
                {"valid": False, "message": f"Evaluation error: {exc}"},
            )


class MathOdysseyEvaluator(MathBenchmarkEvaluator):
    """Evaluate bounded symbolic expressions and equations."""

    def setup_tools(self) -> None:
        self.symbolic_solver = SymbolicSolverTool()
        self.calculator = CalculatorTool()
        self.tools.extend((self.symbolic_solver, self.calculator))

    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        try:
            answer = self.symbolic_solver.invoke(request.problem_text)
            validation = self._validation_for(request, answer)
            return self.process_results(request.problem_id, answer, validation)
        except Exception as exc:
            logger.info("Symbolic evaluation failed: %s", exc)
            return self.process_results(
                request.problem_id,
                None,
                {"valid": False, "message": f"Evaluation error: {exc}"},
            )


class CalculatorTool(SparcBaseTool):
    """Evaluate scalar expressions and single-variable equations."""

    name: str = Field(default="calculator")
    description: str = Field(
        default="Evaluates bounded scalar expressions and equations"
    )

    def _run(self, expression: str) -> str:
        try:
            if "=" not in expression:
                value = evaluate_numeric_expression(expression)
                if value.is_integer():
                    return str(int(value))
                return format(value, ".12g")

            left, right = parse_math_equation(expression)
            equation = left - right
            symbols = sorted(equation.free_symbols, key=lambda item: item.name)
            if len(symbols) != 1:
                raise ValueError("Equation must contain exactly one variable")
            variable = symbols[0]
            polynomial = sympy.Poly(equation, variable)
            if polynomial.degree() > 4:
                raise ValueError("Calculator equations are limited to degree four")
            solutions = sympy.solve(polynomial.as_expr(), variable)
            if not solutions:
                return "No solutions found"
            return f"{variable} = {' or '.join(map(str, solutions))}"
        except Exception as exc:
            raise ValueError(f"Calculation failed: {exc}") from exc


class SymbolicSolverTool(SparcBaseTool):
    """Solve or simplify expressions parsed through the bounded grammar."""

    name: str = Field(default="symbolic_solver")
    description: str = Field(
        default="Solves bounded single-variable equations and symbolic expressions"
    )

    def _run(self, expression: str) -> str:
        try:
            if "=" in expression:
                left, right = parse_math_equation(expression)
                equation = left - right
                symbols = sorted(equation.free_symbols, key=lambda item: item.name)
                if len(symbols) != 1:
                    raise ValueError("Equation must contain exactly one variable")
                variable = symbols[0]
                solutions = sympy.solve(equation, variable)
                if not solutions:
                    return "No solutions found"
                return f"{variable} = {' or '.join(map(str, solutions))}"

            parsed = parse_math_expression(expression)
            if not isinstance(parsed, sympy.Expr):
                raise ValueError("A scalar symbolic expression is required")
            forms = (
                sympy.simplify(parsed),
                sympy.factor(parsed),
                sympy.expand(parsed),
            )
            return min((str(form) for form in forms), key=len)
        except Exception as exc:
            raise ValueError(f"Symbolic solving failed: {exc}") from exc


__all__ = [
    "CalculatorTool",
    "MathBenchmarkEvaluator",
    "MathOdysseyEvaluator",
    "NuminaMathEvaluator",
    "SparcBaseTool",
    "SymbolicSolverTool",
]
