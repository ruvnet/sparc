# Configuration

## Environment Variables

- **OPENAI_API_KEY**: Required for authenticating with the OpenAI API. Ensure this is set in your environment.

## Configuration Options

The application uses a configuration model (`AiderConfig`) to specify how the Aider tool should be executed. The following options are available:

- **chat_mode**: Mode for Aider chat (default: "code").
- **edit_format**: Format for edits (default: "diff").
- **model**: Model to use (default: "gpt-4").
- **prompt**: Optional prompt message.
- **files**: List of files to include.

## Example Configuration

```json
{
  "chat_mode": "code",
  "edit_format": "diff",
  "model": "gpt-4",
  "prompt": "Initial setup",
  "files": ["main.py", "utils.py"]
}
```
