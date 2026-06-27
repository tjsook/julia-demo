"""Supabase data access for Julia document catalog and PDFs."""

from __future__ import annotations

from typing import Any

from app.core.errors import IntegrationError
from app.core.julia_validation import PDF_MIME_TYPE

JULIA_BUCKET = "julia-documents"
JULIA_TABLE = "julia_documents"


class JuliaDocumentRepository:
    """Postgres CRUD plus Supabase Storage operations for Julia documents."""

    def __init__(self) -> None:
        from app.clients.supabase_client import get_supabase

        self._db = get_supabase()

    def exists(self, document_id: str) -> bool:
        """Return true when a document id already exists, active or archived."""
        try:
            resp = (
                self._db.table(JULIA_TABLE)
                .select("id")
                .eq("id", document_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise IntegrationError(f"Julia document existence check failed: {exc}") from exc
        return bool(resp.data)

    def insert(self, row: dict[str, Any]) -> dict[str, Any]:
        """Insert a document catalog row and return it."""
        try:
            resp = self._db.table(JULIA_TABLE).insert(row).execute()
        except Exception as exc:
            raise IntegrationError(f"Julia document insert failed: {exc}") from exc
        rows = resp.data or []
        if not rows:
            raise IntegrationError("Julia document insert returned no row.")
        return rows[0]

    def list(self, status: str) -> list[dict[str, Any]]:
        """List documents by active/archive status."""
        try:
            query = self._db.table(JULIA_TABLE).select("*").order("uploaded_at", desc=True)
            if status == "active":
                query = query.eq("is_active", True)
            elif status == "archived":
                query = query.eq("is_active", False)
            resp = query.execute()
        except Exception as exc:
            raise IntegrationError(f"Julia document list failed: {exc}") from exc
        return resp.data or []

    def get(self, document_id: str) -> dict[str, Any] | None:
        """Fetch one document row."""
        try:
            resp = (
                self._db.table(JULIA_TABLE)
                .select("*")
                .eq("id", document_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise IntegrationError(f"Julia document fetch failed for {document_id}: {exc}") from exc
        rows = resp.data or []
        return rows[0] if rows else None

    def update(self, document_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Update a document row and return the updated row."""
        try:
            resp = (
                self._db.table(JULIA_TABLE)
                .update(fields)
                .eq("id", document_id)
                .execute()
            )
        except Exception as exc:
            raise IntegrationError(f"Julia document update failed for {document_id}: {exc}") from exc
        rows = resp.data or []
        if not rows:
            raise IntegrationError(f"Julia document update returned no row for {document_id}.")
        return rows[0]

    def delete_row(self, document_id: str) -> None:
        """Hard-delete a document catalog row."""
        try:
            self._db.table(JULIA_TABLE).delete().eq("id", document_id).execute()
        except Exception as exc:
            raise IntegrationError(f"Julia document row delete failed for {document_id}: {exc}") from exc

    def upload_pdf(self, storage_path: str, data: bytes) -> None:
        """Upload PDF bytes to the configured private bucket."""
        object_key = self._object_key(storage_path)
        try:
            self._db.storage.from_(JULIA_BUCKET).upload(
                object_key,
                data,
                {"content-type": PDF_MIME_TYPE},
            )
        except Exception as exc:
            raise IntegrationError(f"Julia PDF upload failed for {storage_path}: {exc}") from exc

    def delete_pdf(self, storage_path: str) -> None:
        """Delete the current PDF object from the private bucket."""
        object_key = self._object_key(storage_path)
        try:
            self._db.storage.from_(JULIA_BUCKET).remove([object_key])
        except Exception as exc:
            raise IntegrationError(f"Julia PDF delete failed for {storage_path}: {exc}") from exc

    def create_signed_url(self, storage_path: str, expires_in: int) -> str:
        """Create a short-lived URL for a PDF object."""
        object_key = self._object_key(storage_path)
        try:
            resp = self._db.storage.from_(JULIA_BUCKET).create_signed_url(
                object_key,
                expires_in,
            )
        except Exception as exc:
            raise IntegrationError(f"Julia signed URL creation failed for {storage_path}: {exc}") from exc
        signed_url = resp.get("signedURL") or resp.get("signedUrl") or resp.get("signed_url")
        if not signed_url:
            raise IntegrationError(f"Julia signed URL response missing URL for {storage_path}.")
        return str(signed_url)

    @staticmethod
    def storage_path_for(object_key: str) -> str:
        """Build a persisted storage path from a bucket object key."""
        return f"{JULIA_BUCKET}/{object_key}"

    @staticmethod
    def _object_key(storage_path: str) -> str:
        prefix = f"{JULIA_BUCKET}/"
        if not storage_path.startswith(prefix):
            raise IntegrationError(
                f"Julia storage path must start with {prefix!r}: {storage_path!r}"
            )
        object_key = storage_path[len(prefix):]
        if not object_key:
            raise IntegrationError("Julia storage path is missing an object key.")
        return object_key
