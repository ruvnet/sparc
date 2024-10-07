# Agentic Preview

Agentic Preview is an asynchronous FastAPI backend service that allows users to deploy preview environments using Fly.io.

## Introduction

Agentic Preview is designed to streamline the process of deploying preview environments for your applications. By leveraging the power of Fly.io, it allows you to quickly and easily deploy GitHub repositories to a live environment, providing a seamless way to test and showcase your applications.

## Features

- Deploys GitHub repositories to Fly.io
- Asynchronous operations for improved performance
- Configurable runtime limit for deployments
- Cleans up resources after usage
- Supports custom deployment arguments
- Automatically generates `fly.toml` configuration if not present
- Provides deployment status and logs

## Benefits

- **Speed**: Quickly deploy your applications to a live environment.
- **Efficiency**: Asynchronous operations ensure that deployments do not block other tasks.
- **Flexibility**: Customize deployment arguments and configurations to suit your needs.
- **Resource Management**: Automatically cleans up resources after usage, ensuring efficient use of resources.
- **Ease of Use**: Simple API endpoints for deploying and managing applications.

## Usage

### Deploying an Application

To deploy an application, send a POST request to the `/deploy` endpoint with the following JSON body:

```json
{
  "repo": "username/repository",
  "branch": "main",
  "args": ["--build-arg", "ENV=production"]
}
```

### Checking Deployment Status

To check the status of a deployment, send a GET request to the `/status/{app_name}` endpoint, where `{app_name}` is the name of the deployed application.

### Streaming Logs

To stream logs for a deployed application, send a GET request to the `/logs/{app_name}` endpoint, where `{app_name}` is the name of the deployed application.

## Installation

Run the `install.sh` script to set up the project environment:

```bash
bash install.sh
```

## Deployment

### Prerequisites

- Ensure you have authenticated with Fly.io:

```bash
flyctl auth login
```

### Starting the Application

Activate the virtual environment:

```bash
source venv/bin/activate
```

Run the application:

```bash
poetry run python main.py
```

### Deploying an Application

Send a POST request to `http://localhost:5000/deploy` with the appropriate JSON payload.

Example using `curl`:

```bash
curl -X POST "http://localhost:5000/deploy" \
  -H "Content-Type: application/json" \
  -d '{"repo": "username/repository", "branch": "main"}'
```

## Advanced Configurations

### Modifying Runtime Limit

To change the runtime limit for deployed instances, modify the `RUN_TIME_LIMIT` variable in `main.py`.

### Custom Deployment Arguments

You can pass custom deployment arguments in the `args` field of the deployment request JSON body. These arguments will be passed to the `flyctl deploy` command.

### Customizing `fly.toml`

If your repository does not contain a `fly.toml` file, Agentic Preview will generate one for you. You can customize the generated `fly.toml` by modifying the `deploy_app` function in `main.py`.

## Agentic Editor

The Agentic Editor is a powerful tool that provides various capabilities, API endpoints, and functions to enhance your development workflow. Below is an overview of its features, usage, and API endpoints.

### Features

- **RESTful API**: Provides a simple interface for executing Aider commands.
- **Virtual Environment Management**: Ensures isolated execution of the Aider tool.
- **Configurable Execution**: Supports various configuration options for customizing Aider's behavior.

### Usage

To start the FastAPI server, run the following command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### API Endpoints

#### **POST** `/run-aider`

Execute the Aider tool with the provided configuration.

##### Request Body

- `chat_mode`: Mode for Aider chat (default: "code").
- `edit_format`: Format for edits (default: "diff").
- `model`: Model to use (default: "gpt-4").
- `prompt`: Optional prompt message.
- `files`: List of files to include.

##### Example Request

```json
{
  "chat_mode": "code",
  "edit_format": "diff",
  "model": "gpt-4",
  "prompt": "Initial setup",
  "files": ["main.py", "utils.py"]
}
```

##### Example Response

The response will stream the output from the Aider tool, providing real-time feedback on the execution process.

#### **GET** `/projects`

List all projects.

#### **GET** `/users`

List all users.

### Detailed Documentation

For more detailed information on the architecture, configuration, installation, introduction, and usage of the Agentic Editor, please refer to the [Agentic Editor Documentation](./agentic_editor/docs/README.md).

## License

MIT License
