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
    HUBSPOT_WEBHOOK_ENFORCE_SIGNATURE: bool = False
    HUBSPOT_FUEL_CARD_PIPELINE_ID: str = "1983558335"
    PIPELINE_COHORT_LOOKFORWARD_DAYS: int = 90

    # Internal jobs auth (Cloud Scheduler -> /internal/jobs/*)
    INTERNAL_JOB_TOKEN: str | None = None
    INTERNAL_JOB_OIDC_AUDIENCE: str | None = None
    INTERNAL_JOB_OIDC_SERVICE_ACCOUNT_EMAIL: str | None = None

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000,https://dashboard.gethemutdiesel.com"

    # Phase 2.6 Event Detection
    EVENT_LAPSED_DAYS: int = 7
    EVENT_SEVERE_LAPSED_DAYS: int = 14
    EVENT_REP_STUCK_DEAL_THRESHOLD: int = 5
    EVENT_REP_STUCK_STAGE_DAYS: int = 7
    EVENT_REP_OVERDUE_TASK_THRESHOLD: int = Field(..., gt=0)
    EVENT_PAPERWORK_STAGE_IDS: str = ""

    # Phase 2.7 Routing
    ROUTING_HUBSPOT_WRITES_ENABLED: bool = False
    ROUTING_SLACK_ENABLED: bool = False
    SLACK_BOT_TOKEN: str | None = None
    SLACK_NOTIFICATION_CHANNEL_ID: str | None = None
    SLACK_ESCALATION_CHANNEL_ID: str | None = None
    HUBSPOT_STAGE_ID_ACTIVELY_FUELING: str | None = None

    # Affiliate Program — Clerk (invitation / webhook integration)
    CLERK_SECRET_KEY: str | None = None
    CLERK_PUBLISHABLE_KEY: str | None = None
    CLERK_WEBHOOK_SIGNING_SECRET: str | None = None
    # URL affiliates land on after accepting an invitation
    AFFILIATE_DASHBOARD_URL: str = "https://hemutpartners.com"

    # Affiliate Banking — encryption + admin unlock gate (Phase G contract overhaul)
    BANKING_ENCRYPTION_KEY: str | None = None   # pgp_sym_encrypt key; passed to DB RPC
    BANKING_VIEW_PASSWORD: str | None = None    # admin password to obtain unlock JWT
    BANKING_JWT_SECRET: str | None = None       # HS256 signing secret for unlock JWTs

    # Affiliate Program — DocuSign
    DOCUSIGN_ACCOUNT_ID: str | None = None
    DOCUSIGN_INTEGRATION_KEY: str | None = None
    DOCUSIGN_USER_ID: str | None = None
    # PEM private key; supports both literal newlines and \n-escaped single-line format
    DOCUSIGN_PRIVATE_KEY: str | None = None
    DOCUSIGN_OAUTH_BASE_URI: str = "https://account-d.docusign.com"
    DOCUSIGN_REST_BASE_URI: str = "https://demo.docusign.net"
    DOCUSIGN_CONNECT_HMAC_SECRET: str | None = None
    # Comma-separated template GUIDs; envelopes from other templates are ignored
    AFFILIATE_TEMPLATE_IDS: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def paperwork_stage_ids(self) -> list[str]:
        return [s.strip() for s in self.EVENT_PAPERWORK_STAGE_IDS.split(",") if s.strip()]

    @property
    def affiliate_template_ids_list(self) -> list[str]:
        return [t.strip() for t in self.AFFILIATE_TEMPLATE_IDS.split(",") if t.strip()]

    @property
    def docusign_private_key_pem(self) -> str | None:
        """Normalize the private key — handles both \\n-escaped and literal-newline formats."""
        if self.DOCUSIGN_PRIVATE_KEY is None:
            return None
        return self.DOCUSIGN_PRIVATE_KEY.replace("\\n", "\n")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — cached so the .env is only parsed once per process."""
    return Settings()  # type: ignore[call-arg]
