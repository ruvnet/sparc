#!/bin/bash

# Agentic Preview Installation Script
# This script sets up the Agentic Preview project by installing all necessary dependencies,
# including Python packages, Poetry, and the Fly.io CLI.

set -e  # Exit immediately if a command exits with a non-zero status.

# Function to print messages
function print_step() {
    echo -e "\n\033[1;34m[Agentic Preview Installer] $1\033[0m"
}

function print_error() {
    echo -e "\033[1;31m[Error] $1\033[0m"
}

# Check if the script is run as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user."
   exit 1
fi

# Update system packages
print_step "Updating system packages..."
sudo apt-get update -y

# Install system dependencies
print_step "Installing system dependencies (git, curl, python3, python3-venv)..."
sudo apt-get install -y git curl python3 python3-venv python3-pip

# Verify installations
print_step "Verifying installations..."
for cmd in git curl python3 pip3; do
    if ! command -v $cmd &> /dev/null; then
        print_error "$cmd could not be installed. Please install it manually."
        exit 1
    else
        echo "$cmd is installed."
    fi
done

# Create project directory
PROJECT_DIR="agentic_preview"
print_step "Creating project directory '$PROJECT_DIR'..."
if [ -d "$PROJECT_DIR" ]; then
    print_error "Directory '$PROJECT_DIR' already exists. Please remove it or choose a different project name."
    exit 1
fi
mkdir "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Set up Python virtual environment
print_step "Setting up Python virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Upgrade pip
print_step "Upgrading pip..."
pip install --upgrade pip

# Install Poetry
print_step "Installing Poetry..."
curl -sSL https://install.python-poetry.org | python3 -
export PATH="$HOME/.local/bin:$PATH"

# Verify Poetry installation
if ! command -v poetry &> /dev/null; then
    print_error "Poetry could not be installed."
    exit 1
fi

# Initialize Poetry project
print_step "Initializing Poetry project..."
poetry init --name agentic_preview --description "Agentic Preview Backend Service" --author "Your Name" --python "^3.8" -n

# Add dependencies
print_step "Adding project dependencies..."
poetry add fastapi uvicorn[standard] pydantic

# Install dependencies
print_step "Installing dependencies..."
poetry install

# Install Fly.io CLI
print_step "Installing Fly.io CLI..."
if ! command -v flyctl &> /dev/null; then
    curl -L https://fly.io/install.sh | sh
    # Add Flyctl to PATH
    export FLYCTL_INSTALL="$HOME/.fly"
    export PATH="$FLYCTL_INSTALL/bin:$PATH"
    echo 'export FLYCTL_INSTALL="$HOME/.fly"' >> ~/.bashrc
    echo 'export PATH="$FLYCTL_INSTALL/bin:$PATH"' >> ~/.bashrc
fi

# Verify Flyctl installation
if ! command -v flyctl &> /dev/null; then
    print_error "Fly.io CLI could not be installed."
    exit 1
fi

# Create main application file
print_step "Creating main application file 'main.py'..."
cat > main.py << 'EOF'
import os
import asyncio
import json
import shutil
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

# Configurable runtime limit in seconds
RUN_TIME_LIMIT = 200  # You can change this value as needed

class DeployRequest(BaseModel):
    repo: str
    branch: str
    args: Optional[List[str]] = []

async def execute_command(cmd: List[str], cwd: Optional[str] = None):
    """Asynchronously execute a shell command."""
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        raise Exception(f"Command {' '.join(cmd)} failed with error: {stderr.decode()}")

    return stdout.decode()

async def stop_instance(app_name: str):
    """Stops the Fly.io instance after RUN_TIME_LIMIT seconds."""
    await asyncio.sleep(RUN_TIME_LIMIT)
    try:
        await execute_command(['flyctl', 'apps', 'destroy', app_name, '--yes'])
        print(f"[{datetime.utcnow()}] App {app_name} has been stopped after {RUN_TIME_LIMIT} seconds.")
    except Exception as e:
        print(f"Error stopping app {app_name}: {e}")

@app.post("/deploy")
async def deploy(deploy_request: DeployRequest):
    try:
        repo = deploy_request.repo
        branch = deploy_request.branch
        args = deploy_request.args or []

        # Clone the repository
        repo_name = repo.split('/')[-1]
        timestamp = int(datetime.utcnow().timestamp())
        repo_dir = f"/tmp/{repo_name}-{timestamp}"
        clone_url = f"https://github.com/{repo}.git"
        await execute_command(['git', 'clone', '-b', branch, clone_url, repo_dir])

        # Generate a unique app name
        app_name = f"preview-{repo_name}-{branch}-{timestamp}"

        # Set up Fly.io deployment
        await execute_command(['flyctl', 'launch', '--name', app_name, '--no-deploy', '--now'], cwd=repo_dir)

        # Deploy the app
        deploy_cmd = ['flyctl', 'deploy']
        deploy_cmd.extend(args)
        await execute_command(deploy_cmd, cwd=repo_dir)

        # Get the app URL
        app_info_json = await execute_command(['flyctl', 'info', '--json'], cwd=repo_dir)
        app_info = json.loads(app_info_json)
        preview_url = app_info.get('Hostname', f"{app_name}.fly.dev")

        # Schedule the instance to stop after RUN_TIME_LIMIT seconds
        asyncio.create_task(stop_instance(app_name))

        # Cleanup the cloned repository
        shutil.rmtree(repo_dir, ignore_errors=True)

        return {"preview_url": f"https://{preview_url}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
EOF

# Create a README file
print_step "Creating README file..."
cat > README.md << 'EOF'
# Agentic Preview

Agentic Preview is an asynchronous FastAPI backend service that allows users to deploy preview environments using Fly.io.

## Features

- Deploys GitHub repositories to Fly.io
- Asynchronous operations for improved performance
- Configurable runtime limit for deployments
- Cleans up resources after usage

## Requirements

- Python 3.8 or higher
- Git
- Fly.io CLI (`flyctl`)

## Installation

Run the `install.sh` script to set up the project environment:

```bash
bash install.sh
```