import asyncio
from functools import wraps
from typing import Type, Tuple, Optional, Callable, Any
import logging

logger = logging.getLogger(__name__)

class RetryError(Exception):
    """Raised when all retry attempts fail"""
    pass

def async_retry(
    retries: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    exceptions: Tuple[Type[Exception], ...] = (Exception,),
    on_retry: Optional[Callable[[Exception, int], Any]] = None
):
    """
    Async retry decorator with exponential backoff
    
    Args:
        retries: Maximum number of retries
        delay: Initial delay between retries in seconds
        backoff: Multiplier for delay between retries
        exceptions: Tuple of exceptions to catch
        on_retry: Optional callback function called on each retry
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay

            for attempt in range(retries + 1):
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt == retries:
                        break
                    
                    if on_retry:
                        on_retry(e, attempt + 1)
                    
                    logger.warning(
                        f"Attempt {attempt + 1}/{retries} failed: {str(e)}. "
                        f"Retrying in {current_delay:.1f}s..."
                    )
                    
                    await asyncio.sleep(current_delay)
                    current_delay *= backoff
            
            raise RetryError(f"Failed after {retries} retries") from last_exception
            
        return wrapper
    return decorator
