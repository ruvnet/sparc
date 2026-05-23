"""
Module for running interactive subprocesses with output capture.
"""

import os
import re
import subprocess
import tempfile
import shutil
from typing import List, Tuple


def run_interactive_command(cmd: List[str]) -> Tuple[bytes, int]:
    """
    Runs an interactive command with a pseudo-tty, capturing combined output.

    Assumptions and constraints:
    - We are on a Linux system with script available
    - `cmd` is a non-empty list where cmd[0] is the executable
    - The executable and script are assumed to be on PATH
    - If anything is amiss (e.g., command not found), we fail early and cleanly

    The output is cleaned to remove ANSI escape sequences and control characters.

    Returns:
        Tuple of (cleaned_output, return_code)
    """
    # Fail early if cmd is empty
    if not cmd:
        raise ValueError("No command provided.")

    # Check that the command exists
    if shutil.which(cmd[0]) is None:
        raise FileNotFoundError(f"Command '{cmd[0]}' not found in PATH.")

    # Create temp file for output (we'll always clean it up)
    output_file = tempfile.NamedTemporaryFile(prefix="output_", delete=False)
    output_path = output_file.name
    output_file.close()

    def cleanup():
        if os.path.exists(output_path):
            os.remove(output_path)

    try:
        # Disable pagers by setting environment variables
        env = os.environ.copy()
        env['GIT_PAGER'] = ''
        env['PAGER'] = ''

        # Run command with script for TTY and output capture.
        # Pass cmd as a list to script's -c option so no shell interpolation occurs.
        # The return code of the inner command is the exit status of script itself.
        proc = subprocess.run(
            ['script', '-q', '-e', '-c', ' '.join(
                subprocess.list2cmdline([c]) if ' ' in c else c for c in cmd
            ), output_path],
            env=env,
        )
        return_code = proc.returncode

        # Read and clean the output
        with open(output_path, "rb") as f:
            output = f.read()

        # Clean ANSI escape sequences and control characters
        output = re.sub(rb'\x1b\[[0-9;]*[a-zA-Z]', b'', output)  # ANSI escape sequences
        output = re.sub(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', b'', output)  # Control chars

    except Exception as e:
        # If something goes wrong, cleanup and re-raise
        cleanup()
        raise RuntimeError("Error running interactive capture") from e
    finally:
        # Ensure files are removed no matter what
        cleanup()

    return output, return_code
