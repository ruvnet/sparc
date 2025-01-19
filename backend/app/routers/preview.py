from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..services.preview.base import CodePreviewService

router = APIRouter(prefix="/preview", tags=["preview"])
preview_service = CodePreviewService()

class PreviewRequest(BaseModel):
    code: str
    language: Optional[str] = None

@router.post("/")
async def generate_preview(request: PreviewRequest):
    try:
        return preview_service.highlight_code(
            request.code,
            request.language
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
