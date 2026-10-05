"""Schemas for the standalone Outage & Alerts workspace.

Audience, approval, and provider-specific delivery configuration are purposely
not modeled as client-selectable values here.  Those remain product-policy
decisions and publishing reports readiness instead of fabricating delivery.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


AlertStatus = Literal["DRAFT", "ACTIVE", "RECOVERED"]
PublicationType = Literal["INITIAL", "UPDATE", "RECOVERY"]
LinkTargetType = Literal["INCIDENT", "MAJOR_INCIDENT"]


class OutageAlertCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    draft_message: str = Field(..., min_length=1, max_length=12000)
    affected_service_ids: list[UUID] = Field(default_factory=list, max_length=100)

    model_config = ConfigDict(extra="forbid")


class OutageAlertDraftUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    draft_message: str | None = Field(default=None, min_length=1, max_length=12000)
    affected_service_ids: list[UUID] | None = Field(default=None, max_length=100)

    model_config = ConfigDict(extra="forbid")


class OutageAlertPublicationRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=12000)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=255)

    model_config = ConfigDict(extra="forbid")


class OutageAlertLinkRequest(BaseModel):
    target_type: LinkTargetType
    target_id: UUID

    model_config = ConfigDict(extra="forbid")


class OutageAlertServiceResponse(BaseModel):
    id: UUID
    name: str
    slug: str

    model_config = ConfigDict(from_attributes=True)


class OutageAlertPublicationResponse(BaseModel):
    id: UUID
    sequence_number: int
    publication_type: PublicationType
    message: str
    audience_policy_ref: str | None = None
    published_by_id: UUID
    correlation_id: UUID
    published_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OutageAlertStateHistoryResponse(BaseModel):
    id: UUID
    from_state: str | None = None
    to_state: str
    action: str
    actor_id: UUID | None = None
    correlation_id: UUID
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="event_metadata")
    occurred_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OutageAlertLinkResponse(BaseModel):
    id: UUID
    incident_id: UUID | None = None
    major_incident_id: UUID | None = None
    linked_by_id: UUID
    correlation_id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OutageAlertDeliveryAttemptResponse(BaseModel):
    id: UUID
    attempt_number: int
    status: str
    provider_reference: str | None = None
    error_detail: str | None = None
    correlation_id: UUID
    attempted_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OutageAlertDeliveryResponse(BaseModel):
    id: UUID
    publication_id: UUID
    channel_ref: str | None = None
    status: str
    idempotency_key: str
    correlation_id: UUID
    created_at: datetime
    updated_at: datetime
    attempts: list[OutageAlertDeliveryAttemptResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class OutageAlertReadinessResponse(BaseModel):
    ready: bool
    publication_policy: str
    delivery: str
    detail: str


class OutageAlertSummaryResponse(BaseModel):
    id: UUID
    title: str
    status: AlertStatus
    affected_services: list[OutageAlertServiceResponse] = Field(default_factory=list)
    latest_publication: OutageAlertPublicationResponse | None = None
    activated_at: datetime | None = None
    recovered_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class OutageAlertManagerResponse(OutageAlertSummaryResponse):
    draft_message: str
    audience_policy_ref: str | None = None
    created_by_id: UUID
    readiness: OutageAlertReadinessResponse
    links: list[OutageAlertLinkResponse] = Field(default_factory=list)
    publications: list[OutageAlertPublicationResponse] = Field(default_factory=list)
    state_history: list[OutageAlertStateHistoryResponse] = Field(default_factory=list)
    deliveries: list[OutageAlertDeliveryResponse] = Field(default_factory=list)


class OutageAlertAuditorResponse(OutageAlertManagerResponse):
    """Full read-only evidence projection for the Auditor role."""


class OutageAlertListResponse(BaseModel):
    # Keep the richer projection first. Pydantic otherwise accepts the summary
    # shape first and silently drops manager/auditor evidence fields.
    items: list[OutageAlertManagerResponse | OutageAlertAuditorResponse | OutageAlertSummaryResponse]
    visibility_note: str | None = None


class OutageAlertLinkableIncidentResponse(BaseModel):
    id: UUID
    ticket_number: str
    title: str
    status: str


class OutageAlertLinkableMajorIncidentResponse(BaseModel):
    id: UUID
    ticket_id: UUID
    ticket_number: str
    title: str
    declared_at: datetime


class OutageAlertLinkableRecordsResponse(BaseModel):
    incidents: list[OutageAlertLinkableIncidentResponse] = Field(default_factory=list)
    major_incidents: list[OutageAlertLinkableMajorIncidentResponse] = Field(default_factory=list)
