"""Pydantic schemas for ITSM Productivity Macros and Response Templates (WKS-003)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MacroBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Human-readable macro title")
    slug: Optional[str] = Field(None, max_length=100, description="Unique slug for macro")
    description: Optional[str] = Field(None, description="Detailed description of what the macro does")
    applicable_ticket_type: str = Field(
        default="ALL",
        description="Ticket types this macro can be applied to: 'INCIDENT', 'SERVICE_REQUEST', or 'ALL'",
    )
    response_template: str = Field(..., min_length=1, description="Predefined response/comment template text")
    status_change: Optional[str] = Field(
        None,
        description="Target ticket lifecycle status to transition to (e.g. 'PENDING', 'IN_PROGRESS', 'RESOLVED')",
    )
    status_reason: Optional[str] = Field(
        None,
        max_length=255,
        description="Reason for status change (e.g. 'Pending Requester', 'Awaiting User Verification')",
    )
    priority_change: Optional[str] = Field(
        None,
        description="Optional priority update if supported (e.g. 'P1', 'P2', 'P3', 'P4')",
    )
    follow_up_hours: Optional[int] = Field(
        None,
        ge=1,
        le=720,
        description="Follow-up reminder delay in hours (e.g. 24 for 24h follow-up)",
    )
    is_active: bool = Field(default=True, description="Whether this macro is currently active and selectable")


class MacroCreateRequest(MacroBase):
    pass


class MacroUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    applicable_ticket_type: Optional[str] = None
    response_template: Optional[str] = Field(None, min_length=1)
    status_change: Optional[str] = None
    status_reason: Optional[str] = None
    priority_change: Optional[str] = None
    follow_up_hours: Optional[int] = Field(None, ge=1, le=720)
    is_active: Optional[bool] = None


class MacroResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    applicable_ticket_type: str
    response_template: str
    status_change: Optional[str] = None
    status_reason: Optional[str] = None
    priority_change: Optional[str] = None
    follow_up_hours: Optional[int] = None
    is_active: bool
    current_published_version: Optional[int] = 1
    created_at: datetime
    updated_at: datetime


class MacroApplyRequest(BaseModel):
    ticket_id: UUID = Field(..., description="ID of the ticket to apply the macro to")
    ticket_type: str = Field(
        default="INCIDENT",
        description="Type of the ticket: 'INCIDENT' or 'SERVICE_REQUEST'",
    )


class MacroApplyResponse(BaseModel):
    macro_id: UUID
    macro_name: str
    response_template: str
    status_changed: bool
    new_status: Optional[str] = None
    reminder_created: bool
    follow_up_hours: Optional[int] = None
    message: str
