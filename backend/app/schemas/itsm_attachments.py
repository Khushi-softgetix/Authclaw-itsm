"""Pydantic schemas for ITSM Attachment Management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AttachmentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    target_type: str
    target_id: UUID
    file_name: str
    file_size_bytes: int
    mime_type: str
    storage_backend: str
    checksum_sha256: str
    is_quarantined: bool = False
    quarantine_reason: Optional[str] = None
    uploaded_by_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
