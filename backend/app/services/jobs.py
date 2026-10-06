"""Background execution of analyses, with stages reported as they happen.

The stage a client sees is whatever the pipeline last reported, never a timer.
"""
import logging
import re
import secrets
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.services.store import AnalysisStore

log = logging.getLogger("earthpulse.jobs")

# Each job already fans out to several reader threads.
MAX_CONCURRENT_JOBS = 2
STAGES = ["QUEUED", "ACQUIRING_DATA", "PROCESSING_IMAGERY", "CALCULATING_INDICES",
          "DETECTING_CHANGE", "GENERATING_RESULTS", "COMPLETE"]

Runner = Callable[[Any, str, Settings, Callable[[str], None]], dict[str, Any]]

_pool = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS, thread_name_prefix="analysis")


@lru_cache
def get_store() -> AnalysisStore:
    return AnalysisStore(get_settings().data_dir / "earthpulse.sqlite3")


def new_analysis_id(label: str | None) -> str:
    """EP-<year>-<PLACE>-<5 hex>, for example EP-2026-LAHORE-8F72A."""
    slug = re.sub(r"[^A-Z0-9]+", "", (label or "AOI").upper())[:16] or "AOI"
    return f"EP-{datetime.now(UTC).year}-{slug}-{secrets.token_hex(3)[:5].upper()}"


def submit(kind: str, request: Any, runner: Runner, *, wait: bool = False) -> str:
    store = get_store()
    analysis_id = new_analysis_id(request.label)
    store.create(analysis_id, kind, request.model_dump(mode="json", by_alias=True))

    def work() -> None:
        try:
            result = runner(request, analysis_id, get_settings(),
                            lambda stage: store.set_stage(analysis_id, stage))
            store.complete(analysis_id, result)
        except AppError as exc:
            store.fail(analysis_id, exc.code, exc.message, exc.hint)
        except Exception:
            log.exception("analysis %s failed", analysis_id)
            store.fail(analysis_id, "internal_error", "Analysis could not be completed.")

    future = _pool.submit(work)
    if wait:
        future.result()
    return analysis_id
