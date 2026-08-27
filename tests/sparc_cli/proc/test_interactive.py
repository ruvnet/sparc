import sys
import time

import pytest
from sparc_cli.proc.interactive import (
    CommandOutputLimitExceeded,
    CommandTimedOut,
    run_interactive_command,
)

def test_run_interactive_command():
    """Test that run_interactive_command executes commands and returns output."""
    output, return_code = run_interactive_command(['echo', 'test'])
    assert output == b'test\n'
    assert return_code == 0

def test_run_interactive_command_error():
    """Test that run_interactive_command handles command errors."""
    output, return_code = run_interactive_command(['false'])
    assert return_code == 1

def test_run_interactive_command_invalid():
    """Test that run_interactive_command handles invalid commands."""
    with pytest.raises(FileNotFoundError):
        run_interactive_command(['nonexistentcommand'])


def test_run_interactive_command_preserves_metacharacters_as_argv(tmp_path):
    """Shell syntax in an argument must never be reparsed as a command."""
    marker = tmp_path / "injected"
    payload = f"$(touch {marker}); touch {marker}"

    output, return_code = run_interactive_command([
        sys.executable,
        "-c",
        "import sys; print(sys.argv[1])",
        payload,
    ])

    assert return_code == 0
    assert output == f"{payload}\n".encode()
    assert not marker.exists()


def test_run_interactive_command_respects_canonical_working_directory(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(root, target_is_directory=True)

    output, return_code = run_interactive_command(
        [sys.executable, "-c", "import os; print(os.getcwd())"],
        cwd=alias,
    )

    assert return_code == 0
    assert output == f"{root.resolve()}\n".encode()


def test_run_interactive_command_enforces_timeout_and_kills_descendants(tmp_path):
    marker = tmp_path / "descendant-survived"
    child_source = (
        "import pathlib,sys,time; time.sleep(0.35); "
        "pathlib.Path(sys.argv[1]).write_text('unsafe', encoding='utf-8')"
    )
    parent_source = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable, '-c', {child_source!r}, sys.argv[1]]); "
        "time.sleep(5)"
    )

    with pytest.raises(CommandTimedOut, match="timeout"):
        run_interactive_command(
            [sys.executable, "-c", parent_source, str(marker)],
            timeout_seconds=0.05,
        )

    time.sleep(0.45)
    assert not marker.exists()


def test_run_interactive_command_enforces_output_limit():
    with pytest.raises(CommandOutputLimitExceeded, match="1024-byte"):
        run_interactive_command(
            [sys.executable, "-c", "print('x' * 8192)"],
            max_output_bytes=1024,
        )


@pytest.mark.parametrize("timeout", [0, -1, 3601, True, "1"])
def test_run_interactive_command_rejects_invalid_timeout(timeout):
    with pytest.raises(ValueError, match="timeout_seconds"):
        run_interactive_command([sys.executable, "-c", "pass"], timeout_seconds=timeout)


@pytest.mark.parametrize("limit", [0, -1, 64 * 1024 * 1024 + 1, True, 1.5])
def test_run_interactive_command_rejects_invalid_output_limit(limit):
    with pytest.raises(ValueError, match="max_output_bytes"):
        run_interactive_command([sys.executable, "-c", "pass"], max_output_bytes=limit)


def test_run_interactive_command_rejects_nul_argument():
    with pytest.raises(ValueError, match="NUL"):
        run_interactive_command([sys.executable, "bad\x00argument"])


def test_run_interactive_command_strips_terminal_control_sequences():
    source = "import os; os.write(1, b'plain\\x1b[31mred\\x1b[0m\\x1b]0;title\\x07\\n')"
    output, return_code = run_interactive_command([sys.executable, "-c", source])

    assert return_code == 0
    assert output == b"plainred\n"
