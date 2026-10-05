"""Pydantic schemas for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional
from uuid import UUID, uuid4
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


VALID_IMPACTS = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_URGENCIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
VALID_PRIORITIES = {"P1", "P2", "P3", "P4", "P1_CRITICAL", "P2_HIGH", "P3_MEDIUM", "P4_LOW"}
VALID_STATUSES = {"NEW", "ASSIGNED", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED", "CANCELLED"}


class IncidentCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=512, description="Short incident summary")
    description: str = Field(..., min_length=1, description="Full description of the degradation or outage")
    impact: str = Field(default="MEDIUM", description="LOW, MEDIUM, HIGH, CRITICAL")
    urgency: Optional[str] = Field(default=None, description="LOW, MEDIUM, HIGH, CRITICAL")
    priority: Optional[str] = Field(default=None, description="P1, P2, P3, P4 (auto-derived if omitted)")
    priority_override_reason: Optional[str] = Field(default=None, max_length=1000)
    service_id: Optional[UUID] = Field(default=None, description="Affected service ID")
    configuration_item_id: Optional[UUID] = Field(default=None, description="Affected configuration item ID")
    category_id: Optional[UUID] = Field(default=None, description="Category hierarchy ID")
    category: str = Field(default="GENERAL", max_length=100, description="Top-level category code or label")
    subcategory: Optional[str] = Field(default=None, max_length=100, description="Subcategory code or label")
    assignee_id: Optional[UUID] = Field(default=None, description="Assigned user ID")
    assignment_group: Optional[str] = Field(default=None, max_length=100, description="Assigned team/rotation")
    is_major_incident: bool = Field(default=False, description="Whether this is flagged as a major incident")
    source_channel: str = Field(default="PORTAL", max_length=50, description="PORTAL, API, EMAIL, AGENT, PHONE")

    @field_validator("impact", "urgency")
    @classmethod
    def validate_classification(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in VALID_IMPACTS:
            raise ValueError("Must be LOW, MEDIUM, HIGH, or CRITICAL")
        return value

    model_config = ConfigDict(extra="forbid")


class IncidentUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=512)
    description: Optional[str] = Field(default=None, min_length=1)
    impact: Optional[str] = None
    urgency: Optional[str] = None
    priority: Optional[str] = None
    priority_override_reason: Optional[str] = Field(default=None, max_length=1000)
    service_id: Optional[UUID] = None
    configuration_item_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    category: Optional[str] = Field(default=None, max_length=100)
    subcategory: Optional[str] = Field(default=None, max_length=100)
    assignee_id: Optional[UUID] = None
    assignment_group: Optional[str] = Field(default=None, max_length=100)
    is_major_incident: Optional[bool] = None

    @field_validator("impact", "urgency")
    @classmethod
    def validate_classification(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return IncidentCreateRequest.validate_classification(value)

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


class MajorIncidentRestorationCheckpoint(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    title: str = Field(..., min_length=1, max_length=255)
    owner_id: Optional[UUID] = None
    target_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    note: Optional[str] = Field(default=None, max_length=2000)
    model_config = ConfigDict(extra="forbid")


class MajorIncidentDecision(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    summary: str = Field(..., min_length=1, max_length=2000)
    owner_id: Optional[UUID] = None
    context: Optional[str] = Field(default=None, max_length=2000)
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    model_config = ConfigDict(extra="forbid")


class MajorIncidentTask(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    title: str = Field(..., min_length=1, max_length=255)
    owner_id: Optional[UUID] = None
    due_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    note: Optional[str] = Field(default=None, max_length=2000)
    model_config = ConfigDict(extra="forbid")


class MajorIncidentStakeholder(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(..., min_length=1, max_length=255)
    role: Optional[str] = Field(default=None, max_length=255)
    contact: Optional[str] = Field(default=None, max_length=512)
    model_config = ConfigDict(extra="forbid")


class MajorIncidentCommunication(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    audience: str = Field(..., min_length=1, max_length=255)
    channel: str = Field(..., min_length=1, max_length=255)
    message: str = Field(..., min_length=1, max_length=4000)
    approver_id: Optional[UUID] = None
    status: Literal["DRAFT", "APPROVED", "COMMUNICATED"] = "DRAFT"
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    model_config = ConfigDict(extra="forbid")


class MajorIncidentParticipantResponse(BaseModel):
    id: UUID
    email: str


class IncidentReferenceItem(BaseModel):
    id: UUID
    name: str
    code: Optional[str] = None
    parent_id: Optional[UUID] = None
    service_id: Optional[UUID] = None
    status: Optional[str] = None


class IncidentTeamReferenceItem(IncidentReferenceItem):
    member_ids: list[UUID] = Field(default_factory=list)


class IncidentOperationsReferenceDataResponse(BaseModel):
    users: list[MajorIncidentParticipantResponse]
    commanders: list[MajorIncidentParticipantResponse] = Field(default_factory=list)
    teams: list[IncidentTeamReferenceItem]
    services: list[IncidentReferenceItem]
    configuration_items: list[IncidentReferenceItem]
    categories: list[IncidentReferenceItem]


class MajorIncidentDeclareRequest(BaseModel):
    incident_commander_id: Optional[UUID] = None
    communication_lead_id: Optional[UUID] = None
    bridge_url: Optional[str] = Field(default=None, max_length=1024)
    communication_channel: Optional[str] = Field(default=None, max_length=255)
    impacted_business_units: list[str] = Field(default_factory=list)
    affected_service_ids: list[UUID] = Field(default_factory=list, max_length=100)
    affected_configuration_item_ids: list[UUID] = Field(default_factory=list, max_length=100)
    customer_impact_description: Optional[str] = None
    executive_summary: Optional[str] = None
    restoration_checkpoints: list[MajorIncidentRestorationCheckpoint] = Field(default_factory=list, max_length=100)
    command_decisions: list[MajorIncidentDecision] = Field(default_factory=list, max_length=100)
    command_tasks: list[MajorIncidentTask] = Field(default_factory=list, max_length=100)
    stakeholders: list[MajorIncidentStakeholder] = Field(default_factory=list, max_length=100)
    command_communications: list[MajorIncidentCommunication] = Field(default_factory=list, max_length=100)
    model_config = ConfigDict(extra="forbid")


class MajorIncidentUpdateRequest(MajorIncidentDeclareRequest):
    postmortem_status: Optional[Literal["PENDING", "IN_PROGRESS", "COMPLETE"]] = None
    postmortem_url: Optional[str] = Field(default=None, max_length=1024)


class MajorIncidentResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    ticket_id: UUID
    incident_commander_id: Optional[UUID] = None
    communication_lead_id: Optional[UUID] = None
    bridge_url: Optional[str] = None
    communication_channel: Optional[str] = None
    declared_at: datetime
    declared_by_id: UUID
    postmortem_status: str
    postmortem_url: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    executive_summary: Optional[str] = None
    impacted_business_units: list[str] = Field(default_factory=list)
    affected_service_ids: list[UUID] = Field(default_factory=list)
    affected_configuration_item_ids: list[UUID] = Field(default_factory=list)
    customer_impact_description: Optional[str] = None
    restoration_checkpoints: list[MajorIncidentRestorationCheckpoint] = Field(default_factory=list)
    command_decisions: list[MajorIncidentDecision] = Field(default_factory=list)
    command_tasks: list[MajorIncidentTask] = Field(default_factory=list)
    stakeholders: list[MajorIncidentStakeholder] = Field(default_factory=list)
    command_communications: list[MajorIncidentCommunication] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MajorIncidentPageRecipient(BaseModel):
    id: UUID
    name: Optional[str] = None
    email: str


MajorIncidentPageSelectionSource = Literal["ACTIVE_ON_CALL_SCHEDULE", "INCIDENT_ASSIGNEE_FALLBACK"]


class MajorIncidentPagePreviewResponse(BaseModel):
    incident_id: UUID
    target_kind: Literal["ON_CALL_ENGINEER", "RESPONSE_TEAM", "ASSIGNEE"]
    target_label: str
    selection_source: MajorIncidentPageSelectionSource
    source_label: str
    verified_on_call: bool
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    assignment_group: Optional[str] = None
    team_name: Optional[str] = None
    schedule_id: Optional[UUID] = None
    schedule_name: Optional[str] = None
    on_call_until: Optional[datetime] = None
    warning: Optional[str] = None
    recipients: list[MajorIncidentPageRecipient]
    resolved_at: datetime


class MajorIncidentPageRequest(BaseModel):
    confirmed_recipient_ids: list[UUID] = Field(..., min_length=1)
    confirmed_selection_source: MajorIncidentPageSelectionSource
    preview_resolved_at: datetime

    model_config = ConfigDict(extra="forbid")


class MajorIncidentPageResponse(MajorIncidentPagePreviewResponse):
    delivery_channel: Literal["IN_APP"] = "IN_APP"
    delivery_status: Literal["IN_APP_CREATED"] = "IN_APP_CREATED"
    notification_count: int
    command_path: str
    paged_at: datetime
    incident_reference: str
    correlation_reference: UUID


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
    actor_name: Optional[str] = None
    actor_email: Optional[str] = None
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
            actor_email = meta.get("actor_email")
            actor_name = meta.get("actor_name")
            if not actor_email and hasattr(data, "actor") and data.actor:
                actor_email = getattr(data.actor, "email", None)
            if not actor_name:
                actor_name = actor_email
            return {
                "id": data.id,
                "tenant_id": data.tenant_id,
                "ticket_id": data.ticket_id,
                "actor_type": data.actor_type,
                "actor_id": data.actor_id,
                "actor_name": actor_name,
                "actor_email": actor_email,
                "activity_type": data.activity_type,
                "content": data.content,
                "metadata": meta,
                "old_value": meta.get("old_value"),
                "new_value": meta.get("new_value"),
                "is_internal": bool(meta.get("is_internal", False)),
                "created_at": data.created_at,
            }
        elif isinstance(data, dict):
            meta = data.get("activity_metadata") or data.get("metadata") or {}
            data_copy = dict(data)
            data_copy.setdefault("actor_email", meta.get("actor_email"))
            data_copy.setdefault("actor_name", meta.get("actor_name") or meta.get("actor_email"))
            data_copy.setdefault("old_value", meta.get("old_value"))
            data_copy.setdefault("new_value", meta.get("new_value"))
            data_copy.setdefault("is_internal", bool(meta.get("is_internal", False)))
            return data_copy
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
    assignee_email: Optional[str] = None
    assignment_group: Optional[str] = None
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    configuration_item_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    category: str
    subcategory: Optional[str] = None
    is_major_incident: bool
    linked_problem_id: Optional[UUID] = None
    linked_problem_ticket_number: Optional[str] = None
    sla_policy_id: Optional[UUID] = None
    sla_response_due_at: Optional[datetime] = None
    sla_response_met_at: Optional[datetime] = None
    sla_resolution_due_at: Optional[datetime] = None
    sla_resolution_met_at: Optional[datetime] = None
    sla_status: str
    sla_paused_at: Optional[datetime] = None
    sla_accumulated_pause_seconds: int = 0
    resolution_code: Optional[str] = None
    resolution_summary: Optional[str] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class IncidentSummaryStatsResponse(BaseModel):
    open_tickets_count: int
    resolved_tickets_count: int
    pending_action_count: int
    avg_resolution_hours: float

    model_config = ConfigDict(from_attributes=True)


class IncidentOperationsSLA(BaseModel):
    status: Literal["NO_SLA", "WITHIN_SLA", "AT_RISK", "BREACHED"]
    remaining_seconds: Optional[float] = None


class IncidentOperationsItem(BaseModel):
    incident_id: UUID
    ticket_number: str
    title: str
    priority: str
    status: str
    assignment_group: Optional[str] = None
    assignee_id: Optional[UUID] = None
    assignee_email: Optional[str] = None
    last_activity_at: Optional[datetime] = None
    idle_seconds: Optional[float] = None
    sla: IncidentOperationsSLA
    attention_reasons: list[Literal["HIGH_PRIORITY", "SLA_AT_RISK", "SLA_BREACHED", "STUCK_IDLE"]]
    watch: Literal["REQUIRES_ATTENTION", "NONE"]


class IncidentWorkloadEntry(BaseModel):
    key: str
    label: str
    open_incidents: int
    p1_p2: int
    sla_at_risk: int
    sla_breached: int
    stuck: int


class IncidentOperationsWorkload(BaseModel):
    by_assignment_group: dict[str, int]
    by_assignee: dict[str, int]
    assignment_groups: list[IncidentWorkloadEntry]
    assignees: list[IncidentWorkloadEntry]


class IncidentOperationsDashboardResponse(BaseModel):
    summary: dict[str, int]
    priority_watch: list[IncidentOperationsItem]
    sla_at_risk: list[IncidentOperationsItem]
    sla_breached: list[IncidentOperationsItem]
    stuck: list[IncidentOperationsItem]
    escalation_watch: list[IncidentOperationsItem]
    workload: IncidentOperationsWorkload
    policy: dict[str, Any]


class IncidentOperationsQueueItem(BaseModel):
    incident: IncidentResponse
    operations: Optional[IncidentOperationsItem] = None


class IncidentOperationsQueueResponse(BaseModel):
    items: list[IncidentOperationsQueueItem]
    total: int
    offset: int
    limit: int


class IncidentSavedViewFilters(BaseModel):
    search: Optional[str] = Field(default=None, max_length=512)
    status: Optional[str] = None
    priority: Optional[str] = None
    attention: Optional[Literal["WATCH", "PRIORITY", "SLA_AT_RISK", "SLA_BREACHED", "STUCK"]] = None
    assignment_group: Optional[str] = Field(default=None, max_length=255)
    assignee_id: Optional[UUID] = None
    service_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    unassigned: bool = False
    sort_by: Literal["created", "priority", "sla_due", "updated"] = "created"
    model_config = ConfigDict(extra="forbid")


class IncidentSavedViewCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    filters: IncidentSavedViewFilters
    model_config = ConfigDict(extra="forbid")


class IncidentSavedViewResponse(BaseModel):
    id: UUID
    name: str
    filters: IncidentSavedViewFilters
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
