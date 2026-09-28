"""Domain and database service for ITSM File Attachments."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.storage import LocalStorageEngine
from app.db.models import ITSMAttachment, ITSMTicket

logger = logging.getLogger("authclaw.itsm.attachments")


class ITSMAttachmentService:
    @classmethod
    def save_attachment(
        cls,
        db: Session,
        tenant_id: UUID,
        actor_id: UUID,
        target_type: str,
        target_id: UUID,
        file_name: str,
        mime_type: str,
        content: bytes,
    ) -> ITSMAttachment:
        """Saves physical file to local disk and records metadata in database."""
        target_type_clean = target_type.strip().upper()

        if target_type_clean == "TICKET":
            ticket = db.query(ITSMTicket).filter(
                ITSMTicket.id == target_id,
                ITSMTicket.tenant_id == tenant_id,
            ).first()
            if not ticket:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Ticket '{target_id}' not found.",
                )

        storage_path, checksum_sha256, file_size_bytes = LocalStorageEngine.save_file(
            tenant_id=tenant_id,
            file_name=file_name,
            content=content,
        )

        attachment = ITSMAttachment(
            id=uuid4(),
            tenant_id=tenant_id,
            target_type=target_type_clean,
            target_id=target_id,
            file_name=file_name.strip() or "attachment.bin",
            file_size_bytes=file_size_bytes,
            mime_type=mime_type.strip() if mime_type else "application/octet-stream",
            storage_path=storage_path,
            storage_backend="LOCAL",
            checksum_sha256=checksum_sha256,
            is_quarantined=False,
            quarantine_reason=None,
            uploaded_by_id=actor_id,
            created_at=datetime.now(timezone.utc),
        )

        db.add(attachment)
        db.commit()
        db.refresh(attachment)
        return (
            db.query(ITSMAttachment)
            .options(joinedload(ITSMAttachment.uploaded_by))
            .filter(ITSMAttachment.id == attachment.id)
            .first()
            or attachment
        )

    @classmethod
    def list_attachments_for_target(
        cls,
        db: Session,
        tenant_id: UUID,
        target_type: str,
        target_id: UUID,
    ) -> list[ITSMAttachment]:
        return (
            db.query(ITSMAttachment)
            .options(joinedload(ITSMAttachment.uploaded_by))
            .filter(
                ITSMAttachment.tenant_id == tenant_id,
                ITSMAttachment.target_type == target_type.strip().upper(),
                ITSMAttachment.target_id == target_id,
            )
            .order_by(ITSMAttachment.created_at.asc())
            .all()
        )

    @classmethod
    def get_attachment(
        cls,
        db: Session,
        tenant_id: UUID,
        attachment_id: UUID,
    ) -> tuple[ITSMAttachment, Path]:
        attachment = (
            db.query(ITSMAttachment)
            .options(joinedload(ITSMAttachment.uploaded_by))
            .filter(
                ITSMAttachment.id == attachment_id,
                ITSMAttachment.tenant_id == tenant_id,
            )
            .first()
        )
        if not attachment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Attachment '{attachment_id}' not found.",
            )

        file_path = LocalStorageEngine.resolve_path(attachment.storage_path)
        return attachment, file_path
