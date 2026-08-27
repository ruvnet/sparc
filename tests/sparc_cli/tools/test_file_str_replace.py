import pytest
from sparc_cli.tools.file_str_replace import file_str_replace
from unittest.mock import patch, mock_open

def test_file_str_replace():
    """Test successful string replacement."""
    test_content = "Hello world"
    expected_content = "Hello universe"
    
    mock = mock_open(read_data=test_content)
    with patch('pathlib.Path.exists', return_value=True), \
         patch('pathlib.Path.read_text', return_value=test_content), \
         patch('pathlib.Path.write_text') as mock_write, \
         patch('builtins.open', mock):
        
        result = file_str_replace.invoke({
            "filepath": "test.txt",
            "old_str": "world",
            "new_str": "universe",
        })
        
        assert result["success"] is True
        mock_write.assert_called_once_with(expected_content)

def test_file_str_replace_file_not_found():
    """Test handling of nonexistent files."""
    with patch('pathlib.Path.exists', return_value=False):
        result = file_str_replace.invoke({
            "filepath": "nonexistent.txt",
            "old_str": "test",
            "new_str": "new",
        })
        assert result["success"] is False
        assert "not found" in result["message"]

def test_file_str_replace_string_not_found():
    """Test handling of strings that don't exist in the file."""
    test_content = "Hello world"
    
    with patch('pathlib.Path.exists', return_value=True), \
         patch('pathlib.Path.read_text', return_value=test_content):
        
        result = file_str_replace.invoke({
            "filepath": "test.txt",
            "old_str": "nonexistent",
            "new_str": "new",
        })
        assert result["success"] is False
        assert "not found" in result["message"]

def test_file_str_replace_multiple_occurrences():
    """Test handling of strings that appear multiple times."""
    test_content = "Hello world world"
    
    with patch('pathlib.Path.exists', return_value=True), \
         patch('pathlib.Path.read_text', return_value=test_content):
        
        result = file_str_replace.invoke({
            "filepath": "test.txt",
            "old_str": "world",
            "new_str": "universe",
        })
        assert result["success"] is False
        assert "appears 2 times" in result["message"]
