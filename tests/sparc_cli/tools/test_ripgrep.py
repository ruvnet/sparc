import os
import shutil
from unittest.mock import Mock

import pytest

from sparc_cli.proc.interactive import CommandTimedOut
from sparc_cli.tools.ripgrep import (
    MAX_CAPTURE_BYTES,
    SEARCH_TIMEOUT_SECONDS,
    _ripgrep_search,
    get_rg_command,
    ripgrep_search,
)


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text("needle inside\n", encoding="utf-8")
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(root))
    return root


def test_tool_metadata_is_preserved():
    assert ripgrep_search.name == "ripgrep_search"


def test_search_uses_fixed_argv_bounds_and_canonical_project_root(project, monkeypatch):
    alias = project.parent / "project-alias"
    alias.symlink_to(project, target_is_directory=True)
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(alias))
    monkeypatch.setattr("sparc_cli.tools.ripgrep.get_rg_command", lambda: "/usr/bin/rg")
    runner = Mock(return_value=(b"src/main.py:needle inside\n", 0))
    monkeypatch.setattr("sparc_cli.tools.ripgrep.run_interactive_command", runner)

    result = _ripgrep_search("--files", file_type="py", exclude_dirs=["private data"])

    assert result["success"] is True
    command = runner.call_args.args[0]
    assert command[:4] == ["/usr/bin/rg", "--no-config", "--no-follow", "--color=never"]
    assert "--type=py" in command
    assert command[-3:] == ["--", "--files", "."]
    assert "--glob=!private data/**" in command
    assert "--glob=!**/private data/**" in command
    assert runner.call_args.kwargs == {
        "cwd": project.resolve(),
        "timeout_seconds": SEARCH_TIMEOUT_SECONDS,
        "max_output_bytes": MAX_CAPTURE_BYTES,
    }


def test_search_rejects_symlink_following_before_execution(project, monkeypatch):
    runner = Mock()
    monkeypatch.setattr("sparc_cli.tools.ripgrep.run_interactive_command", runner)

    with pytest.raises(ValueError, match="symbolic links"):
        _ripgrep_search("needle", follow_links=True)

    runner.assert_not_called()


@pytest.mark.parametrize(
    "directory",
    ["../outside", "/tmp", "src/../../outside", "src/*", "src/[abc]", "--hidden", "a//b", "./src"],
)
def test_search_rejects_unsafe_excluded_directories(project, monkeypatch, directory):
    monkeypatch.setattr("sparc_cli.tools.ripgrep.get_rg_command", lambda: "/usr/bin/rg")

    with pytest.raises(ValueError, match="Excluded directories"):
        _ripgrep_search("needle", exclude_dirs=[directory])


@pytest.mark.parametrize("file_type", ["--files", "../py", "py type", "", "/etc"])
def test_search_rejects_option_like_or_unsafe_file_types(project, file_type):
    with pytest.raises(ValueError, match="file_type"):
        _ripgrep_search("needle", file_type=file_type)


@pytest.mark.parametrize("pattern", ["", "line\nbreak", "nul\x00byte", "x" * 4097])
def test_search_rejects_unbounded_or_control_character_patterns(project, pattern):
    with pytest.raises(ValueError, match="pattern"):
        _ripgrep_search(pattern)


def test_search_rejects_excessive_exclusions(project):
    with pytest.raises(ValueError, match="at most 64"):
        _ripgrep_search("needle", exclude_dirs=[f"directory-{index}" for index in range(65)])


def test_search_reports_bounded_runner_failure(project, monkeypatch):
    monkeypatch.setattr("sparc_cli.tools.ripgrep.get_rg_command", lambda: "/usr/bin/rg")
    monkeypatch.setattr(
        "sparc_cli.tools.ripgrep.run_interactive_command",
        Mock(side_effect=CommandTimedOut("bounded timeout")),
    )

    result = _ripgrep_search("needle")

    assert result == {"output": "bounded timeout", "return_code": 1, "success": False}


def test_get_rg_command_never_installs_or_changes_permissions(monkeypatch):
    monkeypatch.setattr("sparc_cli.tools.ripgrep.shutil.which", lambda _name: None)

    def forbidden_chmod(*_args, **_kwargs):
        raise AssertionError("runtime chmod must not be used")

    monkeypatch.setattr(os, "chmod", forbidden_chmod)
    with pytest.raises(RuntimeError, match="install 'rg'"):
        get_rg_command()


@pytest.mark.skipif(shutil.which("rg") is None, reason="ripgrep is not installed")
def test_real_search_does_not_follow_external_symlink(project, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("needle outside\n", encoding="utf-8")
    (project / "escape.txt").symlink_to(outside / "secret.txt")

    result = _ripgrep_search("needle")

    assert result["success"] is True
    assert "main.py" in result["output"]
    assert "escape.txt" not in result["output"]
    assert "outside" not in result["output"]


def test_configured_root_must_exist_and_be_directory(tmp_path, monkeypatch):
    missing = tmp_path / "missing"
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(missing))
    with pytest.raises(ValueError, match="does not exist"):
        _ripgrep_search("needle")

    regular_file = tmp_path / "file"
    regular_file.write_text("data", encoding="utf-8")
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(regular_file))
    with pytest.raises(ValueError, match="not a directory"):
        _ripgrep_search("needle")
