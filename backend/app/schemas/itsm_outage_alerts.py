"""Contracts for the standalone Outage & Alerts communication domain."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


AlertType = Literal["OUTAGE", "DEGRADATION", "MAINTENANCE", "INFORMATION"]
AlertSeverity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
AlertIntent = Literal["INFORM", "ACTION_REQUIRED", "INVESTIGATE", "RESOLVE"]
AlertPublicStatus = Literal["INVESTIGATING", "IDENTIFIED", "MONITORING", "RECOVERED"]
AgentHandling = Literal["ALERT_ONLY", "SOLVE"]
AudienceType = Literal[
    "SERVICE_USERS",
    "SERVICE_AGENTS",
    "PROBLEM_MANAGERS",
    "CHANGE_MANAGERS",
    "SELECTED_TEAM",
    "SERVICE_OWNERS",
    "SPECIFIC_USER",
]
LinkType = Literal["INCIDENT", "MAJOR_INCIDENT", "PROBLEM", "CHANGE"]


class AlertAudienceInput(BaseModel):
    audience_type: AudienceType
    team_id: UUID | None = None
    user_id: UUID | None = None

    @model_validator(mode="after")
    def validate_audience_scope(self):
        if self.audience_type == "SELECTED_TEAM" and self.team_id is None:
            raise ValueError("Selected team audience requires a team")
        if self.audience_type == "SPECIFIC_USER" and self.user_id is None:
            raise ValueError("Specific user audience requires a user")
        if self.audience_type != "SELECTED_TEAM" and self.team_id is not None:
            raise ValueError("team_id is only valid for selected team audiences")
        if self.audience_type != "SPECIFIC_USER" and self.user_id is not None:
            raise ValueError("user_id is only valid for specific user audiences")
        return self

    model_config = ConfigDict(extra="forbid")


class AlertLinkInput(BaseModel):
    target_type: LinkType
    target_id: UUID

    model_config = ConfigDict(extra="forbid")


class AlertDraftRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    alert_type: AlertType
    severity: AlertSeverity
    intent: AlertIntent
    public_summary: str = Field(min_length=1, max_length=5000)
    impact_summary: str = Field(min_length=1, max_length=5000)
    recommended_action: str | None = Field(default=None, max_length=5000)
    service_agent_guidance: str | None = Field(default=None, max_length=5000)
    internal_notes: str | None = Field(default=None, max_length=10000)
    service_agent_handling: AgentHandling = "ALERT_ONLY"
    service_ids: list[UUID] = Field(default_factory=list, max_length=50)
    ci_ids: list[UUID] = Field(default_factory=list, max_length=100)
    audiences: list[AlertAudienceInput] = Field(default_factory=list, max_length=50)
    links: list[AlertLinkInput] = Field(default_factory=list, max_length=50)
    outage_started_at: datetime | None = None
    next_update_at: datetime | None = None

    @model_validator(mode="after")
    def validate_handling(self):
        has_agents = any(a.audience_type == "SERVICE_AGENTS" for a in self.audiences)
        if self.service_agent_handling == "SOLVE" and not has_agents:
            raise ValueError("Solve requires the Service Agents audience")
        return self

    model_config = ConfigDict(extra="forbid")


class AlertPublicationRequest(BaseModel):
    preview_token: str = Field(min_length=32, max_length=128)
    idempotency_key: str = Field(min_length=8, max_length=255)
    public_summary: str | None = Field(default=None, min_length=1, max_length=5000)
    impact_summary: str | None = Field(default=None, min_length=1, max_length=5000)
    recommended_action: str | None = Field(default=None, max_length=5000)
    service_agent_guidance: str | None = Field(default=None, max_length=5000)
    internal_notes: str | None = Field(default=None, max_length=10000)
    severity: AlertSeverity | None = None
    public_status: AlertPublicStatus | None = None
    next_update_at: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class AlertPreviewRequest(BaseModel):
    publication_type: Literal["INITIAL", "UPDATE", "RECOVERY"] | None = None
    public_summary: str | None = Field(default=None, min_length=1, max_length=5000)
    impact_summary: str | None = Field(default=None, min_length=1, max_length=5000)
    recommended_action: str | None = Field(default=None, max_length=5000)
    service_agent_guidance: str | None = Field(default=None, max_length=5000)
    internal_notes: str | None = Field(default=None, max_length=10000)
    severity: AlertSeverity | None = None
    public_status: AlertPublicStatus | None = None
    next_update_at: datetime | None = None
    model_config = ConfigDict(extra="forbid")


class ServiceConsumerRequest(BaseModel):
    user_id: UUID
    is_active: bool = True
    model_config = ConfigDict(extra="forbid")


class ServiceSupportTeamRequest(BaseModel):
    team_id: UUID
    model_config = ConfigDict(extra="forbid")


class AlertSummary(BaseModel):
    id: UUID
    alert_number: str
    title: str | None = None
    alert_type: str | None = None
    severity: str | None = None
    intent: str | None = None
    status: str
    public_status: str | None = None
    affected_services: list[dict[str, Any]]
    updated_at: datetime
    published_at: datetime | None = None
    latest_publication_at: datetime | None = None
    recovered_at: datetime | None = None


class AlertEvidenceSummary(AlertSummary):
    created_by_id: UUID
    created_by_display: str | None = None
    created_at: datetime
    published_by_id: UUID | None = None
    published_by_display: str | None = None
    intended_audiences: list[str] = Field(default_factory=list)
    publication_count: int = 0
    recipient_count: int = 0
    delivery_summary: dict[str, int] = Field(default_factory=dict)
    broadcast_outcome: str
    audit_event_count: int = 0
    evidence_status: str


class AlertEvidencePage(BaseModel):
    items: list[AlertEvidenceSummary]
    total: int
    offset: int
    limit: int
    has_more: bool


class AlertDeliveryHealthSummary(AlertSummary):
    publication_count: int = 0
    recipient_count: int = 0
    delivery_summary: dict[str, int] = Field(default_factory=dict)
    channels: list[str] = Field(default_factory=list)
    failed_recipient_count: int = 0
    retrying_recipient_count: int = 0
    delivery_health_status: str = "HEALTHY"
    last_error: str | None = None


class AlertDeliveryHealthPage(BaseModel):
    items: list[AlertDeliveryHealthSummary]
    total: int
    metrics: dict[str, Any]
    channels: list[dict[str, Any]]
    offset: int
    limit: int
    has_more: bool


class AlertDetail(BaseModel):
    id: UUID
    alert_number: str
    status: str
    projection_type: str
    content: dict[str, Any]
    allowed_actions: list[str]
    affected_services: list[dict[str, Any]]
    links: list[dict[str, Any]]
    publications: list[dict[str, Any]]
    delivery_summary: dict[str, int] | None = None
    delivery_health: dict[str, Any] | None = None
    evidence: dict[str, Any] | None = None


class AlertPreview(BaseModel):
    alert_id: UUID
    preview_token: str
    total_recipients: int
    groups: list[dict[str, Any]]
    exclusions: list[dict[str, Any]]


class AlertReferenceData(BaseModel):
    services: list[dict[str, Any]]
    configuration_items: list[dict[str, Any]]
    teams: list[dict[str, Any]]
    related_records: list[dict[str, Any]]
    supported_channels: list[str] = ["IN_APP", "PORTAL"]
