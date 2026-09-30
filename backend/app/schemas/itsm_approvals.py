"""Pydantic schemas for ITSM Approvals."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ITSMApprovalActionRequest(BaseModel):
    """Payload for approving or rejecting a pending request."""
    reason: Optional[str] = Field(default=None, description="Optional explanation or resolution reason")


class ITSMApprovalResponse(BaseModel):
    """Unified response representation for ITSM approvals."""
    id: UUID
    tenant_id: UUID
    ticket_id: Optional[UUID] = None
    ticket_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: str  # PENDING, APPROVED, REJECTED, EXPIRED
    ticket_status: Optional[str] = None
    action_type: str = "service_request_approval"
    action_description: Optional[str] = None
    catalog_item_name: Optional[str] = None
    service_name: Optional[str] = None
    quantity: Optional[int] = 1
    priority: Optional[str] = "P3"
    urgency: Optional[str] = "MEDIUM"
    impact: Optional[str] = "MEDIUM"
    requester_id: UUID
    requester_email: Optional[str] = None
    approver_id: Optional[UUID] = None
    approver_email: Optional[str] = None
    form_data: dict[str, Any] = Field(default_factory=dict)
    resolution_reason: Optional[str] = None
    expires_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
