import math
import logging
from typing import Any, Tuple, Union

import numpy as np
import sympy

from .safe_parser import DEFAULT_LIMITS, parse_math_expression

logger = logging.getLogger(__name__)

class MathValidator:
    """Class for validating mathematical expressions and computations."""

    @staticmethod
    def validate_numerical(predicted: Union[str, float], 
                         expected: Union[str, float], 
                         tolerance: float = 1e-6) -> Tuple[bool, str]:
        """
        Validate numerical expressions within a specified tolerance.
        
        Args:
            predicted: Predicted numerical value or expression
            expected: Expected numerical value or expression
            tolerance: Acceptable difference between values
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            pred_val = MathValidator._safe_eval(predicted)
            exp_val = MathValidator._safe_eval(expected)
            
            if abs(float(pred_val) - float(exp_val)) <= tolerance:
                return True, ""
            return False, f"Values differ by more than tolerance: {pred_val} != {exp_val}"
            
        except Exception as e:
            return False, f"Numerical validation error: {str(e)}"

    @staticmethod
    def validate_symbolic(predicted: str, expected: str) -> Tuple[bool, str]:
        """
        Validate symbolic mathematical expressions.
        
        Args:
            predicted: Predicted symbolic expression
            expected: Expected symbolic expression
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            pred_expr = MathValidator._normalize_expression(predicted)
            exp_expr = MathValidator._normalize_expression(expected)
            
            diff = sympy.simplify(pred_expr - exp_expr)
            if diff == 0:
                return True, ""
            return False, f"Expressions are not equivalent: {pred_expr} != {exp_expr}"
            
        except Exception as e:
            return False, f"Symbolic validation error: {str(e)}"

    @staticmethod
    def validate_matrix(predicted: Union[str, np.ndarray], 
                       expected: Union[str, np.ndarray]) -> Tuple[bool, str]:
        """
        Validate matrix expressions or values.
        
        Args:
            predicted: Predicted matrix as string or numpy array
            expected: Expected matrix as string or numpy array
            
        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            pred_mat = MathValidator._safe_eval(predicted) if isinstance(predicted, str) else predicted
            exp_mat = MathValidator._safe_eval(expected) if isinstance(expected, str) else expected
            
            return MathValidator._compare_matrices(pred_mat, exp_mat)
            
        except Exception as e:
            return False, f"Matrix validation error: {str(e)}"

    @staticmethod
    def _normalize_expression(expr: str) -> sympy.Expr:
        """Convert string expression to normalized sympy expression."""
        try:
            result = parse_math_expression(
                expr,
                allow_symbols=True,
                allow_matrices=False,
            )
            if not isinstance(result, sympy.Expr):
                raise ValueError("A scalar symbolic expression is required")
            return result
        except Exception as e:
            logger.error(f"Expression normalization failed: {str(e)}")
            raise ValueError("Invalid expression format") from e

    @staticmethod
    def _compare_matrices(mat1: np.ndarray, mat2: np.ndarray) -> Tuple[bool, str]:
        """Compare two matrices for equality."""
        try:
            mat1 = MathValidator._bounded_matrix_array(mat1)
            mat2 = MathValidator._bounded_matrix_array(mat2)
            
            if mat1.shape != mat2.shape:
                return False, f"Matrix shapes differ: {mat1.shape} != {mat2.shape}"
                
            if np.allclose(mat1, mat2):
                return True, ""
            return False, "Matrices have different values"
            
        except Exception as e:
            return False, f"Matrix comparison error: {str(e)}"

    @staticmethod
    def _bounded_matrix_array(value: Any) -> np.ndarray:
        """Convert a matrix to finite floats while enforcing matrix budgets."""

        if isinstance(value, sympy.MatrixBase):
            value = value.tolist()
        array = np.asarray(value, dtype=float)
        if array.ndim != 2:
            raise ValueError("Matrix must be two-dimensional")
        rows, columns = array.shape
        if rows > DEFAULT_LIMITS.max_matrix_rows:
            raise ValueError("Matrix exceeds the row limit")
        if columns > DEFAULT_LIMITS.max_matrix_columns:
            raise ValueError("Matrix exceeds the column limit")
        if array.size > DEFAULT_LIMITS.max_matrix_elements:
            raise ValueError("Matrix exceeds the element limit")
        if not np.all(np.isfinite(array)):
            raise ValueError("Matrix values must be finite real numbers")
        return array

    @staticmethod
    def _safe_eval(expr: Union[str, float, int]) -> Any:
        """Evaluate only bounded scalar or matrix mathematical syntax."""

        if isinstance(expr, bool):
            raise ValueError("Boolean values are not mathematical results")
        if isinstance(expr, (float, int)):
            value = float(expr)
            if not math.isfinite(value):
                raise ValueError("Numerical value must be finite")
            return expr
        if isinstance(expr, np.ndarray):
            return MathValidator._bounded_matrix_array(expr)

        try:
            result = parse_math_expression(
                str(expr),
                allow_symbols=False,
                allow_matrices=True,
            )
            if isinstance(result, sympy.MatrixBase):
                return MathValidator._bounded_matrix_array(result)
            if result.free_symbols or not result.is_number:
                raise ValueError("A numerical expression is required")
            value = float(result.evalf())
            if not math.isfinite(value):
                raise ValueError("Numerical result must be finite")
            return value
        except Exception as e:
            logger.error(f"Expression evaluation failed: {str(e)}")
            # The parser's reason contains only structural policy information,
            # never evaluated input or a command result.
            raise ValueError(f"Invalid mathematical expression: {e}") from e
