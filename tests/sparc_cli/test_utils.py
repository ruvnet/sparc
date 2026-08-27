import pytest
from sparc_cli.text.processing import truncate_output

def test_truncate_output():
    """Test that truncate_output correctly truncates long strings."""
    # Test short string (no truncation)
    short = "Hello world"
    assert truncate_output(short) == short
    
    # Test long string (truncation)
    long = "".join(f"line {index}\n" for index in range(5001))
    truncated = truncate_output(long)
    assert "[1 lines of output truncated]" in truncated
    assert "line 0\n" not in truncated
    assert truncated.endswith("line 5000\n")
    
    # Test empty string
    assert truncate_output("") == ""
    
    # Test None
    assert truncate_output(None) == ""
