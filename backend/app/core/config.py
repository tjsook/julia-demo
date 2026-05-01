"""
Application settings loaded from environment variables.

Uses Pydantic Settings (v2) so every config value is typed and validated
at startup. Secrets have no defaults — the app fails fast if they're missing.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_DIR.parent


class Settings(BaseSettings):
    """Typed, validated settings loaded from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=(
            _REPO_ROOT / ".env",
            _REPO_ROOT / ".env.local",
            _BACKEND_DIR / ".env",
            _BACKEND_DIR / ".env.local",
        ),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # App
    APP_NAME: str = "diesel-dashboard-backend"
    APP_ENV: Literal["dev", "staging", "prod"] = "dev"
    APP_TIMEZONE: str = "America/Los_Angeles"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Supabase
    SUPABASE_URL: str = Field(..., alias="NEXT_PUBLIC_SUPABASE_URL")
    SUPABASE_ANON_KEY: str = Field(..., alias="NEXT_PUBLIC_SUPABASE_ANON_KEY")
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_DB_URL: str | None = None

    # EDS (Enterprise Diesel)
    EDS_API_BASE_URL: str = "https://api.enterprise-diesel.com/rest/v-1/hemut"
    EDS_API_BEARER_TOKEN: str | None = None
    EDS_POLL_TRANSACTIONS_WINDOW_DAYS: int = 3

    # HubSpot
    HUBSPOT_API_BASE_URL: str = "https://api.hubapi.com"
    HUBSPOT_PRIVATE_APP_TOKEN: str | None = None

    # Internal jobs auth (Cloud Scheduler -> /internal/jobs/*)
    INTERNAL_JOB_TOKEN: str | None = None
    INTERNAL_JOB_OIDC_AUDIENCE: str | None = None
    INTERNAL_JOB_OIDC_SERVICE_ACCOUNT_EMAIL: str | None = None

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — cached so the .env is only parsed once per process."""
    return Settings()  # type: ignore[call-arg]

