import pytest
from unittest.mock import patch, Mock
from sparc_cli.tools.shell import run_shell_command
from sparc_cli.tools.memory import _global_memory

@pytest.fixture
def mock_console():
    """Mock console output."""
    with patch('sparc_cli.tools.shell.console') as mock:
        yield mock

@pytest.fixture
def mock_prompt():
    """Mock user prompt."""
    with patch('sparc_cli.tools.shell.Prompt') as mock:
        yield mock

@pytest.fixture
def mock_run_interactive():
    """Mock interactive command execution."""
    with patch('sparc_cli.tools.shell.run_interactive_command') as mock:
        mock.return_value = (b"test output", 0)
        yield mock

def test_run_shell_command_cowboy_mode(mock_console, mock_run_interactive):
    """Test shell command execution in cowboy mode."""
    _global_memory['config'] = {'cowboy_mode': True}
    
    with patch('sparc_cli.tools.shell.get_cowboy_message') as mock_get_message:
        mock_get_message.return_value = '🤠 Test cowboy message!'
        
        result = run_shell_command.invoke({"command": "echo test"})
        assert result["success"] is True
        assert result["return_code"] == 0
        assert "test output" in result["output"]

def test_run_shell_command_interactive(mock_console, mock_prompt, mock_run_interactive):
    """Test shell command execution in interactive mode."""
    _global_memory['config'] = {'cowboy_mode': False}
    mock_prompt.ask.return_value = "y"
    
    result = run_shell_command.invoke({"command": "echo test"})
    assert result["success"] is True
    assert result["return_code"] == 0
    assert "test output" in result["output"]

def test_run_shell_command_cancelled(mock_console, mock_prompt):
    """Test shell command cancellation."""
    _global_memory['config'] = {'cowboy_mode': False}
    mock_prompt.ask.return_value = "n"
    
    result = run_shell_command.invoke({"command": "echo test"})
    assert result["success"] is False
    assert "cancelled" in result["output"].lower()

def test_run_shell_command_error(mock_console, mock_run_interactive):
    """Test shell command error handling."""
    _global_memory['config'] = {'cowboy_mode': True}
    mock_run_interactive.side_effect = Exception("Test error")
    
    result = run_shell_command.invoke({"command": "invalid command"})
    assert result["success"] is False
    assert result["return_code"] == 1
    assert "error" in result["output"].lower()
