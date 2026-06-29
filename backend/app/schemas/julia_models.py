"""Pydantic models for Julia document APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.julia_roi_models import JuliaROIAnalysisPayload, JuliaROIPendingInput


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


class JuliaVoiceMatch(BaseModel):
    """Minimal matched document payload for voice retrieval."""

    id: str
    title: str


class JuliaVoiceIntentResponse(BaseModel):
    """Intent and document matches from a Julia voice utterance."""

    transcript: str
    intent: Literal[
        "single_match",
        "multi_match",
        "no_match",
        "non_doc",
        "roi_analysis",
        "roi_pending_input",
    ]
    matches: list[JuliaVoiceMatch]
    roi_payload: JuliaROIAnalysisPayload | None = None
    roi_pending: JuliaROIPendingInput | None = None
    tts_audio_base64: str | None = None
    tts_mime_type: str | None = None


class JuliaVoicePlaybackResponse(BaseModel):
    """Synthesized Julia voice playback audio."""

    tts_audio_base64: str | None = None
    tts_mime_type: str | None = None


class JuliaErrorResponse(BaseModel):
    """Stable Julia error envelope."""

    error: str
    detail: str
