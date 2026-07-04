"""
Application settings for the Julia demo backend.

Loaded from environment variables (and optional .env files) via Pydantic
Settings v2. Every value is typed and validated at startup.
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
            _REPO_ROOT / "frontend" / ".env.local",
            _BACKEND_DIR / ".env",
            _BACKEND_DIR / ".env.local",
        ),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # App
    APP_NAME: str = "julia-demo-backend"
    APP_ENV: Literal["dev", "staging", "prod"] = "dev"
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Supabase (only needed if you enable document upload / signed-url endpoints)
    SUPABASE_URL: str | None = Field(default=None, alias="NEXT_PUBLIC_SUPABASE_URL")
    SUPABASE_ANON_KEY: str | None = Field(default=None, alias="NEXT_PUBLIC_SUPABASE_ANON_KEY")
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_DB_URL: str | None = None

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    CORS_ALLOW_ORIGIN_REGEX: str = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    # Dashboard auth (NextAuth Google provider -> backend bearer token).
    # In the standalone demo, main.py overrides require_dashboard_user with a
    # demo stub — these values are only consulted if you remove that override.
    GOOGLE_CLIENT_ID: str | None = None
    NEXTAUTH_ALLOWED_EMAILS: str = ""
    # Empty string disables the domain check.
    DASHBOARD_ALLOWED_EMAIL_DOMAIN: str = ""

    # Julia — OpenAI STT/LLM/TTS
    OPENAI_API_KEY: str | None = None
    OPENAI_STT_MODEL: str = "gpt-4o-mini-transcribe"
    OPENAI_TTS_MODEL: str = "gpt-4o-mini-tts"
    OPENAI_TTS_VOICE: str = "marin"
    OPENAI_EXTRACTION_MODEL: str = "gpt-4o-mini"
    OPENAI_INTENT_MODEL: str = "gpt-4o-mini"
    JULIA_VOICE_AUDIO_MAX_MB: int = Field(default=25, ge=1)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def nextauth_allowed_emails_list(self) -> list[str]:
        return [s.strip().lower() for s in self.NEXTAUTH_ALLOWED_EMAILS.split(",") if s.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — cached so the .env is only parsed once per process."""
    return Settings()  # type: ignore[call-arg]
