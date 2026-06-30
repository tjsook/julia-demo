"""Julia document ingestion API routes."""

from __future__ import annotations

import base64
import json
import logging
import time
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
    JuliaVoicePlaybackResponse,
)
from app.services.julia_calibration_service import JuliaCalibrationError, get_calibration
from app.services.julia_document_service import JuliaDocumentService, JuliaServiceError
from app.services.julia_intent_router import IntentClass, classify_intent
from app.services.julia_matcher import JuliaMatchDocument, select_matches
from app.services.julia_openai_service import JuliaOpenAIError, JuliaOpenAIService
from app.services.julia_roi_engine import JuliaROIEngine

router = APIRouter(prefix="/julia", tags=["julia"])
logger = logging.getLogger(__name__)
MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024
MULTI_MATCH_TTS_TEXT = (
    "I found multiple documents of that type. Which one do you want me to pull up?"
)
NO_MATCH_TTS_TEXT = "I could not find that. Narrow down your query."


def _service() -> JuliaDocumentService:
    return JuliaDocumentService()


def _openai_service() -> JuliaOpenAIService:
    return JuliaOpenAIService()


def _roi_engine() -> JuliaROIEngine:
    return JuliaROIEngine()


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
    token_count: int,
    metric_count: int,
    match_count: int = 0,
    top_score: int = 0,
    top_doc_id: str | None = None,
    matched_pain_points: list[str] | None = None,
    fleet_size_provided: bool | None = None,
    elapsed_ms: int | None = None,
) -> None:
    payload: dict[str, object] = {
        "event": "julia.intent",
        "transcript": transcript,
        "intent": intent,
        "token_count": token_count,
        "metric_count": metric_count,
        "match_count": match_count,
        "top_score": top_score,
        "top_doc_id": top_doc_id,
    }
    if matched_pain_points is not None:
        payload["matched_pain_points"] = matched_pain_points
    if fleet_size_provided is not None:
        payload["fleet_size_provided"] = fleet_size_provided
    if elapsed_ms is not None:
        payload["elapsed_ms"] = elapsed_ms
    logger.info(json.dumps(payload, separators=(",", ":")))


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


def _synthesize_voice_response(
    openai_service: JuliaOpenAIService,
    *,
    text: str,
    doc_id: str | None,
) -> tuple[str | None, str | None]:
    try:
        tts_audio, tts_mime_type = openai_service.synthesize_speech(text=text)
    except JuliaOpenAIError as exc:
        logger.warning(
            json.dumps(
                {
                    "event": "julia.tts_failed",
                    "code": exc.code,
                    "detail": exc.detail,
                    "doc_id": doc_id,
                },
                separators=(",", ":"),
            )
        )
        return None, None

    return base64.b64encode(tts_audio).decode("ascii"), tts_mime_type


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
    started_at = time.perf_counter()
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
        calibration = get_calibration()
    except JuliaCalibrationError as exc:
        return _julia_error(500, exc.code, exc.detail)

    classified = classify_intent(transcript, calibration.intent_classifier)

    if classified.intent == IntentClass.DOC_RETRIEVAL:
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
            tts_audio_base64, tts_mime_type = _synthesize_voice_response(
                openai_service,
                text=f"Here's the {voice_matches[0].title} document.",
                doc_id=voice_matches[0].id,
            )
        elif match_result.intent == "multi_match" and voice_matches:
            tts_audio_base64, tts_mime_type = _synthesize_voice_response(
                openai_service,
                text=MULTI_MATCH_TTS_TEXT,
                doc_id=voice_matches[0].id,
            )
        elif match_result.intent == "no_match":
            tts_audio_base64, tts_mime_type = _synthesize_voice_response(
                openai_service,
                text=NO_MATCH_TTS_TEXT,
                doc_id=None,
            )

        _log_voice_intent(
            transcript=transcript,
            intent=match_result.intent,
            token_count=classified.token_count,
            metric_count=classified.metric_count,
            match_count=len(voice_matches),
            top_score=match_result.top_score,
            top_doc_id=voice_matches[0].id if voice_matches else None,
            elapsed_ms=int((time.perf_counter() - started_at) * 1000),
        )
        return JuliaVoiceIntentResponse(
            transcript=transcript,
            intent=match_result.intent,
            matches=voice_matches,
            tts_audio_base64=tts_audio_base64,
            tts_mime_type=tts_mime_type,
        )

    if classified.intent == IntentClass.UNKNOWN:
        logger.info(
            json.dumps(
                {
                    "event": "julia.intent.unknown",
                    "transcript": transcript,
                    "token_count": classified.token_count,
                    "metric_count": classified.metric_count,
                },
                separators=(",", ":"),
            )
        )
        _log_voice_intent(
            transcript=transcript,
            intent="non_doc",
            token_count=classified.token_count,
            metric_count=classified.metric_count,
            elapsed_ms=int((time.perf_counter() - started_at) * 1000),
        )
        return JuliaVoiceIntentResponse(transcript=transcript, intent="non_doc", matches=[])

    try:
        extraction = openai_service.extract_roi_brief(
            transcript=transcript,
            calibration=calibration,
        )
    except JuliaOpenAIError as exc:
        return _julia_error(502, "extraction_failed", exc.detail)

    engine_result = _roi_engine().evaluate_roi(
        transcript=transcript,
        extraction=extraction,
        calibration=calibration,
    )
    if engine_result.pending is not None:
        _log_voice_intent(
            transcript=transcript,
            intent="roi_pending_input",
            token_count=classified.token_count,
            metric_count=classified.metric_count,
            matched_pain_points=[pain.id for pain in extraction.matched_pain_points],
            fleet_size_provided=False,
            elapsed_ms=int((time.perf_counter() - started_at) * 1000),
        )
        return JuliaVoiceIntentResponse(
            transcript=transcript,
            intent="roi_pending_input",
            matches=[],
            roi_pending=engine_result.pending,
        )

    payload = engine_result.payload
    if payload is None:
        return _julia_error(
            500,
            "roi_engine_invalid_state",
            "ROI engine returned neither pending input nor payload.",
        )

    tts_text = (
        f"Here's the ROI analysis for {payload.company_name}."
        if payload.company_name
        else "Here's the ROI analysis."
    )
    tts_audio_base64, tts_mime_type = _synthesize_voice_response(
        openai_service,
        text=tts_text,
        doc_id=None,
    )

    _log_voice_intent(
        transcript=transcript,
        intent="roi_analysis",
        token_count=classified.token_count,
        metric_count=classified.metric_count,
        matched_pain_points=[pain.id for pain in payload.matched_pain_points],
        fleet_size_provided=True,
        elapsed_ms=int((time.perf_counter() - started_at) * 1000),
    )
    return JuliaVoiceIntentResponse(
        transcript=transcript,
        intent="roi_analysis",
        matches=[],
        roi_payload=payload,
        tts_audio_base64=tts_audio_base64,
        tts_mime_type=tts_mime_type,
    )


@router.post(
    "/voice/documents/{document_id}/confirmation",
    response_model=JuliaVoicePlaybackResponse,
    responses={
        404: {"model": JuliaErrorResponse},
        410: {"model": JuliaErrorResponse},
    },
)
async def voice_document_confirmation(
    document_id: str,
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaVoicePlaybackResponse | JSONResponse:
    """Synthesize Julia's spoken confirmation for a selected document."""
    try:
        row = _service().get_document(document_id)
    except JuliaServiceError as exc:
        return _error_response(exc)

    if row.get("is_active") is False:
        return _julia_error(
            410,
            "document_archived",
            "Archived documents are not available for retrieval.",
        )

    openai_service = _openai_service()
    tts_audio_base64, tts_mime_type = _synthesize_voice_response(
        openai_service,
        text=f"Here's the {row['title']} document.",
        doc_id=document_id,
    )
    return JuliaVoicePlaybackResponse(
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
