"""Julia document ingestion API routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from app.dependencies.dashboard_auth import DashboardUser, require_dashboard_user
from app.schemas.julia_models import (
    JuliaDocumentList,
    JuliaDocumentResponse,
    JuliaErrorResponse,
    JuliaSignedUrlResponse,
)
from app.services.julia_document_service import JuliaDocumentService, JuliaServiceError

router = APIRouter(prefix="/julia", tags=["julia"])


def _service() -> JuliaDocumentService:
    return JuliaDocumentService()


def _error_response(exc: JuliaServiceError) -> JSONResponse:
    payload = {"error": exc.code, "detail": exc.detail}
    if exc.extra:
        payload.update(exc.extra)
    return JSONResponse(status_code=exc.status_code, content=payload)


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
