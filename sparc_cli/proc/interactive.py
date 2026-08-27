"""Run argv-based subprocesses in a bounded pseudo-terminal capture."""

from __future__ import annotations

import errno
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import List, Optional, Tuple, Union


DEFAULT_TIMEOUT_SECONDS = 300.0
DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024


class CommandTimedOut(TimeoutError):
    """Raised when a captured process exceeds its wall-clock deadline."""


class CommandOutputLimitExceeded(RuntimeError):
    """Raised when a captured process emits more than the configured limit."""


def _terminate_process_group(proc: subprocess.Popen[bytes]) -> None:
    """Terminate the isolated process group, escalating if it does not exit."""

    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        if proc.poll() is None:
            proc.terminate()

    if proc.poll() is None:
        try:
            proc.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            pass

    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    except OSError:
        if proc.poll() is None:
            proc.kill()
    if proc.poll() is None:
        proc.wait()


def _clean_terminal_output(output: bytes) -> bytes:
    """Remove terminal control sequences while preserving text whitespace."""

    # Operating System Command sequences can set terminal titles or inject
    # hyperlinks. Strip them before the more general ANSI escape matcher.
    output = re.sub(rb"\x1b\].*?(?:\x07|\x1b\\)", b"", output, flags=re.DOTALL)
    output = re.sub(rb"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])", b"", output)
    output = output.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", b"", output)


def run_interactive_command(
    cmd: List[str],
    *,
    cwd: Optional[Union[str, os.PathLike[str]]] = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES,
) -> Tuple[bytes, int]:
    """Run a command directly and capture its combined output through a PTY.

    The executable and arguments are passed directly to :class:`Popen`; no
    command string is constructed and no shell is involved. The child starts
    in its own process group so a timeout or output-limit violation also stops
    descendants.

    Args:
        cmd: Non-empty argv list.
        cwd: Optional existing working directory for the child.
        timeout_seconds: Wall-clock limit in seconds, at most one hour.
        max_output_bytes: Maximum captured stdout and stderr, at most 64 MiB.

    Returns:
        A tuple of cleaned combined output and the process return code.

    Raises:
        CommandTimedOut: The process exceeded ``timeout_seconds``.
        CommandOutputLimitExceeded: Output exceeded ``max_output_bytes``.
    """

    if not isinstance(cmd, list) or not cmd:
        raise ValueError("No command provided.")
    if any(not isinstance(argument, str) or "\x00" in argument for argument in cmd):
        raise ValueError("Command arguments must be strings without NUL bytes.")
    if (
        isinstance(timeout_seconds, bool)
        or not isinstance(timeout_seconds, (int, float))
        or not 0 < float(timeout_seconds) <= 3600
    ):
        raise ValueError("timeout_seconds must be greater than zero and at most 3600")
    if (
        isinstance(max_output_bytes, bool)
        or not isinstance(max_output_bytes, int)
        or not 1 <= max_output_bytes <= 64 * 1024 * 1024
    ):
        raise ValueError("max_output_bytes must be between 1 and 67108864")

    discovered_executable = shutil.which(cmd[0])
    if discovered_executable is None:
        raise FileNotFoundError(f"Command '{cmd[0]}' not found in PATH.")
    try:
        executable = Path(discovered_executable).resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise FileNotFoundError(f"Command '{cmd[0]}' is no longer available.") from error
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise FileNotFoundError(f"Command '{cmd[0]}' is not executable.")

    child_cwd: Optional[str] = None
    if cwd is not None:
        try:
            resolved_cwd = Path(cwd).resolve(strict=True)
        except (OSError, RuntimeError, TypeError) as error:
            raise ValueError("Command working directory does not exist") from error
        if not resolved_cwd.is_dir():
            raise ValueError("Command working directory is not a directory")
        child_cwd = str(resolved_cwd)

    master_fd = -1
    slave_fd = -1
    proc: Optional[subprocess.Popen[bytes]] = None
    deadline = time.monotonic() + float(timeout_seconds)
    chunks: List[bytes] = []
    captured_bytes = 0

    try:
        env = os.environ.copy()
        env["GIT_PAGER"] = ""
        env["PAGER"] = ""

        master_fd, slave_fd = pty.openpty()
        proc = subprocess.Popen(
            cmd,
            executable=str(executable),
            stdin=None,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=child_cwd,
            env=env,
            close_fds=True,
            start_new_session=True,
        )
        os.close(slave_fd)
        slave_fd = -1

        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CommandTimedOut(
                    f"Command exceeded the {float(timeout_seconds):g}-second timeout"
                )

            readable, _, _ = select.select([master_fd], [], [], remaining)
            if not readable:
                if proc.poll() is None:
                    raise CommandTimedOut(
                        f"Command exceeded the {float(timeout_seconds):g}-second timeout"
                    )
                break

            try:
                chunk = os.read(master_fd, min(65_536, max_output_bytes + 1))
            except OSError as error:
                # Linux PTYs report EIO after the final slave descriptor closes.
                if error.errno == errno.EIO:
                    break
                if error.errno == errno.EINTR:
                    continue
                raise
            if not chunk:
                break

            if captured_bytes + len(chunk) > max_output_bytes:
                remaining_capacity = max_output_bytes - captured_bytes
                if remaining_capacity:
                    chunks.append(chunk[:remaining_capacity])
                raise CommandOutputLimitExceeded(
                    f"Command output exceeded the {max_output_bytes}-byte limit"
                )
            chunks.append(chunk)
            captured_bytes += len(chunk)

        remaining = max(0.0, deadline - time.monotonic())
        try:
            return_code = proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired as error:
            raise CommandTimedOut(
                f"Command exceeded the {float(timeout_seconds):g}-second timeout"
            ) from error
        return _clean_terminal_output(b"".join(chunks)), return_code

    except (CommandTimedOut, CommandOutputLimitExceeded):
        if proc is not None:
            _terminate_process_group(proc)
        raise
    except Exception as error:
        if proc is not None:
            _terminate_process_group(proc)
        raise RuntimeError("Error running interactive capture") from error
    finally:
        if slave_fd >= 0:
            os.close(slave_fd)
        if master_fd >= 0:
            os.close(master_fd)


__all__ = [
    "CommandOutputLimitExceeded",
    "CommandTimedOut",
    "run_interactive_command",
]
