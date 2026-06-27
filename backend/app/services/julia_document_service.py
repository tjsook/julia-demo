"""Business logic for Julia document ingestion and retrieval."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.core.julia_validation import (
    PDF_MIME_TYPE,
    JuliaValidationError,
    derive_document_id,
    normalize_aliases,
    normalize_title,
    parse_is_active,
    validate_pdf_upload,
)
from app.repositories.julia_document_repository import JuliaDocumentRepository

SIGNED_URL_TTL_SECONDS = 600


@dataclass(frozen=True)
class JuliaServiceError(Exception):
    """Expected Julia API error with an HTTP status and stable code."""

    status_code: int
    code: str
    detail: str
    extra: dict[str, Any] | None = None


class JuliaDocumentService:
    """Coordinate validation, storage, and catalog updates for Julia documents."""

    def __init__(self, repo: JuliaDocumentRepository | None = None) -> None:
        self._repo = repo or JuliaDocumentRepository()

    def create_document(
        self,
        *,
        filename: str,
        content_type: str | None,
        data: bytes,
        title: str,
        aliases: str,
        uploaded_by: str | None,
    ) -> dict[str, Any]:
        """Validate, upload, and catalog a new PDF document."""
        try:
            validate_pdf_upload(content_type, data)
            clean_title = normalize_title(title)
            clean_aliases = normalize_aliases(aliases)
            document_id = derive_document_id(filename)
        except JuliaValidationError as exc:
            raise JuliaServiceError(422, exc.code, exc.detail) from exc

        if self._repo.exists(document_id):
            raise JuliaServiceError(
                409,
                "document_id_taken",
                "A document with that filename already exists.",
                {"existing_id": document_id},
            )

        storage_path = self._repo.storage_path_for(f"{document_id}.pdf")
        self._repo.upload_pdf(storage_path, data)
        row = {
            "id": document_id,
            "title": clean_title,
            "aliases": clean_aliases,
            "storage_path": storage_path,
            "mime_type": PDF_MIME_TYPE,
            "uploaded_by": uploaded_by,
            "is_active": True,
        }
        return self._repo.insert(row)

    def list_documents(self, status: str) -> list[dict[str, Any]]:
        """List documents filtered by status."""
        if status not in {"active", "archived", "all"}:
            raise JuliaServiceError(
                422,
                "invalid_status",
                'status must be one of "active", "archived", or "all".',
            )
        return self._repo.list(status)

    def get_document(self, document_id: str) -> dict[str, Any]:
        """Fetch one document or raise a 404."""
        return self._get_existing(document_id)

    def update_document(
        self,
        *,
        document_id: str,
        title: str | None,
        aliases: str | None,
        is_active: str | None,
        filename: str | None,
        content_type: str | None,
        data: bytes | None,
    ) -> dict[str, Any]:
        """Update metadata and optionally replace the PDF file."""
        self._get_existing(document_id)
        fields: dict[str, Any] = {"updated_at": datetime.now(UTC).isoformat()}

        try:
            if title is not None:
                fields["title"] = normalize_title(title)
            if aliases is not None:
                fields["aliases"] = normalize_aliases(aliases)
            parsed_is_active = parse_is_active(is_active)
        except JuliaValidationError as exc:
            raise JuliaServiceError(422, exc.code, exc.detail) from exc

        if parsed_is_active is not None:
            fields["is_active"] = parsed_is_active

        if data is not None:
            try:
                validate_pdf_upload(content_type, data)
            except JuliaValidationError as exc:
                raise JuliaServiceError(422, exc.code, exc.detail) from exc
            if not filename:
                raise JuliaServiceError(422, "invalid_file", "Replacement file must have a filename.")
            replacement_key = f"{document_id}__{int(time.time())}.pdf"
            storage_path = self._repo.storage_path_for(replacement_key)
            self._repo.upload_pdf(storage_path, data)
            fields["storage_path"] = storage_path
            fields["mime_type"] = PDF_MIME_TYPE

        return self._repo.update(document_id, fields)

    def hard_delete_document(self, document_id: str) -> None:
        """Delete an archived document row and its current storage object."""
        row = self._get_existing(document_id)
        if row.get("is_active") is True:
            raise JuliaServiceError(
                409,
                "document_active",
                "Archive the document before permanently deleting it.",
            )
        storage_path = str(row.get("storage_path") or "")
        self._repo.delete_pdf(storage_path)
        self._repo.delete_row(document_id)

    def create_signed_url(self, document_id: str) -> dict[str, Any]:
        """Return a signed PDF URL for an active document."""
        row = self._get_existing(document_id)
        if row.get("is_active") is False:
            raise JuliaServiceError(
                410,
                "document_archived",
                "Archived documents are not available for retrieval.",
            )
        signed_url = self._repo.create_signed_url(
            str(row.get("storage_path") or ""),
            SIGNED_URL_TTL_SECONDS,
        )
        return {
            "id": row["id"],
            "title": row["title"],
            "signed_url": signed_url,
            "expires_in": SIGNED_URL_TTL_SECONDS,
        }

    def _get_existing(self, document_id: str) -> dict[str, Any]:
        row = self._repo.get(document_id)
        if not row:
            raise JuliaServiceError(
                404,
                "document_not_found",
                f"Julia document {document_id!r} was not found.",
            )
        return row
