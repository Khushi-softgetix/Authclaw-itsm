"""Pydantic schemas for ITSM Services and Service Catalog."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ITSMServiceCIData(BaseModel):
    """Configuration item reference linked to a service."""
    id: UUID
    name: str
    ci_type: str
    environment: str
    status: str
    attributes: dict = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ITSMServiceTicketSummary(BaseModel):
    """Brief ticket reference related to a service."""
    id: UUID
    ticket_number: str
    title: str
    priority: str
    status: str
    ticket_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ITSMServiceSummaryResponse(BaseModel):
    """Summary card representation of an ITSM service."""
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    tier: str
    status: str
    escalation_team: Optional[str] = None
    owner_user_id: Optional[UUID] = None
    owner_email: Optional[str] = None
    ci_count: int = 0
    active_ticket_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RequesterServiceCatalogItemResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    service_id: UUID
    service_name: str
    category_label: str
    name: str
    slug: str
    description: Optional[str] = None
    estimated_delivery_hours: int
    estimated_time_label: str
    approval_required: bool
    fulfillment_type: str
    fulfillment_group: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ITSMServiceDetailResponse(BaseModel):
    """Complete representation of an ITSM service with CIs and recent tickets."""
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    tier: str
    status: str
    escalation_team: Optional[str] = None
    owner_user_id: Optional[UUID] = None
    owner_email: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    configuration_items: List[ITSMServiceCIData] = Field(default_factory=list)
    recent_incidents: List[ITSMServiceTicketSummary] = Field(default_factory=list)
    recent_requests: List[ITSMServiceTicketSummary] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
