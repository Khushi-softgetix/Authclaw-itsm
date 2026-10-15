"""Domain service for secure ITSM employee account activation and invitation lifecycle."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import os
import re
import secrets
from typing import Any, Callable, List, Optional, Tuple
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.passwords import hash_password, validate_password
from app.db.models import (
    ITSMUserAccess,
    OnboardingEmailOTP,
    Tenant,
    User,
)
from app.schemas.itsm_admin import (
    VALID_ITSM_ROLES,
    AccountActivationRequest,
    AccountActivationResponse,
    ITSMEmployeeCreateManualResponse,
    ITSMEmployeeInviteResponse,
    InvitationResendResponse,
    InvitationRevokeResponse,
    PendingInviteResponse,
)
from app.services.audit_store import append_audit_event
from app.services.email_service import (
    EmailDeliveryError,
    demo_otp_visible,
    send_activation_email,
)

logger = logging.getLogger(__name__)

ACTIVATION_TOKEN_TTL_HOURS = 24
OTP_RESEND_COOLDOWN_SECONDS = 60
MAX_ACTIVATION_ATTEMPTS = 5


def generate_activation_token() -> str:
    """Generate a cryptographically secure, URL-safe activation token with 256 bits of entropy."""
    return secrets.token_urlsafe(32)


def hash_activation_token(token_or_email: str, token: str | None = None) -> str:
    """Compute a cryptographic SHA-256 digest of the activation token keyed with the server secret."""
    from app.core.crypto import get_session_key_ring
    active, keys = get_session_key_ring()
    secret = keys.get("v1") or keys[active]
    if token is not None:
        email = token_or_email.strip().lower()
        raw_token = token.strip()
        material = f"{email}:{raw_token}:{secret}".encode("utf-8")
    else:
        raw_token = token_or_email.strip()
        material = f"{raw_token}:{secret}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _get_console_url() -> str:
    return (
        os.getenv("PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_SITE_URL")
        or os.getenv("NEXT_PUBLIC_APP_URL")
        or "http://localhost:3001"
    ).rstrip("/")


def _emit_activation_audit(
    db: Session,
    tenant_id: UUID,
    actor_id: Optional[UUID],
    action: str,
    target_id: UUID,
    reason: str,
    details: Optional[dict[str, Any]] = None,
) -> None:
    now = datetime.now(timezone.utc)
    try:
        db.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(tenant_id)},
        )
        append_audit_event(
            db,
            {
                "id": str(uuid4()),
                "idempotency_key": f"itsm:activation:{action}:{tenant_id}:{target_id}:{uuid4().hex[:8]}",
                "tenant_id": str(tenant_id),
                "timestamp": now,
                "actor_id": str(actor_id) if actor_id else None,
                "actor_type": "user" if actor_id else "system",
                "action": action,
                "request_id": str(target_id),
                "provider": "itsm",
                "reason": reason,
                "response_status": 200,
                "frameworks_affected": ["ITIL"],
            },
        )
        db.commit()
    except Exception as exc:
        logger.warning("Failed to emit activation audit event: %s", exc)


class ITSMEmployeeActivationService:
    """Service encapsulating secure activation token generation, verification, and revocation."""

    @classmethod
    def invite_employee(
        cls,
        db: Session,
        tenant_id: UUID,
        admin_user_id: Optional[UUID],
        email: str,
        itsm_role: str,
        send_email: bool = True,
        request_id: str = "",
        delivery_fn: Optional[Callable] = None,
    ) -> ITSMEmployeeInviteResponse:
        """Create or invite an employee with a 24-hour secure activation token."""
        clean_email = email.strip().lower()
        clean_role = itsm_role.strip().upper()
        if clean_role == "SERVICE_LEAD":
            clean_role = "INCIDENT_MANAGER"
        if clean_role not in VALID_ITSM_ROLES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid ITSM role '{itsm_role}'. Allowed roles: {', '.join(VALID_ITSM_ROLES)}",
            )

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=ACTIVATION_TOKEN_TTL_HOURS)

        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

        # 1. Check if user already exists
        existing_user = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, User.email == clean_email)
            .first()
        )

        if existing_user and existing_user.is_active:
            # Active user already exists: update role access without touching credentials
            access_rec = (
                db.query(ITSMUserAccess)
                .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == existing_user.id)
                .first()
            )
            if access_rec:
                access_rec.has_itsm_access = True
                access_rec.itsm_role = clean_role
                access_rec.updated_at = now
            else:
                access_rec = ITSMUserAccess(
                    tenant_id=tenant_id,
                    user_id=existing_user.id,
                    itsm_role=clean_role,
                    has_itsm_access=True,
                    has_governance_access=False,
                    created_at=now,
                    updated_at=now,
                )
                db.add(access_rec)
            db.commit()
            return ITSMEmployeeInviteResponse(
                status="already_exists",
                message="This employee already has an AuthClaw account.",
                email=clean_email,
                itsm_role=clean_role,
                user_id=existing_user.id,
            )

        # 2. Provision or reuse inactive user account
        if existing_user:
            target_user = existing_user
        else:
            target_user = User(
                tenant_id=tenant_id,
                email=clean_email,
                role="viewer",
                platform_role="NONE",
                is_active=False,  # Crucial: pending accounts CANNOT authenticate
            )
            db.add(target_user)
            db.flush()

        target_user_id = target_user.id

        # 3. Pre-link ITSMUserAccess
        access_rec = (
            db.query(ITSMUserAccess)
            .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == target_user.id)
            .first()
        )
        if access_rec:
            access_rec.has_itsm_access = True
            access_rec.itsm_role = clean_role
            access_rec.updated_at = now
        else:
            access_rec = ITSMUserAccess(
                tenant_id=tenant_id,
                user_id=target_user.id,
                itsm_role=clean_role,
                has_itsm_access=True,
                has_governance_access=False,
                created_at=now,
                updated_at=now,
            )
            db.add(access_rec)

        # 4. Invalidate prior pending invitations for this email (replacement invalidation)
        prior_invites = (
            db.query(OnboardingEmailOTP)
            .filter(
                OnboardingEmailOTP.tenant_id == tenant_id,
                OnboardingEmailOTP.email == clean_email,
                OnboardingEmailOTP.status == "pending",
                OnboardingEmailOTP.purpose == "invite",
            )
            .all()
        )
        for prior in prior_invites:
            prior.status = "superseded"
            prior.updated_at = now

        # 5. Generate secure activation token and persist only its hash
        raw_token = generate_activation_token()
        token_hash = hash_activation_token(clean_email, raw_token)

        invite_row = OnboardingEmailOTP(
            email=clean_email,
            tenant_name=tenant.name,
            otp_hash=token_hash,
            status="pending",
            expires_at=expires_at,
            sent_at=now,
            purpose="invite",
            invited_role=clean_role,
            invited_by=admin_user_id,
            tenant_id=tenant_id,
        )
        db.add(invite_row)
        db.flush()

        # 6. Dispatch activation email
        console_url = _get_console_url()
        action_url = f"{console_url}/itsm/setup?invite={invite_row.id}&token={raw_token}&email={quote(clean_email)}"

        if not send_email:
            invite_row.last_delivery = "skipped"
            db.commit()
            _emit_activation_audit(
                db, tenant_id, admin_user_id, "itsm.employee.invited", target_user_id, "invitation_created"
            )
            return ITSMEmployeeInviteResponse(
                status="invited",
                message="Invitation created successfully.",
                email=clean_email,
                itsm_role=clean_role,
                user_id=target_user_id,
                signup_id=invite_row.id,
                delivery="skipped",
                expires_at=expires_at,
                action_url=action_url,
            )

        try:
            if delivery_fn:
                delivery_method, dev_otp = delivery_fn(
                    clean_email, raw_token, tenant.name, action_url, clean_role
                )
            else:
                delivery_res = send_activation_email(
                    clean_email,
                    tenant.name,
                    action_url,
                    role=clean_role,
                    expires_in_hours=ACTIVATION_TOKEN_TTL_HOURS,
                )
                delivery_method = delivery_res.method
                dev_otp = raw_token if demo_otp_visible() else None

            invite_row.last_delivery = delivery_method
            invite_row.delivery_error = None
            db.commit()

            _emit_activation_audit(
                db, tenant_id, admin_user_id, "itsm.employee.invited", target_user_id, "invitation_created"
            )

            return ITSMEmployeeInviteResponse(
                status="invited",
                message="Invitation sent successfully.",
                email=clean_email,
                itsm_role=clean_role,
                user_id=target_user_id,
                signup_id=invite_row.id,
                delivery=delivery_method,
                dev_otp=dev_otp,
                expires_at=expires_at,
                action_url=action_url,
            )
        except EmailDeliveryError as exc:
            db.rollback()
            _emit_activation_audit(
                db, tenant_id, admin_user_id, "itsm.employee.invite_delivery_failed", target_user_id, "delivery_failed"
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invitation delivery is temporarily unavailable",
            ) from exc

    @classmethod
    def create_employee_securely(
        cls,
        db: Session,
        tenant_id: UUID,
        admin_user_id: Optional[UUID],
        email: str,
        itsm_role: str,
        send_email: bool = True,
        request_id: str = "",
        delivery_fn: Optional[Callable] = None,
    ) -> ITSMEmployeeCreateManualResponse:
        """Create employee without storing or sending temporary passwords."""
        invite_res = cls.invite_employee(
            db, tenant_id, admin_user_id, email, itsm_role, send_email=send_email, request_id=request_id, delivery_fn=delivery_fn
        )
        return ITSMEmployeeCreateManualResponse(
            status="created" if invite_res.status == "invited" else invite_res.status,
            message="Employee created successfully. Activation link generated.",
            email=invite_res.email,
            itsm_role=invite_res.itsm_role,
            user_id=invite_res.user_id,
            signup_id=invite_res.signup_id,
            has_itsm_access=True,
            delivery=invite_res.delivery,
            expires_at=invite_res.expires_at,
            action_url=invite_res.action_url,
        )

    @classmethod
    def activate_account(
        cls,
        db: Session,
        payload: AccountActivationRequest,
        request_id: str = "",
    ) -> AccountActivationResponse:
        """Atomically activate an account and set the employee's initial password."""
        raw_token = payload.token.strip() if payload.token else ""
        if not raw_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Activation token is required")

        # 1. Validate password constraints
        try:
            validate_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        if not payload.signup_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or unknown activation token",
            )

        now = datetime.now(timezone.utc)
        from app.core.crypto import get_session_key_ring
        active, keys = get_session_key_ring()

        # 2. Call authn.consume_onboarding_invite_for_otp (atomically verifies state, expiry, attempts, hash, and sets tenant context)
        try:
            preauth = db.execute(
                text(
                    """
                    SELECT outcome, tenant_id, email, tenant_name, invited_role
                      FROM authn.consume_onboarding_invite_for_otp(
                        :signup_id, :otp, :secrets, :max_attempts, 'v1', 'v1'
                      )
                    """
                ),
                {
                    "signup_id": str(payload.signup_id),
                    "otp": raw_token,
                    "secrets": list(keys.values()),
                    "max_attempts": MAX_ACTIVATION_ATTEMPTS,
                },
            ).first()
        except Exception as exc:
            logger.error("Error executing consume_onboarding_invite_for_otp: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or unknown activation token",
            ) from exc

        if not preauth:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or unknown activation token",
            )

        if preauth.outcome != "valid":
            db.commit()  # persist attempt counter or expired status updated by the SQL function
            if preauth.outcome == "not_found":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid or unknown activation token",
                )
            elif preauth.outcome == "verified":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Activation link has already been used",
                )
            elif preauth.outcome == "revoked":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Activation link has been revoked",
                )
            elif preauth.outcome == "superseded":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This activation link has been replaced by a newer invitation",
                )
            elif preauth.outcome == "expired":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Activation link has expired",
                )
            elif preauth.outcome == "locked":
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed activation attempts. Invitation is locked.",
                )
            elif preauth.outcome == "invalid":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid activation token",
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invitation is no longer pending",
                )

        # 3. Locate target user account within the tenant context established by authn.set_context
        tenant_id = preauth.tenant_id
        user_email = preauth.email

        user = (
            db.query(User)
            .filter(
                User.tenant_id == tenant_id,
                User.email == user_email,
            )
            .with_for_update()
            .first()
        )
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found")

        if user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account is already active",
            )

        # 4. Atomically set password and activate account
        user.password_hash = hash_password(payload.password)
        user.is_active = True
        user.updated_at = now

        # 5. Mark invitation verified
        invite_row = (
            db.query(OnboardingEmailOTP)
            .filter(OnboardingEmailOTP.id == payload.signup_id)
            .with_for_update()
            .first()
        )
        if invite_row:
            invite_row.status = "verified"
            invite_row.verified_at = now
            invite_row.updated_at = now

        # 6. Retrieve ITSM role
        access_rec = (
            db.query(ITSMUserAccess)
            .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == user.id)
            .first()
        )
        itsm_role = access_rec.itsm_role if access_rec else preauth.invited_role

        target_user_id = user.id
        target_tenant_id = tenant_id
        target_email = user_email

        db.commit()

        _emit_activation_audit(
            db,
            target_tenant_id,
            target_user_id,
            "itsm.employee.activated",
            target_user_id,
            "account_activated_successfully",
        )

        logger.info(
            "[ITSM_ACTIVATION_AUDIT] action=account_activated tenant_id=%s user_id=%s email=%s role=%s",
            target_tenant_id,
            target_user_id,
            target_email,
            itsm_role,
        )

        return AccountActivationResponse(
            status="activated",
            message="Account activated successfully. You may now sign in.",
            email=target_email,
            user_id=target_user_id,
            itsm_role=itsm_role,
        )

    @classmethod
    def resend_invitation(
        cls,
        db: Session,
        tenant_id: UUID,
        admin_user_id: Optional[UUID],
        invite_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
        email: Optional[str] = None,
        delivery_fn: Optional[Callable] = None,
    ) -> InvitationResendResponse:
        """Resend activation link, invalidating previous tokens and issuing a fresh 24-hour token."""
        now = datetime.now(timezone.utc)
        query = db.query(OnboardingEmailOTP).filter(
            OnboardingEmailOTP.tenant_id == tenant_id,
            OnboardingEmailOTP.purpose == "invite",
        ).with_for_update()

        if invite_id:
            invite_row = query.filter(OnboardingEmailOTP.id == invite_id).first()
        elif user_id:
            user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
            invite_row = query.filter(OnboardingEmailOTP.email == user.email).order_by(OnboardingEmailOTP.created_at.desc()).first()
        elif email:
            invite_row = query.filter(OnboardingEmailOTP.email == email.strip().lower()).order_by(OnboardingEmailOTP.created_at.desc()).first()
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invite_id, user_id, or email required")

        if not invite_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")

        invite_row_id = invite_row.id

        if invite_row.status == "verified":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee has already activated their account")
        if invite_row.status == "revoked":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot resend a revoked invitation. Issue a new invite.")

        # Rate limiting cooldown check
        if invite_row.sent_at:
            sent_at = invite_row.sent_at
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            if (now - sent_at).total_seconds() < OTP_RESEND_COOLDOWN_SECONDS:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Please wait {OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another invitation email",
                )

        # Invalidate previous token and generate fresh one
        raw_token = generate_activation_token()
        token_hash = hash_activation_token(invite_row.email, raw_token)
        expires_at = now + timedelta(hours=ACTIVATION_TOKEN_TTL_HOURS)

        invite_row.otp_hash = token_hash
        invite_row.status = "pending"
        invite_row.expires_at = expires_at
        invite_row.sent_at = now
        invite_row.attempts = 0
        invite_row.resend_count = (invite_row.resend_count or 0) + 1
        invite_row.delivery_error = None

        db.flush()

        console_url = _get_console_url()
        action_url = f"{console_url}/itsm/setup?invite={invite_row.id}&token={raw_token}&email={quote(invite_row.email)}"

        try:
            if delivery_fn:
                delivery_method, _ = delivery_fn(
                    invite_row.email, raw_token, invite_row.tenant_name, action_url, invite_row.invited_role
                )
            else:
                delivery_res = send_activation_email(
                    invite_row.email,
                    invite_row.tenant_name,
                    action_url,
                    role=invite_row.invited_role,
                    expires_in_hours=ACTIVATION_TOKEN_TTL_HOURS,
                )
                delivery_method = delivery_res.method

            invite_row.last_delivery = delivery_method
            db.commit()

            _emit_activation_audit(
                db,
                tenant_id,
                admin_user_id,
                "itsm.employee.invite_resent",
                invite_row.id,
                "invitation_resent",
            )

            return InvitationResendResponse(
                status="resent",
                message="Activation invitation resent successfully.",
                signup_id=invite_row.id,
                email=invite_row.email,
                expires_at=expires_at,
                delivery=delivery_method,
            )
        except EmailDeliveryError as exc:
            db.rollback()
            _emit_activation_audit(
                db,
                tenant_id,
                admin_user_id,
                "itsm.employee.resend_delivery_failed",
                invite_row_id,
                "delivery_failed",
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Invitation delivery is temporarily unavailable",
            ) from exc

    @classmethod
    def revoke_invitation(
        cls,
        db: Session,
        tenant_id: UUID,
        admin_user_id: Optional[UUID],
        invite_id: Optional[UUID] = None,
        user_id: Optional[UUID] = None,
    ) -> InvitationRevokeResponse:
        """Revoke a pending invitation, preventing subsequent token redemption."""
        now = datetime.now(timezone.utc)
        query = db.query(OnboardingEmailOTP).filter(
            OnboardingEmailOTP.tenant_id == tenant_id,
            OnboardingEmailOTP.purpose == "invite",
        ).with_for_update()

        if invite_id:
            invite_row = query.filter(OnboardingEmailOTP.id == invite_id).first()
        elif user_id:
            user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
            if not user:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
            invite_row = query.filter(
                OnboardingEmailOTP.email == user.email,
                OnboardingEmailOTP.status == "pending",
            ).order_by(OnboardingEmailOTP.created_at.desc()).first()
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invite_id or user_id required")

        if not invite_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending invitation not found")

        if invite_row.status == "verified":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot revoke an already activated invitation",
            )

        invite_row.status = "revoked"
        invite_row.updated_at = now
        db.commit()

        _emit_activation_audit(
            db,
            tenant_id,
            admin_user_id,
            "itsm.employee.invite_revoked",
            invite_row.id,
            "invitation_revoked",
        )

        return InvitationRevokeResponse(
            status="revoked",
            message="Invitation revoked successfully.",
            signup_id=invite_row.id,
            email=invite_row.email,
        )

    @classmethod
    def list_pending_invitations(
        cls,
        db: Session,
        tenant_id: UUID,
    ) -> List[PendingInviteResponse]:
        """List active pending employee invitations for the tenant."""
        rows = (
            db.query(OnboardingEmailOTP)
            .filter(
                OnboardingEmailOTP.tenant_id == tenant_id,
                OnboardingEmailOTP.status == "pending",
                OnboardingEmailOTP.purpose == "invite",
            )
            .order_by(OnboardingEmailOTP.created_at.desc())
            .all()
        )
        return [
            PendingInviteResponse(
                signup_id=row.id,
                email=row.email,
                tenant_name=row.tenant_name,
                invited_role=row.invited_role,
                status=row.status,
                expires_at=row.expires_at,
                sent_at=row.sent_at,
                resend_count=row.resend_count or 0,
                delivery=row.last_delivery,
            )
            for row in rows
        ]
