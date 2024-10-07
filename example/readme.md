# Installation Instructions

## Prerequisites

Ensure you have the following installed on your system:

- [Git](https://git-scm.com/downloads) (version 2.20 or higher)
- [Docker](https://www.docker.com/get-started) (version 20.10 or higher)
- [Docker Compose](https://docs.docker.com/compose/install/) (version 1.29 or higher)
- [Poetry](https://python-poetry.org/docs/#installation) (for managing Python dependencies)

## Clone the Repository

```bash
git clone https://github.com/yourusername/sparc-framework.git
cd sparc-framework
```

## Set Up Environment Variables

1. Copy the sample environment file:

    ```bash
    cp sample.env .env
    ```

2. Open the `.env` file and set the required environment variables:

    ```env
    OPENAI_API_KEY=your_openai_api_key
    AIDER_MODEL=your_model_choice
    # Add other necessary environment variables as needed
    ```

## Install Dependencies

### Using Docker

Build and run the containers using Docker Compose:

```bash
docker-compose up --build -d
```

### Manual Installation

If you prefer to run the services manually without Docker:

1. **Install Python Dependencies:**

    ```bash
    cd example/Completion/app
    poetry install
    ```

2. **Install Node.js Dependencies:**

    ```bash
    cd ../../../
    npm install
    ```

## Run the Application

### Using Docker

The application should be running automatically after starting the Docker containers. To check the status:

```bash
docker-compose ps
```

### Manual Execution

1. **Start the Python Application:**

    ```bash
    cd example/Completion/app
    poetry run uvicorn main:app --host 0.0.0.0 --port 8000
    ```

2. **Start the Node.js Application:**

    ```bash
    cd ../../../
    npm start
    ```

## Running Tests

Ensure all dependencies are installed, then run the tests using Make:

```bash
make test
```

This will execute both Python and Node.js tests.

## Additional Commands

### Build the Docker Image

```bash
make build
```

### Deploy the Application

```bash
make deploy
```

## Troubleshooting

- **Docker Issues:**

    Ensure Docker and Docker Compose are correctly installed and running. Check container logs if services are not starting as expected:

    ```bash
    docker-compose logs
    ```

- **Python Dependencies:**

    If you encounter issues with Poetry, try reinstalling dependencies:

    ```bash
    poetry install --no-root
    ```

- **Node.js Issues:**

    If `npm install` fails, try clearing the npm cache and reinstalling:

    ```bash
    npm cache clean --force
    npm install
    ```

## Contributing

Please refer to the [CONTRIBUTING.md](../CONTRIBUTING.md) file for guidelines on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](../LICENSE) file for details.
