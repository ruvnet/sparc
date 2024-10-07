# Usage

## Starting the Server

To start the FastAPI server, run the following command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## API Endpoint

### **POST** `/run-aider`

Execute the Aider tool with the provided configuration.

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

#### Example Response

The response will stream the output from the Aider tool, providing real-time feedback on the execution process.

## Error Handling

- **500 Internal Server Error**: Indicates a failure in executing the Aider tool or setting up the environment. Check the error message for details.
