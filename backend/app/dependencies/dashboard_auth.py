"""Lightweight dashboard user guard for backend endpoints exposed on Cloud Run."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException

from app.core.config import get_settings


@dataclass(frozen=True)
class DashboardUser:
    user_id: str
    email: str
    name: str | None = None


def require_dashboard_user(
    x_dashboard_user_email: str | None = Header(default=None),
    x_dashboard_user_id: str | None = Header(default=None),
    x_dashboard_user_name: str | None = Header(default=None),
) -> DashboardUser:
    """
    Require a non-anonymous dashboard identity for costed endpoints.

    This does not currently verify a signed token; it enforces user identity
    headers from the dashboard client and rejects anonymous traffic.
    """
    settings = get_settings()
    email = (x_dashboard_user_email or "").strip().lower()
    user_id = (x_dashboard_user_id or email).strip()
    if not email or not user_id:
        raise HTTPException(status_code=401, detail="Missing dashboard user identity headers")

    if not email.endswith("@hemut.com"):
        raise HTTPException(status_code=403, detail="ROI demo endpoints are restricted to Hemut users")

    allowed = {
        item.strip().lower()
        for item in getattr(settings, "ROI_DEMO_ALLOWED_EMAILS", "").split(",")
        if item.strip()
    }
    if allowed and email not in allowed:
        raise HTTPException(status_code=403, detail="Dashboard user is not authorized for ROI demo")

    return DashboardUser(
        user_id=user_id,
        email=email,
        name=x_dashboard_user_name.strip() if x_dashboard_user_name else None,
    )
