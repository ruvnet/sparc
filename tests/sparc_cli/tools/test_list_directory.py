from pathlib import Path

import pytest

from sparc_cli.tools.list_directory import (
    _list_directory_tree,
    list_directory_tree,
    load_gitignore_patterns,
    should_ignore,
)


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "main.py").write_text("pass\n", encoding="utf-8")
    (root / "README.md").write_text("project\n", encoding="utf-8")
    (root / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
    (root / "ignored.txt").write_text("ignore me\n", encoding="utf-8")
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(root))
    return root


def test_lists_relative_directory_within_configured_root(project):
    assert list_directory_tree.name == "list_directory_tree"
    tree = _list_directory_tree("src", max_depth=2)
    assert "main.py" in tree
    assert str(project / "src") in tree


@pytest.mark.parametrize("path", ["../outside", "src/../../outside", "./../project"])
def test_rejects_parent_traversal(project, path):
    with pytest.raises(ValueError, match="traversal"):
        _list_directory_tree(path)


def test_rejects_absolute_path_outside_configured_root(project, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    with pytest.raises(ValueError, match="escapes"):
        _list_directory_tree(str(outside))


def test_allows_absolute_path_only_when_it_is_inside_root(project):
    tree = _list_directory_tree(str(project / "src"), max_depth=1)
    assert "main.py" in tree


def test_direct_symlink_path_cannot_escape_root(project, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (project / "escape").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes"):
        _list_directory_tree("escape", follow_links=False)


def test_external_symlink_is_skipped_by_default_and_rejected_if_followed(project, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret\n", encoding="utf-8")
    (project / "leak").symlink_to(outside, target_is_directory=True)

    tree = _list_directory_tree(".", follow_links=False, max_depth=2)
    assert "leak" not in tree
    assert "secret.txt" not in tree

    with pytest.raises(ValueError, match="escapes"):
        _list_directory_tree(".", follow_links=True, max_depth=2)


def test_gitignore_is_loaded_only_from_project_root(project):
    spec = load_gitignore_patterns(project)
    assert should_ignore("ignored.txt", spec)
    assert should_ignore("node_modules/package.json", spec)
    assert not should_ignore("src/main.py", spec)


@pytest.mark.parametrize("depth", [-1, 21])
def test_rejects_unbounded_depth(project, depth):
    with pytest.raises(ValueError, match="max_depth"):
        _list_directory_tree(".", max_depth=depth)


def test_rejects_traversal_in_exclude_patterns(project):
    with pytest.raises(ValueError, match="Exclude patterns"):
        _list_directory_tree(".", exclude_patterns=["../secret"])
