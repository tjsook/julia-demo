"""Token-coverage matcher for Julia voice document retrieval."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, TypedDict

JuliaIntent = Literal["single_match", "multi_match", "no_match", "non_doc"]

_PUNCTUATION_RE = re.compile(r"[.,!?;:\"()\[\]\-/\\]+")
_APOSTROPHE_RE = re.compile(r"[']")
_TRIGGER_TOKENS = {"doc", "document"}


class JuliaMatchDocument(TypedDict):
    """Minimum document shape needed by the matcher."""

    id: str
    title: str
    aliases: list[str]


@dataclass(frozen=True)
class JuliaMatch:
    """A scored Julia document match."""

    document: JuliaMatchDocument
    score: int


@dataclass(frozen=True)
class JuliaMatchResult:
    """Final matcher selection result."""

    intent: JuliaIntent
    matches: list[JuliaMatch]
    top_score: int


def tokenize(value: str) -> list[str]:
    """Normalize text into matchable tokens."""
    normalized = _APOSTROPHE_RE.sub("", value.lower())
    normalized = _PUNCTUATION_RE.sub(" ", normalized)
    return [token for token in normalized.split() if len(token) >= 2]


def strip_trigger(tokens: list[str]) -> tuple[list[str], bool]:
    """Remove the required trailing document trigger token."""
    if not tokens or tokens[-1] not in _TRIGGER_TOKENS:
        return tokens, False
    return tokens[:-1], True


def score_documents(
    utterance_tokens: list[str],
    documents: list[JuliaMatchDocument],
) -> list[JuliaMatch]:
    """Score documents by the highest fully-covered alias token count."""
    utterance_set = set(utterance_tokens)
    matches: list[JuliaMatch] = []

    for document in documents:
        doc_score = 0
        for alias in document["aliases"]:
            alias_tokens = tokenize(alias)
            if alias_tokens and set(alias_tokens).issubset(utterance_set):
                doc_score = max(doc_score, len(alias_tokens))
        if doc_score >= 1:
            matches.append(JuliaMatch(document=document, score=doc_score))

    return sorted(matches, key=lambda match: match.score, reverse=True)

def select_matches(
    transcript: str,
    documents: list[JuliaMatchDocument],
    *,
    require_trigger: bool = True,
) -> JuliaMatchResult:
    """Classify retrieval intent and select matching documents."""
    utterance_tokens = tokenize(transcript)
    if require_trigger:
        utterance_tokens, has_trigger = strip_trigger(utterance_tokens)
        if not has_trigger:
            return JuliaMatchResult(intent="non_doc", matches=[], top_score=0)

    candidates = score_documents(utterance_tokens, documents)
    if not candidates:
        return JuliaMatchResult(intent="no_match", matches=[], top_score=0)

    top_score = candidates[0].score
    tied_matches = [candidate for candidate in candidates if candidate.score == top_score]
    if len(tied_matches) == 1:
        return JuliaMatchResult(intent="single_match", matches=tied_matches, top_score=top_score)
    return JuliaMatchResult(intent="multi_match", matches=tied_matches, top_score=top_score)
