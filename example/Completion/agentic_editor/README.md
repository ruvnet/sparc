# Aider FastAPI Service

## Description

This project provides a FastAPI service to run the Aider tool in a virtual environment. It allows you to execute Aider commands via a RESTful API.

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```bash
   cd your_project_name
   ```
3. Install dependencies using Poetry:
   ```bash
   poetry install
   ```

## Usage

To start the FastAPI server, run the following command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### API Endpoint

- **POST** `/run-aider`: Execute the Aider tool with the provided configuration.

#### Request Body

- `chat_mode`: Mode for Aider chat (default: "code").
- `edit_format`: Format for edits (default: "diff").
- `model`: Model to use (default: "gpt-4").
- `prompt`: Optional prompt message.
- `files`: List of files to include.

#### Example Request

```json
{
  "chat_mode": "code",
  "edit_format": "diff",
  "model": "gpt-4",
  "prompt": "Initial setup",
  "files": ["main.py", "utils.py"]
}
```

## Contributing

Guidelines for contributing to the project.

## License

This project is licensed under the MIT License.
