"""Fuzzy file discovery constrained to the configured project root."""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path, PurePosixPath
from typing import List, Optional, Tuple

from git import Repo
from git.exc import InvalidGitRepositoryError, NoSuchPathError
from langchain_core.tools import tool
from rapidfuzz import fuzz, process
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

console = Console()

DEFAULT_EXCLUDE_PATTERNS = [
    "*.pyc",
    "__pycache__/*",
    ".git/*",
    "*.so",
    "*.o",
    "*.class",
]


def _configured_project_root() -> Path:
    """Return the canonical trusted root configured by the host process."""

    configured = os.environ.get("SPARC_PROJECT_ROOT")
    candidate = Path(configured) if configured else Path.cwd()
    try:
        root = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ValueError("Configured project root does not exist") from error
    if not root.is_dir():
        raise ValueError("Configured project root is not a directory")
    return root


def _validate_pattern(pattern: str) -> None:
    path = PurePosixPath(pattern.replace("\\", "/"))
    if not pattern or path.is_absolute() or ".." in path.parts or "\x00" in pattern:
        raise ValueError("File patterns must be relative to the configured project root")


def _safe_repository_path(root: Path, candidate: str) -> Optional[str]:
    """Normalize one Git path and discard paths that escape through syntax or links."""

    normalized = candidate.replace("\\", "/")
    relative = PurePosixPath(normalized)
    if not normalized or relative.is_absolute() or ".." in relative.parts or "\x00" in normalized:
        return None

    filesystem_path = root.joinpath(*relative.parts)
    try:
        resolved = filesystem_path.resolve(strict=False)
    except (OSError, RuntimeError):
        return None
    if not resolved.is_relative_to(root):
        return None
    return relative.as_posix()


def _fuzzy_find_project_files(
    search_term: str,
    *,
    repo_path: str = ".",
    threshold: int = 60,
    max_results: int = 10,
    include_paths: Optional[List[str]] = None,
    exclude_patterns: Optional[List[str]] = None,
) -> List[Tuple[str, int]]:
    """Find Git project files while enforcing the configured project boundary.

    ``repo_path`` is retained for command compatibility, but it cannot be used
    to select another repository. Set ``SPARC_PROJECT_ROOT`` in the trusted host
    environment before exposing the tool when the process working directory is
    not the intended project root.
    """

    if repo_path != ".":
        raise ValueError("Repository root override is not allowed")
    if not 0 <= threshold <= 100:
        raise ValueError("Threshold must be between 0 and 100")
    if not 1 <= max_results <= 100:
        raise ValueError("max_results must be between 1 and 100")
    if not search_term:
        return []
    if len(search_term) > 512 or "\x00" in search_term:
        raise ValueError("search_term is invalid")

    for pattern in (include_paths or []) + (exclude_patterns or []):
        _validate_pattern(pattern)

    root = _configured_project_root()
    try:
        repo = Repo(root, search_parent_directories=False)
    except (InvalidGitRepositoryError, NoSuchPathError) as error:
        raise ValueError("Configured project root must be the repository root") from error
    working_tree = Path(repo.working_tree_dir or "").resolve(strict=True)
    if working_tree != root:
        raise ValueError("Configured project root must be the repository root")

    candidates = repo.git.ls_files().splitlines() + list(repo.untracked_files)
    all_files = sorted(
        {
            safe_path
            for candidate in candidates
            if (safe_path := _safe_repository_path(root, candidate)) is not None
        }
    )

    if include_paths:
        all_files = [
            path
            for path in all_files
            if any(fnmatch.fnmatch(path, pattern) for pattern in include_paths)
        ]

    patterns = DEFAULT_EXCLUDE_PATTERNS + (exclude_patterns or [])
    all_files = [
        path
        for path in all_files
        if not any(fnmatch.fnmatch(path, pattern) for pattern in patterns)
    ]

    raw_matches = process.extract(
        search_term,
        all_files,
        scorer=fuzz.WRatio,
        limit=max_results,
    )
    filtered_matches = [
        (str(match[0]), int(round(float(match[1]))))
        for match in raw_matches
        if float(match[1]) >= threshold
    ]

    params_section = [
        "## Search Parameters",
        f"**Search Term**: `{search_term}`",
        f"**Repository**: `{root}`",
        f"**Threshold**: {threshold}",
        f"**Max Results**: {max_results}",
    ]
    if include_paths:
        params_section.extend(["\n**Include Patterns**:", *[f"- `{item}`" for item in include_paths]])
    if exclude_patterns:
        params_section.extend(
            ["\n**Exclude Patterns**:", *[f"- `{item}`" for item in exclude_patterns]]
        )

    stats_section = [
        "## Results Statistics",
        f"**Total Files Scanned**: {len(all_files)}",
        f"**Matches Found**: {len(filtered_matches)}",
    ]
    results_section = ["## Top Matches"]
    if filtered_matches:
        results_section.extend(
            f"- `{path}` (score: {score})" for path, score in filtered_matches[:5]
        )
    else:
        results_section.append("*No matches found*")

    console.print(
        Panel(
            Markdown("\n\n".join(["\n".join(params_section), "\n".join(stats_section), "\n".join(results_section)])),
            title="Fuzzy Find Results",
            border_style="bright_blue",
        )
    )
    return filtered_matches


fuzzy_find_project_files = tool("fuzzy_find_project_files")(_fuzzy_find_project_files)


__all__ = ["fuzzy_find_project_files"]
