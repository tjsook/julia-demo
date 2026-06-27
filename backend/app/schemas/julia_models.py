"""Pydantic models for Julia document APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JuliaDocumentResponse(BaseModel):
    """Frontend-safe Julia document metadata."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    aliases: list[str]
    mime_type: str
    uploaded_at: datetime
    updated_at: datetime
    is_active: bool


class JuliaDocumentList(BaseModel):
    """List response for the Julia hub."""

    documents: list[JuliaDocumentResponse]


class JuliaSignedUrlResponse(BaseModel):
    """Short-lived signed URL for rendering a Julia document."""

    id: str
    title: str
    signed_url: str
    expires_in: int


class JuliaErrorResponse(BaseModel):
    """Stable Julia error envelope."""

    error: str
    detail: str
