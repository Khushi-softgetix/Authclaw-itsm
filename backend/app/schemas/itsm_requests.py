"""Pydantic schemas for ITSM Service Requests (Step 6)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ServiceRequestDetailData(BaseModel):
    """Snapshot of catalog item intake schema and submitted user form data."""
    catalog_item_id: Optional[UUID] = None
    catalog_item_name: Optional[str] = None
    catalog_item_version: Optional[int] = None
    intake_schema_snapshot: dict[str, Any] = Field(default_factory=dict)
    submitted_form_data: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class ServiceRequestResponse(BaseModel):
    """Unified response representation for Service Request tickets."""
    id: UUID
    tenant_id: UUID
    ticket_number: str
    ticket_type: str = "SERVICE_REQUEST"
    title: str
    description: str
    impact: str = "MEDIUM"
    urgency: str = "MEDIUM"
    priority: str = "P3"
    status: str
    status_reason: Optional[str] = None
    source_channel: str = "PORTAL"
    requester_id: UUID
    requester_email: Optional[str] = None
    assignee_id: Optional[UUID] = None
    assignee_email: Optional[str] = None
    assignment_group: Optional[str] = None
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    category: str = "SERVICE_REQUEST"
    sla_status: str = "WITHIN_SLA"
    sla_response_due_at: Optional[datetime] = None
    sla_response_met_at: Optional[datetime] = None
    sla_resolution_due_at: Optional[datetime] = None
    sla_resolution_met_at: Optional[datetime] = None
    sla_paused_at: Optional[datetime] = None
    sla_accumulated_pause_seconds: int = 0
    sla_due_at: Optional[datetime] = None
    sla_started_at: Optional[datetime] = None
    sla_remaining_seconds: Optional[float] = None
    sla_warning_escalated_at: Optional[datetime] = None
    sla_breach_escalated_at: Optional[datetime] = None
    resolution_code: Optional[str] = None
    resolution_summary: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    request_detail: Optional[ServiceRequestDetailData] = None
    approval_required: bool = False
    approval_status: Optional[str] = None
    rejection_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ServiceRequestStatusUpdateRequest(BaseModel):
    """Payload for transitioning service request status."""
    status: str = Field(..., description="Target status: NEW, ASSIGNED, IN_PROGRESS, PENDING, RESOLVED, CLOSED, CANCELLED")
    status_reason: Optional[str] = Field(default=None, max_length=2000, description="Optional explanation or reason")
    resolution_code: Optional[str] = Field(default=None, max_length=50, description="Required or optional when resolving")
    resolution_summary: Optional[str] = Field(default=None, max_length=2000, description="Summary when resolving")

    model_config = ConfigDict(extra="forbid")


class ServiceRequestAssignRequest(BaseModel):
    """Payload for assigning a service request."""
    assignee_id: Optional[UUID] = Field(default=None, description="Target assignee user ID (must be in tenant)")
    assignment_group: Optional[str] = Field(default=None, max_length=100, description="Assigned operational group")

    model_config = ConfigDict(extra="forbid")


class ServiceRequestCreateRequest(BaseModel):
    """Payload for submitting a new service request from the service catalog."""
    catalog_item_id: Optional[UUID] = Field(default=None, description="Selected service catalog item ID")
    service_id: Optional[UUID] = Field(default=None, description="Associated service ID")
    title: Optional[str] = Field(default=None, max_length=512, description="Request title (defaults to catalog item name)")
    description: str = Field(..., min_length=1, description="Reason / business justification for request")
    quantity: int = Field(default=1, ge=1, le=100, description="Quantity of requested items")
    urgency: str = Field(default="MEDIUM", description="Urgency: LOW, MEDIUM, HIGH, CRITICAL")
    impact: str = Field(default="MEDIUM", description="Impact: LOW, MEDIUM, HIGH, CRITICAL")
    priority: Optional[str] = Field(default="P3", description="Priority level: P1, P2, P3, P4")
    form_data: dict[str, Any] = Field(default_factory=dict, description="Custom catalog intake form values")
    source_channel: str = Field(default="PORTAL", max_length=50, description="Intake source channel")

    model_config = ConfigDict(extra="ignore")

