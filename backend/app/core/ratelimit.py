"""Small in-memory sliding-window rate limiter.

Adequate for a single process. A multi-worker deployment should move this to
Redis; the interface is one function so that swap is local.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited

WINDOW_SECONDS = 60.0

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def check(key: str, limit: int, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    with _lock:
        hits = _hits[key]
        while hits and now - hits[0] > WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            raise RateLimited("Too many requests. Please wait a minute and try again.")
        hits.append(now)


def limit_analysis(request: Request) -> None:
    """FastAPI dependency for the expensive endpoints."""
    host = request.client.host if request.client else "unknown"
    check(f"analysis:{host}", get_settings().rate_limit_per_minute)


def reset() -> None:
    with _lock:
        _hits.clear()
