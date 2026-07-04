"""Validation helpers for Julia document ingestion."""

from __future__ import annotations

import re
from pathlib import PurePath

MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_ALIASES = 10
MIN_ALIAS_CHARS = 2
MAX_ALIAS_CHARS = 80
MAX_TITLE_CHARS = 200
PDF_MIME_TYPE = "application/pdf"
PDF_MAGIC = b"%PDF-"


class JuliaValidationError(ValueError):
    """Raised when a Julia document input fails validation."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def derive_document_id(filename: str) -> str:
    """Derive the stable Julia document id from an uploaded filename."""
    stem = PurePath(filename).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "_", stem)
    slug = re.sub(r"_+", "_", slug).strip("_")
    if not slug:
        raise JuliaValidationError(
            "invalid_document_id",
            "Filename must contain at least one alphanumeric character.",
        )
    return slug


def normalize_title(title: str | None) -> str:
    """Trim and validate a document title."""
    cleaned = (title or "").strip()
    if not cleaned:
        raise JuliaValidationError("invalid_title", "Title is required.")
    if len(cleaned) > MAX_TITLE_CHARS:
        raise JuliaValidationError(
            "invalid_title",
            f"Title must be {MAX_TITLE_CHARS} characters or fewer.",
        )
    return cleaned


def normalize_aliases(raw_aliases: str | None) -> list[str]:
    """Split, normalize, dedupe, and validate comma-separated aliases."""
    aliases: list[str] = []
    seen: set[str] = set()
    for alias in (raw_aliases or "").split(","):
        cleaned = alias.strip().lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        aliases.append(cleaned)

    if not aliases:
        raise JuliaValidationError(
            "invalid_aliases",
            "At least one alias is required.",
        )
    if len(aliases) > MAX_ALIASES:
        raise JuliaValidationError(
            "invalid_aliases",
            f"At most {MAX_ALIASES} aliases are allowed.",
        )
    for alias in aliases:
        if len(alias) < MIN_ALIAS_CHARS or len(alias) > MAX_ALIAS_CHARS:
            raise JuliaValidationError(
                "invalid_aliases",
                f"Each alias must be {MIN_ALIAS_CHARS}-{MAX_ALIAS_CHARS} characters.",
            )
    return aliases


def parse_is_active(raw_value: str | None) -> bool | None:
    """Parse the optional multipart is_active field."""
    if raw_value is None:
        return None
    normalized = raw_value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise JuliaValidationError(
        "invalid_is_active",
        'is_active must be either "true" or "false".',
    )


def validate_pdf_upload(content_type: str | None, data: bytes) -> None:
    """Validate uploaded PDF bytes using both MIME type and magic bytes."""
    if len(data) > MAX_PDF_BYTES:
        raise JuliaValidationError(
            "file_too_large",
            "PDF must be 25 MB or smaller.",
        )
    if content_type != PDF_MIME_TYPE:
        raise JuliaValidationError(
            "invalid_file_type",
            "File Content-Type must be application/pdf.",
        )
    if not data.startswith(PDF_MAGIC):
        raise JuliaValidationError(
            "invalid_file_type",
            "File must be a valid PDF.",
        )
