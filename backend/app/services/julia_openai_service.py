"""OpenAI STT and TTS wrapper for Julia voice retrieval."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import get_settings

_OPENAI_BASE_URL = "https://api.openai.com/v1"
_TRANSCRIPTION_URL = f"{_OPENAI_BASE_URL}/audio/transcriptions"
_SPEECH_URL = f"{_OPENAI_BASE_URL}/audio/speech"
_TTS_MIME_TYPE = "audio/mpeg"


@dataclass(frozen=True)
class JuliaOpenAIError(Exception):
    """Expected OpenAI voice-service failure."""

    code: str
    detail: str


class JuliaOpenAIService:
    """Thin HTTP wrapper around OpenAI transcription and speech endpoints."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        stt_model: str | None = None,
        tts_model: str | None = None,
        tts_voice: str | None = None,
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
