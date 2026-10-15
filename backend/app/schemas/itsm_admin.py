"""Pydantic schemas for ITSM Platform Administrator portal."""
from __future__ import annotations

from datetime import datetime
import re
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

VALID_ITSM_ROLES = (
    "REQUESTER",
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "SERVICE_LEAD",  # Retained for internal / backwards compatibility
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "AUDITOR",
    "CATALOG_MANAGER",
    "CMDB_ADMIN",
)

# CMDB Audit Action Constants (supporting CI CRUD, bulk import, and preparing for CMDB-002 relationships)
CMDB_AUDIT_ACTION_CI_CREATED = "itsm.cmdb.ci_created"
CMDB_AUDIT_ACTION_CI_UPDATED = "itsm.cmdb.ci_updated"
CMDB_AUDIT_ACTION_BULK_IMPORT = "itsm.cmdb.bulk_import"
CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED = "itsm.cmdb.relationship_created"
CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED = "itsm.cmdb.relationship_deleted"


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
    invitation_status: Optional[str] = None
    invite_id: Optional[UUID] = None
    invite_expires_at: Optional[datetime] = None

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


# --- Configuration Item Typed Relationships Schemas (CMDB-002) ---
VALID_CI_RELATIONSHIP_TYPES = (
    "DEPENDS_ON",
    "RUNS_ON",
    "HOSTED_ON",
    "CONNECTS_TO",
    "OWNED_BY",
    "SUPPORTS",
    "PART_OF",
)


class ITSMRelatedCIDetails(BaseModel):
    """Summarized attributes of a related Configuration Item."""
    id: UUID
    name: str
    ci_type: str
    environment: str
    status: str
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None

    class Config:
        from_attributes = True


class ITSMConfigurationItemRelationshipResponse(BaseModel):
    """Schema for a typed CI relationship in the CMDB Service Graph."""
    id: UUID
    tenant_id: UUID
    parent_ci_id: UUID
    child_ci_id: UUID
    relationship_type: str
    source: str = "MANUAL"
    confidence: float = 1.0
    status: str = "ACTIVE"
    created_at: datetime
    updated_at: datetime
    direction: Optional[str] = None
    display_label: Optional[str] = None
    related_ci: Optional[ITSMRelatedCIDetails] = None

    class Config:
        from_attributes = True


class ITSMConfigurationItemRelationshipCreateRequest(BaseModel):
    """Schema for creating a typed relationship between two Configuration Items."""
    parent_ci_id: UUID = Field(..., description="Source/parent CI ID")
    child_ci_id: UUID = Field(..., description="Target/child CI ID")
    relationship_type: str = Field(default="DEPENDS_ON", description="One of: DEPENDS_ON, RUNS_ON, HOSTED_ON, CONNECTS_TO, OWNED_BY, SUPPORTS, PART_OF")
    source: Optional[str] = Field(default="MANUAL", max_length=100)
    confidence: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)

    @field_validator("relationship_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in VALID_CI_RELATIONSHIP_TYPES:
            raise ValueError(
                f"Invalid relationship type '{value}'. Supported types: {', '.join(VALID_CI_RELATIONSHIP_TYPES)}"
            )
        return normalized

    @model_validator(mode="after")
    def validate_no_self_link(self) -> "ITSMConfigurationItemRelationshipCreateRequest":
        if self.parent_ci_id == self.child_ci_id:
            raise ValueError("A Configuration Item cannot have a relationship with itself (self-link is prohibited)")
        return self


# --- Bulk Configuration Item (CI) Import Schemas (CMDB-005) ---
class CIBulkImportRowDiff(BaseModel):
    old: Any = None
    new: Any = None


class CIBulkImportRowResult(BaseModel):
    row_number: int
    action: str  # INSERT, UPDATE, CONFLICT, ERROR
    name: Optional[str] = None
    ci_type: Optional[str] = None
    environment: Optional[str] = None
    status: Optional[str] = None
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    external_resource_id: Optional[str] = None
    existing_ci_id: Optional[UUID] = None
    changes: Optional[dict[str, CIBulkImportRowDiff]] = None
    errors: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    raw_data: dict[str, Any] = Field(default_factory=dict)


class CIBulkImportDryRunRequest(BaseModel):
    source_filename: str = Field(..., max_length=255)
    source_type: str = Field(..., pattern="^(?i)(csv|json)$")
    field_mapping: Optional[dict[str, str]] = None
    raw_records: list[dict[str, Any]] = Field(..., min_length=1, max_length=1000)


class CIBulkImportDryRunResponse(BaseModel):
    source_filename: str
    source_type: str
    total_records: int
    valid_records: int
    invalid_records: int
    insert_count: int
    update_count: int
    conflict_count: int
    error_count: int
    rows: list[CIBulkImportRowResult]


class CIBulkImportCommitRequest(BaseModel):
    source_filename: str = Field(..., max_length=255)
    source_type: str = Field(..., pattern="^(?i)(csv|json)$")
    field_mapping: Optional[dict[str, str]] = None
    raw_records: list[dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    update_existing: bool = True


class CIBulkImportErrorQueueItem(BaseModel):
    row_number: int
    name: Optional[str] = None
    action: str
    errors: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    raw_data: dict[str, Any] = Field(default_factory=dict)


class CIBulkImportCommitResponse(BaseModel):
    batch_id: str
    source_filename: str
    total_records: int
    inserted_count: int
    updated_count: int
    skipped_count: int
    error_count: int
    error_queue: list[CIBulkImportErrorQueueItem] = Field(default_factory=list)


# --- Service Catalog Schemas ---
class ITSMServiceCatalogItemResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    service_id: UUID
    service_name: Optional[str] = None
    version: int = 1
    approval_required: bool = False
    fulfillment_group: Optional[str] = None
    estimated_delivery_hours: int = 24
    is_active: bool = True
    intake_schema: Optional[dict] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMServiceCatalogItemCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: Optional[str] = Field(default=None, min_length=2, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    service_id: UUID
    approval_required: bool = Field(default=False)
    fulfillment_group: Optional[str] = Field(default=None, max_length=100)
    estimated_delivery_hours: int = Field(default=24, ge=1)
    is_active: bool = Field(default=True)
    intake_schema: Optional[dict] = Field(default_factory=dict)


class ITSMServiceCatalogItemUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    service_id: Optional[UUID] = Field(default=None)
    approval_required: Optional[bool] = Field(default=None)
    fulfillment_group: Optional[str] = Field(default=None, max_length=100)
    estimated_delivery_hours: Optional[int] = Field(default=None, ge=1)
    is_active: Optional[bool] = Field(default=None)
    intake_schema: Optional[dict] = Field(default=None)


class ValidationCheckItem(BaseModel):
    category: str
    name: str
    passed: bool
    message: Optional[str] = None


class ITSMServiceCatalogValidationResponse(BaseModel):
    is_valid: bool
    status: str  # "READY TO PUBLISH" or "VALIDATION FAILED"
    errors: List[str] = Field(default_factory=list)
    checks: List[ValidationCheckItem] = Field(default_factory=list)


# --- Business Calendar Schemas ---
class ITSMBusinessCalendarResponse(BaseModel):
    id: UUID
    name: str
    timezone: str
    weekly_hours: dict = Field(default_factory=dict)
    holidays: list = Field(default_factory=list)
    is_default: bool = False
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMBusinessCalendarCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    timezone: str = Field(default="UTC", max_length=50)
    weekly_hours: Optional[dict] = Field(default_factory=dict)
    holidays: Optional[list] = Field(default_factory=list)
    is_default: bool = Field(default=False)


class ITSMBusinessCalendarUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    timezone: Optional[str] = Field(default=None, max_length=50)
    weekly_hours: Optional[dict] = Field(default=None)
    holidays: Optional[list] = Field(default=None)
    is_default: Optional[bool] = Field(default=None)


# --- SLA Policy Schemas ---
class ITSMSLAPolicyResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    ticket_type: str = "INCIDENT"
    priority: str
    service_id: Optional[UUID] = None
    service_name: Optional[str] = None
    calendar_id: Optional[UUID] = None
    calendar_name: Optional[str] = None
    response_target_minutes: int
    resolution_target_minutes: int
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ITSMSLAPolicyCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    ticket_type: str = Field(default="INCIDENT", max_length=32)
    priority: str = Field(..., description="P1, P2, P3, P4")
    service_id: Optional[UUID] = Field(default=None)
    calendar_id: Optional[UUID] = Field(default=None)
    response_target_minutes: int = Field(..., ge=1)
    resolution_target_minutes: int = Field(..., ge=1)
    is_active: bool = Field(default=True)


class ITSMSLAPolicyUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    priority: Optional[str] = Field(default=None)
    service_id: Optional[UUID] = Field(default=None)
    calendar_id: Optional[UUID] = Field(default=None)
    response_target_minutes: Optional[int] = Field(default=None, ge=1)
    resolution_target_minutes: Optional[int] = Field(default=None, ge=1)
    is_active: Optional[bool] = Field(default=None)


# --- Platform Settings Schemas (Step 4) ---
class ITSMPlatformSettingsResponse(BaseModel):
    tenant_id: UUID
    tenant_name: str
    platform_edition: str = "AuthClaw ITSM Foundation (Phase 4 MVP)"
    notifications_enabled: bool = True
    notification_delivery_channel: str = "IN_APP"
    default_priority: str = "P3"
    active_services_count: int = 0
    active_catalog_items_count: int = 0
    active_sla_policies_count: int = 0
    default_business_calendar: Optional[str] = None


# --- Employee Invite & Creation Schemas ---
class ITSMEmployeeInviteRequest(BaseModel):
    """Schema for inviting or adding an employee with an ITSM role."""
    email: str = Field(..., description="Employee corporate email address")
    itsm_role: str = Field(..., description="Assigned ITSM business role")
    send_email: bool = Field(default=True, description="Whether to send invitation email")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, value: str) -> str:
        clean = value.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean):
            raise ValueError("Invalid email format")
        return clean

    @field_validator("itsm_role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized == "SERVICE_LEAD":
            normalized = "INCIDENT_MANAGER"
        if normalized not in VALID_ITSM_ROLES:
            raise ValueError(f"Invalid ITSM role '{value}'. Allowed roles: {', '.join(VALID_ITSM_ROLES)}")
        return normalized


class ITSMEmployeeInviteResponse(BaseModel):
    """Response payload after employee invite or existing user role assignment."""
    status: str = Field(..., description="'invited' or 'already_exists'")
    message: str
    email: str
    itsm_role: str
    user_id: Optional[UUID] = None
    signup_id: Optional[UUID] = None
    delivery: Optional[str] = None
    dev_otp: Optional[str] = None
    expires_at: Optional[datetime] = None
    action_url: Optional[str] = None


class ITSMEmployeeCreateManualRequest(BaseModel):
    """Schema for creating an employee in AuthClaw with an ITSM role."""
    email: str = Field(..., description="Employee corporate email address")
    itsm_role: str = Field(..., description="Assigned ITSM business role")
    password: Optional[str] = Field(default=None, description="Optional employee account password (deprecated; activation link used)")
    confirm_password: Optional[str] = Field(default=None, description="Password confirmation")
    email_credentials: bool = Field(default=False, description="Optionally send invitation / activation link")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, value: str) -> str:
        clean = value.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean):
            raise ValueError("Invalid email format")
        return clean

    @field_validator("itsm_role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized == "SERVICE_LEAD":
            normalized = "INCIDENT_MANAGER"
        if normalized not in VALID_ITSM_ROLES:
            raise ValueError(f"Invalid ITSM role '{value}'. Allowed roles: {', '.join(VALID_ITSM_ROLES)}")
        return normalized

    @model_validator(mode="after")
    def validate_passwords(self) -> "ITSMEmployeeCreateManualRequest":
        if self.password:
            if len(self.password) < 12:
                raise ValueError("Password must be at least 12 characters")
            if self.password != self.confirm_password:
                raise ValueError("Passwords do not match")
        return self


class ITSMEmployeeCreateManualResponse(BaseModel):
    """Response payload after manual employee creation or existing user posture check."""
    status: str = Field(..., description="'created' or 'already_exists'")
    message: str
    email: str
    itsm_role: str
    user_id: Optional[UUID] = None
    signup_id: Optional[UUID] = None
    has_itsm_access: Optional[bool] = None
    delivery: Optional[str] = None
    expires_at: Optional[datetime] = None
    action_url: Optional[str] = None


class AccountActivationRequest(BaseModel):
    """Request payload for employee account activation and initial password setting."""
    token: str = Field(..., min_length=1, description="URL-safe activation token")
    password: str = Field(..., min_length=1, max_length=256, description="Chosen employee password")
    confirm_password: Optional[str] = Field(default=None, description="Optional confirmation password")
    signup_id: Optional[UUID] = Field(default=None, description="Optional invitation ID")
    email: Optional[str] = Field(default=None, description="Optional employee email")

    @model_validator(mode="after")
    def validate_confirm_password(self) -> "AccountActivationRequest":
        if self.confirm_password is not None and self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class AccountActivationResponse(BaseModel):
    """Response payload after successful employee account activation."""
    status: str = "activated"
    message: str = "Account activated successfully. You may now sign in."
    email: str
    user_id: UUID
    itsm_role: Optional[str] = None


class InvitationResendResponse(BaseModel):
    """Response payload after resending an activation invitation."""
    status: str = "resent"
    message: str = "Activation invitation resent successfully."
    signup_id: UUID
    email: str
    expires_at: datetime
    delivery: Optional[str] = None


class InvitationRevokeResponse(BaseModel):
    """Response payload after revoking an activation invitation."""
    status: str = "revoked"
    message: str = "Invitation revoked successfully."
    signup_id: UUID
    email: str


class PendingInviteResponse(BaseModel):
    """Response payload representing a pending tenant invitation."""
    signup_id: UUID
    email: str
    tenant_name: str
    invited_role: Optional[str] = None
    status: str
    expires_at: datetime
    sent_at: Optional[datetime] = None
    resend_count: int = 0
    delivery: Optional[str] = None





