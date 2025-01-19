from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from ..dependencies import get_llm_service
from ..services.llm.base import BaseLLMService

router = APIRouter(prefix="/chat", tags=["chat"])

class ChatRequest(BaseModel):
    prompt: str
    stream: bool = False
    
class ChatResponse(BaseModel):
    text: str

@router.post("/complete", response_model=ChatResponse)
async def create_completion(
    request: ChatRequest,
    llm_service: BaseLLMService = Depends(get_llm_service)
):
    """Create a chat completion."""
    try:
        if request.stream:
            return StreamingResponse(
                llm_service.stream(request.prompt),
                media_type="text/event-stream"
            )
        
        response = await llm_service.complete(request.prompt)
        return ChatResponse(text=response)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
