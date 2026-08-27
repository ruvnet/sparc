from dataclasses import asdict

import pytest

from sparc_cli.tools.math.models import BenchmarkRequest, BenchmarkResponse


def test_request_uses_documented_contract_and_detached_serialization():
    request = BenchmarkRequest(
        problem_id="example-1",
        problem_text="2 + 2",
        expected_type="numerical",
        metadata={"expected_answer": 4},
    )

    assert asdict(request) == request.to_dict()
    serialized = request.to_dict()
    serialized["metadata"]["expected_answer"] = 5
    assert request.metadata["expected_answer"] == 4


@pytest.mark.parametrize(
    "values",
    [
        {"problem_id": "", "problem_text": "2 + 2", "expected_type": "numerical"},
        {"problem_id": "id", "problem_text": "", "expected_type": "numerical"},
        {"problem_id": "id", "problem_text": "2 + 2", "expected_type": "unknown"},
        {
            "problem_id": "id",
            "problem_text": "2 + 2",
            "expected_type": "numerical",
            "metadata": [],
        },
    ],
)
def test_request_rejects_invalid_contract_values(values):
    with pytest.raises(ValueError):
        BenchmarkRequest(**values)


def test_response_reports_only_an_explicit_validation_pass():
    valid = BenchmarkResponse("one", 4, {"valid": True})
    unknown = BenchmarkResponse("two", 4, {"valid": None})
    legacy_status = BenchmarkResponse("three", 4, {"status": "valid"})

    assert valid.is_valid is True
    assert unknown.is_valid is False
    assert legacy_status.is_valid is False
    assert valid.to_dict()["answer"] == 4


@pytest.mark.parametrize(
    "kwargs",
    [
        {"problem_id": "", "answer": 4, "validation_result": {}},
        {"problem_id": "id", "answer": 4, "validation_result": []},
        {
            "problem_id": "id",
            "answer": 4,
            "validation_result": {},
            "metadata": [],
        },
    ],
)
def test_response_rejects_invalid_contract_values(kwargs):
    with pytest.raises(ValueError):
        BenchmarkResponse(**kwargs)


def test_math_package_exposes_its_documented_public_api():
    from sparc_cli.tools.math import MathBenchmarkEvaluator, MathValidator

    assert MathBenchmarkEvaluator.__name__ == "MathBenchmarkEvaluator"
    assert MathValidator.__name__ == "MathValidator"
