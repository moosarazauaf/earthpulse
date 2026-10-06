"""Analysis store.

SQLite for the MVP so the application runs with no services to install. The
table mirrors the planned PostGIS `analyses` table; only this module knows
which database is underneath.
"""
import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL,
    stage       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    request     TEXT NOT NULL,
    result      TEXT,
    error       TEXT
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class AnalysisStore:
    def __init__(self, path: Path) -> None:
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock, self._db:
            self._db.executescript(SCHEMA)
            # Jobs that were mid-flight when the process stopped can never finish.
            self._db.execute(
                "UPDATE analyses SET status='FAILED', error=? WHERE status IN ('QUEUED','RUNNING')",
                (json.dumps({"code": "interrupted",
                             "message": "The server restarted before this analysis finished."}),),
            )

    def create(self, analysis_id: str, kind: str, request: dict[str, Any]) -> None:
        now = _now()
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO analyses (id, type, status, stage, created_at, updated_at, request) "
                "VALUES (?, ?, 'QUEUED', 'QUEUED', ?, ?, ?)",
                (analysis_id, kind, now, now, json.dumps(request)),
            )

    def set_stage(self, analysis_id: str, stage: str) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE analyses SET status='RUNNING', stage=?, updated_at=? WHERE id=?",
                (stage, _now(), analysis_id),
            )

    def complete(self, analysis_id: str, result: dict[str, Any]) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE analyses SET status='COMPLETE', stage='COMPLETE', updated_at=?, result=? "
                "WHERE id=?",
                (_now(), json.dumps(result), analysis_id),
            )

    def fail(self, analysis_id: str, code: str, message: str, hint: str | None = None) -> None:
        with self._lock, self._db:
            self._db.execute(
                "UPDATE analyses SET status='FAILED', updated_at=?, error=? WHERE id=?",
                (_now(), json.dumps({"code": code, "message": message, "hint": hint}), analysis_id),
            )

    def get(self, analysis_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM analyses WHERE id=?", (analysis_id,)).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "type": row["type"],
            "status": row["status"],
            "stage": row["stage"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "request": json.loads(row["request"]),
            "result": json.loads(row["result"]) if row["result"] else None,
            "error": json.loads(row["error"]) if row["error"] else None,
        }
