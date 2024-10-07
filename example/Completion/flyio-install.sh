#!/bin/bash

# This script installs Fly.io CLI (flyctl) on your machine.

set -e

# Function to check if the script is run with sudo (for Linux)
check_sudo() {
    if [ "$EUID" -ne 0 ]; then
        echo "ERROR: Please run this script with sudo or as root."
        exit 1
    fi
}

# Function to print verbose output
verbose_echo() {
    echo "[VERBOSE] $1"
}

# Detect the OS
OS=$(uname -s)
verbose_echo "Detected OS: $OS"

if [ "$OS" == "Linux" ]; then
    verbose_echo "Starting installation process for Linux..."
    check_sudo
    verbose_echo "Downloading and running Fly.io installation script..."
    curl -L https://fly.io/install.sh | sh
    verbose_echo "Adding flyctl to PATH for all users..."
    FLYCTL_INSTALL="/usr/local/bin"
    echo "export FLYCTL_INSTALL=\"$FLYCTL_INSTALL\"" | sudo tee /etc/profile.d/flyctl.sh > /dev/null
    echo "export PATH=\"\$FLYCTL_INSTALL:\$PATH\"" | sudo tee -a /etc/profile.d/flyctl.sh > /dev/null
    verbose_echo "Sourcing the new environment variables..."
    source /etc/profile.d/flyctl.sh
elif [ "$OS" == "Darwin" ]; then
    verbose_echo "Starting installation process for macOS..."
    if ! command -v brew &> /dev/null; then
        echo "ERROR: Homebrew is not installed. Please install Homebrew first: https://brew.sh/"
        exit 1
    fi
    verbose_echo "Using Homebrew to install flyctl..."
    brew install flyctl
elif [[ "$OS" == CYGWIN* || "$OS" == MINGW* || "$OS" == MSYS* ]]; then
    verbose_echo "Starting installation process for Windows..."
    verbose_echo "Downloading and running Fly.io PowerShell installation script..."
    powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
else
    echo "ERROR: Unsupported OS: $OS"
    exit 1
fi

# Verify installation
verbose_echo "Verifying flyctl installation..."
if command -v flyctl &> /dev/null; then
    echo "SUCCESS: flyctl successfully installed."
    verbose_echo "Checking flyctl version..."
    flyctl version
else
    echo "ERROR: flyctl installation failed. Please check the above output for errors."
    exit 1
fi

echo "Installation complete. Please restart your terminal or run 'source /etc/profile.d/flyctl.sh' to use flyctl."
verbose_echo "Script execution finished."
