"""Bounded directory tree rendering for the configured project root."""

from __future__ import annotations

import datetime
import fnmatch
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Set

import pathspec
from langchain_core.tools import tool
from rich.console import Console
from rich.markdown import Markdown
from rich.markup import escape
from rich.panel import Panel
from rich.tree import Tree

console = Console()


@dataclass
class DirScanConfig:
    """Configuration for a bounded directory scan."""

    max_depth: int
    follow_links: bool
    show_size: bool
    show_modified: bool
    exclude_patterns: List[str]


DEFAULT_EXCLUDE_PATTERNS = [
    ".*",
    "__pycache__",
    "*.pyc",
    "node_modules",
    "*.swp",
    "*.swo",
    "*.swn",
    "*.class",
    "*.o",
    "*.so",
    "*.dll",
    "*.exe",
    "*.log",
    "*.bak",
    "*.tmp",
    "*.cache",
]


def _configured_project_root() -> Path:
    configured = os.environ.get("SPARC_PROJECT_ROOT")
    candidate = Path(configured) if configured else Path.cwd()
    try:
        root = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise ValueError("Configured project root does not exist") from error
    if not root.is_dir():
        raise ValueError("Configured project root is not a directory")
    return root


def _resolve_project_path(path: str, project_root: Path) -> Path:
    if not isinstance(path, str) or not path or "\x00" in path:
        raise ValueError("Path is invalid")
    requested = Path(path)
    if ".." in requested.parts:
        raise ValueError("Parent traversal is not allowed")
    candidate = requested if requested.is_absolute() else project_root / requested
    try:
        resolved = candidate.resolve(strict=True)
    except (FileNotFoundError, OSError, RuntimeError) as error:
        raise ValueError(f"Path does not exist: {path}") from error
    if not resolved.is_relative_to(project_root):
        raise ValueError("Path escapes the configured project root")
    if not resolved.is_dir():
        raise ValueError(f"Path is not a directory: {path}")
    return resolved


def format_size(size_bytes: int) -> str:
    """Format file size in human readable form."""

    value = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if value < 1024:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}TB"


def format_time(timestamp: float) -> str:
    """Format a timestamp as a local date and time."""

    return datetime.datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M")


def load_gitignore_patterns(path: Path) -> pathspec.PathSpec:
    """Load project-root gitignore rules plus the conservative defaults."""

    gitignore_path = path / ".gitignore"
    patterns: List[str] = []
    if gitignore_path.is_file():
        with gitignore_path.open(encoding="utf-8", errors="replace") as gitignore:
            patterns.extend(
                line.strip()
                for line in gitignore
                if line.strip() and not line.lstrip().startswith("#")
            )
    patterns.extend(DEFAULT_EXCLUDE_PATTERNS)
    return pathspec.GitIgnoreSpec.from_lines(patterns)


def should_ignore(path: str, spec: pathspec.PathSpec) -> bool:
    """Return whether a project-relative path matches ignore rules."""

    return spec.match_file(path)


def should_exclude(name: str, patterns: List[str]) -> bool:
    """Return whether a file or directory name matches an explicit exclusion."""

    return any(fnmatch.fnmatch(name, pattern) for pattern in patterns)


def _assert_within_project(path: Path, project_root: Path) -> Path:
    try:
        resolved = path.resolve(strict=True)
    except (FileNotFoundError, OSError, RuntimeError) as error:
        raise ValueError("Directory entry could not be resolved safely") from error
    if not resolved.is_relative_to(project_root):
        raise ValueError("Symbolic link escapes the configured project root")
    return resolved


def build_tree(
    path: Path,
    tree: Tree,
    config: DirScanConfig,
    current_depth: int = 0,
    spec: Optional[pathspec.PathSpec] = None,
    *,
    scan_root: Optional[Path] = None,
    project_root: Optional[Path] = None,
    visited: Optional[Set[Path]] = None,
    relative_prefix: Optional[Path] = None,
) -> None:
    """Recursively build a tree without crossing the configured boundary."""

    if current_depth >= config.max_depth:
        return
    scan_root = scan_root or path
    project_root = project_root or path
    visited = visited if visited is not None else set()
    relative_prefix = relative_prefix or Path()
    canonical_directory = _assert_within_project(path, project_root)
    if canonical_directory in visited:
        return
    visited.add(canonical_directory)

    try:
        entries = sorted(path.iterdir(), key=lambda entry: (not entry.is_dir(), entry.name.lower()))
    except PermissionError:
        tree.add("Permission denied")
        return

    for entry in entries:
        relative_path = (relative_prefix / entry.name).as_posix()
        if spec and should_ignore(relative_path, spec):
            continue
        if should_exclude(entry.name, config.exclude_patterns):
            continue
        if entry.is_symlink() and not config.follow_links:
            continue

        try:
            canonical_entry = _assert_within_project(entry, project_root)
            if canonical_entry.is_dir():
                branch = tree.add(f"[blue]{escape(entry.name)}/[/blue]")
                build_tree(
                    canonical_entry,
                    branch,
                    config,
                    current_depth + 1,
                    spec,
                    scan_root=scan_root,
                    project_root=project_root,
                    visited=visited,
                    relative_prefix=relative_prefix / entry.name,
                )
            else:
                metadata = []
                if config.show_size:
                    metadata.append(format_size(canonical_entry.stat().st_size))
                if config.show_modified:
                    metadata.append(format_time(canonical_entry.stat().st_mtime))
                label = escape(entry.name)
                if metadata:
                    label = f"{label} ({', '.join(metadata)})"
                tree.add(label)
        except PermissionError:
            tree.add(f"{escape(entry.name)} (Permission denied)")


def _list_directory_tree(
    path: str = ".",
    *,
    max_depth: int = 1,
    follow_links: bool = False,
    show_size: bool = False,
    show_modified: bool = False,
    exclude_patterns: Optional[List[str]] = None,
) -> str:
    """Render a directory tree that cannot leave the configured project root."""

    if not 0 <= max_depth <= 20:
        raise ValueError("max_depth must be between 0 and 20")
    for pattern in exclude_patterns or []:
        if not pattern or "\x00" in pattern or ".." in Path(pattern).parts:
            raise ValueError("Exclude patterns must be relative to the configured project root")

    project_root = _configured_project_root()
    root_path = _resolve_project_path(path, project_root)
    spec = load_gitignore_patterns(project_root)
    tree = Tree(f"[blue]{escape(str(root_path))}/[/blue]")
    config = DirScanConfig(
        max_depth=max_depth,
        follow_links=follow_links,
        show_size=show_size,
        show_modified=show_modified,
        exclude_patterns=DEFAULT_EXCLUDE_PATTERNS + (exclude_patterns or []),
    )
    build_tree(
        root_path,
        tree,
        config,
        spec=spec,
        scan_root=root_path,
        project_root=project_root,
    )

    with console.capture() as capture:
        console.print(tree)
    tree_string = capture.get()
    console.print(
        Panel(
            Markdown(f"```\n{tree_string}\n```"),
            title="Directory Tree",
            border_style="bright_blue",
        )
    )
    return tree_string


list_directory_tree = tool("list_directory_tree")(_list_directory_tree)


__all__ = [
    "DirScanConfig",
    "build_tree",
    "format_size",
    "format_time",
    "list_directory_tree",
    "load_gitignore_patterns",
    "should_exclude",
    "should_ignore",
]
