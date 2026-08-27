"""Bounded parser for untrusted mathematical expressions.

The standard :func:`sympy.sympify` string path uses SymPy's Python-oriented
parser and is therefore inappropriate at a trust boundary.  This module first
parses the input with Python's AST parser, accepts a deliberately small grammar,
and constructs SymPy objects directly.  It never evaluates or sympifies input.
"""

from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass
from typing import Callable

import sympy


class MathParseError(ValueError):
    """Raised when an expression is invalid, unsafe, or exceeds its budget."""


@dataclass(frozen=True)
class ParseLimits:
    """Resource limits applied before and while constructing SymPy objects."""

    max_input_length: int = 2_048
    max_nodes: int = 256
    max_depth: int = 24
    max_exponent: int = 100
    max_integer_digits: int = 64
    max_symbols: int = 32
    max_matrix_rows: int = 16
    max_matrix_columns: int = 16
    max_matrix_elements: int = 256


DEFAULT_LIMITS = ParseLimits()

_SAFE_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,31}\Z")


@dataclass(frozen=True)
class _FunctionSpec:
    function: Callable[..., sympy.Expr]
    minimum_arguments: int
    maximum_arguments: int


_FUNCTIONS = {
    "Abs": _FunctionSpec(sympy.Abs, 1, 1),
    "abs": _FunctionSpec(sympy.Abs, 1, 1),
    "sqrt": _FunctionSpec(sympy.sqrt, 1, 1),
    "sin": _FunctionSpec(sympy.sin, 1, 1),
    "cos": _FunctionSpec(sympy.cos, 1, 1),
    "tan": _FunctionSpec(sympy.tan, 1, 1),
    "asin": _FunctionSpec(sympy.asin, 1, 1),
    "acos": _FunctionSpec(sympy.acos, 1, 1),
    "atan": _FunctionSpec(sympy.atan, 1, 1),
    "sinh": _FunctionSpec(sympy.sinh, 1, 1),
    "cosh": _FunctionSpec(sympy.cosh, 1, 1),
    "tanh": _FunctionSpec(sympy.tanh, 1, 1),
    "exp": _FunctionSpec(sympy.exp, 1, 1),
    "log": _FunctionSpec(sympy.log, 1, 2),
    "ln": _FunctionSpec(sympy.log, 1, 1),
    "floor": _FunctionSpec(sympy.floor, 1, 1),
    "ceiling": _FunctionSpec(sympy.ceiling, 1, 1),
}

_CONSTANTS = {
    "E": sympy.E,
    "pi": sympy.pi,
}


def validate_math_source(source: str, limits: ParseLimits = DEFAULT_LIMITS) -> str:
    """Validate the cheap source-level invariants shared by all math paths."""

    if not isinstance(source, str):
        raise MathParseError("Expression must be a string")
    if not source.strip():
        raise MathParseError("Expression must not be empty")
    if len(source) > limits.max_input_length:
        raise MathParseError("Expression exceeds the input-length limit")
    if "\x00" in source:
        raise MathParseError("Expression contains a null byte")
    return source


def parse_math_expression(
    source: str,
    *,
    allow_symbols: bool = True,
    allow_matrices: bool = False,
    limits: ParseLimits = DEFAULT_LIMITS,
) -> sympy.Expr | sympy.MatrixBase:
    """Parse a bounded expression into SymPy without evaluating Python code."""

    validate_math_source(source, limits)
    try:
        tree = ast.parse(source, mode="eval")
    except (SyntaxError, MemoryError, RecursionError) as exc:
        raise MathParseError("Invalid mathematical syntax") from exc

    _validate_tree_budget(tree, limits)
    builder = _SympyBuilder(
        allow_symbols=allow_symbols,
        allow_matrices=allow_matrices,
        limits=limits,
    )
    try:
        return builder.build(tree.body)
    except MathParseError:
        raise
    except (ArithmeticError, TypeError, ValueError) as exc:
        raise MathParseError("Invalid mathematical expression") from exc


def parse_math_equation(
    source: str,
    *,
    allow_symbols: bool = True,
    limits: ParseLimits = DEFAULT_LIMITS,
) -> tuple[sympy.Expr, sympy.Expr]:
    """Parse exactly one equality while applying the expression grammar."""

    validate_math_source(source, limits)
    if source.count("=") != 1:
        raise MathParseError("Equation must contain exactly one equality")
    left, right = (part.strip() for part in source.split("=", 1))
    left_expr = parse_math_expression(
        left,
        allow_symbols=allow_symbols,
        allow_matrices=False,
        limits=limits,
    )
    right_expr = parse_math_expression(
        right,
        allow_symbols=allow_symbols,
        allow_matrices=False,
        limits=limits,
    )
    assert isinstance(left_expr, sympy.Expr)
    assert isinstance(right_expr, sympy.Expr)
    return left_expr, right_expr


def evaluate_numeric_expression(
    source: str,
    *,
    limits: ParseLimits = DEFAULT_LIMITS,
) -> float:
    """Parse and evaluate a finite, real, symbol-free scalar expression."""

    expression = parse_math_expression(
        source,
        allow_symbols=False,
        allow_matrices=False,
        limits=limits,
    )
    if not isinstance(expression, sympy.Expr) or expression.free_symbols:
        raise MathParseError("A finite scalar expression is required")
    if not expression.is_number:
        raise MathParseError("A numerical expression is required")
    try:
        value = float(expression.evalf())
    except (TypeError, ValueError, OverflowError) as exc:
        raise MathParseError("A finite real result is required") from exc
    if not math.isfinite(value):
        raise MathParseError("A finite real result is required")
    return value


def _validate_tree_budget(tree: ast.AST, limits: ParseLimits) -> None:
    node_count = 0
    stack = [(tree, 1)]
    while stack:
        node, depth = stack.pop()
        node_count += 1
        if node_count > limits.max_nodes:
            raise MathParseError("Expression exceeds the AST node limit")
        if depth > limits.max_depth:
            raise MathParseError("Expression exceeds the nesting-depth limit")
        stack.extend((child, depth + 1) for child in ast.iter_child_nodes(node))


class _SympyBuilder:
    def __init__(
        self,
        *,
        allow_symbols: bool,
        allow_matrices: bool,
        limits: ParseLimits,
    ) -> None:
        self.allow_symbols = allow_symbols
        self.allow_matrices = allow_matrices
        self.limits = limits
        self.symbols: dict[str, sympy.Symbol] = {}

    def build(self, node: ast.AST) -> sympy.Expr | sympy.MatrixBase:
        if isinstance(node, ast.Constant):
            return self._constant(node)
        if isinstance(node, ast.Name):
            return self._name(node)
        if isinstance(node, ast.BinOp):
            return self._binary(node)
        if isinstance(node, ast.UnaryOp):
            return self._unary(node)
        if isinstance(node, ast.Call):
            return self._call(node)
        if isinstance(node, (ast.List, ast.Tuple)):
            return self._matrix(node)
        if isinstance(node, ast.Attribute):
            raise MathParseError("Attribute access is not allowed")
        raise MathParseError(f"Unsupported expression component: {type(node).__name__}")

    def _constant(self, node: ast.Constant) -> sympy.Expr:
        value = node.value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise MathParseError("Only real numeric literals are allowed")
        if isinstance(value, int):
            if len(str(abs(value))) > self.limits.max_integer_digits:
                raise MathParseError("Integer literal exceeds the digit limit")
            return sympy.Integer(value)
        if not math.isfinite(value):
            raise MathParseError("Non-finite literals are not allowed")
        return sympy.Float(repr(value))

    def _name(self, node: ast.Name) -> sympy.Expr:
        name = node.id
        if name in _CONSTANTS:
            return _CONSTANTS[name]
        if not self.allow_symbols:
            raise MathParseError("Symbols are not allowed in numerical expressions")
        if not _SAFE_NAME.fullmatch(name) or name.startswith("_"):
            raise MathParseError("Invalid symbol name")
        if name not in self.symbols:
            if len(self.symbols) >= self.limits.max_symbols:
                raise MathParseError("Expression exceeds the symbol limit")
            self.symbols[name] = sympy.Symbol(name)
        return self.symbols[name]

    def _binary(self, node: ast.BinOp) -> sympy.Expr | sympy.MatrixBase:
        left = self.build(node.left)
        right = self.build(node.right)
        try:
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, (ast.Pow, ast.BitXor)):
                if isinstance(left, sympy.MatrixBase) or isinstance(right, sympy.MatrixBase):
                    raise MathParseError("Matrix exponentiation is not allowed")
                return self._power(left, right)
        except MathParseError:
            raise
        except (ArithmeticError, TypeError, ValueError) as exc:
            raise MathParseError("Invalid mathematical operation") from exc
        raise MathParseError(f"Unsupported binary operator: {type(node.op).__name__}")

    def _power(self, base: sympy.Expr, exponent: sympy.Expr) -> sympy.Expr:
        if not exponent.is_number or exponent.free_symbols:
            raise MathParseError("Exponents must be numeric")
        try:
            magnitude = abs(float(exponent))
        except (TypeError, ValueError, OverflowError) as exc:
            raise MathParseError("Exponent must be a finite real number") from exc
        if not math.isfinite(magnitude) or magnitude > self.limits.max_exponent:
            raise MathParseError("Exponent exceeds the configured limit")
        return sympy.Pow(base, exponent)

    def _unary(self, node: ast.UnaryOp) -> sympy.Expr | sympy.MatrixBase:
        operand = self.build(node.operand)
        if isinstance(node.op, ast.UAdd):
            return operand
        if isinstance(node.op, ast.USub):
            return -operand
        raise MathParseError(f"Unsupported unary operator: {type(node.op).__name__}")

    def _call(self, node: ast.Call) -> sympy.Expr:
        if not isinstance(node.func, ast.Name):
            raise MathParseError("Only direct calls to approved math functions are allowed")
        if node.keywords:
            raise MathParseError("Keyword arguments are not allowed")
        name = node.func.id
        if name == "pow":
            if len(node.args) != 2:
                raise MathParseError("pow requires exactly two arguments")
            base = self.build(node.args[0])
            exponent = self.build(node.args[1])
            if not isinstance(base, sympy.Expr) or not isinstance(exponent, sympy.Expr):
                raise MathParseError("pow only accepts scalar arguments")
            return self._power(base, exponent)
        spec = _FUNCTIONS.get(name)
        if spec is None:
            raise MathParseError("Function is not in the approved math whitelist")
        if not spec.minimum_arguments <= len(node.args) <= spec.maximum_arguments:
            raise MathParseError("Incorrect number of function arguments")
        arguments = [self.build(argument) for argument in node.args]
        if any(not isinstance(argument, sympy.Expr) for argument in arguments):
            raise MathParseError("Approved math functions only accept scalar arguments")
        return spec.function(*arguments)

    def _matrix(self, node: ast.List | ast.Tuple) -> sympy.MatrixBase:
        if not self.allow_matrices:
            raise MathParseError("Matrix literals are not allowed here")
        if not node.elts:
            raise MathParseError("Matrix literals must not be empty")

        nested = [isinstance(item, (ast.List, ast.Tuple)) for item in node.elts]
        if any(nested) and not all(nested):
            raise MathParseError("Matrix rows must have a consistent structure")
        row_nodes = node.elts if all(nested) else [node]
        if len(row_nodes) > self.limits.max_matrix_rows:
            raise MathParseError("Matrix exceeds the row limit")

        rows: list[list[sympy.Expr]] = []
        column_count: int | None = None
        for row_node in row_nodes:
            assert isinstance(row_node, (ast.List, ast.Tuple))
            if not row_node.elts:
                raise MathParseError("Matrix rows must not be empty")
            if any(isinstance(item, (ast.List, ast.Tuple)) for item in row_node.elts):
                raise MathParseError("Matrices may only be two-dimensional")
            if len(row_node.elts) > self.limits.max_matrix_columns:
                raise MathParseError("Matrix exceeds the column limit")
            if column_count is None:
                column_count = len(row_node.elts)
            elif len(row_node.elts) != column_count:
                raise MathParseError("Matrix rows must have equal length")

            row: list[sympy.Expr] = []
            for item in row_node.elts:
                value = self.build(item)
                if not isinstance(value, sympy.Expr):
                    raise MathParseError("Nested matrices are not allowed")
                row.append(value)
            rows.append(row)

        element_count = len(rows) * (column_count or 0)
        if element_count > self.limits.max_matrix_elements:
            raise MathParseError("Matrix exceeds the element limit")
        return sympy.ImmutableMatrix(rows)
