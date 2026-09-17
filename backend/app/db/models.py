"""SQLAlchemy ORM Models for AuthClaw"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy import (
    Column, String, UUID, DateTime, Boolean, ForeignKey,
    Integer, BigInteger, SmallInteger, Text, ARRAY, JSON, Index, Float, create_engine,
    CheckConstraint
)
from app.db.base import Base
from sqlalchemy.orm import relationship
import uuid
import enum
from sqlalchemy import UniqueConstraint, Enum


def default_api_key_expiry():
    return datetime.now(timezone.utc) + timedelta(days=90)


class AccessRequest(Base):
    """Public demo and early-access intake request."""
    __tablename__ = "access_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference = Column(String(35), nullable=False)
    name = Column(String(255), nullable=False)
    business_email = Column(String(255), nullable=False)
    company = Column(String(255), nullable=False)
    role = Column(String(100), nullable=False)
    use_case = Column(Text, nullable=False)
    requested_access = Column(String(100), nullable=False)
    consent_timestamp = Column(DateTime(timezone=True), nullable=False)
    notice_version = Column(String(50), nullable=False)
    source_page = Column(String(512), nullable=False)
    status = Column(String(50), nullable=False, default="PENDING")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_access_requests_reference", "reference", unique=True),
        Index("idx_access_requests_status_created", "status", "created_at"),
    )


class AccessRequestHistory(Base):
    """Non-tenant audit history for public intake requests."""
    __tablename__ = "access_request_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    access_request_id = Column(UUID(as_uuid=True), nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    event_type = Column(String(50), nullable=False)
    old_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    event_metadata = Column("metadata", JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("idx_access_request_history_request", "access_request_id", "created_at"),
    )


class DataSubjectRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


class DataSubjectRequest(Base):
    """Tenant-scoped GDPR data-subject request lifecycle."""
    __tablename__ = "data_subject_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    subject_id = Column(String(255), nullable=False)
    request_type = Column(String(20), nullable=False)
    status = Column(
        Enum(
            DataSubjectRequestStatus,
            name="data_subject_request_status",
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=DataSubjectRequestStatus.PENDING,
    )
    identity_verified = Column(Boolean, nullable=False, default=False)
    identity_verified_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    identity_verified_at = Column(DateTime(timezone=True), nullable=True)
    scope = Column(JSON, nullable=False, default=dict)
    decision = Column(String(20), nullable=True)
    decision_reason = Column(Text, nullable=True)
    decision_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decision_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "request_type IN ('ACCESS', 'EXPORT', 'DELETION')",
            name="ck_data_subject_request_type",
        ),
        CheckConstraint(
            "decision IS NULL OR decision IN ('APPROVED', 'REJECTED')",
            name="ck_data_subject_request_decision",
        ),
        Index("idx_data_subject_request_tenant_status", "tenant_id", "status"),
        Index("idx_data_subject_request_tenant_created", "tenant_id", "created_at"),
        Index("idx_data_subject_request_tenant_subject", "tenant_id", "subject_id"),
    )


class Tenant(Base):
    """Multi-tenant tenant model"""
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, unique=True)
    tier = Column(String(50), nullable=False, default="starter")  # starter, pro, enterprise
    status = Column(String(50), nullable=False, default="active")  # active, suspended
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    api_keys = relationship("APIKey", back_populates="tenant", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="tenant", cascade="all, delete-orphan")
    gateways = relationship("GatewayConfig", back_populates="tenant", cascade="all, delete-orphan")
    redaction_tokens = relationship("RedactionToken", back_populates="tenant", cascade="all, delete-orphan")
    workflows = relationship("ComplianceWorkflow", back_populates="tenant", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="tenant", cascade="all, delete-orphan")
    ephemeral_worker_tokens = relationship("EphemeralWorkerToken", back_populates="tenant", cascade="all, delete-orphan")
    ephemeral_worker_runs = relationship("EphemeralWorkerRun", back_populates="tenant", cascade="all, delete-orphan")
    cloud_connectors = relationship("CloudConnector", back_populates="tenant", cascade="all, delete-orphan")
    oidc_config = relationship("TenantOIDCConfig", back_populates="tenant", cascade="all, delete-orphan", uselist=False)
    trust_center_shares = relationship("TrustCenterShare", back_populates="tenant", cascade="all, delete-orphan")
    trust_center_access_logs = relationship("TrustCenterAccessLog", back_populates="tenant", cascade="all, delete-orphan")
    evidence_records = relationship("EvidenceRecord", back_populates="tenant", cascade="all, delete-orphan")
    findings = relationship("Finding", back_populates="tenant", cascade="all, delete-orphan")
    compliance_score_snapshots = relationship("ComplianceScoreSnapshot", back_populates="tenant", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="tenant", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_tenant_status", "status"),
    )


class PlatformAdmin(Base):
    """Tenantless AuthClaw developer administrator."""
    __tablename__ = "platform_admins"
    __table_args__ = {"schema": "authn"}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False, default="AuthClaw Developer")
    role = Column(String(50), nullable=False, default="ADMIN")
    is_active = Column(Boolean, nullable=False, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class User(Base):
    """User model with tenant isolation"""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=True)
    role = Column(
    Enum("owner", "admin", "developer", "operator", "viewer", name="user_role"),
    nullable=False,
    default="viewer"
    )  # owner, admin, developer, operator, viewer
    platform_role = Column(
        Enum("NONE", "ADMIN", name="platform_role"),
        nullable=False,
        default="NONE",
    )
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret = Column(Text, nullable=True)  # Encrypted TOTP secret
    mfa_backup_codes = Column(ARRAY(String), nullable=True)  # Hashed one-time backup codes
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    approvals = relationship("PendingApproval", back_populates="approver", foreign_keys="PendingApproval.approver_id")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
    UniqueConstraint(
        "tenant_id",
        "email",
        name="uq_tenant_email"
    ),
    Index("idx_user_tenant_email", "tenant_id", "email"),
    Index("idx_user_is_active", "is_active"),
    )


class Notification(Base):
    """Tenant-scoped in-app notification."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    type = Column(String(100), nullable=False)
    severity = Column(String(20), nullable=False, default="info")
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False, default="")
    link = Column(String(512), nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="notifications")
    user = relationship("User", back_populates="notifications")

    __table_args__ = (
        Index("idx_notification_tenant_created", "tenant_id", "created_at"),
        Index("idx_notification_tenant_read", "tenant_id", "read_at"),
        Index("idx_notification_user", "tenant_id", "user_id"),
    )


class APIKey(Base):
    """API Key for service-to-service authentication"""
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    key_hash = Column(String(255), nullable=False, unique=True)  # HMAC digest
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    scopes = Column(ARRAY(String), nullable=False, default=["read"])  # read, write, admin
    is_active = Column(Boolean, default=True)
    last_used = Column(DateTime(timezone=True), nullable=True)
    last_used_ip = Column(String(64), nullable=True)
    last_used_user_agent = Column(String(512), nullable=True)
    last_used_request_id = Column(String(255), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, default=default_api_key_expiry)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    rotated_at = Column(DateTime(timezone=True), nullable=True)
    rotated_from_id = Column(UUID(as_uuid=True), ForeignKey("api_keys.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="api_keys")

    __table_args__ = (
        Index("idx_apikey_tenant", "tenant_id"),
        Index("idx_apikey_active", "is_active"),
    )


class Policy(Base):
    """YAML Policy storage per tenant"""
    __tablename__ = "policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    policy_yaml = Column(Text, nullable=False)  # Full YAML policy content
    version = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="policies")

    __table_args__ = (
        Index("idx_policy_tenant", "tenant_id"),
        Index("idx_policy_active", "is_active"),
    )


class GatewayConfig(Base):
    """Gateway routing configuration per tenant"""
    __tablename__ = "gateway_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    provider = Column(String(50), nullable=False)  # openai, anthropic, cohere, azure_openai
    endpoint = Column(String(512), nullable=False)
    model_whitelist = Column(ARRAY(String), nullable=True)  # If null, allow all models
    redaction_strategy = Column(String(50), nullable=False, default="mask")  # mask, hash, synthetic
    redaction_token_retention_days = Column(Integer, nullable=False, default=90)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="gateways")

    __table_args__ = (
        Index("idx_gateway_tenant", "tenant_id"),
        Index("idx_gateway_active", "is_active"),
    )


class ProviderCredential(Base):
    """Encrypted model-provider credential for AuthClaw Lite gateway egress."""
    __tablename__ = "provider_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    provider = Column(String(50), nullable=False)
    display_name = Column(String(255), nullable=False)
    endpoint = Column(String(512), nullable=True)
    encrypted_secret = Column(Text, nullable=False)
    auth_scheme = Column(String(50), nullable=False, default="api_key")
    status = Column(String(50), nullable=False, default="active")
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    rotated_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rotated_from_id = Column(UUID(as_uuid=True), ForeignKey("provider_credentials.id"), nullable=True)
    version = Column(Integer, nullable=False, default=1)

    __table_args__ = (
        Index("idx_provider_credential_tenant", "tenant_id"),
        Index("idx_provider_credential_provider", "tenant_id", "provider"),
        Index("idx_provider_credential_status", "status"),
    )


class TenantOIDCConfig(Base):
    """Tenant-scoped enterprise SSO configuration."""
    __tablename__ = "tenant_oidc_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)
    issuer = Column(String(512), nullable=False)
    client_id = Column(String(255), nullable=False)
    encrypted_client_secret = Column(Text, nullable=True)
    redirect_uri = Column(String(512), nullable=False)
    scopes = Column(ARRAY(String), nullable=False, default=["openid", "email", "profile"])
    authorization_endpoint = Column(String(512), nullable=True)
    token_endpoint = Column(String(512), nullable=True)
    jwks_uri = Column(String(512), nullable=True)
    email_claim = Column(String(100), nullable=False, default="email")
    groups_claim = Column(String(100), nullable=False, default="groups")
    tenant_claim = Column(String(100), nullable=False, default="tenant_id")
    tenant_claim_value = Column(String(255), nullable=True)
    role_mapping = Column(JSON, nullable=False, default=dict)
    default_role = Column(String(50), nullable=False, default="viewer")
    auto_provision = Column(Boolean, nullable=False, default=False)
    require_mfa = Column(Boolean, nullable=False, default=True)
    accepted_amr = Column(ARRAY(String), nullable=False, default=["mfa"])
    accepted_acr = Column(ARRAY(String), nullable=False, default=list)
    max_auth_age_seconds = Column(Integer, nullable=False, default=43200)
    status = Column(String(50), nullable=False, default="disabled")
    last_tested_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="oidc_config")

    __table_args__ = (
        Index("idx_tenant_oidc_config_tenant", "tenant_id"),
        Index("idx_tenant_oidc_config_status", "tenant_id", "status"),
    )


class CloudConnector(Base):
    """Encrypted cloud/SCM connector credential for AWS, GitHub, and GCP."""
    __tablename__ = "cloud_connectors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    provider = Column(String(50), nullable=False)
    display_name = Column(String(255), nullable=False)
    auth_type = Column(String(50), nullable=False)
    encrypted_secret = Column(Text, nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)

    tenant = relationship("Tenant", back_populates="cloud_connectors")

    __table_args__ = (
        Index("idx_cloud_connector_tenant", "tenant_id"),
        Index("idx_cloud_connector_provider", "tenant_id", "provider"),
        Index("idx_cloud_connector_status", "tenant_id", "status"),
    )


class OnboardingEmailOTP(Base):
    """Public signup email OTP state before a tenant-scoped key exists."""
    __tablename__ = "onboarding_email_otps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), nullable=False)
    tenant_name = Column(String(255), nullable=False)
    otp_hash = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    resend_count = Column(Integer, nullable=False, default=0)
    last_delivery = Column(String(50), nullable=True)
    delivery_error = Column(Text, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    purpose = Column(String(50), nullable=False, default="signup")
    invited_role = Column(String(50), nullable=True)
    invited_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=True)
    api_key_id = Column(UUID(as_uuid=True), ForeignKey("api_keys.id"), nullable=True)
    terms_version = Column(String(32), nullable=True)
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)
    privacy_notice_version = Column(String(32), nullable=True)
    privacy_notice_acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_onboarding_otp_email", "email"),
        Index("idx_onboarding_otp_status", "status"),
        Index("idx_onboarding_otp_expires", "expires_at"),
    )


class OnboardingStatus(Base):
    """Tenant-scoped onboarding checklist state."""
    __tablename__ = "onboarding_status"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    signup_id = Column(UUID(as_uuid=True), ForeignKey("onboarding_email_otps.id"), nullable=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    tenant_created = Column(Boolean, nullable=False, default=False)
    api_key_issued = Column(Boolean, nullable=False, default=False)
    provider_key_saved = Column(Boolean, nullable=False, default=False)
    route_created = Column(Boolean, nullable=False, default=False)
    policy_created = Column(Boolean, nullable=False, default=False)
    snippet_viewed = Column(Boolean, nullable=False, default=False)
    current_step = Column(String(50), nullable=False, default="connect_provider")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_onboarding_status_tenant", "tenant_id"),
        Index("idx_onboarding_status_step", "current_step"),
    )


class RedactionToken(Base):
    """Reversible redaction token mappings per tenant"""
    __tablename__ = "redaction_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    original_value = Column(Text, nullable=False)  # Encrypted
    original_value_blind_index = Column(String(64), nullable=False)
    token_hash = Column(String(255), nullable=False)  # SHA-256 hash of token
    token_value = Column(String(255), nullable=False)  # Synthetic/masked value
    strategy = Column(String(50), nullable=False)  # mask, hash, synthetic
    entity_type = Column(String(100), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    use_count = Column(Integer, nullable=False, default=0)
    purged_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="redaction_tokens")

    __table_args__ = (
        UniqueConstraint("tenant_id", "original_value_blind_index", "strategy", name="uq_redaction_tokens_tenant_blind_index_strategy"),
        Index("idx_redaction_tenant", "tenant_id"),
        Index("idx_redaction_hash", "token_hash"),
        Index("idx_redaction_expires", "tenant_id", "expires_at"),
        Index("idx_redaction_purged", "tenant_id", "purged_at"),
        Index("idx_redaction_entity", "tenant_id", "entity_type"),
    )


class PendingApproval(Base):
    """HITL approval workflow state"""
    __tablename__ = "pending_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    action_id = Column(String(255), nullable=False)  # Unique action identifier
    action_type = Column(String(50), nullable=False)  # remediation, configuration_change, etc.
    action_description = Column(Text, nullable=False)
    action_payload = Column(JSON, nullable=False)  # Full action details
    action_hash = Column(String(64), nullable=True)
    status = Column(String(50), nullable=False, default="PENDING")  # PENDING, APPROVED, REJECTED, EXPIRED, CONSUMED
    requester_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approver_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    mfa_verified = Column(Boolean, default=False)
    mfa_timestamp = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)  # 30 min from creation
    approved_at = Column(DateTime(timezone=True), nullable=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    consumed_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolution_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    approver = relationship("User", back_populates="approvals", foreign_keys=[approver_id])

    __table_args__ = (
        Index("idx_approval_tenant", "tenant_id"),
        Index("idx_approval_status", "status"),
        Index("idx_approval_expires", "expires_at"),
        Index("idx_approval_tenant_action_hash", "tenant_id", "action_hash"),
    )


class ApprovalAudit(Base):
    """Immutable audit log of all approval decisions"""
    __tablename__ = "approval_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(String(50), nullable=False)  # APPROVED, REJECTED, EXPIRED
    action_hash = Column(String(64), nullable=True)
    reason = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)
    mfa_verified = Column(Boolean, default=False)
    mfa_timestamp = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_approval_audit_tenant", "tenant_id"),
        Index("idx_approval_audit_approval", "approval_id"),
    )


class AuditLogMetadata(Base):
    """Authoritative PostgreSQL audit chain mirrored to ClickHouse for analytics."""
    __tablename__ = "audit_log_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    record_id = Column(UUID(as_uuid=True), nullable=False, unique=True)  # Matches ClickHouse record_id
    tenant_sequence = Column(BigInteger, nullable=False)
    idempotency_key = Column(Text, nullable=False)
    chain_version = Column(SmallInteger, nullable=False, default=2)
    canonical_payload = Column(Text, nullable=False)
    actor_id = Column(UUID(as_uuid=True), nullable=True)
    actor_type = Column(String(100), nullable=False, default="gateway")
    action = Column(String(255), nullable=False)
    request_id = Column(String(255), nullable=True)
    policy_id = Column(UUID(as_uuid=True), nullable=True)
    provider = Column(String(100), nullable=True)
    model = Column(String(255), nullable=True)
    reason = Column(Text, nullable=True)
    prompt_count = Column(Integer, nullable=False, default=0)
    request_size = Column(Integer, nullable=False, default=0)
    response_status = Column(Integer, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=False, default=0)
    frameworks_affected = Column(ARRAY(String), nullable=True)  # GDPR, HIPAA, SOC2
    execution_trace = Column(Text, nullable=False, default="[]")
    prior_hash = Column(String(64), nullable=True)
    integrity_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_audit_metadata_tenant", "tenant_id"),
        Index("idx_audit_metadata_record", "record_id"),
        Index("idx_audit_metadata_created", "created_at"),
        UniqueConstraint("tenant_id", "tenant_sequence", name="uq_audit_log_tenant_sequence"),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_audit_log_tenant_idempotency"),
    )


class AuditOutbox(Base):
    """Transactional Kafka publication queue for immutable audit records."""

    __tablename__ = "audit_outbox"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    record_id = Column(UUID(as_uuid=True), ForeignKey("audit_log_metadata.record_id"), nullable=False, unique=True)
    tenant_sequence = Column(BigInteger, nullable=False)
    event_payload = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    published_at = Column(DateTime(timezone=True), nullable=True)
    publish_attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_audit_outbox_pending", "published_at", "created_at"),
        UniqueConstraint("tenant_id", "tenant_sequence", name="uq_audit_outbox_tenant_sequence"),
    )


class ComplianceWorkflow(Base):
    """LangGraph compliance workflow execution state"""
    __tablename__ = "compliance_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    workflow_id = Column(String(255), nullable=False, unique=True)  # LangGraph workflow execution ID
    request_id = Column(String(255), nullable=True)  # Request correlation ID
    framework = Column(String(50), nullable=False)  # GDPR, HIPAA, SOC2
    current_state = Column(String(50), nullable=False, default="GATHER_EVIDENCE")
    findings = Column(JSON, nullable=True)
    risk_score = Column(Float, nullable=True)
    remediation_plan = Column(JSON, nullable=True)
    approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id"), nullable=True)
    approval_status = Column(String(50), nullable=True)  # PENDING, APPROVED, REJECTED, EXPIRED, ALTERED
    execution_status = Column(String(50), nullable=False, default="RUNNING")
    execution_result = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, nullable=False, default=0)
    state_data = Column(JSON, nullable=True)  # Full LangGraph state snapshot for recovery
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="workflows")
    approval = relationship("PendingApproval")

    __table_args__ = (
        Index("idx_workflow_tenant", "tenant_id"),
        Index("idx_workflow_status", "execution_status"),
        Index("idx_workflow_state", "current_state"),
        Index("idx_workflow_wfid", "workflow_id"),
    )


class ChatSession(Base):
    """Compliance agent chat sessions"""
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_chatsession_tenant", "tenant_id"),
    )


class ChatMessage(Base):
    """Messages in a compliance agent chat session"""
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False)
    sender = Column(Enum("user", "agent", name="chat_sender"), nullable=False)
    text = Column(Text, nullable=False)
    results = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        Index("idx_chatmessage_session", "session_id"),
    )


class RAGCorpusVersion(Base):
    """Versioned global regulatory corpus loaded from checked-in source files."""
    __tablename__ = "rag_corpus_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    corpus_key = Column(String(120), nullable=False)
    version = Column(String(80), nullable=False)
    checksum = Column(String(64), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    loaded_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    chunks = relationship("RAGCorpusChunk", back_populates="corpus_version", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("corpus_key", "version", name="uq_rag_corpus_version"),
        Index("idx_rag_corpus_active", "corpus_key", "is_active"),
    )


class RAGCorpusChunk(Base):
    """Searchable regulatory corpus chunk with citation metadata."""
    __tablename__ = "rag_corpus_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    corpus_version_id = Column(UUID(as_uuid=True), ForeignKey("rag_corpus_versions.id", ondelete="CASCADE"), nullable=False)
    framework = Column(String(50), nullable=False)
    section_id = Column(String(120), nullable=False)
    title = Column(String(255), nullable=False)
    citation_label = Column(String(255), nullable=False)
    source_name = Column(String(255), nullable=False)
    source_url = Column(Text, nullable=False)
    chunk_text = Column(Text, nullable=False)
    keywords = Column(ARRAY(String), nullable=False, default=list)
    chunk_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    corpus_version = relationship("RAGCorpusVersion", back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("corpus_version_id", "section_id", name="uq_rag_chunk_version_section"),
        Index("idx_rag_chunk_framework", "framework"),
        Index("idx_rag_chunk_hash", "chunk_hash"),
    )


class AWSUsageLimits(Base):
    """Per-tenant Bedrock daily usage counters and hard limits.
    
    The Go Gateway reads this table BEFORE forwarding any Bedrock request.
    If daily_requests >= max_daily_requests the request is blocked locally,
    never reaching AWS, preventing runaway billing.
    """
    __tablename__ = "aws_usage_limits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, unique=True)

    # Running daily counters
    daily_requests      = Column(Integer, nullable=False, default=0)
    daily_tokens        = Column(Integer, nullable=False, default=0)
    daily_cost_estimate = Column(Float, nullable=False, default=0.0)

    # Configurable hard limits
    max_daily_requests  = Column(Integer, nullable=False, default=100)
    max_daily_tokens    = Column(Integer, nullable=False, default=50000)
    max_daily_cost_usd  = Column(Float, nullable=False, default=1.0)

    last_reset  = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_aws_usage_tenant", "tenant_id"),
    )


class AWSS3Document(Base):
    """Metadata of S3 objects synced for a tenant.
    
    Populated by POST /v1/aws/s3/sync. Stores only metadata — no file content.
    Used by RAG pipeline as its document inventory source.
    """
    __tablename__ = "aws_s3_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    bucket_name     = Column(String(255), nullable=False)
    object_key      = Column(Text, nullable=False)       # Full S3 key
    file_name       = Column(String(512), nullable=False) # Basename
    file_size_bytes = Column(Integer, nullable=True)
    content_type    = Column(String(255), nullable=True)
    last_modified   = Column(DateTime(timezone=True), nullable=True)
    etag            = Column(String(255), nullable=True)   # S3 ETag for change detection
    synced_at       = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_s3_docs_tenant", "tenant_id"),
        Index("idx_s3_docs_synced", "synced_at"),
        # Prevent duplicate keys per tenant+bucket
        UniqueConstraint("tenant_id", "bucket_name", "object_key", name="uq_s3_doc_tenant_key"),
    )


class EphemeralWorkerToken(Base):
    """Short-lived, scoped token issued to a scan/remediation worker."""
    __tablename__ = "ephemeral_worker_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    workflow_id = Column(String(255), nullable=True)
    action_id = Column(String(255), nullable=False)
    connector = Column(String(50), nullable=False)
    purpose = Column(String(50), nullable=False)
    scopes = Column(ARRAY(String), nullable=False, default=list)
    permission_boundary = Column(JSON, nullable=False, default=dict)
    token_hash = Column(String(64), nullable=False, unique=True)
    token_prefix = Column(String(32), nullable=False)
    hash_algorithm = Column(String(32), nullable=False, server_default="sha256")
    hash_key_version = Column(String(16), nullable=True)
    status = Column(String(50), nullable=False, default="active")
    issued_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    issued_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    last_used_action = Column(String(255), nullable=True)
    use_count = Column(Integer, nullable=False, default=0)
    metadata_json = Column(JSON, nullable=False, default=dict)

    tenant = relationship("Tenant", back_populates="ephemeral_worker_tokens")
    runs = relationship("EphemeralWorkerRun", back_populates="worker_token", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_ephemeral_worker_token_tenant", "tenant_id"),
        Index("idx_ephemeral_worker_token_status", "tenant_id", "status", "expires_at"),
        Index("idx_ephemeral_worker_token_workflow", "tenant_id", "workflow_id"),
        Index("idx_ephemeral_worker_token_prefix", "token_prefix"),
    )


class EphemeralWorkerRun(Base):
    """Auditable authorization decision for one worker action attempt."""
    __tablename__ = "ephemeral_worker_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    worker_token_id = Column(UUID(as_uuid=True), ForeignKey("ephemeral_worker_tokens.id"), nullable=True)
    connector = Column(String(50), nullable=False)
    action = Column(String(255), nullable=False)
    required_scope = Column(String(255), nullable=False)
    destructive = Column(Boolean, nullable=False, default=False)
    status = Column(String(50), nullable=False)
    reason = Column(Text, nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)

    tenant = relationship("Tenant", back_populates="ephemeral_worker_runs")
    worker_token = relationship("EphemeralWorkerToken", back_populates="runs")

    __table_args__ = (
        Index("idx_ephemeral_worker_run_tenant", "tenant_id", "started_at"),
        Index("idx_ephemeral_worker_run_token", "worker_token_id"),
        Index("idx_ephemeral_worker_run_status", "tenant_id", "status"),
        Index("idx_ephemeral_worker_run_connector", "tenant_id", "connector"),
    )


class EvidenceRecord(Base):
    """Permanent evidence record for all compliance activity.

    Created whenever a compliance scan, approval event, or gateway action
    produces a trackable finding. This table is the source of truth consumed
    by downstream features (Findings Dashboard, Reports, RAG, Enterprise Governance).
    """
    __tablename__ = "evidence_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)

    # Link back to the workflow that produced this evidence (nullable for events
    # that occur outside of a workflow, e.g. gateway redactions)
    workflow_id = Column(String(255), nullable=True)

    # The compliance framework this evidence belongs to
    framework = Column(String(50), nullable=False)  # GDPR, HIPAA, SOC2

    # Where the evidence came from
    # s3_document | gateway_event | audit_event | approval_event | policy_evaluation
    source_type = Column(String(100), nullable=False)

    # A human-readable reference to the specific source artifact
    # e.g. "tenant-xxx/file.txt", "audit-event-<uuid>", "approval-<uuid>"
    source_reference = Column(Text, nullable=True)

    # What kind of evidence this is
    # pii_detected | policy_violation | approval_record | audit_log | scan_result
    evidence_type = Column(String(100), nullable=False)

    # Full structured payload — Presidio results, approval details, etc.
    evidence_data = Column(JSON, nullable=False, default=dict)

    # Severity classification: critical | high | medium | low | info
    severity = Column(String(50), nullable=False, default="info")

    # Canonical hash over tenant, source, payload, classification, and timestamp.
    # Versioning allows the canonical form to evolve without rewriting old evidence.
    integrity_hash = Column(String(64), nullable=False)
    integrity_algorithm = Column(String(20), nullable=False, default="sha256")
    integrity_version = Column(Integer, nullable=False, default=1)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="evidence_records")
    links = relationship("EvidenceLink", back_populates="evidence", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_evidence_tenant", "tenant_id"),
        Index("idx_evidence_workflow", "workflow_id"),
        Index("idx_evidence_framework", "framework"),
        Index("idx_evidence_type", "evidence_type"),
        Index("idx_evidence_severity", "severity"),
        Index("idx_evidence_created", "created_at"),
    )


class EvidenceLink(Base):
    """Traceability links — connects one evidence record to any related entity.

    Supported linked_type values:
      finding   — a specific finding within a workflow
      workflow  — a ComplianceWorkflow
      approval  — a PendingApproval
      report    — a future compliance report
    """
    __tablename__ = "evidence_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    evidence_id = Column(UUID(as_uuid=True), ForeignKey("evidence_records.id"), nullable=False)

    # Type of the linked entity: finding | workflow | approval | report
    linked_type = Column(String(50), nullable=False)

    # String ID of the linked entity (UUID or workflow_id string)
    linked_id = Column(String(255), nullable=False)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    evidence = relationship("EvidenceRecord", back_populates="links")

    __table_args__ = (
        Index("idx_evidence_link_tenant", "tenant_id"),
        Index("idx_evidence_link_evidence", "evidence_id"),
        Index("idx_evidence_link_linked", "linked_type", "linked_id"),
    )


class Finding(Base):
    """Actionable compliance issues derived from evidence."""
    __tablename__ = "findings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    workflow_id = Column(String(255), nullable=True)
    evidence_id = Column(UUID(as_uuid=True), ForeignKey("evidence_records.id"), nullable=True)
    
    framework = Column(String(50), nullable=False)
    finding_key = Column(String(512), nullable=False)  # framework|finding_type|source_reference
    
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    
    # critical, high, medium, low, info
    severity = Column(String(50), nullable=False, default="medium")
    
    # OPEN, ACKNOWLEDGED, IN_PROGRESS, AWAITING_APPROVAL, RESOLVED, FALSE_POSITIVE, ACCEPTED_RISK
    status = Column(String(50), nullable=False, default="OPEN")
    
    # PII_EXPOSURE, POLICY_VIOLATION, ACCESS_CONTROL, DATA_RETENTION, ENCRYPTION, AUDIT_GAP, AI_GOVERNANCE
    finding_type = Column(String(100), nullable=False)
    
    risk_score = Column(Float, nullable=False, default=0.0)
    remediation_summary = Column(Text, nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="findings")
    evidence = relationship("EvidenceRecord")
    owner = relationship("User")

    __table_args__ = (
        Index("idx_finding_tenant", "tenant_id"),
        Index("idx_finding_workflow", "workflow_id"),
        Index("idx_finding_framework", "framework"),
        Index("idx_finding_status", "status"),
        Index("idx_finding_severity", "severity"),
        Index("idx_finding_type", "finding_type"),
        Index("idx_finding_created", "created_at"),
        Index("idx_finding_key", "finding_key"),
    )


class ComplianceScoreSnapshot(Base):
    """Daily framework readiness score snapshot for trend reporting."""
    __tablename__ = "compliance_score_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    framework = Column(String(50), nullable=False)
    snapshot_date = Column(String(10), nullable=False)
    overall_score = Column(Float, nullable=False, default=0.0)
    readiness_level = Column(String(50), nullable=False, default="insufficient_evidence")
    control_scores = Column(JSON, nullable=False, default=dict)
    evidence_count = Column(Integer, nullable=False, default=0)
    audit_event_count = Column(Integer, nullable=False, default=0)
    open_findings = Column(Integer, nullable=False, default=0)
    critical_findings = Column(Integer, nullable=False, default=0)
    generated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant", back_populates="compliance_score_snapshots")

    __table_args__ = (
        UniqueConstraint("tenant_id", "framework", "snapshot_date", name="uq_compliance_score_tenant_framework_date"),
        Index("idx_compliance_score_tenant", "tenant_id"),
        Index("idx_compliance_score_framework", "tenant_id", "framework"),
        Index("idx_compliance_score_date", "tenant_id", "snapshot_date"),
    )


class TrustCenterShare(Base):
    """Scoped public auditor share for the Trust Center."""
    __tablename__ = "trust_center_shares"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    label = Column(String(255), nullable=False)
    auditor_email = Column(String(255), nullable=True)
    token_hash = Column(String(64), nullable=False, unique=True)
    token_prefix = Column(String(32), nullable=False)
    frameworks = Column(ARRAY(String), nullable=False, default=list)
    permissions = Column(ARRAY(String), nullable=False, default=list)
    status = Column(String(50), nullable=False, default="active")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_accessed_at = Column(DateTime(timezone=True), nullable=True)
    access_count = Column(Integer, nullable=False, default=0)
    metadata_json = Column(JSON, nullable=False, default=dict)

    tenant = relationship("Tenant", back_populates="trust_center_shares")
    access_logs = relationship("TrustCenterAccessLog", back_populates="share", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_trust_share_tenant", "tenant_id"),
        Index("idx_trust_share_status", "tenant_id", "status", "expires_at"),
        Index("idx_trust_share_prefix", "token_prefix"),
    )


class TrustCenterAccessLog(Base):
    """Access audit for public Trust Center share usage."""
    __tablename__ = "trust_center_access_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    share_id = Column(UUID(as_uuid=True), ForeignKey("trust_center_shares.id"), nullable=False)
    action = Column(String(100), nullable=False)
    accessed_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)

    tenant = relationship("Tenant", back_populates="trust_center_access_logs")
    share = relationship("TrustCenterShare", back_populates="access_logs")

    __table_args__ = (
        Index("idx_trust_access_tenant", "tenant_id", "accessed_at"),
        Index("idx_trust_access_share", "share_id"),
    )

# =============================================================================
# ITSM DOMAIN MODELS (MVP -> V1 -> V1.5 -> V2)
# =============================================================================
from sqlalchemy import Numeric
from sqlalchemy.dialects.postgresql import JSONB, ARRAY as PG_ARRAY, UUID as PG_UUID


# -----------------------------------------------------------------------------
# MVP Models (12 tables)
# -----------------------------------------------------------------------------

class ITSMBusinessCalendar(Base):
    """Business calendar with working hours and holidays for SLA calculations."""
    __tablename__ = "itsm_business_calendars"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    timezone = Column(String(50), nullable=False, default="UTC")
    weekly_hours = Column(JSONB, nullable=False, default=dict)
    holidays = Column(JSONB, nullable=False, default=list)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_itsm_calendar_tenant_name"),
        Index("idx_itsm_calendar_tenant", "tenant_id"),
    )


class ITSMService(Base):
    """Business and technical service definitions."""
    __tablename__ = "itsm_services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    tier = Column(String(20), nullable=False, default="TIER_2")
    status = Column(String(32), nullable=False, default="OPERATIONAL")
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    escalation_team = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    owner = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_itsm_services_tenant_slug"),
        Index("idx_itsm_services_tenant", "tenant_id"),
        Index("idx_itsm_services_tenant_tier", "tenant_id", "tier"),
        Index("idx_itsm_services_tenant_status", "tenant_id", "status"),
    )


class ITSMTicketCategory(Base):
    """Hierarchical category taxonomy for ITSM tickets."""
    __tablename__ = "itsm_ticket_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    code = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    parent_category_id = Column(UUID(as_uuid=True), ForeignKey("itsm_ticket_categories.id", ondelete="CASCADE"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    display_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    parent_category = relationship("ITSMTicketCategory", remote_side=[id])

    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_itsm_category_tenant_code"),
        Index("idx_itsm_category_tenant", "tenant_id"),
        Index("idx_itsm_category_parent", "tenant_id", "parent_category_id"),
    )


class ITSMSLAPolicy(Base):
    """SLA Policy defining response and resolution targets per priority/service."""
    __tablename__ = "itsm_sla_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    calendar_id = Column(UUID(as_uuid=True), ForeignKey("itsm_business_calendars.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    ticket_type = Column(String(32), nullable=False, default="INCIDENT")
    priority = Column(String(20), nullable=False)
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=True)
    response_target_minutes = Column(Integer, nullable=False)
    resolution_target_minutes = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    calendar = relationship("ITSMBusinessCalendar")
    service = relationship("ITSMService")

    __table_args__ = (
        Index("idx_itsm_sla_lookup", "tenant_id", "ticket_type", "priority", "is_active"),
    )


class ITSMTicketCounter(Base):
    """Concurrency-safe sequence counters for human-readable ticket numbers."""
    __tablename__ = "itsm_ticket_counters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_type = Column(String(32), nullable=False)
    prefix = Column(String(10), nullable=False)
    last_number = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_type", name="uq_itsm_ticket_counter_tenant_type"),
    )


class ITSMTicket(Base):
    """Core ITSM Ticket entity for Incidents, Problems, and Service Requests."""
    __tablename__ = "itsm_tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_number = Column(String(32), nullable=False)
    ticket_type = Column(String(32), nullable=False, default="INCIDENT")
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=False)
    impact = Column(String(20), nullable=False, default="MEDIUM")
    urgency = Column(String(20), nullable=False, default="MEDIUM")
    priority = Column(String(20), nullable=False, default="P3")
    status = Column(String(32), nullable=False, default="NEW")
    status_reason = Column(Text, nullable=True)
    source_channel = Column(String(50), nullable=False, default="PORTAL")
    requester_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assignment_group = Column(String(100), nullable=True)
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("itsm_ticket_categories.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(100), nullable=False, default="GENERAL")
    subcategory = Column(String(100), nullable=True)
    is_major_incident = Column(Boolean, nullable=False, default=False)
    linked_problem_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="SET NULL"), nullable=True)
    linked_finding_id = Column(UUID(as_uuid=True), ForeignKey("findings.id", ondelete="SET NULL"), nullable=True)
    sla_policy_id = Column(UUID(as_uuid=True), ForeignKey("itsm_sla_policies.id", ondelete="SET NULL"), nullable=True)
    sla_response_due_at = Column(DateTime(timezone=True), nullable=True)
    sla_response_met_at = Column(DateTime(timezone=True), nullable=True)
    sla_resolution_due_at = Column(DateTime(timezone=True), nullable=True)
    sla_resolution_met_at = Column(DateTime(timezone=True), nullable=True)
    sla_status = Column(String(20), nullable=False, default="WITHIN_SLA")
    sla_paused_at = Column(DateTime(timezone=True), nullable=True)
    sla_accumulated_pause_seconds = Column(Integer, nullable=False, default=0)
    resolution_code = Column(String(50), nullable=True)
    resolution_summary = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    ai_triaged = Column(Boolean, nullable=False, default=False)
    ai_suggested_priority = Column(String(20), nullable=True)
    ai_confidence_score = Column(Float, nullable=True)
    ai_summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    category_rel = relationship("ITSMTicketCategory", foreign_keys=[category_id])
    service = relationship("ITSMService")
    requester = relationship("User", foreign_keys=[requester_id])
    assignee = relationship("User", foreign_keys=[assignee_id])
    sla_policy = relationship("ITSMSLAPolicy")
    linked_problem = relationship("ITSMTicket", remote_side=[id], foreign_keys=[linked_problem_id])

    @property
    def service_name(self) -> str | None:
        return self.service.name if self.service else None

    @property
    def assignee_email(self) -> str | None:
        return self.assignee.email if self.assignee else None

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_number", name="uq_itsm_tickets_tenant_number"),
        Index("idx_itsm_tickets_tenant_status", "tenant_id", "status"),
        Index("idx_itsm_tickets_tenant_priority", "tenant_id", "priority"),
        Index("idx_itsm_tickets_tenant_assignee", "tenant_id", "assignee_id"),
        Index("idx_itsm_tickets_tenant_created", "tenant_id", "created_at"),
    )


class ITSMTicketActivity(Base):
    """Audit trail and conversation history for tickets."""
    __tablename__ = "itsm_ticket_activities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False)
    activity_type = Column(String(50), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_type = Column(String(32), nullable=False, default="USER")
    content = Column(Text, nullable=True)
    activity_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    actor = relationship("User", foreign_keys=[actor_id])

    __table_args__ = (
        Index("idx_itsm_activity_ticket_created", "tenant_id", "ticket_id", "created_at"),
    )


class ITSMServiceCatalogItem(Base):
    """Service catalog request templates and dynamic intake forms."""
    __tablename__ = "itsm_service_catalog_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    intake_schema = Column(JSONB, nullable=False, default=dict)
    approval_required = Column(Boolean, nullable=False, default=False)
    fulfillment_group = Column(String(100), nullable=True)
    estimated_delivery_hours = Column(Integer, nullable=False, default=24)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    service = relationship("ITSMService")

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_itsm_catalog_tenant_slug"),
        Index("idx_itsm_catalog_tenant_service", "tenant_id", "service_id", "is_active"),
    )


class ITSMServiceRequestDetail(Base):
    """Snapshot of catalog schema and user form data for submitted service requests."""
    __tablename__ = "itsm_service_request_details"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False)
    catalog_item_id = Column(UUID(as_uuid=True), ForeignKey("itsm_service_catalog_items.id", ondelete="RESTRICT"), nullable=False)
    catalog_item_version = Column(Integer, nullable=False)
    intake_schema_snapshot = Column(JSONB, nullable=False)
    submitted_form_data = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    catalog_item = relationship("ITSMServiceCatalogItem")

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_request_details_ticket"),
        Index("idx_itsm_request_details_catalog", "tenant_id", "catalog_item_id"),
    )


class ITSMKnowledgeArticle(Base):
    """Knowledge base article metadata."""
    __tablename__ = "itsm_knowledge_articles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(512), nullable=False)
    slug = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False, default="TROUBLESHOOTING")
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(32), nullable=False, default="DRAFT")
    current_published_version = Column(Integer, nullable=True)
    view_count = Column(Integer, nullable=False, default=0)
    helpful_count = Column(Integer, nullable=False, default=0)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    service = relationship("ITSMService")
    author = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_itsm_kb_tenant_slug"),
        Index("idx_itsm_kb_tenant_status", "tenant_id", "status"),
        Index("idx_itsm_kb_service", "tenant_id", "service_id"),
    )


class ITSMKnowledgeArticleVersion(Base):
    """Immutable versioned revisions of knowledge articles."""
    __tablename__ = "itsm_knowledge_article_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    article_id = Column(UUID(as_uuid=True), ForeignKey("itsm_knowledge_articles.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    title = Column(String(512), nullable=False)
    content_markdown = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    keywords = Column(PG_ARRAY(Text), nullable=False, default=list)
    change_summary = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    article = relationship("ITSMKnowledgeArticle")
    creator = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "article_id", "version_number", name="uq_itsm_kb_version_number"),
        Index("idx_itsm_kb_version_article", "tenant_id", "article_id"),
    )


class ITSMConfigurationItem(Base):
    """Configuration items (CIs) in the CMDB."""
    __tablename__ = "itsm_configuration_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    ci_type = Column(String(50), nullable=False)
    environment = Column(String(20), nullable=False, default="PRODUCTION")
    cloud_connector_id = Column(UUID(as_uuid=True), ForeignKey("cloud_connectors.id", ondelete="SET NULL"), nullable=True)
    external_resource_id = Column(String(512), nullable=True)
    status = Column(String(32), nullable=False, default="ACTIVE")
    attributes = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    service = relationship("ITSMService")

    __table_args__ = (
        Index("idx_itsm_ci_tenant_service", "tenant_id", "service_id"),
        Index("idx_itsm_ci_type", "tenant_id", "ci_type"),
        Index("idx_itsm_ci_cloud_connector", "tenant_id", "cloud_connector_id"),
    )


# -----------------------------------------------------------------------------
# V1 Models (5 tables)
# -----------------------------------------------------------------------------

class ITSMChangeRequest(Base):
    """Change requests for infrastructure and application modifications."""
    __tablename__ = "itsm_change_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    change_number = Column(String(32), nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, nullable=False)
    change_type = Column(String(20), nullable=False, default="STANDARD")
    risk_level = Column(String(20), nullable=False, default="LOW")
    impact_level = Column(String(20), nullable=False, default="LOW")
    status = Column(String(32), nullable=False, default="DRAFT")
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="RESTRICT"), nullable=True)
    lead_time_hours = Column(Integer, nullable=False, default=0)
    outage_expected = Column(Boolean, nullable=False, default=False)
    implementation_plan = Column(Text, nullable=False, default="")
    backout_plan = Column(Text, nullable=False, default="")
    test_plan = Column(Text, nullable=False, default="")
    requested_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    assigned_to_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_team = Column(String(100), nullable=True)
    pending_approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True)
    earliest_start_at = Column(DateTime(timezone=True), nullable=True)
    latest_finish_at = Column(DateTime(timezone=True), nullable=True)
    actual_start_at = Column(DateTime(timezone=True), nullable=True)
    actual_finish_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    service = relationship("ITSMService")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    pending_approval = relationship("PendingApproval")

    __table_args__ = (
        UniqueConstraint("tenant_id", "change_number", name="uq_itsm_change_tenant_number"),
        Index("idx_itsm_change_tenant_status", "tenant_id", "status"),
        Index("idx_itsm_change_service", "tenant_id", "service_id"),
        Index("idx_itsm_change_approval", "tenant_id", "pending_approval_id"),
    )


class ITSMChangeRequestCI(Base):
    """Normalized join relationship between Changes and Configuration Items."""
    __tablename__ = "itsm_change_request_cis"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    change_id = Column(UUID(as_uuid=True), ForeignKey("itsm_change_requests.id", ondelete="CASCADE"), nullable=False)
    ci_id = Column(UUID(as_uuid=True), ForeignKey("itsm_configuration_items.id", ondelete="RESTRICT"), nullable=False)
    impact_type = Column(String(32), nullable=False, default="AFFECTED")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    change = relationship("ITSMChangeRequest")
    ci = relationship("ITSMConfigurationItem")

    __table_args__ = (
        UniqueConstraint("tenant_id", "change_id", "ci_id", name="uq_itsm_change_ci_unique"),
        Index("idx_itsm_change_ci_change", "tenant_id", "change_id"),
        Index("idx_itsm_change_ci_ci", "tenant_id", "ci_id"),
    )


class ITSMServiceRelationship(Base):
    """Directed acyclic service dependency topology graph."""
    __tablename__ = "itsm_service_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    parent_service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False)
    child_service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False)
    relationship_type = Column(String(50), nullable=False, default="DEPENDS_ON")
    criticality = Column(String(20), nullable=False, default="MEDIUM")
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    parent_service = relationship("ITSMService", foreign_keys=[parent_service_id])
    child_service = relationship("ITSMService", foreign_keys=[child_service_id])

    __table_args__ = (
        UniqueConstraint("tenant_id", "parent_service_id", "child_service_id", name="uq_itsm_service_rel"),
        CheckConstraint("parent_service_id != child_service_id", name="ck_itsm_service_rel_no_self_ref"),
        Index("idx_itsm_serv_rel_parent", "tenant_id", "parent_service_id"),
        Index("idx_itsm_serv_rel_child", "tenant_id", "child_service_id"),
    )


class ITSMAttachment(Base):
    """File attachment records across tickets, changes, problems, and KB articles."""
    __tablename__ = "itsm_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    target_type = Column(String(32), nullable=False)
    target_id = Column(UUID(as_uuid=True), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size_bytes = Column(BigInteger, nullable=False)
    mime_type = Column(String(127), nullable=False)
    storage_path = Column(String(1024), nullable=False)
    storage_backend = Column(String(32), nullable=False, default="S3")
    checksum_sha256 = Column(String(64), nullable=False)
    is_quarantined = Column(Boolean, nullable=False, default=False)
    quarantine_reason = Column(String(255), nullable=True)
    uploaded_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    uploaded_by = relationship("User")

    __table_args__ = (
        Index("idx_itsm_attach_target", "tenant_id", "target_type", "target_id"),
    )


class ITSMProblemDetail(Base):
    """Root cause and permanent workaround tracking for problem tickets."""
    __tablename__ = "itsm_problem_details"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False)
    known_error = Column(Boolean, nullable=False, default=False)
    root_cause_summary = Column(Text, nullable=True)
    workaround_summary = Column(Text, nullable=True)
    permanent_solution = Column(Text, nullable=True)
    rca_document_url = Column(String(1024), nullable=True)
    assigned_investigator_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    identified_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    assigned_investigator = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_problem_details_ticket"),
        Index("idx_itsm_problem_investigator", "tenant_id", "assigned_investigator_id"),
    )


# -----------------------------------------------------------------------------
# V1.5 Models (8 tables)
# -----------------------------------------------------------------------------

class ITSMMajorIncident(Base):
    """Major incident response coordination, command bridge, and postmortem tracking."""
    __tablename__ = "itsm_major_incidents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False)
    incident_commander_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    bridge_url = Column(String(1024), nullable=True)
    communication_channel = Column(String(255), nullable=True)
    declared_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    declared_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    postmortem_status = Column(String(32), nullable=False, default="PENDING")
    postmortem_url = Column(String(1024), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    executive_summary = Column(Text, nullable=True)
    impacted_business_units = Column(PG_ARRAY(Text), nullable=False, default=list)
    customer_impact_description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    incident_commander = relationship("User", foreign_keys=[incident_commander_id])
    declared_by = relationship("User", foreign_keys=[declared_by_id])

    __table_args__ = (
        UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_major_incident_ticket"),
        Index("idx_itsm_major_inc_commander", "tenant_id", "incident_commander_id"),
    )


class ITSMOnCallSchedule(Base):
    """Service on-call schedules."""
    __tablename__ = "itsm_oncall_schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(255), nullable=False)
    timezone = Column(String(50), nullable=False, default="UTC")
    is_active = Column(Boolean, nullable=False, default=True)
    calendar_id = Column(UUID(as_uuid=True), ForeignKey("itsm_business_calendars.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    service = relationship("ITSMService")
    calendar = relationship("ITSMBusinessCalendar")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_itsm_oncall_sched_name"),
        Index("idx_itsm_oncall_service", "tenant_id", "service_id"),
    )


class ITSMOnCallRotation(Base):
    """Tiered rotation schedules for primary, secondary, and escalation managers."""
    __tablename__ = "itsm_oncall_rotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("itsm_oncall_schedules.id", ondelete="CASCADE"), nullable=False)
    tier_level = Column(Integer, nullable=False, default=1)
    user_ids = Column(PG_ARRAY(PG_UUID(as_uuid=True)), nullable=False, default=list)
    rotation_type = Column(String(20), nullable=False, default="WEEKLY")
    rotation_start_at = Column(DateTime(timezone=True), nullable=False)
    handoff_time = Column(String(10), nullable=False, default="09:00")
    escalation_delay_minutes = Column(Integer, nullable=False, default=15)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    schedule = relationship("ITSMOnCallSchedule")

    __table_args__ = (
        UniqueConstraint("tenant_id", "schedule_id", "tier_level", name="uq_itsm_oncall_tier"),
        Index("idx_itsm_oncall_rot_sched", "tenant_id", "schedule_id"),
    )


class ITSMOnCallOverride(Base):
    """Temporary on-call shift substitution overrides."""
    __tablename__ = "itsm_oncall_overrides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("itsm_oncall_schedules.id", ondelete="CASCADE"), nullable=False)
    tier_level = Column(Integer, nullable=False, default=1)
    original_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    override_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=False)
    reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    schedule = relationship("ITSMOnCallSchedule")
    original_user = relationship("User", foreign_keys=[original_user_id])
    override_user = relationship("User", foreign_keys=[override_user_id])

    __table_args__ = (
        Index("idx_itsm_override_time", "tenant_id", "schedule_id", "start_at", "end_at"),
    )


class ITSMAgentSession(Base):
    """Safe agent decision logs and action proposals (NO raw chain-of-thought)."""
    __tablename__ = "itsm_agent_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False)
    agent_run_id = Column(UUID(as_uuid=True), nullable=True)
    session_type = Column(String(32), nullable=False, default="TRIAGE")
    decision_summary = Column(Text, nullable=False)
    evidence_artifacts = Column(JSONB, nullable=False, default=dict)
    actions_proposed = Column(JSONB, nullable=False, default=list)
    actions_executed = Column(JSONB, nullable=False, default=list)
    confidence_score = Column(Numeric(4, 3), nullable=True)
    guardrail_flags = Column(PG_ARRAY(Text), nullable=False, default=list)
    requires_human_approval = Column(Boolean, nullable=False, default=False)
    pending_approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    pending_approval = relationship("PendingApproval")

    __table_args__ = (
        Index("idx_itsm_agent_ticket", "tenant_id", "ticket_id"),
        Index("idx_itsm_agent_run", "tenant_id", "agent_run_id"),
        Index("idx_itsm_agent_approval", "tenant_id", "pending_approval_id"),
    )


class ITSMWorkflow(Base):
    """Workflow templates and triggers."""
    __tablename__ = "itsm_workflows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    trigger_type = Column(String(50), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    current_published_version = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_itsm_workflow_slug"),
        Index("idx_itsm_workflow_trigger", "tenant_id", "trigger_type", "is_active"),
    )


class ITSMWorkflowVersion(Base):
    """Immutable versions of workflow definitions (nodes, edges, actions)."""
    __tablename__ = "itsm_workflow_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("itsm_workflows.id", ondelete="CASCADE"), nullable=False)
    version_number = Column(Integer, nullable=False)
    definition = Column(JSONB, nullable=False)
    changelog = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    workflow = relationship("ITSMWorkflow")
    creator = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "workflow_id", "version_number", name="uq_itsm_wf_version_number"),
        Index("idx_itsm_wf_version_wf", "tenant_id", "workflow_id"),
    )


class ITSMWorkflowExecution(Base):
    """Runtime execution instances of workflows."""
    __tablename__ = "itsm_workflow_executions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(UUID(as_uuid=True), ForeignKey("itsm_workflows.id", ondelete="CASCADE"), nullable=False)
    workflow_version = Column(Integer, nullable=False)
    trigger_event = Column(JSONB, nullable=False, default=dict)
    status = Column(String(32), nullable=False, default="RUNNING")
    current_step_id = Column(String(64), nullable=True)
    execution_context = Column(JSONB, nullable=False, default=dict)
    error_message = Column(Text, nullable=True)
    pending_approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    tenant = relationship("Tenant")
    workflow = relationship("ITSMWorkflow")
    pending_approval = relationship("PendingApproval")

    __table_args__ = (
        Index("idx_itsm_wf_exec_status", "tenant_id", "status"),
        Index("idx_itsm_wf_exec_approval", "tenant_id", "pending_approval_id"),
    )


# -----------------------------------------------------------------------------
# V2 Models (5 tables)
# -----------------------------------------------------------------------------

class ITSMEventRule(Base):
    """Event correlation, deduplication, and routing rules."""
    __tablename__ = "itsm_event_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    source_pattern = Column(String(255), nullable=False)
    condition_expression = Column(JSONB, nullable=False, default=dict)
    action_type = Column(String(50), nullable=False)
    target_service_id = Column(UUID(as_uuid=True), ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True)
    target_severity = Column(String(20), nullable=False, default="SEV_3")
    is_active = Column(Boolean, nullable=False, default=True)
    priority_order = Column(Integer, nullable=False, default=100)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    target_service = relationship("ITSMService")

    __table_args__ = (
        Index("idx_itsm_event_rules_tenant", "tenant_id", "is_active", "priority_order"),
    )


class ITSMIngestedEvent(Base):
    """Ingested monitoring and alerting events with fingerprint deduplication."""
    __tablename__ = "itsm_ingested_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    source = Column(String(100), nullable=False)
    event_type = Column(String(100), nullable=False)
    severity = Column(String(20), nullable=False, default="WARNING")
    payload = Column(JSONB, nullable=False)
    first_seen_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    occurrence_count = Column(Integer, nullable=False, default=1)
    status = Column(String(32), nullable=False, default="NEW")
    correlated_ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="SET NULL"), nullable=True)
    rule_matched_id = Column(UUID(as_uuid=True), ForeignKey("itsm_event_rules.id", ondelete="SET NULL"), nullable=True)

    tenant = relationship("Tenant")
    correlated_ticket = relationship("ITSMTicket")
    rule_matched = relationship("ITSMEventRule")

    __table_args__ = (
        UniqueConstraint("tenant_id", "fingerprint", name="uq_itsm_event_tenant_fingerprint"),
        Index("idx_itsm_events_status", "tenant_id", "status"),
        Index("idx_itsm_events_ticket", "tenant_id", "correlated_ticket_id"),
    )


class ITSMIntegrationConfig(Base):
    """Third-party integration configurations (Jira, ServiceNow, PagerDuty, etc.)."""
    __tablename__ = "itsm_integration_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    integration_type = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    config_schema = Column(JSONB, nullable=False, default=dict)
    encrypted_credentials = Column(JSONB, nullable=False, default=dict)
    is_active = Column(Boolean, nullable=False, default=True)
    sync_interval_seconds = Column(Integer, nullable=False, default=300)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_itsm_integ_name"),
        Index("idx_itsm_integ_type", "tenant_id", "integration_type", "is_active"),
    )


class ITSMIntegrationSyncRecord(Base):
    """Synchronization audit and state tracking across external ITSM systems."""
    __tablename__ = "itsm_integration_sync_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    integration_config_id = Column(UUID(as_uuid=True), ForeignKey("itsm_integration_configs.id", ondelete="CASCADE"), nullable=False)
    sync_type = Column(String(50), nullable=False)
    external_id = Column(String(255), nullable=True)
    internal_entity_type = Column(String(50), nullable=False)
    internal_entity_id = Column(UUID(as_uuid=True), nullable=False)
    sync_status = Column(String(32), nullable=False, default="SUCCESS")
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=3)
    error_details = Column(Text, nullable=True)
    conflict_resolution = Column(String(32), nullable=True)
    synced_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    integration_config = relationship("ITSMIntegrationConfig")

    __table_args__ = (
        Index("idx_itsm_sync_entity", "tenant_id", "internal_entity_type", "internal_entity_id"),
        Index("idx_itsm_sync_status", "tenant_id", "sync_status"),
    )


class ITSMProactiveRemediation(Base):
    """Governed proactive remediation tracking with pre/post checks and rollback."""
    __tablename__ = "itsm_proactive_remediations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("itsm_ingested_events.id", ondelete="SET NULL"), nullable=True)
    rule_id = Column(UUID(as_uuid=True), ForeignKey("itsm_event_rules.id", ondelete="SET NULL"), nullable=True)
    runbook_identifier = Column(String(255), nullable=False)
    governance_approval_id = Column(UUID(as_uuid=True), ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True)
    pre_check_results = Column(JSONB, nullable=False, default=dict)
    execution_results = Column(JSONB, nullable=False, default=dict)
    post_check_results = Column(JSONB, nullable=False, default=dict)
    rollback_plan = Column(JSONB, nullable=False, default=dict)
    rollback_executed = Column(Boolean, nullable=False, default=False)
    rollback_results = Column(JSONB, nullable=False, default=dict)
    status = Column(String(32), nullable=False, default="PENDING_APPROVAL")
    started_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    tenant = relationship("Tenant")
    ticket = relationship("ITSMTicket")
    event = relationship("ITSMIngestedEvent")
    rule = relationship("ITSMEventRule")
    governance_approval = relationship("PendingApproval")

    __table_args__ = (
        Index("idx_itsm_remed_status", "tenant_id", "status"),
        Index("idx_itsm_remed_approval", "tenant_id", "governance_approval_id"),
    )


class ITSMUserAccess(Base):
    """Product-specific access and finalized ITSM business role assignment."""
    __tablename__ = "itsm_user_access"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    itsm_role = Column(String(50), nullable=False, default="REQUESTER")
    has_itsm_access = Column(Boolean, nullable=False, default=True)
    has_governance_access = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_itsm_user_access_tenant_user"),
        Index("idx_itsm_user_access_lookup", "tenant_id", "user_id"),
        Index("idx_itsm_user_access_role", "tenant_id", "itsm_role"),
    )


class ITSMTeam(Base):
    """ITSM operational teams and assignment groups."""
    __tablename__ = "itsm_teams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    members = relationship("ITSMTeamMember", back_populates="team", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_itsm_teams_tenant_name"),
        Index("idx_itsm_teams_tenant", "tenant_id"),
        Index("idx_itsm_teams_tenant_status", "tenant_id", "is_active"),
    )


class ITSMTeamMember(Base):
    """Membership of an existing AuthClaw user within an ITSM operational team."""
    __tablename__ = "itsm_team_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    team_id = Column(UUID(as_uuid=True), ForeignKey("itsm_teams.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    tenant = relationship("Tenant")
    team = relationship("ITSMTeam", back_populates="members")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_itsm_team_members_team_user"),
        Index("idx_itsm_team_members_lookup", "tenant_id", "team_id"),
        Index("idx_itsm_team_members_user", "tenant_id", "user_id"),
    )

