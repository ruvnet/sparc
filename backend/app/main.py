from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .routers import chat, preview
from .config import Settings

settings = Settings()

app = FastAPI(
    title="SPARC API",
    description="SPARC Framework API with LLM integration",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/v1")
app.include_router(preview.router, prefix="/api/v1")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
