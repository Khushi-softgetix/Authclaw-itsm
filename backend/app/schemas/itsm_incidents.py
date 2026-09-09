"""Pydantic schemas for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


VALID_IMPACTS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_URGENCIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_PRIORITIES = {"P1", "P2", "P3", "P4", "P1_CRITICAL", "P2_HIGH", "P3_MEDIUM", "P4_LOW"}
VALID_STATUSES = {"NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"}


class IncidentCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=512, description="Short incident summary")
    description: str = Field(..., min_length=1, description="Full description of the degradation or outage")
    impact: str = Field(default="MEDIUM", description="LOW, MEDIUM, HIGH, CRITICAL")
    urgency: str = Field(default="MEDIUM", description="LOW, MEDIUM, HIGH, CRITICAL")
    priority: Optional[str] = Field(default=None, description="P1, P2, P3, P4 (auto-derived if omitted)")
    service_id: Optional[UUID] = Field(default=None, description="Affected service ID")
    category_id: Optional[UUID] = Field(default=None, description="Category hierarchy ID")
    category: str = Field(default="GENERAL", max_length=100, description="Top-level category code or label")
    subcategory: Optional[str] = Field(default=None, max_length=100, description="Subcategory code or label")
    assignee_id: Optional[UUID] = Field(default=None, description="Assigned user ID")
    assignment_group: Optional[str] = Field(default=None, max_length=100, description="Assigned team/rotation")
    is_major_incident: bool = Field(default=False, description="Whether this is flagged as a major incident")
    source_channel: str = Field(default="PORTAL", max_length=50, description="PORTAL, API, EMAIL, AGENT, PHONE")

    model_config = ConfigDict(extra="forbid")


class IncidentUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=512)
    description: Optional[str] = Field(default=None, min_length=1)
    impact: Optional[str] = None
    urgency: Optional[str] = None
    priority: Optional[str] = None
    service_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    category: Optional[str] = Field(default=None, max_length=100)
    subcategory: Optional[str] = Field(default=None, max_length=100)
    assignee_id: Optional[UUID] = None
    assignment_group: Optional[str] = Field(default=None, max_length=100)
    is_major_incident: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class IncidentStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="Target lifecycle state")
    status_reason: Optional[str] = Field(default=None, description="Reason required for PENDING or CANCELLED")
    resolution_code: Optional[str] = Field(default=None, max_length=50, description="Required for RESOLVED")
    resolution_summary: Optional[str] = Field(default=None, description="Required for RESOLVED")

    model_config = ConfigDict(extra="forbid")


class IncidentAssignRequest(BaseModel):
    assignee_id: Optional[UUID] = Field(default=None, description="Target assignee user ID (must be in tenant)")
    assignment_group: Optional[str] = Field(default=None, max_length=100, description="Assigned operational group")

    model_config = ConfigDict(extra="forbid")


class IncidentActivityCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, description="Comment or activity details")
    activity_type: str = Field(default="COMMENT", max_length=50, description="COMMENT, NOTE, WORKAROUND")
    is_internal: bool = Field(default=False, description="Internal note visible only to operators/agents")

    model_config = ConfigDict(extra="forbid")


class IncidentActivityResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    ticket_id: UUID
    actor_type: str
    actor_id: Optional[UUID] = None
    activity_type: str
    content: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="activity_metadata")
    old_value: Optional[dict[str, Any]] = None
    new_value: Optional[dict[str, Any]] = None
    is_internal: bool = False
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def extract_metadata_fields(cls, data: Any) -> Any:
        if hasattr(data, "activity_metadata"):
            meta = data.activity_metadata or {}
            return {
                "id": data.id,
                "tenant_id": data.tenant_id,
                "ticket_id": data.ticket_id,
                "actor_type": data.actor_type,
                "actor_id": data.actor_id,
                "activity_type": data.activity_type,
                "content": data.content,
                "metadata": meta,
                "old_value": meta.get("old_value"),
                "new_value": meta.get("new_value"),
                "is_internal": bool(meta.get("is_internal", False)),
                "created_at": data.created_at,
            }
        return data

    model_config = ConfigDict(from_attributes=True)


class IncidentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    ticket_number: str
    ticket_type: str
    title: str
    description: str
    impact: str
    urgency: str
    priority: str
    status: str
    status_reason: Optional[str] = None
    source_channel: str
    requester_id: UUID
    assignee_id: Optional[UUID] = None
    assignment_group: Optional[str] = None
    service_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    category: str
    subcategory: Optional[str] = None
    is_major_incident: bool
    sla_policy_id: Optional[UUID] = None
    sla_response_due_at: Optional[datetime] = None
    sla_response_met_at: Optional[datetime] = None
    sla_resolution_due_at: Optional[datetime] = None
    sla_resolution_met_at: Optional[datetime] = None
    sla_status: str
    resolution_code: Optional[str] = None
    resolution_summary: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
