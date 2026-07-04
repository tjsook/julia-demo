"""Standalone Julia demo FastAPI app.

Slim boot shim for the extracted julia-demo repo. In the original
diesel-dashboard this file wires ~18 routers; here we mount only the Julia
router plus the minimum middleware needed for it to run.

The dashboard_auth dependency (Google ID-token verification) is overridden
with a demo stub so the API is usable without a real dashboard session.
Restore the original dependency when integrating with a real auth backend.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import UnhandledExceptionMiddleware, register_exception_handlers
from app.dependencies.dashboard_auth import DashboardUser, require_dashboard_user
from app.routers.julia_routes import router as julia_router


def _demo_dashboard_user() -> DashboardUser:
    return DashboardUser(subject="julia-demo", email="demo@hemut.com")


def create_app(root_path: str = "") -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO)

    app = FastAPI(title="Julia Demo API", root_path=root_path)

    app.add_middleware(UnhandledExceptionMiddleware)
    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(julia_router)

    # Bypass Google-ID-token auth for the standalone demo. Remove this
    # override to enforce real dashboard auth again.
    app.dependency_overrides[require_dashboard_user] = _demo_dashboard_user

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
