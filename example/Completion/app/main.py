from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from typing import List
from pydantic import BaseModel
import jwt
import os

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# In-memory databases for simplicity
users_db = {}
tasks_db = {}

# Pydantic models
class User(BaseModel):
    id: str
    email: str
    hashed_password: str
    is_active: bool

class Task(BaseModel):
    id: str
    title: str
    description: str
    is_completed: bool
    user_id: str

class Token(BaseModel):
    access_token: str
    token_type: str

# Authentication functions
def authenticate_user(email: str, password: str):
    user = users_db.get(email)
    if not user or user.hashed_password != password:  # Simplified for example
        return False
    return user

def create_access_token(data: dict):
    return jwt.encode(data, os.getenv("SECRET_KEY"), algorithm="HS256")

# API endpoints
@app.post("/register")
def register(email: str, password: str):
    if email in users_db:
        raise HTTPException(status_code=400, detail="User already exists")
    user_id = str(len(users_db) + 1)
    users_db[email] = User(id=user_id, email=email, hashed_password=password, is_active=True)
    return {"msg": "User registered successfully"}

@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, os.getenv("SECRET_KEY"), algorithms=["HS256"])
        email = payload.get("sub")
        user = users_db.get(email)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/tasks/", response_model=Task)
def create_task(task: Task, current_user: User = Depends(get_current_user)):
    task_id = str(len(tasks_db) + 1)
    task.id = task_id
    task.user_id = current_user.id
    tasks_db[task_id] = task
    return task

@app.get("/tasks/", response_model=List[Task])
def read_tasks(current_user: User = Depends(get_current_user)):
    return [task for task in tasks_db.values() if task.user_id == current_user.id]

@app.put("/tasks/{task_id}", response_model=Task)
def update_task(task_id: str, task: Task, current_user: User = Depends(get_current_user)):
    existing_task = tasks_db.get(task_id)
    if not existing_task or existing_task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    tasks_db[task_id] = task
    return task

@app.delete("/tasks/{task_id}")
def delete_task(task_id: str, current_user: User = Depends(get_current_user)):
    task = tasks_db.get(task_id)
    if not task or task.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    del tasks_db[task_id]
    return {"msg": "Task deleted successfully"}
