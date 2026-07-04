"""
Domain error classes and a FastAPI exception handler that returns a
stable JSON envelope.

CORS note: app.exception_handler(Exception) gets moved by Starlette to
ServerErrorMiddleware (the outermost layer, outside CORSMiddleware), so
unhandled-exception responses would arrive at the browser without
Access-Control-Allow-Origin headers. To fix this, UnhandledExceptionMiddleware
catches all unhandled exceptions inside the CORSMiddleware layer and returns
the same stable JSON envelope. Register it via add_middleware() AFTER
CORSMiddleware (so it runs inside it), and do NOT use app.exception_handler(Exception).
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for expected application errors."""

    status_code: int = 500
    code: str = "app_error"

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class IntegrationError(AppError):
    """Upstream integration (EDS, Supabase, etc.) failed."""

    status_code = 502
    code = "integration_error"


class DomainRuleError(AppError):
    """A business rule was violated."""

    status_code = 422
    code = "domain_rule_error"


class UnhandledExceptionMiddleware(BaseHTTPMiddleware):
    """
    Catch-all middleware that runs INSIDE CORSMiddleware.

    Catches any exception that escapes FastAPI's ExceptionMiddleware and
    returns the stable JSON error envelope — with CORS headers intact,
    because this middleware sits below CORSMiddleware in the stack.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        try:
            return await call_next(request)
        except Exception:
            request_id = str(uuid.uuid4())
            logger.exception(
                "Unhandled exception request_id=%s path=%s", request_id, request.url.path
            )
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "internal_error",
                        "message": "Internal server error",
                        "request_id": request_id,
                    }
                },
            )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach global handlers so every error returns the same shape."""

    @app.exception_handler(AppError)
    async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    # NOTE: do NOT register app.exception_handler(Exception) here.
    # That would move the handler to ServerErrorMiddleware (outside CORSMiddleware),
    # causing 500 responses to arrive at browsers without CORS headers.
    # Use UnhandledExceptionMiddleware (added in main.py) instead.
