"""Errors that are safe to show to a user.

Anything that is not an AppError is logged in full and reported to the client
as a generic failure, so upstream responses and stack traces never leak.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("earthpulse")


class AppError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, *, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.hint = hint


class InvalidAOI(AppError):
    code = "invalid_aoi"


class AOITooLarge(AppError):
    code = "aoi_too_large"


class NoImagery(AppError):
    status = 404
    code = "no_imagery"


class DatasetUnavailable(AppError):
    status = 404
    code = "dataset_unavailable"


class UpstreamUnavailable(AppError):
    status = 503
    code = "imagery_unavailable"


class NotFound(AppError):
    status = 404
    code = "not_found"


class RateLimited(AppError):
    status = 429
    code = "rate_limited"


def _body(code: str, message: str, hint: str | None = None) -> dict:
    return {"error": {"code": code, "message": message, "hint": hint}}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.hint), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"Invalid request: {where}: {first.get('msg', 'invalid value')}"
        return JSONResponse(_body("invalid_request", message), status_code=422)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse(
            _body("internal_error", "Analysis could not be completed."), status_code=500
        )
