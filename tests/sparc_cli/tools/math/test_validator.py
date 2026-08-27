import pytest
import numpy as np
from sparc_cli.tools.math.validator import MathValidator

@pytest.fixture
def validator():
    return MathValidator()

# Numerical Validation Tests
@pytest.mark.parametrize("predicted,expected,result", [
    ("2 + 2", "4", True),
    ("10 / 2", "5", True),
    ("3 * 4", "12", True),
    ("2.5 + 2.5", "5.0", True),
    ("1/3 + 1/3", "0.666666", True),
])
def test_validate_numerical_basic(validator, predicted, expected, result):
    is_valid, _ = MathValidator.validate_numerical(predicted, expected)
    assert is_valid == result

@pytest.mark.parametrize("predicted,expected,tolerance,result", [
    ("0.1 + 0.2", "0.3", 1e-6, True),
    ("1/3", "0.33333", 1e-3, True),
    ("1.00001", "1.0", 1e-6, False),
])
def test_validate_numerical_tolerance(validator, predicted, expected, tolerance, result):
    is_valid, _ = MathValidator.validate_numerical(predicted, expected, tolerance)
    assert is_valid == result

def test_validate_numerical_errors():
    # Division by zero
    is_valid, error = MathValidator.validate_numerical("1/0", "1")
    assert not is_valid
    assert "error" in error.lower()

    # Invalid expression
    is_valid, error = MathValidator.validate_numerical("invalid", "1")
    assert not is_valid
    assert "error" in error.lower()

# Symbolic Validation Tests
@pytest.mark.parametrize("predicted,expected,result", [
    ("x + y", "y + x", True),
    ("(a + b)**2", "a**2 + 2*a*b + b**2", True),
    ("x**2 - y**2", "(x+y)*(x-y)", True),
    ("sin(x)**2 + cos(x)**2", "1", True),
])
def test_validate_symbolic_expressions(validator, predicted, expected, result):
    is_valid, _ = MathValidator.validate_symbolic(predicted, expected)
    assert is_valid == result

def test_validate_symbolic_errors():
    # Invalid expression
    is_valid, error = MathValidator.validate_symbolic("x +* y", "x + y")
    assert not is_valid
    assert "error" in error.lower()

# Matrix Validation Tests
def test_validate_matrix_numpy():
    mat1 = np.array([[1, 2], [3, 4]])
    mat2 = np.array([[1, 2], [3, 4]])
    is_valid, _ = MathValidator.validate_matrix(mat1, mat2)
    assert is_valid

def test_validate_matrix_shape_mismatch():
    mat1 = np.array([[1, 2], [3, 4]])
    mat2 = np.array([[1, 2, 3], [4, 5, 6]])
    is_valid, error = MathValidator.validate_matrix(mat1, mat2)
    assert not is_valid
    assert "shape" in error.lower()

def test_validate_matrix_close_values():
    mat1 = np.array([[1.0000001, 2], [3, 4]])
    mat2 = np.array([[1, 2], [3, 4]])
    is_valid, _ = MathValidator.validate_matrix(mat1, mat2)
    assert is_valid  # Should be True due to np.allclose default tolerance

def test_validate_matrix_string_input():
    is_valid, _ = MathValidator.validate_matrix("[[1, 2], [3, 4]]", "[[1, 2], [3, 4]]")
    assert is_valid

# Internal Helper Methods Tests
@pytest.mark.parametrize("expr,expected", [
    ("2 + 2", 4),
    ("3 * 4", 12),
    ("10 / 2", 5),
])
def test_safe_eval_valid(validator, expr, expected):
    result = MathValidator._safe_eval(expr)
    assert result == expected

def test_safe_eval_invalid():
    with pytest.raises(ValueError):
        MathValidator._safe_eval("import os")
    
    with pytest.raises(ValueError):
        MathValidator._safe_eval("__import__('os')")


@pytest.mark.parametrize("payload", [
    "__import__('os').system('echo exploited')",
    "(1).__class__.__mro__",
    "open('/tmp/sparc-owned', 'w')",
    "[x for x in (1, 2)]",
    "(lambda: 1)()",
    "sin.__class__",
])
def test_safe_eval_rejects_python_execution_primitives(payload):
    with pytest.raises(ValueError):
        MathValidator._safe_eval(payload)


@pytest.mark.parametrize("expression", [
    "2**101",
    "9" * 65,
    "+".join("1" for _ in range(200)),
])
def test_safe_eval_enforces_complexity_limits(expression):
    with pytest.raises(ValueError):
        MathValidator._safe_eval(expression)


def test_safe_eval_allows_only_named_math_whitelist():
    assert MathValidator._safe_eval("sqrt(9) + sin(0) + log(E)") == 4


def test_validate_matrix_rejects_oversized_string_matrix():
    matrix = "[" + ",".join("[" + ",".join("0" for _ in range(16)) + "]" for _ in range(17)) + "]"
    is_valid, error = MathValidator.validate_matrix(matrix, matrix)
    assert not is_valid
    assert "limit" in error.lower()

def test_normalize_expression():
    expr1 = MathValidator._normalize_expression("x + y")
    expr2 = MathValidator._normalize_expression("y + x")
    assert expr1 - expr2 == 0

def test_compare_matrices():
    mat1 = np.array([[1, 2], [3, 4]])
    mat2 = np.array([[1, 2], [3, 4]])
    is_valid, _ = MathValidator._compare_matrices(mat1, mat2)
    assert is_valid

    # Test with different shapes
    mat3 = np.array([[1, 2]])
    is_valid, error = MathValidator._compare_matrices(mat1, mat3)
    assert not is_valid
    assert "shape" in error.lower()
