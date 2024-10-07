import subprocess
import json
import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict

app = FastAPI()

# In-memory storage for projects and users
projects: Dict[str, Dict] = {}
users: Dict[str, List[str]] = {}

class AiderConfig(BaseModel):
    chat_mode: str = Field("code", example="code")
    edit_format: str = Field("diff", example="diff")
    model: str = Field("claude-3-5-sonnet-20240620", example="claude-3-5-sonnet-20240620")
    prompt: Optional[str] = Field(None, example="Initial main.py with fastapi and dockerfile")
    files: List[str] = Field(default_factory=list, example=["main.py", "utils.py"])
    project_name: str = Field(..., example="sonnet")
    user_id: str = Field(..., example="test")

    @validator('files')
    def validate_files(cls, v):
        for file in v:
            if '..' in file or file.startswith('/'):
                raise ValueError(f"Invalid file path: {file}")
        return v

# New function to update projects and users data
def update_project_user_data(project_name: str, user_id: str):
    project_id = f"{project_name}_{user_id}"
    if project_id not in projects:
        projects[project_id] = {"name": project_name, "user_id": user_id}
    if user_id not in users:
        users[user_id] = []
    if project_name not in users[user_id]:
        users[user_id].append(project_name)

def run_aider(config: AiderConfig, project_path: str):
    command = [
        "aider",
        "--chat-mode", config.chat_mode,
        "--edit-format", config.edit_format,
        "--model", config.model,
        "--yes",  # Non-interactive mode
        "--no-git"  # Run without git integration
    ]

    if config.prompt:
        command.extend(["--message", config.prompt])

    command.extend(config.files)

    env = os.environ.copy()
    api_key = env.get('OPENAI_API_KEY')

    if api_key is None:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not set in the environment."
        )

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        cwd=project_path,
        env=env
    )
    return process

def stream_aider_output(process):
    while True:
        output = process.stdout.readline()
        if output == '' and process.poll() is not None:
            break
        if output:
            yield json.dumps({
                "type": "streamContent",
                "content": output.strip()
            }) + "\n"

    rc = process.poll()
    if rc != 0:
        stderr = process.stderr.read()
        yield json.dumps({
            "type": "error",
            "content": f"Aider process exited with code {rc}. Stderr: {stderr.strip()}"
        }) + "\n"

@app.get("/")
async def redirect_to_docs():
    return RedirectResponse(url="/docs")

@app.post("/run-aider")
async def execute_aider(config: AiderConfig):
    project_path = os.path.join("projects", f"{config.project_name}_{config.user_id}")
    
    # Create project directory if it doesn't exist
    os.makedirs(project_path, exist_ok=True)

    # Ensure all files exist in the project directory
    for file in config.files:
        file_path = os.path.join(project_path, file)
        if not os.path.exists(file_path):
            with open(file_path, 'w') as f:
                f.write('')  # Create an empty file

    # Update project and user data
    update_project_user_data(config.project_name, config.user_id)

    aider_process = await asyncio.to_thread(run_aider, config, project_path)
    return stream_aider_output(aider_process)

@app.get("/projects")
async def list_projects():
    return {"projects": projects}

@app.get("/users")
async def list_users():
    return {"users": users}

# Don't remove this line
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
