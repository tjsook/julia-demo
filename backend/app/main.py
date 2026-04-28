"""
FastAPI entrypoint for the Diesel Dashboard Backend.

Wires:
- Settings + logging
- CORS
- Exception handlers (stable error envelope)
- RequestID middleware
- Routers (health, calculations, trips)
- Lifespan hooks (init/close external clients)

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clients.eds_client import close_eds_client
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.middleware.request_id import RequestIDMiddleware
from app.routers import (
    calculation_routes,
    fueling_routes,
    health_routes,
    internal_jobs,
    mapping_review_routes,
    program_metrics_routes,
)

settings = get_settings()
configure_logging(settings.LOG_LEVEL)
logger = get_logger("diesel_dashboard_backend")


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Starting %s (env=%s)", settings.APP_NAME, settings.APP_ENV)
    yield
    logger.info("Shutting down — closing external clients")
    await close_eds_client()


def create_app(*, root_path: str = "") -> FastAPI:
    """Build the FastAPI application for local or prefixed ASGI entrypoints."""
    application = FastAPI(
        title="Diesel Dashboard Backend",
        description="APIs + calculations for the Hemut Diesel dashboard.",
        version="0.1.0",
        lifespan=lifespan,
        root_path=root_path,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(RequestIDMiddleware)

    register_exception_handlers(application)

    application.include_router(health_routes.router)
    application.include_router(calculation_routes.router)
    application.include_router(internal_jobs.router)
    application.include_router(fueling_routes.router)
    application.include_router(program_metrics_routes.router)
    application.include_router(mapping_review_routes.router)
    return application


app = create_app()
