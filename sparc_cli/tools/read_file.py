import os
import os.path
import logging
import time
from typing import Dict, Optional, Tuple
from pathlib import Path
from langchain_core.tools import tool
from rich.console import Console
from rich.panel import Panel
from sparc_cli.text.processing import truncate_output

console = Console()

# Standard buffer size for file reading
CHUNK_SIZE = 8192


def _check_safe_path(filepath: str) -> None:
    safe_root = Path.cwd().resolve()
    resolved = Path(filepath).resolve()
    if not (str(resolved).startswith(str(safe_root) + os.sep) or resolved == safe_root):
        raise PermissionError(f"Access denied: path outside working directory: {filepath}")


@tool
def read_file_tool(
    filepath: str,
    verbose: bool = True,
    encoding: str = 'utf-8'
) -> Dict[str, str]:
    """Read and return the contents of a text file.

    Args:
        filepath: Path to the file to read
        verbose: Whether to display a Rich panel with read statistics (default: True)
        encoding: File encoding to use (default: utf-8)

    Returns:
        Dict containing:
            - content: The file contents as a string (truncated if needed)

    Raises:
        RuntimeError: If file cannot be read or does not exist
    """
    _check_safe_path(filepath)
    start_time = time.time()
    try:
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")

        logging.debug(f"Starting to read file: {filepath}")
        content = []
        line_count = 0
        total_bytes = 0

        with open(filepath, 'r', encoding=encoding) as f:
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                
                content.append(chunk)
                total_bytes += len(chunk)
                line_count += chunk.count('\n')
                
                logging.debug(f"Read chunk: {len(chunk)} bytes, running total: {total_bytes} bytes")

        full_content = ''.join(content)
        elapsed = time.time() - start_time
        
        logging.debug(f"File read complete: {total_bytes} bytes in {elapsed:.2f}s")
        logging.debug(f"Pre-truncation stats: {total_bytes} bytes, {line_count} lines")

        if verbose:
            console.print(Panel(
                f"Read {line_count} lines ({total_bytes} bytes) from {filepath} in {elapsed:.2f}s",
                title="📄 File Read",
                border_style="bright_blue"
            ))
        
        # Truncate if needed
        truncated = truncate_output(full_content) if full_content else ""

        return {"content": truncated}

    except Exception as e:
        elapsed = time.time() - start_time
        raise
