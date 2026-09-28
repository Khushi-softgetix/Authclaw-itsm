"""API Router for ITSM File Attachments."""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.core.storage import LocalStorageEngine
from app.db.models import ITSMTicket
from app.schemas.itsm_attachments import AttachmentResponse
from app.services.itsm_attachment_service import ITSMAttachmentService
from app.services.itsm_incident_service import IncidentService

logger = logging.getLogger("authclaw.itsm.attachments")

router = APIRouter()

ALLOWED_ITSM_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "SERVICE_LEAD",
    "REQUESTER",
    "ADMIN",
    "OWNER",
    "PROCESS_CHANGE_MANAGER",
    "AUDITOR",
}


def _verify_itsm_user(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Validate tenant-scoped ITSM entitlement and return effective ITSM role."""
    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    ).first()

    if access_row:
        if not access_row.has_itsm_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User does not have access to AuthClaw ITSM.",
            )
        role = str(access_row.itsm_role or "REQUESTER").upper()
    else:
        role = "REQUESTER"

    if role not in ALLOWED_ITSM_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized role for ITSM attachments operations",
        )
    return role


def _resolve_mime_type(filename: str, incoming_mime: str | None) -> str:
    if incoming_mime and incoming_mime != "application/octet-stream":
        return incoming_mime
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


@router.post(
    "/incidents/{incident_id}/attachments",
    response_model=AttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload attachment for an incident",
    description="Uploads a binary file attachment associated with a specific incident ticket.",
)
async def upload_incident_attachment(
    incident_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _verify_itsm_user(db, t_id, actor_id)

    incident = IncidentService.get_incident(db, t_id, incident_id)

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found.",
        )

    filename = file.filename or "attachment.bin"
    ext = Path(filename).suffix.lower()
    if not ext or ext not in LocalStorageEngine.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not supported. Allowed formats: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT.",
        )

    content = await file.read()
    if not content or len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(content) > LocalStorageEngine.MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds maximum allowed limit of 10 MB.",
        )

    content_type = _resolve_mime_type(filename, file.content_type)

    attachment = ITSMAttachmentService.save_attachment(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        target_type="TICKET",
        target_id=incident.id,
        file_name=filename,
        mime_type=content_type,
        content=content,
    )

    # Append activity to timeline
    try:
        from app.schemas.itsm_incidents import IncidentActivityCreateRequest
        IncidentService.add_activity(
            db=db,
            tenant_id=t_id,
            incident_id=incident.id,
            actor_id=actor_id,
            payload=IncidentActivityCreateRequest(
                activity_type="COMMENT",
                message=f"Attached file: {attachment.file_name} ({(attachment.file_size_bytes / 1024):.1f} KB)",
                is_internal=False,
            ),
        )
    except Exception as exc:
        logger.warning(f"Could not append attachment activity note: {exc}")

    return attachment


@router.get(
    "/incidents/{incident_id}/attachments",
    response_model=list[AttachmentResponse],
    summary="List attachments for an incident",
    description="Retrieves metadata for all attachments linked to an incident.",
)
def list_incident_attachments(
    incident_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _verify_itsm_user(db, t_id, actor_id)

    incident = IncidentService.get_incident(db, t_id, incident_id)

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found.",
        )

    return ITSMAttachmentService.list_attachments_for_target(
        db=db,
        tenant_id=t_id,
        target_type="TICKET",
        target_id=incident.id,
    )


@router.post(
    "/requests/{request_id}/attachments",
    response_model=AttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload attachment for a service request",
    description="Uploads a binary file attachment associated with a specific service request ticket.",
)
async def upload_request_attachment(
    request_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _verify_itsm_user(db, t_id, actor_id)

    ticket = (
        db.query(ITSMTicket)
        .filter(
            ITSMTicket.id == request_id,
            ITSMTicket.tenant_id == t_id,
        )
        .first()
    )
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service request not found.",
        )

    if role == "REQUESTER" and str(ticket.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service request not found.",
        )

    filename = file.filename or "attachment.bin"
    ext = Path(filename).suffix.lower()
    if not ext or ext not in LocalStorageEngine.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not supported. Allowed formats: PNG, JPG, JPEG, WEBP, PDF, DOCX, XLSX, TXT.",
        )

    content = await file.read()
    if not content or len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(content) > LocalStorageEngine.MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds maximum allowed limit of 10 MB.",
        )

    content_type = _resolve_mime_type(filename, file.content_type)

    return ITSMAttachmentService.save_attachment(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        target_type="TICKET",
        target_id=ticket.id,
        file_name=filename,
        mime_type=content_type,
        content=content,
    )


@router.get(
    "/requests/{request_id}/attachments",
    response_model=list[AttachmentResponse],
    summary="List attachments for a service request",
    description="Retrieves metadata for all attachments linked to a service request.",
)
def list_request_attachments(
    request_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _verify_itsm_user(db, t_id, actor_id)

    ticket = (
        db.query(ITSMTicket)
        .filter(
            ITSMTicket.id == request_id,
            ITSMTicket.tenant_id == t_id,
        )
        .first()
    )
    if not ticket:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service request not found.",
        )

    if role == "REQUESTER" and str(ticket.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service request not found.",
        )

    return ITSMAttachmentService.list_attachments_for_target(
        db=db,
        tenant_id=t_id,
        target_type="TICKET",
        target_id=ticket.id,
    )


@router.get(
    "/attachments/{attachment_id}/download",
    summary="Download or preview attachment content",
    description="Downloads or previews binary content for an attachment with tenant and owner isolation.",
)
def download_attachment(
    attachment_id: UUID,
    request: Request,
    preview: bool = Query(default=False, description="Preview mode with inline content disposition"),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _verify_itsm_user(db, t_id, actor_id)

    attachment, file_path = ITSMAttachmentService.get_attachment(db, t_id, attachment_id)

    if role == "REQUESTER" and attachment.target_type == "TICKET":
        ticket = (
            db.query(ITSMTicket)
            .filter(
                ITSMTicket.id == attachment.target_id,
                ITSMTicket.tenant_id == t_id,
            )
            .first()
        )
        if not ticket or str(ticket.requester_id) != str(actor_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found.",
            )

    disposition_type = "inline" if preview else "attachment"
    return FileResponse(
        path=file_path,
        filename=attachment.file_name,
        media_type=attachment.mime_type,
        content_disposition_type=disposition_type,
    )
