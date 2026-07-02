"""Julia document ingestion API routes."""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError

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
from app.schemas.julia_roi_models import (
    JuliaResolvedInput,
    JuliaROICollectionSession,
)
from app.services.julia_calibration_service import JuliaCalibrationError, get_calibration
from app.services.julia_document_service import JuliaDocumentService, JuliaServiceError
from app.services.julia_intent_router import IntentClass, classify_intent
from app.services.julia_matcher import JuliaMatchDocument, select_matches
from app.services.julia_openai_service import JuliaOpenAIError, JuliaOpenAIService
from app.services.julia_roi_engine import JuliaROIEngine

router = APIRouter(prefix="/julia", tags=["julia"])
logger = logging.getLogger(__name__)
MULTI_MATCH_TTS_TEXT = (
    "I found multiple documents of that type. Which one do you want me to pull up?"
)
NO_MATCH_TTS_TEXT = "I could not find that. Narrow down your query."
ROI_COMPANY_QUESTION_TEXT = "Which company is this for?"
ROI_PAIN_POINTS_QUESTION_TEXT = "What pain points did you identify in their office or operation?"
INITIAL_GREETING_TEMPLATE = "Hey {name}, what can I do for you today?"
ROI_FIELD_QUESTIONS: dict[str, str] = {
    "company_name": ROI_COMPANY_QUESTION_TEXT,
    "pain_points": ROI_PAIN_POINTS_QUESTION_TEXT,
    "T": "How many trucks are in their fleet?",
    "Ld": "About how many loads per day do they run?",
    "S": "What share of their freight is spot versus contracted?",
    "Du": "What percentage of detention is currently not getting billed or collected?",
    "P": "How many office or dispatch staff work on this workflow?",
    "R": "What is their average revenue per load?",
    "minutes_per_order": "About how many minutes does manual order entry take per load?",
}


def _max_voice_audio_mb() -> int:
    return get_settings().JULIA_VOICE_AUDIO_MAX_MB


def _max_voice_audio_bytes() -> int:
    return _max_voice_audio_mb() * 1024 * 1024


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


def _question_text_for_field(field: str) -> str:
    question = ROI_FIELD_QUESTIONS.get(field)
    if question is None:
        raise ValueError(f"Unsupported ROI question field: {field}.")
    return question


def _field_label(field: str) -> str:
    return {
        "company_name": "company name",
        "pain_points": "pain points",
        "T": "fleet size",
        "Ld": "loads per day",
        "S": "spot mix",
        "Du": "detention uncaptured percentage",
        "P": "office/dispatch staff",
        "R": "average revenue per load",
        "minutes_per_order": "minutes per order entry",
    }.get(field, field)


def _merge_unique(existing: list[str], additions: list[str]) -> list[str]:
    merged: list[str] = list(existing)
    for item in additions:
        if item not in merged:
            merged.append(item)
    return merged


def _parse_yes_no(transcript: str) -> bool | None:
    lowered = transcript.strip().lower()
    if not lowered:
        return None
    yes_tokens = ("yes", "yeah", "yep", "correct", "right", "sure", "do it", "use it")
    no_tokens = ("no", "nope", "dont", "don't", "not now", "skip")
    if any(token in lowered for token in yes_tokens):
        return True
    if any(token in lowered for token in no_tokens):
        return False
    return None


def _format_default_value(field: str, value: float) -> str:
    if field in {"S", "Du"}:
        return f"{round(value * 100, 1):g}%"
    if field == "R":
        return f"${value:,.0f}"
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"


def _numeric_fields_from_required(required_fields: list[str]) -> list[str]:
    return [
        field
        for field in required_fields
        if field in {"T", "Ld", "S", "Du", "P", "R", "minutes_per_order"}
    ]


def _next_missing_numeric_field(session: JuliaROICollectionSession) -> str | None:
    required_numeric = _numeric_fields_from_required(session.required_fields)
    for field in required_numeric:
        if field not in session.resolved_inputs:
            return field
    return None


def _is_defaultable_field(field: str) -> bool:
    return field in {"S", "P", "Ld", "Du", "R"}


def _resolved_input_from_followup_result(
    *,
    field: str,
    value: float | None,
    unit: str | None,
    qualitative_tag: str | None,
    confidence: float,
    session: JuliaROICollectionSession,
    calibration,
    followup_markers: list[str] | None = None,
) -> JuliaResolvedInput:
    if field == "T":
        if value is None:
            raise ValueError("Fleet size is missing.")
        if value < 1 or value > 10000 or not float(value).is_integer():
            raise ValueError("Fleet size must be an integer between 1 and 10,000.")
        return JuliaResolvedInput(value=float(int(value)), source="rep", confidence=confidence)
    if field == "P":
        if value is None:
            raise ValueError("Office/dispatch staff count is missing.")
        if value < 1 or value > 5000 or not float(value).is_integer():
            raise ValueError("Office/dispatch staff must be an integer between 1 and 5,000.")
        return JuliaResolvedInput(value=float(int(value)), source="rep", confidence=confidence)
    if field == "Ld":
        if value is None:
            raise ValueError("Loads per day value is missing.")
        if value <= 0:
            raise ValueError("Loads per day must be greater than 0.")
        t_value = session.resolved_inputs.get("T")
        if t_value is not None and value > t_value.value * 10:
            raise ValueError(
                f"Loads per day is too high versus fleet size. Maximum accepted is T × 10 ({t_value.value * 10:g})."
            )
        return JuliaResolvedInput(value=float(value), source="rep", confidence=confidence)
    if field == "R":
        if value is None:
            raise ValueError("Average revenue per load is missing.")
        if value <= 0:
            raise ValueError("Average revenue per load must be greater than 0.")
        return JuliaResolvedInput(value=float(value), source="rep", confidence=confidence)
    if field == "minutes_per_order":
        if value is None:
            raise ValueError("Minutes per order entry value is missing.")
        normalized_value = float(value)
        if unit == "hours":
            normalized_value = normalized_value * 60.0
            if followup_markers is not None:
                followup_markers.append(
                    f"Converted minutes_per_order from hours to minutes ({value:g}h -> {normalized_value:g}m)."
                )
        if normalized_value <= 0:
            raise ValueError("Minutes per order entry must be greater than 0.")
        return JuliaResolvedInput(value=normalized_value, source="rep", confidence=confidence)
    if field in {"S", "Du"}:
        if value is not None:
            if value < 0 or value > 1:
                raise ValueError(f"{_field_label(field).capitalize()} must be between 0 and 1.")
            return JuliaResolvedInput(value=float(value), source="rep", confidence=confidence)
        if qualitative_tag:
            buckets = (
                calibration.qualitative_buckets.S.model_dump()
                if field == "S"
                else calibration.qualitative_buckets.Du.model_dump()
            )
            bucket_value = buckets.get(qualitative_tag)
            if bucket_value is None:
                raise ValueError(f"Unsupported qualitative tag for {field}: {qualitative_tag}.")
            return JuliaResolvedInput(
                value=float(bucket_value),
                source="rep_qualitative",
                confidence=confidence,
                qualitative_tag=qualitative_tag,
            )
        raise ValueError(f"{_field_label(field).capitalize()} answer did not include a usable value.")
    raise ValueError(f"Unsupported follow-up field: {field}.")


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
    required_fields: list[str] = ["company_name", "pain_points"]
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
            "resolved_inputs": {},
            "pending_default_field": None,
            "pending_default_value": None,
            "pending_default_rule": None,
            "followup_markers": [],
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
    "/voice/roi-followup",
    response_model=JuliaVoiceIntentResponse,
    responses={
        413: {"model": JuliaErrorResponse},
        422: {"model": JuliaErrorResponse},
        502: {"model": JuliaErrorResponse},
    },
)
async def voice_roi_followup(
    audio: Annotated[UploadFile, File()],
    expected_field: Annotated[str, Form()],
    session: Annotated[str, Form()],
    _user: Annotated[DashboardUser, Depends(require_dashboard_user)],
) -> JuliaVoiceIntentResponse | JSONResponse:
    """Handle guided ROI follow-up answers for company, pain points, and numeric fields."""
    allowed_fields = {
        "company_name",
        "pain_points",
        "T",
        "Ld",
        "S",
        "Du",
        "P",
        "R",
        "minutes_per_order",
    }
    if expected_field not in allowed_fields:
        return _julia_error(
            422,
            "invalid_expected_field",
            f"expected_field must be one of: {', '.join(sorted(allowed_fields))}.",
        )

    try:
        session_state = JuliaROICollectionSession.model_validate_json(session)
    except ValidationError as exc:
        return _julia_error(422, "invalid_session", f"Session payload is invalid: {exc}")

    if session_state.stage == "complete":
        return _julia_error(422, "session_complete", "ROI session is already complete.")

    audio_bytes = await audio.read()
    max_audio_mb = _max_voice_audio_mb()
    if len(audio_bytes) > _max_voice_audio_bytes():
        return _julia_error(413, "audio_too_large", f"Audio must be {max_audio_mb} MB or smaller.")

    openai_service = _openai_service()
    try:
        transcript = openai_service.transcribe_audio(
            audio=audio_bytes,
            filename=audio.filename or "julia-voice-followup",
            content_type=audio.content_type,
        )
    except JuliaOpenAIError as exc:
        return _julia_error(502, "transcription_failed", exc.detail)

    try:
        calibration = get_calibration()
    except JuliaCalibrationError as exc:
        return _julia_error(500, exc.code, exc.detail)

    transcript = openai_service.normalize_brand_variants(
        transcript=transcript,
        calibration=calibration,
    )
    followup_confidence_threshold = calibration.extraction.numeric_confidence_threshold
    engine = _roi_engine()

    def pending_response(
        *,
        next_field: str,
        detail: str,
        stage: str,
        question_text: str | None = None,
    ) -> JuliaVoiceIntentResponse:
        session_state.stage = stage
        session_state.missing_fields = [next_field]
        pending_payload = {
            "missing": [next_field],
            "next_field": next_field,
            "question_text": question_text or _question_text_for_field(next_field),
            "detail": detail,
            "session": session_state.model_dump(),
        }
        tts_audio_base64, tts_mime_type = _synthesize_voice_response(
            openai_service,
            text=pending_payload["question_text"],
            doc_id=None,
        )
        return JuliaVoiceIntentResponse(
            transcript=transcript,
            intent="roi_pending_input",
            matches=[],
            roi_pending=pending_payload,
            tts_audio_base64=tts_audio_base64,
            tts_mime_type=tts_mime_type,
        )

    def finalize_analysis() -> JuliaVoiceIntentResponse | JSONResponse:
        if not session_state.company_name:
            return pending_response(
                next_field="company_name",
                detail="I still need the company name to continue.",
                stage="company",
            )
        required_numeric = engine.plan_required_fields(
            matched_pain_points=session_state.matched_pain_points,
            calibration=calibration,
        )
        session_state.required_fields = _merge_unique(
            ["company_name", "pain_points"],
            required_numeric,
        )
        next_numeric = _next_missing_numeric_field(session_state)
        if next_numeric is not None:
            return pending_response(
                next_field=next_numeric,
                detail=f"I still need {_field_label(next_numeric)} before running analysis.",
                stage="numeric_fields",
            )
        try:
            payload = engine.evaluate_guided_roi(
                company_name=session_state.company_name,
                matched_pain_points=session_state.matched_pain_points,
                inputs=session_state.resolved_inputs,
                calibration=calibration,
                followup_markers=session_state.followup_markers,
            )
        except ValueError as exc:
            return _julia_error(500, "roi_engine_invalid_state", str(exc))

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
        session_state.stage = "complete"
        session_state.missing_fields = []
        return JuliaVoiceIntentResponse(
            transcript=transcript,
            intent="roi_analysis",
            matches=[],
            roi_payload=payload,
            tts_audio_base64=tts_audio_base64,
            tts_mime_type=tts_mime_type,
        )

    session_state.answer_transcripts.append(transcript)

    if expected_field == "company_name":
        company_name = _normalize_company_name(transcript)
        if company_name is None:
            return pending_response(
                next_field="company_name",
                detail="I could not capture the company name. Which company is this for?",
                stage="company",
            )
        session_state.company_name = company_name
        session_state.collected_fields = _merge_unique(session_state.collected_fields, ["company_name"])
        session_state.required_fields = _merge_unique(session_state.required_fields, ["company_name", "pain_points"])
        return pending_response(
            next_field="pain_points",
            detail="Tell me the main pain points you identified in their office or operation.",
            stage="pain_points",
        )

    if expected_field == "pain_points":
        try:
            pain_points = openai_service.extract_roi_pain_points(
                transcript=transcript,
                calibration=calibration,
            )
        except JuliaOpenAIError as exc:
            return _julia_error(502, "extraction_failed", exc.detail)

        filtered_points, drop_markers = engine.filter_pain_points_for_followup(
            transcript=transcript,
            pain_point_matches=pain_points,
            calibration=calibration,
        )
        if not filtered_points:
            return pending_response(
                next_field="pain_points",
                detail="I could not capture usable pain points. Please describe them again.",
                stage="pain_points",
            )

        session_state.matched_pain_points = filtered_points
        session_state.followup_markers = _merge_unique(session_state.followup_markers, drop_markers)
        session_state.collected_fields = _merge_unique(session_state.collected_fields, ["pain_points"])
        required_numeric = engine.plan_required_fields(
            matched_pain_points=filtered_points,
            calibration=calibration,
        )
        session_state.required_fields = _merge_unique(
            ["company_name", "pain_points"],
            required_numeric,
        )

        for field in required_numeric:
            if field in session_state.resolved_inputs:
                continue
            candidate = getattr(session_state.variables, field, None)
            if candidate is None:
                continue
            try:
                session_state.resolved_inputs[field] = _resolved_input_from_followup_result(
                    field=field,
                    value=getattr(candidate, "value", None),
                    unit=getattr(candidate, "unit", None),
                    qualitative_tag=getattr(candidate, "qualitative_tag", None),
                    confidence=float(getattr(candidate, "confidence", 0.0)),
                    session=session_state,
                    calibration=calibration,
                    followup_markers=session_state.followup_markers,
                )
                session_state.collected_fields = _merge_unique(session_state.collected_fields, [field])
            except ValueError:
                continue

        next_numeric = _next_missing_numeric_field(session_state)
        if next_numeric is None:
            return finalize_analysis()
        return pending_response(
            next_field=next_numeric,
            detail=f"I still need {_field_label(next_numeric)} before running analysis.",
            stage="numeric_fields",
        )

    if expected_field not in {"T", "Ld", "S", "Du", "P", "R", "minutes_per_order"}:
        return _julia_error(422, "invalid_expected_field", "Follow-up field is not numeric.")

    if session_state.pending_default_field == expected_field:
        yes_no = _parse_yes_no(transcript)
        if yes_no is None:
            return pending_response(
                next_field=expected_field,
                detail="Please answer yes or no so I can continue.",
                stage="confirm_default",
                question_text=(
                    f"I can use the default of "
                    f"{_format_default_value(expected_field, session_state.pending_default_value or 0.0)} "
                    f"for {_field_label(expected_field)}. Should I use that?"
                ),
            )
        if not yes_no:
            session_state.pending_default_field = None
            session_state.pending_default_value = None
            session_state.pending_default_rule = None
            return pending_response(
                next_field=expected_field,
                detail=f"Okay, I still need {_field_label(expected_field)} from you.",
                stage="numeric_fields",
            )

        fleet_size = session_state.resolved_inputs.get("T")
        try:
            resolved_default = engine.resolve_user_approved_default(
                symbol=expected_field,
                calibration=calibration,
                fleet_size=fleet_size.value if fleet_size else None,
            )
        except ValueError as exc:
            return _julia_error(422, "default_resolution_failed", str(exc))
        session_state.resolved_inputs[expected_field] = resolved_default
        session_state.collected_fields = _merge_unique(session_state.collected_fields, [expected_field])
        session_state.followup_markers = _merge_unique(
            session_state.followup_markers,
            [f"Used default for {_field_label(expected_field)} with explicit rep approval."],
        )
        session_state.pending_default_field = None
        session_state.pending_default_value = None
        session_state.pending_default_rule = None
    else:
        try:
            followup_result = openai_service.extract_roi_followup_field(
                transcript=transcript,
                expected_field=expected_field,
                calibration=calibration,
            )
        except JuliaOpenAIError as exc:
            return _julia_error(502, "followup_extraction_failed", exc.detail)

        if followup_result.status == "not_applicable_or_unknown":
            if not _is_defaultable_field(expected_field):
                return pending_response(
                    next_field=expected_field,
                    detail=f"{_field_label(expected_field).capitalize()} is required and has no default.",
                    stage="numeric_fields",
                )
            fleet_size = session_state.resolved_inputs.get("T")
            try:
                default_input = engine.resolve_user_approved_default(
                    symbol=expected_field,
                    calibration=calibration,
                    fleet_size=fleet_size.value if fleet_size else None,
                )
            except ValueError as exc:
                return _julia_error(422, "default_resolution_failed", str(exc))
            session_state.pending_default_field = expected_field
            session_state.pending_default_value = default_input.value
            session_state.pending_default_rule = default_input.rule
            return pending_response(
                next_field=expected_field,
                detail=f"Default approval required for {_field_label(expected_field)}.",
                stage="confirm_default",
                question_text=(
                    f"I can use the default of {_format_default_value(expected_field, default_input.value)} "
                    f"for {_field_label(expected_field)}. Should I use that?"
                ),
            )

        extracted_value = (
            followup_result.normalized_value
            if expected_field in {"S", "Du"} and followup_result.normalized_value is not None
            else followup_result.value
        )
        has_captured_value = extracted_value is not None or followup_result.qualitative_tag is not None
        status = followup_result.status
        if (
            status == "needs_confirmation"
            and has_captured_value
            and followup_result.confidence >= followup_confidence_threshold
        ):
            status = "value_captured"

        if status == "value_captured" and followup_result.confidence < followup_confidence_threshold:
            return pending_response(
                next_field=expected_field,
                detail=(
                    f"I heard a possible {_field_label(expected_field)}, but I need a clearer answer. "
                    f"{_question_text_for_field(expected_field)}"
                ),
                stage="numeric_fields",
            )

        if status in {"no_answer", "needs_confirmation"}:
            return pending_response(
                next_field=expected_field,
                detail=f"I could not capture {_field_label(expected_field)}. {_question_text_for_field(expected_field)}",
                stage="numeric_fields",
            )

        try:
            session_state.resolved_inputs[expected_field] = _resolved_input_from_followup_result(
                field=expected_field,
                value=extracted_value,
                unit=followup_result.unit,
                qualitative_tag=followup_result.qualitative_tag,
                confidence=followup_result.confidence,
                session=session_state,
                calibration=calibration,
                followup_markers=session_state.followup_markers,
            )
        except ValueError as exc:
            return pending_response(
                next_field=expected_field,
                detail=f"I could not capture {_field_label(expected_field)} ({exc}).",
                stage="numeric_fields",
            )
        session_state.collected_fields = _merge_unique(session_state.collected_fields, [expected_field])

    next_numeric = _next_missing_numeric_field(session_state)
    if next_numeric is None:
        return finalize_analysis()
    return pending_response(
        next_field=next_numeric,
        detail=f"I still need {_field_label(next_numeric)} before running analysis.",
        stage="numeric_fields",
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
