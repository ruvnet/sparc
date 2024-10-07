#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "Installing Poetry..."
curl -sSL https://install.python-poetry.org | python3 -

export PATH="$HOME/.local/bin:$PATH"

echo "Installing Python dependencies using Poetry..."
cd example/Completion/app
poetry install

echo "Installing Node.js dependencies..."
cd ../../..
npm install

echo "Installation complete."
