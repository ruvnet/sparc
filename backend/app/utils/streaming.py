import json
from typing import AsyncIterator

async def format_sse(data: str, event: str = None) -> str:
    """Format Server-Sent Events message."""
    message = f"data: {json.dumps(data)}\n"
    if event is not None:
        message = f"event: {event}\n{message}"
    return f"{message}\n"

async def stream_generator(stream: AsyncIterator[str]) -> AsyncIterator[str]:
    """Generate SSE stream from async iterator."""
    try:
        async for chunk in stream:
            yield await format_sse(chunk)
    except Exception as e:
        yield await format_sse(str(e), event="error")
    finally:
        yield await format_sse("[DONE]", event="done")
