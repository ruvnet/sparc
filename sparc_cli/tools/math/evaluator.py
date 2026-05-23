from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import logging
from typing import Any, Dict, List, Optional, Literal
from langchain.tools import BaseTool
from langchain.llms.base import BaseLLM
from .models import BenchmarkRequest, BenchmarkResponse
from .validator import MathValidator
from pydantic import Field

from typing import Dict, Any, Optional, List, Union
from sympy import simplify, sympify, solve, factor, expand
import numpy as np

class SparcBaseTool(BaseTool):
    """Base class for SPARC tools with proper type annotations."""
    name: str = Field(description="The name of the tool")
    description: str = Field(description="The description of the tool")

logger = logging.getLogger(__name__)

class BenchmarkRequest:
    """Data structure representing a math problem."""
    def __init__(self, problem_id: str, problem_text: str, expected_type: str, metadata: Optional[Dict[str, Any]] = None):
        self.problem_id = problem_id
        self.problem_text = problem_text
        self.expected_type = expected_type  # 'numerical', 'symbolic', 'matrix'
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "problem_id": self.problem_id,
            "problem_text": self.problem_text,
            "expected_type": self.expected_type,
            "metadata": self.metadata
        }

class BenchmarkResponse:
    """Standardized structure for evaluation responses."""
    def __init__(self, problem_id: str, answer: Any, validation_result: Dict[str, Any], metadata: Optional[Dict[str, Any]] = None):
        self.problem_id = problem_id
        self.answer = answer
        self.validation_result = validation_result
        self.metadata = metadata or {}

    @property
    def is_valid(self) -> bool:
        return self.validation_result.get("status") == "valid"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "problem_id": self.problem_id,
            "answer": self.answer,
            "validation_result": self.validation_result,
            "metadata": self.metadata
        }

class MathValidator:
    """Utility class for validating mathematical results."""
    
    @staticmethod
    def validate_numerical(predicted: Union[str, float], expected: Union[str, float], tolerance: float = 1e-6) -> tuple[bool, str]:
        """Validate numerical results within tolerance."""
        try:
            pred_val = float(predicted)
            exp_val = float(expected)
            is_valid = abs(pred_val - exp_val) < tolerance
            return is_valid, f"Difference: {abs(pred_val - exp_val)}"
        except (ValueError, TypeError) as e:
            return False, f"Validation error: {str(e)}"

    @staticmethod
    def validate_symbolic(predicted: str, expected: str) -> tuple[bool, str]:
        """Validate symbolic expressions for equivalence."""
        try:
            pred_expr = sympify(predicted)
            exp_expr = sympify(expected)
            is_valid = bool(simplify(pred_expr - exp_expr) == 0)
            return is_valid, "Expressions are equivalent" if is_valid else "Expressions differ"
        except Exception as e:
            return False, f"Symbolic validation error: {str(e)}"

    @staticmethod
    def validate_matrix(predicted: Union[List[List[float]], np.ndarray], 
                       expected: Union[List[List[float]], np.ndarray]) -> tuple[bool, str]:
        """Validate matrix results."""
        try:
            pred_arr = np.array(predicted, dtype=float)
            exp_arr = np.array(expected, dtype=float)
            is_valid = np.allclose(pred_arr, exp_arr)
            return is_valid, "Matrices match" if is_valid else "Matrices differ"
        except Exception as e:
            return False, f"Matrix validation error: {str(e)}"

class MathBenchmarkEvaluator(ABC):
    """Base class for math benchmark evaluation."""
    
    def __init__(self, llm: BaseLLM, tools: Optional[List[BaseTool]] = None):
        """Initialize the evaluator.
        
        Args:
            llm: Language model to use for evaluation
            tools: Optional list of tools to use
        """
        self.llm = llm
        self.tools = tools or []
        self.validator = MathValidator()
        self.setup_tools()
        
    @abstractmethod
    def setup_tools(self) -> None:
        """Configure tools needed for evaluation."""
        pass
        
    @abstractmethod
    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        """Evaluate a math benchmark problem.
        
        Args:
            request: The benchmark problem to evaluate
            
        Returns:
            Response containing the answer and validation results
        """
        pass
    
    def process_results(self, problem_id: str, answer: Any, 
                       validation_result: Dict[str, Any]) -> BenchmarkResponse:
        """Process evaluation results into a response.
        
        Args:
            problem_id: ID of the problem
            answer: Computed answer
            validation_result: Validation details
            
        Returns:
            Formatted benchmark response
        """
        return BenchmarkResponse(
            problem_id=problem_id,
            answer=answer,
            validation_result=validation_result,
            metadata={'evaluator': self.__class__.__name__}
        )
    
    def validate_solution(self, answer: Any, expected: Any, 
                         answer_type: str) -> Dict[str, Any]:
        """Validate a solution against expected answer.
        
        Args:
            answer: Computed answer to validate
            expected: Expected correct answer
            answer_type: Type of answer (numerical/symbolic/matrix)
            
        Returns:
            Dictionary with validation results
        """
        if answer_type == 'numerical':
            valid, message = self.validator.validate_numerical(answer, expected)
        elif answer_type == 'symbolic':
            valid, message = self.validator.validate_symbolic(answer, expected)
        elif answer_type == 'matrix':
            valid, message = self.validator.validate_matrix(answer, expected)
        else:
            valid, message = False, f"Unknown answer type: {answer_type}"
            
        return {
            'valid': valid,
            'message': message,
            'type': answer_type
        }

class NuminaMathEvaluator(MathBenchmarkEvaluator):
    """Direct calculation-based math evaluator."""
    
    def setup_tools(self) -> None:
        """Configure calculation tools."""
        # Initialize calculator and basic math tools
        self.calculator = CalculatorTool()
        self.tools.extend([self.calculator])
        
    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        """Evaluate problem using direct calculation.
        
        Args:
            request: The benchmark problem to evaluate
            
        Returns:
            Response with calculated answer
        """
        try:
            # Direct calculation using calculator tool
            answer = self.calculator.run(request.problem_text)
            
            # Validate against expected answer if provided
            expected = request.metadata.get('expected_answer')
            if expected:
                validation = self.validate_solution(
                    answer, expected, request.expected_type
                )
            else:
                validation = {'valid': None, 'message': 'No expected answer provided'}
                
            return self.process_results(request.problem_id, answer, validation)
            
        except Exception as e:
            logger.error(f"Evaluation failed: {str(e)}")
            return self.process_results(
                request.problem_id,
                None,
                {'valid': False, 'message': f"Evaluation error: {str(e)}"}
            )

class MathOdysseyEvaluator(MathBenchmarkEvaluator):
    """Step-by-step reasoning math evaluator."""
    
    def setup_tools(self) -> None:
        """Configure symbolic and advanced math tools."""
        self.symbolic_solver = SymbolicSolverTool()
        self.calculator = CalculatorTool()
        self.tools.extend([self.symbolic_solver, self.calculator])
        
    def evaluate_problem(self, request: BenchmarkRequest) -> BenchmarkResponse:
        """Evaluate problem using step-by-step reasoning.
        
        Args:
            request: The benchmark problem to evaluate
            
        Returns:
            Response with reasoned answer
        """
        try:
            # First attempt symbolic solution
            symbolic_result = self.symbolic_solver.run(request.problem_text)
            
            # Fall back to numerical if needed
            if not symbolic_result:
                answer = self.calculator.run(request.problem_text)
            else:
                answer = symbolic_result
                
            # Validate result
            expected = request.metadata.get('expected_answer')
            if expected:
                validation = self.validate_solution(
                    answer, expected, request.expected_type
                )
            else:
                validation = {'valid': None, 'message': 'No expected answer provided'}
                
            return self.process_results(request.problem_id, answer, validation)
            
        except Exception as e:
            logger.error(f"Evaluation failed: {str(e)}")
            return self.process_results(
                request.problem_id,
                None,
                {'valid': False, 'message': f"Evaluation error: {str(e)}"}
            )

class CalculatorTool(SparcBaseTool):
    """Tool for basic mathematical calculations."""
    
    name: str = Field(default="calculator")
    description: str = Field(default="Performs basic mathematical calculations")
    
    def _run(self, expression: str) -> str:
        """Execute the calculation.
        
        Args:
            expression: Mathematical expression to evaluate
            
        Returns:
            Calculated result as a string
        """
        try:
            # Check if it's a quadratic equation
            if "=" in expression and ("x^2" in expression or "x²" in expression):
                # Extract the left side of the equation (assume right side is 0)
                left_side = expression.split("=")[0].strip()
                
                # Normalize the expression
                expr = left_side.replace("²", "^2")  # standardize squared notation
                expr = expr.replace(" ", "")  # remove spaces
                
                # Initialize coefficients
                a = b = c = 0
                
                # Split into terms and normalize
                expr = expr.replace("-", "+-").strip("+")  # Handle negative terms
                terms = expr.split("+")
                
                # Process each term
                for term in terms:
                    if not term:  # Skip empty terms
                        continue
                    term = term.strip()
                    
                    # Handle x^2 terms
                    if "x^2" in term:
                        coef = term.replace("x^2", "").strip()
                        if not coef:
                            a += 1
                        elif coef == "-":
                            a -= 1
                        else:
                            a += float(coef)
                    
                    # Handle x terms
                    elif "x" in term:
                        coef = term.replace("x", "").strip()
                        if not coef:
                            b += 1
                        elif coef == "-":
                            b -= 1
                        else:
                            b += float(coef)
                    
                    # Handle constant terms
                    else:
                        c += float(term)
                
                # Calculate using quadratic formula
                discriminant = b**2 - 4*a*c
                if discriminant < 0:
                    return "No real solutions"
                
                x1 = (-b + (discriminant ** 0.5)) / (2*a)
                x2 = (-b - (discriminant ** 0.5)) / (2*a)
                
                # Format solutions
                solutions = []
                for x in sorted([x1, x2]):
                    if abs(x - round(x)) < 1e-10:  # if very close to an integer
                        solutions.append(str(int(round(x))))
                    else:
                        solutions.append(f"{x:.2f}")
                
                return f"x = {' or x = '.join(solutions)}"
            else:
                # Handle regular calculations using sympy for safe evaluation.
                # eval() with {"__builtins__": None} is insufficient — Python's
                # dunder-attribute chain can still escape the sandbox (CWE-78).
                # sympy.sympify + evalf performs safe symbolic evaluation instead.
                sympy_expr = sympify(expression)
                result = sympy_expr.evalf()
                result_float = float(result)
                if result_float == int(result_float):
                    return str(int(result_float))
                return f"{result_float:.2f}"
        except Exception as e:
            raise ValueError(f"Calculation failed: {str(e)}")

class SymbolicSolverTool(SparcBaseTool):
    """Tool for symbolic mathematical manipulation."""
    
    name: str = Field(default="symbolic_solver")
    description: str = Field(default="Performs symbolic mathematical operations")
    
    def _run(self, expression: str) -> str:
        """Execute symbolic manipulation.
        
        Args:
            expression: Mathematical expression to manipulate
            
        Returns:
            Simplified symbolic expression
        """
        try:
                # Parse the expression and identify operation type
            if "=" in expression:
                # Handle equations
                left_side, right_side = [s.strip() for s in expression.split("=")]
                # Convert to sympy expressions
                left_expr = sympify(left_side)
                right_expr = sympify(right_side)
                # Move everything to left side
                expr = left_expr - right_expr
                
                # Get variables in the expression
                variables = list(expr.free_symbols)
                if not variables:
                    return str(expr)
                
                # Solve for the variable
                try:
                    solutions = solve(expr, variables[0])
                    if solutions:
                        return f"{variables[0]} = {' or '.join(str(sol) for sol in solutions)}"
                    return "No solutions found"
                except Exception as e:
                    # Fall back to quadratic formula for quadratic equations
                    if str(variables[0]) + "**2" in str(expr):
                        # Extract coefficients
                        x = variables[0]
                        expanded = expand(expr)
                        a = expanded.coeff(x, 2)
                        b = expanded.coeff(x, 1)
                        c = expanded.coeff(x, 0)
                        
                        # Use quadratic formula
                        discriminant = b**2 - 4*a*c
                        if discriminant < 0:
                            return "No real solutions"
                        
                        x1 = (-b + (discriminant ** 0.5)) / (2*a)
                        x2 = (-b - (discriminant ** 0.5)) / (2*a)
                        
                        return f"x = {x1} or x = {x2}"
                    raise ValueError(f"Could not solve equation: {str(e)}")
            
            else:
                # Handle expressions (simplification, factoring, etc.)
                sympy_expr = sympify(expression)
                
                # Try different forms and return the most compact
                simplified = simplify(sympy_expr)
                factored = factor(sympy_expr)
                expanded = expand(sympy_expr)
                
                # Choose the shortest representation
                forms = {
                    'simplified': str(simplified),
                    'factored': str(factored),
                    'expanded': str(expanded)
                }
                
                shortest = min(forms.items(), key=lambda x: len(x[1]))
                return shortest[1]
                
        except Exception as e:
            raise ValueError(f"Symbolic solving failed: {str(e)}")
