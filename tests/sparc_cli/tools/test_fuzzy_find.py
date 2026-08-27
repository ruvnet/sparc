from pathlib import Path

import pytest
from git import Repo

from sparc_cli.tools.fuzzy_find import _fuzzy_find_project_files, fuzzy_find_project_files


@pytest.fixture
def project(tmp_path, monkeypatch):
    root = tmp_path / "project"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "important_module.py").write_text("pass\n", encoding="utf-8")
    (root / "README.md").write_text("project\n", encoding="utf-8")
    repo = Repo.init(root)
    repo.index.add(["src/important_module.py", "README.md"])
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(root))
    return root, repo


def test_finds_files_only_in_configured_repository(project):
    assert fuzzy_find_project_files.name == "fuzzy_find_project_files"
    root, _ = project
    matches = _fuzzy_find_project_files("important module", threshold=40)
    assert matches
    assert matches[0][0] == "src/important_module.py"
    assert all(not Path(path).is_absolute() for path, _ in matches)
    assert root.name not in matches[0][0]


@pytest.mark.parametrize("override", ["..", "/tmp", "subdirectory", "./other"])
def test_rejects_repository_root_override(project, override):
    with pytest.raises(ValueError, match="override"):
        _fuzzy_find_project_files("file", repo_path=override)


@pytest.mark.parametrize("pattern", ["../*", "/etc/*", "src/../../*", ""])
def test_rejects_unsafe_file_patterns(project, pattern):
    with pytest.raises(ValueError, match="relative"):
        _fuzzy_find_project_files("file", include_paths=[pattern])


def test_excludes_symlink_that_escapes_project(project, tmp_path):
    root, repo = project
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret\n", encoding="utf-8")
    (root / "leaked-secret.txt").symlink_to(outside / "secret.txt")
    repo.index.add(["leaked-secret.txt"])

    matches = _fuzzy_find_project_files("leaked secret", threshold=0, max_results=100)
    assert "leaked-secret.txt" not in {path for path, _ in matches}


def test_configured_root_must_be_repository_root(project, monkeypatch):
    root, _ = project
    monkeypatch.setenv("SPARC_PROJECT_ROOT", str(root / "src"))
    with pytest.raises(ValueError, match="repository root"):
        _fuzzy_find_project_files("module")


def test_bounds_threshold_and_result_count(project):
    with pytest.raises(ValueError, match="Threshold"):
        _fuzzy_find_project_files("module", threshold=101)
    with pytest.raises(ValueError, match="max_results"):
        _fuzzy_find_project_files("module", max_results=101)
