"""OpenAI STT, TTS, and ROI extraction wrapper for Julia voice workflows."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.core.config import get_settings
from app.schemas.julia_roi_models import (
    JuliaCalibrationModel,
    JuliaExtractedDuValue,
    JuliaExtractedSValue,
    JuliaExtractedValue,
    JuliaExtractionVariables,
    JuliaPainPointMatch,
    JuliaROIExtractionLLMResponse,
    JuliaROIExtractionResult,
    JuliaROIFollowupFieldResult,
    ROIPendingField,
)

_OPENAI_BASE_URL = "https://api.openai.com/v1"
_TRANSCRIPTION_URL = f"{_OPENAI_BASE_URL}/audio/transcriptions"
_SPEECH_URL = f"{_OPENAI_BASE_URL}/audio/speech"
_CHAT_COMPLETIONS_URL = f"{_OPENAI_BASE_URL}/chat/completions"
_TTS_MIME_TYPE = "audio/mpeg"
_WHISPER_PROMPT = (
    "Hemut is a trucking technology company. "
    "The rep is a Hemut salesperson speaking about a trucking prospect."
)

logger = logging.getLogger(__name__)

IntentFallbackLabel = Literal["doc_retrieval", "roi_analysis", "non_doc"]


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
        intent_model: str | None = None,
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
        self._intent_model = intent_model or settings.OPENAI_INTENT_MODEL
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
        data = {"model": self._stt_model, "prompt": _WHISPER_PROMPT}
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

    def normalize_brand_variants(
        self,
        *,
        transcript: str,
        calibration: JuliaCalibrationModel,
    ) -> str:
        """Normalize known Hemut transcription variants in transcript text."""
        variants = calibration.brand_normalization.variants
        if not variants:
            return transcript

        pattern = r"\b(" + "|".join(re.escape(variant) for variant in variants) + r")\b"
        return re.sub(
            pattern,
            calibration.brand_normalization.target,
            transcript,
            flags=re.IGNORECASE,
        )

    def classify_intent_llm(self, *, transcript: str) -> IntentFallbackLabel:
        """Classify ambiguous utterances into doc_retrieval, roi_analysis, or non_doc."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        messages = [
            {
                "role": "system",
                "content": (
                    "You classify a single rep utterance into one of three intents:\n"
                    "- doc_retrieval: the rep is asking to display a specific sales document\n"
                    "- roi_analysis: the rep is summarizing a prospect's situation for an ROI calculation\n"
                    "- non_doc: anything else (greetings, side talk, unclear)\n\n"
                    'Output strict JSON: {"intent":"<one of the three values>"}. '
                    "Never explain. Never add other fields."
                ),
            },
            {
                "role": "user",
                "content": f'Utterance: "{transcript}"',
            },
        ]
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "intent": {
                    "type": "string",
                    "enum": ["doc_retrieval", "roi_analysis", "non_doc"],
                }
            },
            "required": ["intent"],
        }
        payload = {
            "model": self._intent_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "julia_intent_fallback",
                    "strict": True,
                    "schema": schema,
                },
            },
            "temperature": 0,
            "max_tokens": 50,
        }

        try:
            response = self._client.post(
                _CHAT_COMPLETIONS_URL,
                headers=headers,
                json=payload,
                timeout=3,
            )
            if response.status_code >= 400:
                raise JuliaOpenAIError(
                    "intent_fallback_failed",
                    f"OpenAI intent fallback failed with status {response.status_code}.",
                )
            body = response.json()
            choices = body.get("choices") if isinstance(body, dict) else None
            message = choices[0].get("message") if isinstance(choices, list) and choices else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Missing structured intent content.")
            raw_json = json.loads(content)
            intent = raw_json.get("intent") if isinstance(raw_json, dict) else None
            if intent not in {"doc_retrieval", "roi_analysis", "non_doc"}:
                raise ValueError(f"Unsupported intent fallback value: {intent!r}.")
            return intent
        except Exception as exc:
            logger.warning(
                json.dumps(
                    {
                        "event": "julia.intent_fallback_failed",
                        "detail": str(exc),
                    },
                    separators=(",", ":"),
                )
            )
            return "non_doc"

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
        s_bucket_enum = list(calibration.qualitative_buckets.S.model_dump().keys())
        du_bucket_enum = list(calibration.qualitative_buckets.Du.model_dump().keys())
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
                        "T": _positive_number_var_schema(max_value=10000),
                        "S": _qualitative_fraction_var_schema(bucket_enum=s_bucket_enum),
                        "P": _positive_number_var_schema(max_value=5000),
                        "Ld": _positive_number_var_schema(max_value=10000),
                        "Du": _qualitative_fraction_var_schema(bucket_enum=du_bucket_enum),
                        "R": _positive_number_var_schema(max_value=50000),
                        "minutes_per_order": _minutes_per_order_var_schema(max_value=120),
                    },
                    "required": ["T", "S", "P", "Ld", "Du", "R", "minutes_per_order"],
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
                    "Use lexical math for obvious spoken numerals and fractions like 'about a hundred' or 'half'.\n"
                    "Strict rules:\n"
                    "- Return null for any variable not explicitly stated as a specific number or percentage.\n"
                    "- Never invent numbers from related sentences.\n"
                    "- S and Du are decimal fractions in the range [0, 1]. Values outside [0,1] are invalid.\n"
                    "- Cap reported confidence at 0.95. Never use 1.0.\n\n"
                    "PAIN POINT EXTRACTION RULES:\n"
                    "1. Default to OMITTING pain points. Only include a pain point if the rep explicitly "
                    "mentioned the underlying issue in the transcript.\n"
                    "2. The evidence field for each pain point MUST be a verbatim substring from the transcript "
                    "- not a paraphrase, not the trigger phrase from the context list. If you cannot point to "
                    "specific words the rep said, do NOT include the pain point.\n"
                    "3. If you are not sure whether the rep mentioned a pain point, omit it."
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
                    + "\n\nWhen the rep clearly describes the underlying issue of a pain point — even using words\n"
                    "different from the trigger examples — match the pain point. The trigger examples show\n"
                    "common patterns; they are not an exhaustive list. Base your judgment on what the rep\n"
                    "actually means, then quote their exact words as evidence.\n\n"
                    "Example — rep says \"they aren't using algorithms\":\n"
                    "- MATCH manual_load_matching with evidence \"aren't using algorithms\"\n"
                    "Example — rep says \"using zero algorithms for planning\":\n"
                    "- MATCH manual_load_matching with evidence \"zero algorithms for planning\"\n"
                    "- DO NOT match if the rep is off-topic or unclear.\n\n"
                    "Example — rep says \"spending 40 seconds per load putting in loads\":\n"
                    "- MATCH manual_order_entry with evidence \"putting in loads\"\n"
                    "- DO NOT paraphrase; quote the rep's actual words.\n\n"
                    "If the rep is ambiguous (\"things are slow\"), still omit. This rule applies only to\n"
                    "clear descriptions of the underlying issue."
                    + "\n\nNumeric extraction rules:\n"
                    "- Extract numbers ONLY if explicitly stated by the rep.\n"
                    "- If a variable is not mentioned with a specific number, return null.\n"
                    "- DO NOT guess from related numbers in nearby sentences.\n"
                    "- Return confidence [0,1] for each value and each pain point.\n"
                    "Per-variable extraction examples:\n"
                    "T (trucks):\n"
                    "- '100 trucks' -> T = {'value': 100, 'confidence': 0.95}\n"
                    "- 'around 100 trucks' -> T = {'value': 100, 'confidence': 0.85}\n"
                    "- 'a lot of trucks' -> T = null\n"
                    "S (% spot, MUST be decimal fraction 0-1 OR a qualitative_tag):\n"
                    "Numeric:\n"
                    "- '60 percent spot' -> S = {'value': 0.60, 'qualitative_tag': null, 'confidence': 0.95}\n"
                    "- 'split half and half' -> S = {'value': 0.50, 'qualitative_tag': null, 'confidence': 0.85}\n"
                    "Qualitative tag (when no specific number given):\n"
                    "- 'mostly spot freight' -> S = {'value': null, 'qualitative_tag': 'mostly_spot', 'confidence': 0.85}\n"
                    "- 'all spot, no contracts' -> S = {'value': null, 'qualitative_tag': 'strongly_spot', 'confidence': 0.90}\n"
                    "- 'primarily contracted' -> S = {'value': null, 'qualitative_tag': 'mostly_contracted', 'confidence': 0.85}\n"
                    "- 'balanced mix' -> S = {'value': null, 'qualitative_tag': 'balanced', 'confidence': 0.80}\n"
                    "No signal:\n"
                    "- (no mention of spot vs contracted at all) -> S = null\n"
                    "P (office people):\n"
                    "- '8 in the office' or '8 office people' -> P = {'value': 8, 'confidence': 0.95}\n"
                    "- 'a small team' -> P = null\n"
                    "Ld (loads per day):\n"
                    "- '150 loads a day' -> Ld = {'value': 150, 'confidence': 0.95}\n"
                    "- 'they run about 150 loads daily' -> Ld = {'value': 150, 'confidence': 0.90}\n"
                    "- 'lots of loads' -> Ld = null\n"
                    "R (average revenue per load, USD):\n"
                    "- '$2,300 per load' -> R = {'value': 2300, 'confidence': 0.95}\n"
                    "- 'roughly 2500 a load' -> R = {'value': 2500, 'confidence': 0.85}\n"
                    "- 'not sure on revenue per load' -> R = null\n"
                    "minutes_per_order (manual order-entry minutes per load/order):\n"
                    "- ALWAYS set unit to either 'minutes' or 'hours' when value is present.\n"
                    "- 'three minutes per order' -> minutes_per_order = {'value': 3, 'unit': 'minutes', 'confidence': 0.95}\n"
                    "- 'about 2.5 minutes per load' -> minutes_per_order = {'value': 2.5, 'unit': 'minutes', 'confidence': 0.85}\n"
                    "- '0.05 hours per order' -> minutes_per_order = {'value': 0.05, 'unit': 'hours', 'confidence': 0.9}\n"
                    "- 'order entry is slow' -> minutes_per_order = null\n"
                    "Du (% detention uncaptured, MUST be decimal fraction 0-1 OR a qualitative_tag):\n"
                    "Numeric:\n"
                    "- '70 percent uncaptured' -> Du = {'value': 0.70, 'qualitative_tag': null, 'confidence': 0.95}\n"
                    "Qualitative tag:\n"
                    "- 'most detention is not billed' -> Du = {'value': null, 'qualitative_tag': 'mostly_uncaptured', 'confidence': 0.85}\n"
                    "- 'we barely collect any detention' -> Du = {'value': null, 'qualitative_tag': 'barely_collected', 'confidence': 0.90}\n"
                    "- 'we bill it pretty well' -> Du = {'value': null, 'qualitative_tag': 'mostly_collected', 'confidence': 0.85}\n"
                    "No signal:\n"
                    "- (no mention of detention billing rate at all) -> Du = null"
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

        clamped_pain_points = [
            pain.model_copy(update={"confidence": _clamp_confidence(pain.confidence)})
            for pain in structured.pain_points
        ]

        numeric_threshold = calibration.extraction.numeric_confidence_threshold
        filtered_variables = JuliaExtractionVariables(
            T=_accept_numeric(structured.variables.T, numeric_threshold),
            S=_accept_qualitative_fraction(structured.variables.S, numeric_threshold),
            P=_accept_numeric(structured.variables.P, numeric_threshold),
            Ld=_accept_numeric(structured.variables.Ld, numeric_threshold),
            Du=_accept_qualitative_fraction(structured.variables.Du, numeric_threshold),
            R=_accept_numeric(structured.variables.R, numeric_threshold),
            minutes_per_order=_accept_numeric(structured.variables.minutes_per_order, numeric_threshold),
        )

        return JuliaROIExtractionResult(
            company_name=structured.company_name,
            matched_pain_points=clamped_pain_points,
            variables=filtered_variables,
        )

    def extract_roi_pain_points(
        self,
        *,
        transcript: str,
        calibration: JuliaCalibrationModel,
    ) -> list[JuliaPainPointMatch]:
        """Extract only pain points from a dedicated pain-point stage answer."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        pain_points = calibration.pain_points
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
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
                }
            },
            "required": ["pain_points"],
        }
        messages = [
            {
                "role": "system",
                "content": (
                    "You extract only ROI pain points from one transcript. "
                    "Return strict JSON and do not include pain points unless the rep clearly described them. "
                    "Use verbatim evidence substrings from the transcript. "
                    "Treat no/zero algorithm statements (for planning/dispatch/load matching) as manual_load_matching."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Identify pain points from this transcript.\n\n"
                    f"Transcript:\n{transcript}\n\n"
                    "Examples:\n"
                    "- 'they're using zero algorithms for planning' -> MATCH manual_load_matching\n"
                    "- 'no matching algorithm' -> MATCH manual_load_matching\n\n"
                    "Pain point context:\n"
                    + "\n".join(
                        f"- {pain.id} ({pain.label}): {', '.join(pain.trigger_phrases)}"
                        for pain in pain_points
                    )
                ),
            },
        ]
        payload = {
            "model": self._extraction_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "julia_roi_pain_points",
                    "strict": True,
                    "schema": schema,
                },
            },
            "temperature": 0,
        }
        raw_json = self._chat_completion_json(
            headers=headers,
            payload=payload,
            error_code="extraction_failed",
            error_prefix="OpenAI pain-point extraction",
        )
        try:
            raw_points = raw_json.get("pain_points")
            if not isinstance(raw_points, list):
                raise ValueError("Missing pain_points list.")
            return [
                JuliaPainPointMatch.model_validate(point).model_copy(
                    update={"confidence": _clamp_confidence(float(point.get("confidence", 0.0)))}
                )
                for point in raw_points
                if isinstance(point, dict)
            ]
        except Exception as exc:
            raise JuliaOpenAIError(
                "extraction_failed",
                f"OpenAI pain-point extraction response parsing failed: {exc}",
            ) from exc

    def extract_roi_followup_field(
        self,
        *,
        transcript: str,
        expected_field: ROIPendingField,
        calibration: JuliaCalibrationModel,
    ) -> JuliaROIFollowupFieldResult:
        """Extract one expected follow-up field answer with classification status."""
        if expected_field not in {"T", "S", "P", "Ld", "Du", "R", "minutes_per_order"}:
            raise JuliaOpenAIError(
                "followup_extraction_failed",
                f"Unsupported follow-up field: {expected_field}.",
            )

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        s_bucket_enum = list(calibration.qualitative_buckets.S.model_dump().keys())
        du_bucket_enum = list(calibration.qualitative_buckets.Du.model_dump().keys())
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "status": {
                    "type": "string",
                    "enum": [
                        "value_captured",
                        "needs_confirmation",
                        "no_answer",
                        "not_applicable_or_unknown",
                    ],
                },
                "field": {"type": "string", "enum": [expected_field]},
                "value": {"type": ["number", "null"]},
                "unit": {
                    "type": ["string", "null"],
                    "enum": ["minutes", "hours", None] if expected_field == "minutes_per_order" else [None],
                },
                "qualitative_tag": {
                    "type": ["string", "null"],
                    "enum": [*(s_bucket_enum if expected_field == "S" else du_bucket_enum), None]
                    if expected_field in {"S", "Du"}
                    else [None],
                },
                "normalized_value": {"type": ["number", "null"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "evidence": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": [
                "status",
                "field",
                "value",
                "unit",
                "qualitative_tag",
                "normalized_value",
                "confidence",
                "evidence",
                "reason",
            ],
        }
        percentage_specific_rules = ""
        if expected_field in {"S", "Du"}:
            percentage_specific_rules = (
                "\n- For S and Du, convert clear percent answers to decimal fractions in [0,1].\n"
                "- If the rep says a plain number from 0 to 100 (for example '10'), treat it as percent and set "
                "normalized_value to 0.10.\n"
                "- If the rep self-corrects (for example '10%, maybe 20%, yeah 20%'), use the final clear value.\n"
                "- If multiple values remain unresolved (for example '10 or 20'), use needs_confirmation.\n"
            )
        minutes_specific_rules = ""
        if expected_field == "minutes_per_order":
            minutes_specific_rules = (
                "\n- For minutes_per_order, capture the spoken numeric value in `value` and set `unit`.\n"
                "- If the rep says minutes/min, set unit='minutes'.\n"
                "- If the rep says hours/hr, set unit='hours'.\n"
                "- If unit is omitted but context is order-entry time per load/order, default unit='minutes'.\n"
            )
        messages = [
            {
                "role": "system",
                "content": (
                    "Classify one answer for one expected ROI field. "
                    "Only extract the expected field. Never infer from unrelated numbers. "
                    "Use status value_captured, needs_confirmation, no_answer, or not_applicable_or_unknown. "
                    "Return strict JSON only."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Expected field: {expected_field}\n"
                    f"Transcript: {transcript}\n\n"
                    "Rules:\n"
                    "- value_captured: clear direct answer with one plausible value.\n"
                    "- needs_confirmation: noisy/ambiguous, multiple numbers, hedged phrasing.\n"
                    "- no_answer: off-topic or no usable value.\n"
                    "- not_applicable_or_unknown: explicit don't know/use default.\n"
                    "- For S and Du, qualitative tags are allowed when no explicit numeric percentage is given."
                    f"{percentage_specific_rules}"
                    f"{minutes_specific_rules}"
                ),
            },
        ]
        payload = {
            "model": self._extraction_model,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "julia_roi_followup_field",
                    "strict": True,
                    "schema": schema,
                },
            },
            "temperature": 0,
        }
        raw_json = self._chat_completion_json(
            headers=headers,
            payload=payload,
            error_code="followup_extraction_failed",
            error_prefix="OpenAI follow-up extraction",
        )
        try:
            result = JuliaROIFollowupFieldResult.model_validate(raw_json)
            return result.model_copy(update={"confidence": _clamp_confidence(result.confidence)})
        except Exception as exc:
            raise JuliaOpenAIError(
                "followup_extraction_failed",
                f"OpenAI follow-up extraction response parsing failed: {exc}",
            ) from exc

    def _chat_completion_json(
        self,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
        error_code: str,
        error_prefix: str,
    ) -> dict[str, Any]:
        try:
            response = self._client.post(
                _CHAT_COMPLETIONS_URL,
                headers=headers,
                json=payload,
            )
        except Exception as exc:
            raise JuliaOpenAIError(error_code, f"{error_prefix} request failed: {exc}") from exc

        if response.status_code >= 400:
            raise JuliaOpenAIError(
                error_code,
                f"{error_prefix} failed with status {response.status_code}.",
            )

        try:
            body = response.json()
            choices = body.get("choices") if isinstance(body, dict) else None
            message = choices[0].get("message") if isinstance(choices, list) and choices else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Missing structured content.")
            raw_json = json.loads(content)
            if not isinstance(raw_json, dict):
                raise ValueError("Structured content must decode to an object.")
            return raw_json
        except Exception as exc:
            raise JuliaOpenAIError(
                error_code,
                f"{error_prefix} response parsing failed: {exc}",
            ) from exc


def _qualitative_fraction_var_schema(*, bucket_enum: list[str]) -> dict[str, Any]:
    return {
        "type": ["object", "null"],
        "additionalProperties": False,
        "properties": {
            "value": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
            "qualitative_tag": {"type": ["string", "null"], "enum": [*bucket_enum, None]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["value", "qualitative_tag", "confidence"],
    }


def _positive_number_var_schema(*, max_value: float) -> dict[str, Any]:
    return {
        "type": ["object", "null"],
        "additionalProperties": False,
        "properties": {
            "value": {"type": "number", "exclusiveMinimum": 0, "maximum": max_value},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["value", "confidence"],
    }


def _minutes_per_order_var_schema(*, max_value: float) -> dict[str, Any]:
    return {
        "type": ["object", "null"],
        "additionalProperties": False,
        "properties": {
            "value": {"type": "number", "exclusiveMinimum": 0, "maximum": max_value},
            "unit": {"type": "string", "enum": ["minutes", "hours"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
        "required": ["value", "unit", "confidence"],
    }


def _accept_numeric(candidate: JuliaExtractedValue | None, threshold: float) -> JuliaExtractedValue | None:
    if candidate is None:
        return None
    clamped = candidate.model_copy(update={"confidence": _clamp_confidence(candidate.confidence)})
    if clamped.confidence < threshold:
        return None
    return clamped


def _accept_qualitative_fraction(
    candidate: JuliaExtractedSValue | JuliaExtractedDuValue | None,
    threshold: float,
) -> JuliaExtractedSValue | JuliaExtractedDuValue | None:
    if candidate is None:
        return None
    clamped = candidate.model_copy(update={"confidence": _clamp_confidence(candidate.confidence)})
    if clamped.confidence < threshold:
        return None
    return clamped


def _clamp_confidence(confidence: float) -> float:
    return min(float(confidence), 0.95)
