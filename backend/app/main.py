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
from app.clients.slack_client import close_slack_client
from app.core.config import get_settings
from app.core.errors import UnhandledExceptionMiddleware, register_exception_handlers
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
from app.routers.affiliate_routes import router as affiliate_router
from app.routers.banking_routes import router as banking_router
from app.routers.clerk_webhooks import router as clerk_webhook_router
from app.routers.commission_admin_routes import router as commission_admin_router
from app.routers.commission_read_routes import router as commission_read_router
from app.routers.docusign_webhooks import router as docusign_webhook_router
from app.routers.event_routes import router as event_router
from app.routers.fueling_attribution_routes import router as fueling_attribution_router
from app.routers.hubspot_webhooks import router as hubspot_webhook_router
from app.routers.pipeline_health_routes import router as pipeline_health_router
from app.routers.rep_performance_routes import router as rep_performance_router
from app.routers.routing_audit_routes import router as routing_audit_router
from app.routers.terms_routes import router as terms_router
from app.routers.waitlist_routes import router as waitlist_router

settings = get_settings()
configure_logging(settings.LOG_LEVEL)
logger = get_logger("diesel_dashboard_backend")


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Starting %s (env=%s)", settings.APP_NAME, settings.APP_ENV)
    yield
    logger.info("Shutting down — closing external clients")
    await close_eds_client()
    await close_slack_client()


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
        allow_origin_regex=settings.CORS_ALLOW_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # UnhandledExceptionMiddleware sits INSIDE CORSMiddleware so that even
    # unexpected 500s get the Access-Control-Allow-Origin header. See errors.py.
    application.add_middleware(UnhandledExceptionMiddleware)
    application.add_middleware(RequestIDMiddleware)

    register_exception_handlers(application)

    application.include_router(health_routes.router)
    application.include_router(calculation_routes.router)
    application.include_router(internal_jobs.router)
    application.include_router(fueling_routes.router)
    application.include_router(program_metrics_routes.router)
    application.include_router(mapping_review_routes.router)
    application.include_router(hubspot_webhook_router)
    application.include_router(pipeline_health_router)
    application.include_router(rep_performance_router)
    application.include_router(fueling_attribution_router)
    application.include_router(event_router)
    application.include_router(routing_audit_router)
    application.include_router(docusign_webhook_router)
    application.include_router(clerk_webhook_router)
    application.include_router(affiliate_router)
    application.include_router(terms_router)
    application.include_router(banking_router)
    application.include_router(commission_read_router)
    application.include_router(waitlist_router)
    application.include_router(commission_admin_router)
    return application


app = create_app()
