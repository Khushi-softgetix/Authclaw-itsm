"""Pydantic schemas for ITSM Platform Administrator portal."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

VALID_ITSM_ROLES = (
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "SERVICE_LEAD",  # Retained for internal / backwards compatibility
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
)


class ITSMUserItemResponse(BaseModel):
    """Schema for tenant user with ITSM access and role information."""
    id: UUID
    name: str
    email: str
    itsm_access: bool
    itsm_role: str
    governance_access: bool
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class ITSMUserAccessUpdateRequest(BaseModel):
    """Schema for updating ITSM access and role for a tenant user."""
    has_itsm_access: bool = Field(..., description="Whether ITSM product access is enabled")
    itsm_role: str = Field(..., description="ITSM role assignment")
    has_governance_access: Optional[bool] = Field(default=None, description="Optional toggle for Governance access")

    @field_validator("itsm_role")
    @classmethod
    def validate_itsm_role(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_ITSM_ROLES:
            raise ValueError(f"Invalid ITSM role '{normalized}'. Allowed: {', '.join(VALID_ITSM_ROLES)}")
        if normalized == "SERVICE_LEAD":
            return "INCIDENT_MANAGER"
        return normalized


# --- Teams Schemas ---
class ITSMTeamMemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class ITSMTeamResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    is_active: bool
    member_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMTeamDetailResponse(ITSMTeamResponse):
    members: List[ITSMTeamMemberResponse] = []


class ITSMTeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: bool = Field(default=True)


class ITSMTeamUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_active: Optional[bool] = Field(default=None)


class ITSMTeamMemberAddRequest(BaseModel):
    user_id: UUID = Field(..., description="ID of an existing AuthClaw user belonging to the tenant")


# --- Services Schemas ---
class ITSMServiceResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    tier: str
    status: str
    owner_user_id: Optional[UUID] = None
    escalation_team: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMServiceCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: Optional[str] = Field(default=None, min_length=2, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    tier: str = Field(default="TIER_2")
    status: str = Field(default="OPERATIONAL")
    escalation_team: Optional[str] = Field(default=None, max_length=100)


class ITSMServiceUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    tier: Optional[str] = Field(default=None)
    status: Optional[str] = Field(default=None)
    escalation_team: Optional[str] = Field(default=None, max_length=100)


# --- Configuration Items (CMDB) Schemas ---
class ITSMConfigurationItemResponse(BaseModel):
    id: UUID
    name: str
    ci_type: str
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    environment: str
    status: str
    external_resource_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMConfigurationItemCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    ci_type: str = Field(..., min_length=2, max_length=50)
    service_id: Optional[UUID] = Field(default=None)
    environment: str = Field(default="PRODUCTION")
    status: str = Field(default="ACTIVE")
    external_resource_id: Optional[str] = Field(default=None, max_length=512)


class ITSMConfigurationItemUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    ci_type: Optional[str] = Field(default=None, min_length=2, max_length=50)
    service_id: Optional[UUID] = Field(default=None)
    environment: Optional[str] = Field(default=None)
    status: Optional[str] = Field(default=None)
    external_resource_id: Optional[str] = Field(default=None, max_length=512)
