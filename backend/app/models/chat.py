from pydantic import BaseModel

class ChatRequest(BaseModel):
    prompt: str
    stream: bool = False

class ChatResponse(BaseModel):
    response: str
