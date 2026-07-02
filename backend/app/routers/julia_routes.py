"""Julia document ingestion API routes."""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from app.core.config import get_settings
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

router = APIRouter(prefix="/julia", tags=["julia"])
logger = logging.getLogger(__name__)
MULTI_MATCH_TTS_TEXT = (
    "I found multiple documents of that type. Which one do you want me to pull up?"
)
NO_MATCH_TTS_TEXT = "I could not find that. Narrow down your query."
ROI_COMPANY_QUESTION_TEXT = "Which company is this for?"
ROI_PAIN_POINTS_QUESTION_TEXT = "What pain points did you identify in their office or operation?"
INITIAL_GREETING_TEMPLATE = "Hey {name}, what can I do for you today?"


def _max_voice_audio_mb() -> int:
    return get_settings().JULIA_VOICE_AUDIO_MAX_MB


def _max_voice_audio_bytes() -> int:
    return _max_voice_audio_mb() * 1024 * 1024


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


def _normalize_company_name(raw_company_name: str | None) -> str | None:
    if raw_company_name is None:
        return None
    trimmed = raw_company_name.strip()
    return trimmed or None


def _greeting_name(raw_first_name: str | None) -> str:
    if raw_first_name is None:
        return "there"
    trimmed = raw_first_name.strip()
    if not trimmed:
        return "there"
    return trimmed.split()[0]


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
    max_audio_mb = _max_voice_audio_mb()
    if len(audio_bytes) > _max_voice_audio_bytes():
        return _julia_error(413, "audio_too_large", f"Audio must be {max_audio_mb} MB or smaller.")

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

    normalized_transcript = openai_service.normalize_brand_variants(
        transcript=transcript,
        calibration=calibration,
    )
    if normalized_transcript != transcript:
        logger.info(
            json.dumps(
                {
                    "event": "julia.transcript_normalized",
                    "raw_transcript": transcript,
                    "normalized_transcript": normalized_transcript,
                },
                separators=(",", ":"),
            )
        )
    transcript = normalized_transcript

    classified = classify_intent(transcript, calibration.intent_classifier)
    effective_intent = classified.intent
    if effective_intent == IntentClass.UNKNOWN:
        fallback_started_at = time.perf_counter()
        fallback_intent = openai_service.classify_intent_llm(transcript=transcript)
        fallback_elapsed_ms = int((time.perf_counter() - fallback_started_at) * 1000)
        logger.info(
            json.dumps(
                {
                    "event": "julia.intent_fallback",
                    "transcript": transcript,
                    "classification": fallback_intent,
                    "elapsed_ms": fallback_elapsed_ms,
                },
                separators=(",", ":"),
            )
        )
        if fallback_intent == "doc_retrieval":
            effective_intent = IntentClass.DOC_RETRIEVAL
        elif fallback_intent == "roi_analysis":
            effective_intent = IntentClass.ROI_ANALYSIS

    if effective_intent == IntentClass.DOC_RETRIEVAL:
        try:
            document_rows = _service().list_documents("active")
        except JuliaServiceError as exc:
            return _error_response(exc)

        match_result = select_matches(
            transcript,
            _voice_documents(document_rows),
            require_trigger=False,
        )
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

    if effective_intent == IntentClass.UNKNOWN:
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

    company_name = _normalize_company_name(extraction.company_name)
    required_fields = ["company_name", "pain_points"]
    collected_fields: list[str] = []
    missing_fields: list[str] = []
    stage = "company"
    question_text = ROI_COMPANY_QUESTION_TEXT
    detail = "I can run ROI analysis after I capture the company name."

    if company_name is not None:
        collected_fields.append("company_name")
        missing_fields = ["pain_points"]
        stage = "pain_points"
        question_text = ROI_PAIN_POINTS_QUESTION_TEXT
        detail = "Tell me the main pain points you identified in their office or operation."
    else:
        missing_fields = ["company_name"]

    pending_payload = {
        "missing": missing_fields,
        "next_field": missing_fields[0],
        "question_text": question_text,
        "detail": detail,
        "session": {
            "original_transcript": transcript,
            "answer_transcripts": [transcript],
            "company_name": company_name,
            "matched_pain_points": [],
            "variables": extraction.variables.model_dump(),
            "required_fields": required_fields,
            "collected_fields": collected_fields,
            "missing_fields": missing_fields,
            "stage": stage,
        },
    }

    tts_audio_base64, tts_mime_type = _synthesize_voice_response(
        openai_service,
        text=question_text,
        doc_id=None,
    )

    _log_voice_intent(
        transcript=transcript,
        intent="roi_pending_input",
        token_count=classified.token_count,
        metric_count=classified.metric_count,
        matched_pain_points=[pain.id for pain in extraction.matched_pain_points],
        elapsed_ms=int((time.perf_counter() - started_at) * 1000),
    )
    return JuliaVoiceIntentResponse(
        transcript=transcript,
        intent="roi_pending_input",
        matches=[],
        roi_pending=pending_payload,
        tts_audio_base64=tts_audio_base64,
        tts_mime_type=tts_mime_type,
    )


@router.post(
    "/voice/greeting",
    response_model=JuliaVoicePlaybackResponse,
    responses={
        502: {"model": JuliaErrorResponse},
    },
)
async def voice_greeting(
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
    first_name: Annotated[str | None, Form()] = None,
) -> JuliaVoicePlaybackResponse | JSONResponse:
    """Synthesize Julia's opening greeting for the guided conversation shell."""
    openai_service = _openai_service()
    greeting_text = INITIAL_GREETING_TEMPLATE.format(name=_greeting_name(first_name))
    tts_audio_base64, tts_mime_type = _synthesize_voice_response(
        openai_service,
        text=greeting_text,
        doc_id=None,
    )
    return JuliaVoicePlaybackResponse(
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
