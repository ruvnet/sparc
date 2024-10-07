#!/bin/bash

# This script starts the FastAPI application using Uvicorn with Poetry.

set -e

# Navigate to the directory where this script is located
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

# Check if Poetry is installed, if not, install it
if ! command -v poetry &> /dev/null
then
    echo "Poetry not found, installing Poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
    export PATH="$HOME/.local/bin:$PATH"
fi

# Install required Python packages using Poetry
if [ -f "pyproject.toml" ]; then
    echo "Installing Python dependencies with Poetry..."
    poetry install
else
    echo "No pyproject.toml found, skipping Python dependency installation."
fi

# Run the FastAPI application using Poetry with auto-reload
poetry run uvicorn main:app --host 0.0.0.0 --port 5000 --reload

# Note:
# Ensure that 'main.py' contains the FastAPI app instance named 'app', and this script is located in the same directory as 'main.py'.