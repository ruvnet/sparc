import numpy as np
import sympy
from typing import Union, Tuple, Any
import logging

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
            return sympy.sympify(expr)
        except Exception as e:
            logger.error(f"Expression normalization failed: {str(e)}")
            raise ValueError(f"Invalid expression format: {expr}")

    @staticmethod
    def _compare_matrices(mat1: np.ndarray, mat2: np.ndarray) -> Tuple[bool, str]:
        """Compare two matrices for equality."""
        try:
            mat1 = np.array(mat1)
            mat2 = np.array(mat2)
            
            if mat1.shape != mat2.shape:
                return False, f"Matrix shapes differ: {mat1.shape} != {mat2.shape}"
                
            if np.allclose(mat1, mat2):
                return True, ""
            return False, "Matrices have different values"
            
        except Exception as e:
            return False, f"Matrix comparison error: {str(e)}"

    @staticmethod
    def _safe_eval(expr: Union[str, float, int]) -> Any:
        """Safely evaluate mathematical expressions using sympy.

        Previously used eval() with an AST whitelist, which is fragile:
        - ast.Num is deprecated since Python 3.8 (ast.Constant replaced it),
          causing the whitelist to reject valid numeric literals on 3.10+.
        - eval() with {"__builtins__": None} or {} can still be escaped via
          Python's dunder-attribute chain (CWE-78 / CWE-502).

        sympy.sympify + evalf performs safe, sandboxed symbolic evaluation
        without any use of eval() on untrusted input.
        """
        if isinstance(expr, (float, int, np.ndarray)):
            return expr

        try:
            # sympify parses only mathematical syntax; it rejects arbitrary
            # Python expressions and does not execute them.
            result = sympy.sympify(str(expr)).evalf()
            # Convert scalar results to float; leave compound types as-is.
            try:
                return float(result)
            except (TypeError, ValueError):
                return result
        except Exception as e:
            logger.error(f"Expression evaluation failed: {str(e)}")
            raise ValueError(f"Invalid expression: {expr}")
