# Sparc MCP Server

## Overview
This is a simple Flask-based MCP (Model Context Protocol) server that responds to POST requests at the `/process` endpoint.

## Prerequisites
- Docker
- Docker Compose (optional)

## Building the Docker Image
To build the Docker image, run the following command in the project directory:

```bash
docker build -t sparc_mcp .
```

## Running the Docker Container
To run the Docker container:

```bash
docker run -p 5000:5000 sparc_mcp
```

## Testing the Endpoint
You can test the `/process` endpoint using curl:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"key": "value"}' http://localhost:5000/process
```

## Development
To modify the server, edit `app.py` and rebuild the Docker image.

## License
[Add your license information here]
