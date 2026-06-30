"""OpenAI STT, TTS, and ROI extraction wrapper for Julia voice workflows."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.julia_roi_models import (
    JuliaCalibrationModel,
    JuliaExtractedValue,
    JuliaExtractionVariables,
    JuliaROIExtractionLLMResponse,
    JuliaROIExtractionResult,
)

_OPENAI_BASE_URL = "https://api.openai.com/v1"
_TRANSCRIPTION_URL = f"{_OPENAI_BASE_URL}/audio/transcriptions"
_SPEECH_URL = f"{_OPENAI_BASE_URL}/audio/speech"
_CHAT_COMPLETIONS_URL = f"{_OPENAI_BASE_URL}/chat/completions"
_TTS_MIME_TYPE = "audio/mpeg"


@dataclass(frozen=True)
class JuliaOpenAIError(Exception):
    """Expected OpenAI voice-service failure."""

    code: str
    detail: str


class JuliaOpenAIService:
    """Thin HTTP wrapper around OpenAI transcription, speech, and extraction endpoints."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        stt_model: str | None = None,
        tts_model: str | None = None,
        tts_voice: str | None = None,
        extraction_model: str | None = None,
        http_client: Any | None = None,
    ) -> None:
        settings = get_settings()
        self._api_key = api_key if api_key is not None else settings.OPENAI_API_KEY
        if not self._api_key:
            raise JuliaOpenAIError(
                "openai_not_configured",
                "OPENAI_API_KEY must be configured for Julia voice retrieval.",
            )
        self._stt_model = stt_model or settings.OPENAI_STT_MODEL
        self._tts_model = tts_model or settings.OPENAI_TTS_MODEL
        self._tts_voice = tts_voice or settings.OPENAI_TTS_VOICE
        self._extraction_model = extraction_model or settings.OPENAI_EXTRACTION_MODEL
        self._client = http_client or httpx.Client(timeout=30)

    def transcribe_audio(
        self,
        *,
        audio: bytes,
        filename: str,
        content_type: str | None,
    ) -> str:
        """Transcribe a browser-recorded audio blob."""
        headers = {"Authorization": f"Bearer {self._api_key}"}
        files = {
            "file": (
                filename or "julia-voice.webm",
                audio,
                content_type or "application/octet-stream",
            )
        }
        data = {"model": self._stt_model}
        try:
            response = self._client.post(
                _TRANSCRIPTION_URL,
                headers=headers,
                data=data,
                files=files,
            )
        except Exception as exc:
            raise JuliaOpenAIError("transcription_failed", f"OpenAI transcription request failed: {exc}") from exc

        if response.status_code >= 400:
            raise JuliaOpenAIError(
                "transcription_failed",
                f"OpenAI transcription failed with status {response.status_code}.",
            )

        payload = response.json()
        transcript = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(transcript, str):
            raise JuliaOpenAIError(
                "transcription_failed",
                "OpenAI transcription response did not include text.",
            )
        return transcript.strip()

    def synthesize_speech(self, *, text: str) -> tuple[bytes, str]:
        """Create a short spoken confirmation clip."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self._tts_model,
            "voice": self._tts_voice,
            "input": text,
            "response_format": "mp3",
        }
        try:
            response = self._client.post(
                _SPEECH_URL,
                headers=headers,
                json=payload,
            )
        except Exception as exc:
            raise JuliaOpenAIError("tts_failed", f"OpenAI speech request failed: {exc}") from exc

        if response.status_code >= 400:
            raise JuliaOpenAIError(
                "tts_failed",
                f"OpenAI speech failed with status {response.status_code}.",
            )
        if not response.content:
            raise JuliaOpenAIError("tts_failed", "OpenAI speech response was empty.")
        return response.content, _TTS_MIME_TYPE

    def extract_roi_brief(
        self,
        *,
        transcript: str,
        calibration: JuliaCalibrationModel,
    ) -> JuliaROIExtractionResult:
        """Extract ROI pain points and explicit numeric variables in one structured LLM call."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        pain_points = calibration.pain_points
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "company_name": {"type": ["string", "null"]},
                "pain_points": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "id": {"type": "string", "enum": [pain.id for pain in pain_points]},
                            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                            "evidence": {"type": "string"},
                        },
                        "required": ["id", "confidence", "evidence"],
                    },
                },
                "variables": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "T": _numeric_var_schema(),
                        "S": _numeric_var_schema(),
                        "P": _numeric_var_schema(),
                        "Ld": _numeric_var_schema(),
                        "Du": _numeric_var_schema(),
                    },
                    "required": ["T", "S", "P", "Ld", "Du"],
                },
            },
            "required": ["company_name", "pain_points", "variables"],
        }

        messages = [
            {
                "role": "system",
                "content": (
                    "You extract sales call ROI details into strict JSON. "
                    "Only output schema-valid JSON. Never infer unstated numbers. "
                    "Use lexical math for obvious spoken numerals and fractions like 'about a hundred' or 'half'."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Classify ROI pain points and extract explicit numeric variables from this transcript.\n\n"
                    f"Transcript:\n{transcript}\n\n"
                    "Pain point context:\n"
                    + "\n".join(
                        f"- {pain.id} ({pain.label}): {', '.join(pain.trigger_phrases)}"
                        for pain in pain_points
                    )
                    + "\n\nNumeric extraction rules:\n"
                    "- Extract numbers only if explicitly stated.\n"
                    "- '100 trucks' -> T=100.\n"
                    "- 'Half detention' -> Du=0.5.\n"
                    "- Percent values should be decimal fractions (e.g. 70% => 0.70).\n"
                    "- Return confidence [0,1] for each value and each pain point."
                ),
            },
        ]

        payload = {
            "model": self._extraction_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "julia_roi_extraction",
                    "strict": True,
                    "schema": schema,
                },
            },
            "temperature": 0,
        }

        try:
            response = self._client.post(
                _CHAT_COMPLETIONS_URL,
                headers=headers,
                json=payload,
            )
        except Exception as exc:
            raise JuliaOpenAIError("extraction_failed", f"OpenAI extraction request failed: {exc}") from exc

        if response.status_code >= 400:
            raise JuliaOpenAIError(
                "extraction_failed",
                f"OpenAI extraction failed with status {response.status_code}.",
            )

        try:
            body = response.json()
            choices = body.get("choices") if isinstance(body, dict) else None
            message = choices[0].get("message") if isinstance(choices, list) and choices else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Missing structured extraction content.")
            raw_json = json.loads(content)
            structured = JuliaROIExtractionLLMResponse.model_validate(raw_json)
        except Exception as exc:
            raise JuliaOpenAIError(
                "extraction_failed",
                f"OpenAI extraction response parsing failed: {exc}",
            ) from exc

        thresholds = {pain.id: pain.threshold for pain in pain_points}
        matched = [
            pain
            for pain in structured.pain_points
            if pain.id in thresholds and pain.confidence >= thresholds[pain.id]
        ]

        numeric_threshold = calibration.extraction.numeric_confidence_threshold
        filtered_variables = JuliaExtractionVariables(
            T=_accept_numeric(structured.variables.T, numeric_threshold),
            S=_accept_numeric(structured.variables.S, numeric_threshold),
            P=_accept_numeric(structured.variables.P, numeric_threshold),
            Ld=_accept_numeric(structured.variables.Ld, numeric_threshold),
            Du=_accept_numeric(structured.variables.Du, numeric_threshold),
        )

        return JuliaROIExtractionResult(
            company_name=structured.company_name,
            matched_pain_points=matched,
            variables=filtered_variables,
        )


def _numeric_var_schema() -> dict[str, Any]:
    return {
        "type": ["object", "null"],
        "additionalProperties": False,
        "properties": {
            "value": {"type": "number"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["value", "confidence"],
    }


def _accept_numeric(candidate: JuliaExtractedValue | None, threshold: float) -> JuliaExtractedValue | None:
    if candidate is None:
        return None
    if candidate.confidence < threshold:
        return None
    return candidate
