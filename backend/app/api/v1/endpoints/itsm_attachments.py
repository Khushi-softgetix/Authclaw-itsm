"""API Router for ITSM File Attachments."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_attachments import AttachmentResponse
from app.services.itsm_attachment_service import ITSMAttachmentService
from app.services.itsm_incident_service import IncidentService

router = APIRouter()


def _get_itsm_role(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    try:
        row = db.execute(
            text("SELECT itsm_role FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row and row.itsm_role:
            return str(row.itsm_role).upper()
    except Exception:
        pass
    return "ADMIN"


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
    role = _get_itsm_role(db, t_id, actor_id)

    incident = IncidentService.get_incident(db, t_id, incident_id)

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found.",
        )

    content = await file.read()
    filename = file.filename or "attachment.bin"
    content_type = file.content_type or "application/octet-stream"

    return ITSMAttachmentService.save_attachment(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        target_type="TICKET",
        target_id=incident.id,
        file_name=filename,
        mime_type=content_type,
        content=content,
    )


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
    role = _get_itsm_role(db, t_id, actor_id)

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


@router.get(
    "/attachments/{attachment_id}/download",
    summary="Download attachment content",
    description="Downloads binary content for an attachment with tenant and owner isolation.",
)
def download_attachment(
    attachment_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    attachment, file_path = ITSMAttachmentService.get_attachment(db, t_id, attachment_id)

    if role == "REQUESTER" and attachment.target_type == "TICKET":
        incident = IncidentService.get_incident(db, t_id, attachment.target_id)
        if str(incident.requester_id) != str(actor_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found.",
            )

    return FileResponse(
        path=file_path,
        filename=attachment.file_name,
        media_type=attachment.mime_type,
    )
