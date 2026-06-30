"""Deterministic Julia intent classifier for DOC vs ROI vs UNKNOWN."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.schemas.julia_roi_models import JuliaIntentClassifierConfig
from app.services.julia_matcher import tokenize


class IntentClass(StrEnum):
    """Internal intent labels used by the route layer."""

    DOC_RETRIEVAL = "DOC_RETRIEVAL"
    ROI_ANALYSIS = "ROI_ANALYSIS"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class IntentClassification:
    """Classifier output plus key diagnostics for logging."""

    intent: IntentClass
    token_count: int
    metric_count: int


def classify_intent(transcript: str, config: JuliaIntentClassifierConfig) -> IntentClassification:
    """Classify transcript intent using the deterministic rule chain from the architecture doc."""
    original = transcript.strip()
    tokens = tokenize(original)
    token_count = len(tokens)

    metric_vocab = {token.lower() for token in config.metric_vocabulary}
    metric_count = sum(1 for token in tokens if any(char.isdigit() for char in token) or token in metric_vocab)

    if token_count >= config.length_threshold and metric_count >= config.metric_count_threshold:
        return IntentClassification(IntentClass.ROI_ANALYSIS, token_count, metric_count)

    lowered_original = original.lower()
    if any(pattern.lower() in lowered_original for pattern in config.roi_verb_patterns):
        return IntentClassification(IntentClass.ROI_ANALYSIS, token_count, metric_count)

    doc_triggers = {token.lower() for token in config.doc_word_triggers}
    if any(token in doc_triggers for token in tokens):
        return IntentClassification(IntentClass.DOC_RETRIEVAL, token_count, metric_count)

    return IntentClassification(IntentClass.UNKNOWN, token_count, metric_count)
