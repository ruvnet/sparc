import os
import pytest
from unittest.mock import patch, mock_open
from git.exc import InvalidGitRepositoryError
from sparc_cli.tools.write_file import write_file_tool

def test_write_file_tool():
    """Test that write_file_tool writes content to a file."""
    with patch('builtins.open', mock_open()) as mock_file:
        result = write_file_tool.invoke({
            "filepath": "test.txt",
            "content": "test content",
        })
        mock_file.assert_called_once_with("test.txt", "w", encoding="utf-8")
        mock_file().write.assert_called_once_with("test content")
        assert result["success"] is True

def test_write_file_tool_error():
    """Test that write_file_tool handles errors."""
    with patch('builtins.open', mock_open()) as mock_file:
        mock_file.side_effect = IOError("Test error")
        result = write_file_tool.invoke({
            "filepath": "test.txt",
            "content": "test content",
        })
        assert result["success"] is False
        assert "error" in result["message"].lower()

def test_write_file_tool_creates_directories():
    """Test that write_file_tool creates parent directories."""
    with patch('os.makedirs') as mock_makedirs, \
         patch('builtins.open', mock_open()) as mock_file:
        result = write_file_tool.invoke({
            "filepath": "dir/test.txt",
            "content": "test content",
        })
        mock_makedirs.assert_called_once()
        assert result["success"] is True
