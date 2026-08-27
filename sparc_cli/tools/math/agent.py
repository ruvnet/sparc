"""A small, modern LangChain math-agent pipeline.

The historical implementation inherited from an obsolete LangChain agent API
and attempted to pass this class itself to ``AgentExecutor``. This version uses
the stable ``langchain-core`` Runnable interface and invokes only tools supplied
by the caller.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from langchain_core.language_models import BaseLanguageModel
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.tools import BaseTool


class MathAgent:
    """Route a bounded math problem through analysis, selection, and execution."""

    def __init__(
        self,
        llm: BaseLanguageModel,
        tools: Sequence[BaseTool] | None = None,
        config: Mapping[str, Any] | None = None,
    ) -> None:
        self.llm = llm
        self.tools = list(tools or ())
        self.config = {
            "max_problem_length": 2_048,
            **dict(config or {}),
        }
        self.setup_prompts()
        self.setup_chains()

    def setup_prompts(self) -> None:
        """Configure the three explicit stages used by the pipeline."""

        self.analysis_prompt = PromptTemplate.from_template(
            "Analyze the mathematical problem briefly and identify its type.\n"
            "Problem: {problem}\nAnalysis:"
        )
        self.tool_selection_prompt = PromptTemplate.from_template(
            "Choose exactly one available tool name, or NONE.\n"
            "Analysis: {analysis}\nAvailable tools:\n{tools}\nChoice:"
        )
        self.reasoning_prompt = PromptTemplate.from_template(
            "Return a concise final answer to this math problem.\n"
            "Problem: {problem}\nAnalysis: {analysis}\n"
            "Selected tool: {tool_choice}\nAnswer:"
        )

    def setup_chains(self) -> None:
        """Build LCEL chains supported by current ``langchain-core`` releases."""

        text = StrOutputParser()
        self.analysis_chain = self.analysis_prompt | self.llm | text
        self.tool_selection_chain = self.tool_selection_prompt | self.llm | text
        self.reasoning_chain = self.reasoning_prompt | self.llm | text
        # Stable public alias for callers that previously inspected the chain.
        self.agent_chain = self.reasoning_chain

    def run(self, problem: str) -> dict[str, Any]:
        """Solve ``problem`` and return an auditable, bounded stage summary."""

        if not isinstance(problem, str) or not problem.strip():
            raise ValueError("problem must be a non-empty string")
        maximum = self.config.get("max_problem_length", 2_048)
        if isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 1:
            raise ValueError("max_problem_length must be a positive integer")
        if len(problem) > maximum:
            raise ValueError(f"problem exceeds {maximum} characters")

        steps: list[dict[str, str]] = []
        try:
            analysis = self.analysis_chain.invoke({"problem": problem})
            steps.append({"stage": "analysis", "output": analysis})

            tool_descriptions = "\n".join(
                f"{tool.name}: {tool.description}" for tool in self.tools
            ) or "NONE"
            selection = self.tool_selection_chain.invoke(
                {"analysis": analysis, "tools": tool_descriptions}
            ).strip()
            steps.append({"stage": "tool_selection", "output": selection})

            selected = self._select_tool(selection)
            if selected is not None:
                solution = selected.invoke(problem)
                tool_names = [selected.name]
                confidence = 1.0
            else:
                solution = self.reasoning_chain.invoke(
                    {
                        "problem": problem,
                        "analysis": analysis,
                        "tool_choice": "NONE",
                    }
                )
                tool_names = []
                confidence = 0.5
            steps.append({"stage": "solution", "output": str(solution)})

            return {
                "solution": solution,
                "steps": steps,
                "tools_used": tool_names,
                "confidence": confidence,
            }
        except Exception as exc:
            return {
                "error": str(exc),
                "steps": steps,
                "tools_used": [],
                "confidence": 0.0,
            }

    def _select_tool(self, selection: str) -> BaseTool | None:
        """Resolve a model selection without allowing arbitrary tool names."""

        normalized = selection.strip().strip("`").casefold()
        matches = [tool for tool in self.tools if tool.name.casefold() == normalized]
        return matches[0] if len(matches) == 1 else None


# Compatibility name used by the original design document.
ReActMathAgent = MathAgent

__all__ = ["MathAgent", "ReActMathAgent"]
