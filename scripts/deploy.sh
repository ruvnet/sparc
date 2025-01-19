#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Function to check if required environment variables are set
check_env() {
    local missing_vars=0
    declare -a required_vars=("FLY_API_TOKEN" "ENVIRONMENT")

    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo -e "${RED}Error: $var is not set${NC}"
            missing_vars=1
        fi
    done

    if [ $missing_vars -eq 1 ]; then
        exit 1
    fi
}

# Function to deploy a service
deploy_service() {
    local service=$1
    local app_name=$2
    
    echo -e "${GREEN}Deploying $service...${NC}"
    
    cd $service

    # Check if app exists on fly
    if ! fly status --app $app_name >/dev/null 2>&1; then
        echo "Creating new app: $app_name"
        fly launch --no-deploy --name $app_name
    fi

    # Deploy the app
    fly deploy --app $app_name
    
    # Wait for deployment to complete
    echo "Waiting for deployment to complete..."
    sleep 10
    
    # Check deployment status
    if fly status --app $app_name | grep -q "running"; then
        echo -e "${GREEN}$service deployed successfully!${NC}"
    else
        echo -e "${RED}$service deployment failed!${NC}"
        exit 1
    fi
    
    cd ..
}

# Main deployment script
main() {
    echo "Starting deployment process..."
    
    # Check environment variables
    check_env
    
    # Deploy backend
    deploy_service "backend" "chat-app-backend"
    
    # Deploy frontend
    deploy_service "frontend" "chat-app-frontend"
    
    echo -e "${GREEN}All services deployed successfully!${NC}"
}

main
