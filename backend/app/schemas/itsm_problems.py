"""Pydantic schemas for ITSM Problem Management."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


from app.schemas.itsm_changes import ChangeSummaryResponse


class RelatedIncidentItem(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    status: str
    priority: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProblemDetailData(BaseModel):
    known_error: bool = False
    root_cause_summary: Optional[str] = None
    workaround_summary: Optional[str] = None
    permanent_solution: Optional[str] = None
    rca_document_url: Optional[str] = None
    assigned_investigator_id: Optional[UUID] = None
    identified_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ProblemSummaryResponse(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    description: str
    status: str
    priority: str
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    assignment_group: Optional[str] = None
    assignee_id: Optional[UUID] = None
    assignee_email: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    related_incidents_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProblemDetailResponse(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    description: str
    status: str
    priority: str
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    assignment_group: Optional[str] = None
    assignee_id: Optional[UUID] = None
    assignee_email: Optional[str] = None
    configuration_item_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    related_incidents_count: int = 0
    related_incidents: list[RelatedIncidentItem] = Field(default_factory=list)
    related_changes: list[ChangeSummaryResponse] = Field(default_factory=list)
    problem_details: Optional[ProblemDetailData] = None
    resolution_summary: Optional[str] = None
    resolution_code: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    closed_by_email: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class LinkChangeRequest(BaseModel):
    change_id: UUID

    model_config = ConfigDict(extra="forbid")


class UnlinkChangeRequest(BaseModel):
    change_id: UUID

    model_config = ConfigDict(extra="forbid")


class CreateChangeFromProblemRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    description: Optional[str] = None
    change_type: Optional[str] = "STANDARD"
    risk_level: Optional[str] = "LOW"
    impact_level: Optional[str] = "LOW"
    service_id: Optional[UUID] = None
    implementation_plan: Optional[str] = None
    backout_plan: Optional[str] = None
    test_plan: Optional[str] = None
    ci_ids: Optional[list[UUID]] = None

    model_config = ConfigDict(extra="forbid")


class ProblemStatsResponse(BaseModel):
    open: int = 0
    in_progress: int = 0
    resolved: int = 0
    total: int = 0


class ProblemInvestigationUpdateRequest(BaseModel):
    root_cause_summary: Optional[str] = None
    workaround_summary: Optional[str] = None
    known_error: Optional[bool] = None
    permanent_solution: Optional[str] = None
    rca_document_url: Optional[str] = None
    investigation_notes: Optional[str] = None
    status: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class ProblemResolveRequest(BaseModel):
    resolution_summary: str = Field(..., min_length=1, max_length=5000)
    resolution_notes: Optional[str] = None
    permanent_solution: Optional[str] = None
    workaround_summary: Optional[str] = None
    root_cause_summary: Optional[str] = None
    rca_document_url: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class ProblemCloseRequest(BaseModel):
    closure_notes: Optional[str] = None

    model_config = ConfigDict(extra="forbid")



class ProblemActivityResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    activity_type: str
    actor_id: Optional[UUID] = None
    actor_email: Optional[str] = None
    content: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReportRecurringProblemRequest(BaseModel):
    problem_short_description: str = Field(..., min_length=1, max_length=512, description="Short summary of recurring problem")
    recurring_reason: str = Field(..., min_length=1, description="Reason / Recurring Issue explanation")
    notes: Optional[str] = Field(default=None, description="Optional additional notes")

    model_config = ConfigDict(extra="forbid")


class ReportRecurringProblemResponse(BaseModel):
    problem_id: UUID
    problem_ticket_number: str
    already_reported: bool = False
    message: str

    model_config = ConfigDict(from_attributes=True)
