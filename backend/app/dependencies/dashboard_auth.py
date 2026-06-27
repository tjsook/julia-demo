"""Dashboard-user authentication for backend API routes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Header, HTTPException
from google.auth.transport import requests
from google.oauth2 import id_token

from app.core.config import get_settings


@dataclass(frozen=True)
class DashboardUser:
    """Authenticated dashboard user details needed by backend routes."""

    subject: str
    email: str


def require_dashboard_user(authorization: str = Header(default="")) -> DashboardUser:
    """Verify a Google ID token from the existing NextAuth dashboard session."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing dashboard bearer token.")

    settings = get_settings()
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID must be configured for dashboard API auth.",
        )

    token = authorization[7:]
    try:
        payload: dict[str, Any] = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid dashboard bearer token.") from exc

    email = str(payload.get("email") or "").lower()
    subject = str(payload.get("sub") or "")
    if not email or not subject:
        raise HTTPException(status_code=401, detail="Dashboard token missing subject or email.")
    if not email.endswith("@hemut.com"):
        raise HTTPException(status_code=403, detail="Dashboard email must use the hemut.com domain.")

    allowed_emails = settings.nextauth_allowed_emails_list
    if allowed_emails and email not in allowed_emails:
        raise HTTPException(status_code=403, detail="Dashboard user is not in the allowed email list.")

    return DashboardUser(subject=subject, email=email)
