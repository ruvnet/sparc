"""Bounded ripgrep search constrained to the configured project root."""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional, Union

from langchain_core.tools import tool
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

from sparc_cli.proc.interactive import run_interactive_command
from sparc_cli.text.processing import truncate_output

console = Console()

SEARCH_TIMEOUT_SECONDS = 20.0
MAX_CAPTURE_BYTES = 1024 * 1024
MAX_PATTERN_LENGTH = 4096
MAX_EXCLUDE_DIRS = 64
MAX_EXCLUDE_LENGTH = 256
MAX_RESULT_LINES = 2000

DEFAULT_EXCLUDE_DIRS = [
    ".git",
    "node_modules",
    "vendor",
    ".venv",
    "__pycache__",
    ".cache",
    "dist",
    "build",
    "env",
    ".env",
    "venv",
    ".idea",
    ".vscode",
]

_FILE_TYPE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_+.-]{0,63}\Z")
_GLOB_META = frozenset("*?[]{}!\\")


def _configured_project_root() -> Path:
    """Return the canonical directory selected by the trusted host process."""

    configured = os.environ.get("SPARC_PROJECT_ROOT")
    candidate = Path(configured) if configured else Path.cwd()
    try:
        root = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ValueError("Configured project root does not exist") from error
    if not root.is_dir():
        raise ValueError("Configured project root is not a directory")
    return root


def get_rg_command() -> str:
    """Return a canonical executable path without changing the host system."""

    discovered = shutil.which("rg")
    if discovered is None:
        raise RuntimeError("ripgrep is required; install 'rg' before using ripgrep_search")
    try:
        executable = Path(discovered).resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise RuntimeError("The discovered ripgrep executable is unavailable") from error
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError("The discovered ripgrep executable is not executable")
    return str(executable)


def _validate_pattern(pattern: str) -> None:
    if not isinstance(pattern, str) or not pattern:
        raise ValueError("pattern must be a non-empty string")
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise ValueError(f"pattern must be at most {MAX_PATTERN_LENGTH} characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in pattern):
        raise ValueError("pattern must not contain control characters")


def _validate_file_type(file_type: Optional[str]) -> None:
    if file_type is not None and _FILE_TYPE_PATTERN.fullmatch(file_type) is None:
        raise ValueError("file_type must be a simple ripgrep type name")


def _normalize_exclude_dir(directory: str) -> str:
    """Validate a literal project-relative directory used in a deny glob."""

    if not isinstance(directory, str) or not directory:
        raise ValueError("Excluded directories must be non-empty relative paths")
    if len(directory) > MAX_EXCLUDE_LENGTH or "\x00" in directory:
        raise ValueError("Excluded directory path is invalid")
    if any(ord(character) < 32 or ord(character) == 127 for character in directory):
        raise ValueError("Excluded directory path contains control characters")
    if any(character in _GLOB_META for character in directory):
        raise ValueError("Excluded directories must not contain glob syntax")

    path = PurePosixPath(directory)
    raw_parts = directory.split("/")
    if (
        path.is_absolute()
        or directory.startswith(("/", "\\"))
        or any(part in {"", ".", ".."} for part in raw_parts)
        or any(part.startswith("-") for part in raw_parts)
        or any(part in {".", ".."} for part in path.parts)
    ):
        raise ValueError("Excluded directories must stay within the configured project root")
    return path.as_posix()


def _normalize_exclusions(exclude_dirs: Optional[List[str]]) -> List[str]:
    additional = exclude_dirs or []
    if len(additional) > MAX_EXCLUDE_DIRS:
        raise ValueError(f"exclude_dirs may contain at most {MAX_EXCLUDE_DIRS} entries")
    return list(
        dict.fromkeys(
            _normalize_exclude_dir(directory)
            for directory in [*DEFAULT_EXCLUDE_DIRS, *additional]
        )
    )


def _build_command(
    executable: str,
    pattern: str,
    *,
    file_type: Optional[str],
    case_sensitive: bool,
    include_hidden: bool,
    exclusions: List[str],
) -> List[str]:
    """Construct a fixed-option argv where the pattern follows ``--``."""

    command = [
        executable,
        "--no-config",
        "--no-follow",
        "--color=never",
        "--max-filesize=10M",
        "--max-columns=1000",
        "--max-columns-preview",
        "--case-sensitive" if case_sensitive else "--ignore-case",
    ]
    if include_hidden:
        command.append("--hidden")
    if file_type is not None:
        command.append(f"--type={file_type}")

    for directory in exclusions:
        # Values stay in the same argv element as the option, and validation
        # above excludes glob syntax. Both project-root and nested instances
        # are denied without accepting caller-provided rg options.
        command.append(f"--glob=!{directory}/**")
        command.append(f"--glob=!**/{directory}/**")

    command.extend(["--", pattern, "."])
    return command


def _ripgrep_search(
    pattern: str,
    *,
    file_type: Optional[str] = None,
    case_sensitive: bool = True,
    include_hidden: bool = False,
    follow_links: bool = False,
    exclude_dirs: Optional[List[str]] = None,
) -> Dict[str, Union[str, int, bool]]:
    """Search only the canonical ``SPARC_PROJECT_ROOT`` using bounded rg.

    ``follow_links`` remains in the public signature for compatibility, but a
    true value is rejected because a project symlink can otherwise expose data
    outside the configured boundary.
    """

    _validate_pattern(pattern)
    _validate_file_type(file_type)
    if not isinstance(case_sensitive, bool) or not isinstance(include_hidden, bool):
        raise ValueError("case_sensitive and include_hidden must be booleans")
    if not isinstance(follow_links, bool):
        raise ValueError("follow_links must be a boolean")
    if follow_links:
        raise ValueError("Following symbolic links is not allowed")
    if exclude_dirs is not None and not isinstance(exclude_dirs, list):
        raise ValueError("exclude_dirs must be a list of relative directory paths")
    exclusions = _normalize_exclusions(exclude_dirs)

    project_root = _configured_project_root()
    executable = get_rg_command()
    command = _build_command(
        executable,
        pattern,
        file_type=file_type,
        case_sensitive=case_sensitive,
        include_hidden=include_hidden,
        exclusions=exclusions,
    )

    title = Text("Searching for: ")
    title.append(pattern, style="bold")
    console.print(Panel(title, title="Ripgrep Search", border_style="bright_blue"))
    try:
        output, return_code = run_interactive_command(
            command,
            cwd=project_root,
            timeout_seconds=SEARCH_TIMEOUT_SECONDS,
            max_output_bytes=MAX_CAPTURE_BYTES,
        )
        decoded_output = output.decode("utf-8", errors="replace") if output else ""
        return {
            "output": truncate_output(decoded_output, max_lines=MAX_RESULT_LINES),
            "return_code": return_code,
            "success": return_code == 0,
        }
    except Exception as error:
        error_message = str(error)
        console.print(Panel(error_message, title="Error", border_style="red"))
        return {
            "output": error_message,
            "return_code": 1,
            "success": False,
        }


ripgrep_search = tool("ripgrep_search")(_ripgrep_search)


__all__ = ["get_rg_command", "ripgrep_search"]
