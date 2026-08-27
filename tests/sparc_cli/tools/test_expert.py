from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from sparc_cli.tools.expert import (
    ask_expert,
    emit_expert_context,
    expert_context,
    read_files_with_limit,
)


@pytest.fixture(autouse=True)
def clear_expert_context():
    expert_context["text"].clear()
    expert_context["files"].clear()
    yield
    expert_context["text"].clear()
    expert_context["files"].clear()


def test_read_files_with_limit_is_line_bounded(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("first.txt").write_text("one\ntwo\n", encoding="utf-8")
    Path("second.txt").write_text("three\nfour\n", encoding="utf-8")

    content = read_files_with_limit(["first.txt", "second.txt"], max_lines=2)

    assert "one\ntwo\n" in content
    assert "three\n" not in content
    assert "truncated after 2 lines" in content
    assert read_files_with_limit([], max_lines=2) == ""


def test_read_files_with_limit_rejects_nonpositive_budget():
    with pytest.raises(ValueError, match="positive"):
        read_files_with_limit([], max_lines=0)


def test_emit_expert_context_uses_structured_tool_contract():
    result = emit_expert_context.invoke({"context": "Test context"})

    assert result == "Context added."
    assert expert_context["text"] == ["Test context"]


def test_ask_expert_includes_then_clears_one_shot_context():
    emit_expert_context.invoke({"context": "Exact implementation detail"})
    model = Mock()
    model.invoke.return_value = SimpleNamespace(content="Expert answer")

    with patch("sparc_cli.tools.expert.get_model", return_value=model):
        result = ask_expert.invoke({"question": "Is this correct?"})

    assert result == "Expert answer"
    query = model.invoke.call_args.args[0]
    assert "# Additional Context" in query
    assert "Exact implementation detail" in query
    assert "# Question\nIs this correct?" in query
    assert expert_context == {"text": [], "files": []}
