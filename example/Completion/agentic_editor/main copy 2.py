import subprocess
import json
import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, validator
from typing import List, Optional
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.exc import IntegrityError

# Database setup
DATABASE_URL = "sqlite:///./aider_projects.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, unique=True, index=True)
    projects = relationship("Project", back_populates="user")

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    user_id = Column(String, ForeignKey("users.user_id"))
    user = relationship("User", back_populates="projects")

Base.metadata.create_all(bind=engine)

app = FastAPI()

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

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def update_project_user_data(project_name: str, user_id: str):
    db = next(get_db())
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        user = User(user_id=user_id)
        db.add(user)
    
    project = db.query(Project).filter(Project.name == project_name, Project.user_id == user_id).first()
    if not project:
        project = Project(name=project_name, user_id=user_id)
        db.add(project)
    
    try:
        db.commit()
    except IntegrityError:
        db.rollback()

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
    db = next(get_db())
    projects = db.query(Project).all()
    return {"projects": [{"name": project.name, "user_id": project.user_id} for project in projects]}

@app.get("/users")
async def list_users():
    db = next(get_db())
    users = db.query(User).all()
    return {"users": {user.user_id: [project.name for project in user.projects] for user in users}}

# Don't remove this line
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
