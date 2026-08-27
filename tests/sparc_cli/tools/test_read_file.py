import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from sparc_cli.tools import read_file_tool

def test_read_file_tool(tmp_path, monkeypatch):
    """Test that read_file_tool reads file content."""
    test_content = "test content"
    monkeypatch.chdir(tmp_path)
    Path("test.txt").write_text(test_content, encoding="utf-8")

    result = read_file_tool.invoke({"filepath": "test.txt", "verbose": False})
    assert isinstance(result, dict)
    assert "content" in result
    assert result["content"] == test_content

def test_read_file_tool_nonexistent():
    """Test that read_file_tool handles nonexistent files."""
    with pytest.raises(FileNotFoundError):
        read_file_tool.invoke({"filepath": "nonexistent.txt"})

def test_read_file_tool_error():
    """Test that read_file_tool handles read errors."""
    with patch('os.path.exists', return_value=True), patch('builtins.open') as mock_open:
        mock_open.side_effect = IOError("Test error")
        with pytest.raises(IOError):
            read_file_tool.invoke({"filepath": "test.txt"})

def mock_open(read_data=""):
    """Helper to create a mock file object."""
    mock = MagicMock(name='mock_open')
    handle = MagicMock(name='file_handle')
    handle.__enter__.return_value = handle
    handle.read.return_value = read_data
    mock.return_value = handle
    return mock
