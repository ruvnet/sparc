#!/bin/bash

echo "Welcome to SPARC CLI Installation"
echo "================================"
echo

# Function to prompt for a secret
prompt_secret() {
    local secret_name=$1
    local required=$2
    local current_value=${!secret_name}
    
    if [ -n "$current_value" ]; then
        echo "Enter value for ${secret_name} (current: ${current_value}):"
    else
        echo "Enter value for ${secret_name}:"
    fi
    
    read -s value
    echo
    
    if [ -n "$value" ]; then
        echo "$value"
        return 0
    elif [ -n "$current_value" ]; then
        echo "$current_value"
        return 0
    elif [ "$required" = "true" ]; then
        echo "Error: ${secret_name} is required" >&2
        return 1
    fi
    return 0
}

# Function to setup environment variables
setup_environment() {
    echo "Setting up API keys..."
    echo "----------------------"
    echo "Press Enter to keep existing values or input new ones."
    echo "For required keys, you must provide a value."
    echo
    
    # Create exports file
    local exports_file="$HOME/.sparc_exports"
    
    echo "The following API keys are used to access different AI models:"
    echo
    
    # Always require ANTHROPIC_API_KEY
    echo "ANTHROPIC_API_KEY (Required)"
    echo "- Used for Claude models from Anthropic"
    echo "- Get it from: https://console.anthropic.com/account/keys"
    while true; do
        ANTHROPIC_API_KEY=$(prompt_secret "ANTHROPIC_API_KEY" "true")
        if [ $? -eq 0 ] && [ -n "$ANTHROPIC_API_KEY" ]; then
            break
        fi
        echo "ANTHROPIC_API_KEY is required. Please try again."
    done
    echo
    
    # Optional keys with descriptions
    echo "OPENAI_API_KEY (Optional)"
    echo "- Used for GPT models from OpenAI"
    echo "- Get it from: https://platform.openai.com/api-keys"
    OPENAI_API_KEY=$(prompt_secret "OPENAI_API_KEY" "false")
    echo
    
    echo "OPENROUTER_KEY (Optional)"
    echo "- Used to access multiple AI models through a single API"
    echo "- Get it from: https://openrouter.ai/keys"
    OPENROUTER_KEY=$(prompt_secret "OPENROUTER_KEY" "false")
    echo
    
    echo "ENCRYPTION_KEY (Optional)"
    echo "- Used for secure storage of sensitive data"
    echo "- Can be any string you choose"
    ENCRYPTION_KEY=$(prompt_secret "ENCRYPTION_KEY" "false")
    echo
    
    echo "GEMINI_API_KEY (Optional)"
    echo "- Used for Google's Gemini models"
    echo "- Get it from: https://makersuite.google.com/app/apikey"
    GEMINI_API_KEY=$(prompt_secret "GEMINI_API_KEY" "false")
    echo
    
    echo "VERTEXAI_PROJECT (Optional)"
    echo "- Your Google Cloud project ID for Vertex AI"
    echo "- Find it in your Google Cloud Console"
    VERTEXAI_PROJECT=$(prompt_secret "VERTEXAI_PROJECT" "false")
    echo
    
    echo "VERTEXAI_LOCATION (Optional)"
    echo "- Geographic location for Vertex AI services (e.g., us-central1)"
    echo "- See: https://cloud.google.com/vertex-ai/docs/general/locations"
    VERTEXAI_LOCATION=$(prompt_secret "VERTEXAI_LOCATION" "false")
    
    # Create exports file
    cat > "$exports_file" << EOF
# SPARC CLI Environment Variables
export ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}'
export OPENAI_API_KEY='${OPENAI_API_KEY}'
export OPENROUTER_KEY='${OPENROUTER_KEY}'
export ENCRYPTION_KEY='${ENCRYPTION_KEY}'
export GEMINI_API_KEY='${GEMINI_API_KEY}'
export VERTEXAI_PROJECT='${VERTEXAI_PROJECT}'
export VERTEXAI_LOCATION='${VERTEXAI_LOCATION}'
EOF
    
    # Make exports file executable
    chmod +x "$exports_file"
    
    # Source the exports file
    source "$exports_file"
    
    # Add to shell rc file if not already there
    local rc_file="$HOME/.bashrc"
    if [[ "$SHELL" == *"zsh"* ]]; then
        rc_file="$HOME/.zshrc"
    fi
    
    if ! grep -q "source.*\.sparc_exports" "$rc_file" 2>/dev/null; then
        echo "# SPARC CLI Environment Variables" >> "$rc_file"
        echo "source $exports_file" >> "$rc_file"
    fi
    
    echo
    echo "Environment variables have been set and will be loaded in new shell sessions"
    echo "To use them in the current session, run: source $exports_file"
    echo
}

# Function to install local dependencies
install_local() {
    echo "Installing SPARC CLI locally..."
    echo "-------------------------------"
    
    # Check if Python is installed
    if ! command -v python3 &> /dev/null; then
        echo "Error: Python 3 is required but not installed."
        exit 1
    fi
    
    # Install pip if not present
    if ! command -v pip3 &> /dev/null; then
        echo "Installing pip..."
        curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
        python3 get-pip.py
        rm get-pip.py
    fi
    
    # Install dependencies
    echo "Installing Python dependencies..."
    pip3 install -e .
    
    # Install Playwright browsers
    echo "Installing Playwright browsers..."
    playwright install
    
    echo
    echo "Local installation complete!"
    echo "Run 'sparc' to start using the CLI"
}

# Function to install Docker version
install_docker() {
    echo "Installing SPARC CLI via Docker..."
    echo "--------------------------------"
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo "Error: Docker is required but not installed."
        echo "Please install Docker first: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Make entrypoint script executable
    chmod +x docker-entrypoint.sh
    
    # Build Docker image
    echo "Building Docker image..."
    ./docker-entrypoint.sh
    
    echo
    echo "Docker installation complete!"
    echo "Run './docker-entrypoint.sh' to start using the CLI"
}

# Main installation flow
setup_environment

echo "Installation Options"
echo "-------------------"
echo "1) Local installation (requires Python 3)"
echo "2) Docker installation (requires Docker)"
echo
read -p "Choose installation method [1/2]: " choice

case $choice in
    1)
        install_local
        ;;
    2)
        install_docker
        ;;
    *)
        echo "Invalid choice. Please run the script again and select 1 or 2."
        exit 1
        ;;
esac

echo
echo "Installation completed successfully!"
echo "-----------------------------------"
echo "Your environment variables are saved in $HOME/.sparc_exports"
if [ "$choice" = "1" ]; then
    echo "Run 'source $HOME/.sparc_exports' then 'sparc' to start using the CLI"
else
    echo "Run 'source $HOME/.sparc_exports' then './docker-entrypoint.sh' to start using the CLI"
fi
