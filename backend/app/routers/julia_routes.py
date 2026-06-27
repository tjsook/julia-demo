"""Julia document ingestion API routes."""

from __future__ import annotations

import base64
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from app.dependencies.dashboard_auth import DashboardUser, require_dashboard_user
from app.schemas.julia_models import (
    JuliaDocumentList,
    JuliaDocumentResponse,
    JuliaErrorResponse,
    JuliaSignedUrlResponse,
    JuliaVoiceIntentResponse,
    JuliaVoiceMatch,
)
from app.services.julia_document_service import JuliaDocumentService, JuliaServiceError
from app.services.julia_matcher import JuliaMatchDocument, select_matches
from app.services.julia_openai_service import JuliaOpenAIError, JuliaOpenAIService

router = APIRouter(prefix="/julia", tags=["julia"])
logger = logging.getLogger(__name__)
MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024


def _service() -> JuliaDocumentService:
    return JuliaDocumentService()


def _openai_service() -> JuliaOpenAIService:
    return JuliaOpenAIService()


def _error_response(exc: JuliaServiceError) -> JSONResponse:
    payload = {"error": exc.code, "detail": exc.detail}
    if exc.extra:
        payload.update(exc.extra)
    return JSONResponse(status_code=exc.status_code, content=payload)


def _julia_error(status_code: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": code, "detail": detail})


def _log_voice_intent(
    *,
    transcript: str,
    intent: str,
    match_count: int,
    top_score: int,
    top_doc_id: str | None,
) -> None:
    logger.info(
        json.dumps(
            {
                "event": "julia.intent",
                "transcript": transcript,
                "intent": intent,
                "match_count": match_count,
                "top_score": top_score,
                "top_doc_id": top_doc_id,
            },
            separators=(",", ":"),
        )
    )


def _voice_documents(rows: list[dict]) -> list[JuliaMatchDocument]:
    documents: list[JuliaMatchDocument] = []
    for row in rows:
        aliases = row.get("aliases") or []
        if not isinstance(aliases, list):
            aliases = []
        documents.append(
            {
                "id": str(row["id"]),
                "title": str(row["title"]),
                "aliases": [str(alias) for alias in aliases],
            }
        )
    return documents


@router.post(
    "/documents",
    response_model=JuliaDocumentResponse,
    status_code=201,
    responses={409: {"model": JuliaErrorResponse}, 422: {"model": JuliaErrorResponse}},
)
async def upload_document(
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form()],
    aliases: Annotated[str, Form()],
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaDocumentResponse | JSONResponse:
    """Upload and catalog a new Julia PDF document."""
    data = await file.read()
    try:
        row = _service().create_document(
            filename=file.filename or "",
            content_type=file.content_type,
            data=data,
            title=title,
            aliases=aliases,
            uploaded_by=None,
        )
    except JuliaServiceError as exc:
        return _error_response(exc)
    return JuliaDocumentResponse(**row)


@router.get("/documents", response_model=JuliaDocumentList)
async def list_documents(
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
    status: str = "active",
) -> JuliaDocumentList | JSONResponse:
    """List Julia documents by active/archive status."""
    try:
        rows = _service().list_documents(status)
    except JuliaServiceError as exc:
        return _error_response(exc)
    return JuliaDocumentList(documents=[JuliaDocumentResponse(**row) for row in rows])


@router.get(
    "/documents/{document_id}",
    response_model=JuliaDocumentResponse,
    responses={404: {"model": JuliaErrorResponse}},
)
async def get_document(
    document_id: str,
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaDocumentResponse | JSONResponse:
    """Fetch one Julia document."""
    try:
        row = _service().get_document(document_id)
    except JuliaServiceError as exc:
        return _error_response(exc)
    return JuliaDocumentResponse(**row)


@router.patch(
    "/documents/{document_id}",
    response_model=JuliaDocumentResponse,
    responses={404: {"model": JuliaErrorResponse}, 422: {"model": JuliaErrorResponse}},
)
async def update_document(
    document_id: str,
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
    title: Annotated[str | None, Form()] = None,
    aliases: Annotated[str | None, Form()] = None,
    is_active: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> JuliaDocumentResponse | JSONResponse:
    """Edit a Julia document and optionally replace the PDF."""
    data = await file.read() if file is not None else None
    try:
        row = _service().update_document(
            document_id=document_id,
            title=title,
            aliases=aliases,
            is_active=is_active,
            filename=file.filename if file is not None else None,
            content_type=file.content_type if file is not None else None,
            data=data,
        )
    except JuliaServiceError as exc:
        return _error_response(exc)
    return JuliaDocumentResponse(**row)


@router.delete(
    "/documents/{document_id}",
    status_code=204,
    response_model=None,
    response_class=Response,
    responses={404: {"model": JuliaErrorResponse}, 409: {"model": JuliaErrorResponse}},
)
async def hard_delete_document(
    document_id: str,
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> Response | JSONResponse:
    """Permanently delete an archived Julia document and its current PDF."""
    try:
        _service().hard_delete_document(document_id)
    except JuliaServiceError as exc:
        return _error_response(exc)
    return Response(status_code=204)


@router.post(
    "/voice/intent",
    response_model=JuliaVoiceIntentResponse,
    responses={
        413: {"model": JuliaErrorResponse},
        502: {"model": JuliaErrorResponse},
    },
)
async def voice_intent(
    audio: Annotated[UploadFile, File()],
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaVoiceIntentResponse | JSONResponse:
    """Transcribe a voice utterance and match it to active Julia documents."""
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_VOICE_AUDIO_BYTES:
        return _julia_error(413, "audio_too_large", "Audio must be 25 MB or smaller.")

    try:
        openai_service = _openai_service()
        transcript = openai_service.transcribe_audio(
            audio=audio_bytes,
            filename=audio.filename or "julia-voice",
            content_type=audio.content_type,
        )
    except JuliaOpenAIError as exc:
        return _julia_error(502, "transcription_failed", exc.detail)

    try:
        document_rows = _service().list_documents("active")
    except JuliaServiceError as exc:
        return _error_response(exc)

    match_result = select_matches(transcript, _voice_documents(document_rows))
    voice_matches = [
        JuliaVoiceMatch(id=match.document["id"], title=match.document["title"])
        for match in match_result.matches
    ]
    tts_audio_base64: str | None = None
    tts_mime_type: str | None = None

    if match_result.intent == "single_match" and voice_matches:
        try:
            tts_audio, tts_mime_type = openai_service.synthesize_speech(
                text=f"Here's the {voice_matches[0].title}.",
            )
            tts_audio_base64 = base64.b64encode(tts_audio).decode("ascii")
        except JuliaOpenAIError as exc:
            logger.warning(
                json.dumps(
                    {
                        "event": "julia.tts_failed",
                        "code": exc.code,
                        "detail": exc.detail,
                        "doc_id": voice_matches[0].id,
                    },
                    separators=(",", ":"),
                )
            )
            tts_mime_type = None

    _log_voice_intent(
        transcript=transcript,
        intent=match_result.intent,
        match_count=len(voice_matches),
        top_score=match_result.top_score,
        top_doc_id=voice_matches[0].id if voice_matches else None,
    )
    return JuliaVoiceIntentResponse(
        transcript=transcript,
        intent=match_result.intent,
        matches=voice_matches,
        tts_audio_base64=tts_audio_base64,
        tts_mime_type=tts_mime_type,
    )


@router.get(
    "/documents/{document_id}/signed-url",
    response_model=JuliaSignedUrlResponse,
    responses={404: {"model": JuliaErrorResponse}, 410: {"model": JuliaErrorResponse}},
)
async def get_signed_url(
    document_id: str,
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaSignedUrlResponse | JSONResponse:
    """Create a short-lived signed URL for an active Julia document."""
    try:
        payload = _service().create_signed_url(document_id)
    except JuliaServiceError as exc:
        return _error_response(exc)
    return JuliaSignedUrlResponse(**payload)
