"""Validated data contracts for math benchmark evaluation."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

ExpectedType = Literal["numerical", "symbolic", "matrix"]


@dataclass(frozen=True)
class BenchmarkRequest:
    """A bounded request to evaluate one math benchmark problem."""

    problem_id: str
    problem_text: str
    expected_type: ExpectedType
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.problem_id, str) or not self.problem_id.strip():
            raise ValueError("problem_id must be a non-empty string")
        if len(self.problem_id) > 128:
            raise ValueError("problem_id exceeds 128 characters")
        if not isinstance(self.problem_text, str) or not self.problem_text.strip():
            raise ValueError("problem_text must be a non-empty string")
        if len(self.problem_text) > 2_048:
            raise ValueError("problem_text exceeds 2,048 characters")
        if self.expected_type not in {"numerical", "symbolic", "matrix"}:
            raise ValueError("expected_type must be numerical, symbolic, or matrix")
        if not isinstance(self.metadata, dict):
            raise ValueError("metadata must be a dictionary")

    def to_dict(self) -> dict[str, Any]:
        """Return a detached dictionary representation."""

        return asdict(self)


@dataclass(frozen=True)
class BenchmarkResponse:
    """The answer, validation result, and evaluator metadata for a request."""

    problem_id: str
    answer: Any
    validation_result: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.problem_id, str) or not self.problem_id.strip():
            raise ValueError("problem_id must be a non-empty string")
        if not isinstance(self.validation_result, dict):
            raise ValueError("validation_result must be a dictionary")
        if not isinstance(self.metadata, dict):
            raise ValueError("metadata must be a dictionary")

    @property
    def is_valid(self) -> bool:
        """Return whether validation explicitly passed."""

        return self.validation_result.get("valid") is True

    def to_dict(self) -> dict[str, Any]:
        """Return a detached dictionary representation."""

        return asdict(self)
