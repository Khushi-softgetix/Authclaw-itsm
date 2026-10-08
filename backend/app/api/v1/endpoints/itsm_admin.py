"""API Router for ITSM Platform Administration."""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import (
    APIKey,
    ITSMBusinessCalendar,
    ITSMConfigurationItem,
    ITSMService,
    ITSMServiceCatalogItem,
    ITSMSLAPolicy,
    ITSMTeam,
    ITSMTeamMember,
    ITSMUserAccess,
    OnboardingEmailOTP,
    Tenant,
    User,
)
from app.core.passwords import hash_password
from app.services import event_backbone
from app.api.v1.endpoints.onboarding import (
    OTP_TTL_MINUTES,
    _deliver_otp,
    _emit_invitation_audit,
    _generate_otp,
    _otp_hash,
)
from app.services.email_service import EmailDeliveryError, send_email
from app.schemas.itsm_admin import (
    VALID_ITSM_ROLES,
    CIBulkImportCommitRequest,
    CIBulkImportCommitResponse,
    CIBulkImportDryRunRequest,
    CIBulkImportDryRunResponse,
    ITSMBusinessCalendarCreateRequest,
    ITSMBusinessCalendarResponse,
    ITSMBusinessCalendarUpdateRequest,
    ITSMConfigurationItemCreateRequest,
    ITSMConfigurationItemResponse,
    ITSMConfigurationItemUpdateRequest,
    ITSMEmployeeCreateManualRequest,
    ITSMEmployeeCreateManualResponse,
    ITSMEmployeeInviteRequest,
    ITSMEmployeeInviteResponse,
    ITSMServiceCatalogItemCreateRequest,
    ITSMServiceCatalogItemResponse,
    ITSMServiceCatalogItemUpdateRequest,
    ITSMServiceCatalogValidationResponse,
    ITSMServiceCreateRequest,
    ITSMServiceResponse,
    ITSMServiceUpdateRequest,
    ITSMSLAPolicyCreateRequest,
    ITSMSLAPolicyResponse,
    ITSMSLAPolicyUpdateRequest,
    ITSMTeamCreateRequest,
    ITSMTeamDetailResponse,
    ITSMTeamMemberAddRequest,
    ITSMTeamMemberResponse,
    ITSMTeamResponse,
    ITSMTeamUpdateRequest,
    ITSMUserAccessUpdateRequest,
    ITSMUserItemResponse,
    ITSMPlatformSettingsResponse,
)
from app.services.itsm_ci_import_service import CIImportService

logger = logging.getLogger(__name__)

router = APIRouter()


def _friendly_name_from_email(email: str) -> str:
    prefix = email.split("@")[0]
    parts = [p.capitalize() for p in prefix.replace(".", " ").replace("_", " ").split()]
    return " ".join(parts) or email


def _slugify(text_val: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text_val.strip().lower()).strip("-")
    return slug[:100] or "service"


SUPPORTED_QUESTION_TYPES = {
    "text",
    "textarea",
    "number",
    "dropdown",
    "radio",
    "multiselect",
}

FIELD_KEY_REGEX = re.compile(r"^[a-z][a-z0-9_]*$")


def _validate_intake_schema(schema: Optional[dict]) -> None:
    """Validate intake_schema questions structure for No-Code Catalog Item Form Builder."""
    if not schema:
        return
    if not isinstance(schema, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="intake_schema must be a JSON object",
        )

    questions = schema.get("questions")
    if questions is None:
        return

    if not isinstance(questions, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="intake_schema.questions must be an array of questions",
        )

    seen_keys: set[str] = set()
    for idx, q in enumerate(questions):
        if not isinstance(q, dict):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Question at index {idx} must be a JSON object",
            )

        q_id = q.get("id") or q.get("field_key") or q.get("key")
        if not q_id or not isinstance(q_id, str) or not q_id.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Question at index {idx} requires a non-empty field key",
            )

        q_id = q_id.strip()
        if not FIELD_KEY_REGEX.match(q_id):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Question field key '{q_id}' must start with a lowercase letter "
                    "and contain only lowercase letters, numbers, and underscores"
                ),
            )

        if q_id in seen_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Duplicate field key '{q_id}' found in questions list",
            )
        seen_keys.add(q_id)

        label = q.get("label")
        if label is not None and not isinstance(label, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Question '{q_id}' label must be a string",
            )

        q_type = q.get("type")
        if not q_type or not isinstance(q_type, str) or q_type.lower() not in SUPPORTED_QUESTION_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Question '{q_id}' has unsupported question type '{q_type}'. "
                    f"Supported types: {', '.join(sorted(SUPPORTED_QUESTION_TYPES))}"
                ),
            )
        q_type = q_type.lower()

        required = q.get("required")
        if required is not None and not isinstance(required, bool):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Question '{q_id}' 'required' must be a boolean",
            )

        if q_type in ("dropdown", "radio", "multiselect"):
            options = q.get("options")
            if not isinstance(options, list) or len(options) == 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Question '{q_id}' of type '{q_type}' requires a non-empty list of options",
                )
            clean_opts = []
            for opt_idx, opt in enumerate(options):
                if not isinstance(opt, str) or not opt.strip():
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Option at index {opt_idx} for question '{q_id}' cannot be empty",
                    )
                clean_opts.append(opt.strip())
            if len(clean_opts) != len({o.lower() for o in clean_opts}):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Duplicate options are not allowed for question '{q_id}'",
                )



def _validate_fulfillment_group(db: Session, tenant_id: UUID, group_name: Optional[str]) -> Optional[str]:
    """Validate fulfillment team selection according to tenant isolation and active status."""
    if not group_name:
        return None
    trimmed = group_name.strip()
    if not trimmed:
        return None

    # Check if a team with this name exists in this tenant
    team_in_tenant = (
        db.query(ITSMTeam)
        .filter(
            ITSMTeam.tenant_id == tenant_id,
            func.lower(ITSMTeam.name) == trimmed.lower(),
        )
        .first()
    )

    if team_in_tenant:
        if not team_in_tenant.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fulfillment team '{trimmed}' is inactive in this tenant",
            )
        return team_in_tenant.name

    # Check if a team exists in another tenant (cross-tenant violation)
    cross_tenant_team = (
        db.query(ITSMTeam)
        .filter(
            ITSMTeam.tenant_id != tenant_id,
            func.lower(ITSMTeam.name) == trimmed.lower(),
        )
        .first()
    )
    if cross_tenant_team:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Fulfillment team '{trimmed}' belongs to another tenant",
        )

    # If this tenant has teams configured in itsm_teams, the group must match one of them
    tenant_has_teams = (
        db.query(ITSMTeam.id)
        .filter(ITSMTeam.tenant_id == tenant_id)
        .first()
    ) is not None

    if tenant_has_teams:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Fulfillment team '{trimmed}' does not exist in this tenant",
        )

    return trimmed


def _validate_catalog_offering(
    db: Session,
    tenant_id: UUID,
    item: ITSMServiceCatalogItem,
) -> tuple[bool, str, list[str], list[dict]]:
    """
    Deterministically validate a catalog offering configuration across:
    1. Basic Information (name, slug, parent service)
    2. Form Configuration (intake_schema structure)
    3. Question Definitions (field keys, types, options, required flags, uniqueness)
    4. Approval Configuration (approval_required boolean)
    5. Fulfillment Configuration (active team belonging to current tenant)
    """
    errors: list[str] = []
    checks: list[dict] = []

    # 1. Basic Information
    basic_errors: list[str] = []
    if not item.name or not item.name.strip():
        basic_errors.append("Catalog item requires a non-empty title/name")
    elif len(item.name.strip()) < 2:
        basic_errors.append("Catalog item name must be at least 2 characters long")
    elif len(item.name.strip()) > 255:
        basic_errors.append("Catalog item name cannot exceed 255 characters")

    if not item.slug or not item.slug.strip():
        basic_errors.append("Catalog item requires a valid URL slug identifier")
    elif len(item.slug.strip()) > 100:
        basic_errors.append("Catalog item slug cannot exceed 100 characters")

    if not item.service_id:
        basic_errors.append("Parent service is required")
    else:
        srv = (
            db.query(ITSMService)
            .filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id)
            .first()
        )
        if not srv:
            cross_srv = db.query(ITSMService).filter(ITSMService.id == item.service_id).first()
            if cross_srv:
                basic_errors.append("Parent service belongs to another tenant")
            else:
                basic_errors.append("Referenced parent service does not exist in this tenant")
        elif hasattr(srv, "status") and srv.status and str(srv.status).upper() in ("INACTIVE", "DEPRECATED", "DELETED"):
            basic_errors.append(f"Referenced parent service is {srv.status}")

    checks.append({
        "category": "basic_info",
        "name": "Basic Information",
        "passed": len(basic_errors) == 0,
        "message": "; ".join(basic_errors) if basic_errors else "Title, slug, and parent service valid",
    })
    errors.extend(basic_errors)

    # 2. Form Configuration & 3. Question Definitions
    form_errors: list[str] = []
    question_errors: list[str] = []

    schema = item.intake_schema
    if schema is not None and not isinstance(schema, dict):
        form_errors.append("intake_schema must be a valid JSON object")
    else:
        questions = (schema or {}).get("questions")
        if questions is not None and not isinstance(questions, list):
            form_errors.append("Form intake_schema.questions must be an array")
        elif questions:
            seen_keys: set[str] = set()
            for idx, q in enumerate(questions):
                if not isinstance(q, dict):
                    question_errors.append(f"Question at index {idx} must be a JSON object")
                    continue

                q_id = q.get("id") or q.get("field_key") or q.get("key")
                if not q_id or not isinstance(q_id, str) or not q_id.strip():
                    question_errors.append(f"Question at index {idx} requires a valid key")
                    continue

                q_id = q_id.strip()
                if not FIELD_KEY_REGEX.match(q_id):
                    question_errors.append(
                        f"Question field key '{q_id}' must start with a lowercase letter and contain only lowercase letters, digits, and underscores"
                    )

                if q_id in seen_keys:
                    question_errors.append(f"Duplicate question key '{q_id}' found in form configuration")
                seen_keys.add(q_id)

                label = q.get("label")
                if label is not None and not isinstance(label, str):
                    question_errors.append(f"Question '{q_id}' label must be a string")

                q_type = q.get("type")
                if not q_type or not isinstance(q_type, str) or q_type.lower() not in SUPPORTED_QUESTION_TYPES:
                    question_errors.append(
                        f"Question '{q_id}' has unsupported type '{q_type}'"
                    )
                else:
                    q_type = q_type.lower()
                    if q_type in ("dropdown", "radio", "multiselect"):
                        opts = q.get("options")
                        if not isinstance(opts, list) or len(opts) == 0:
                            question_errors.append(f"Question '{q_id}' of type '{q_type}' has no valid options")
                        else:
                            clean_opts = []
                            for opt_idx, opt in enumerate(opts):
                                if not isinstance(opt, str) or not opt.strip():
                                    question_errors.append(f"Option at index {opt_idx} for question '{q_id}' cannot be empty")
                                else:
                                    clean_opts.append(opt.strip())
                            if len(clean_opts) != len({o.lower() for o in clean_opts}):
                                question_errors.append(f"Duplicate options are not allowed for question '{q_id}'")

                req = q.get("required")
                if req is not None and not isinstance(req, bool):
                    question_errors.append(f"Question '{q_id}' 'required' must be a boolean")

    checks.append({
        "category": "form_schema",
        "name": "Form Configuration",
        "passed": len(form_errors) == 0,
        "message": "; ".join(form_errors) if form_errors else "Intake schema structure valid",
    })
    errors.extend(form_errors)

    checks.append({
        "category": "question_definitions",
        "name": "Question Definitions",
        "passed": len(question_errors) == 0,
        "message": "; ".join(question_errors) if question_errors else "All question keys, types, and options valid",
    })
    errors.extend(question_errors)

    # 4. Approval Configuration
    approval_errors: list[str] = []
    if not isinstance(item.approval_required, bool):
        approval_errors.append("Approval configuration must be a boolean flag")

    checks.append({
        "category": "approval",
        "name": "Approval Configuration",
        "passed": len(approval_errors) == 0,
        "message": "; ".join(approval_errors) if approval_errors else "Approval routing configuration valid",
    })
    errors.extend(approval_errors)

    # 5. Fulfillment Configuration
    fulfillment_errors: list[str] = []
    if item.fulfillment_group and item.fulfillment_group.strip():
        fg_name = item.fulfillment_group.strip()
        team_in_tenant = (
            db.query(ITSMTeam)
            .filter(
                ITSMTeam.tenant_id == tenant_id,
                func.lower(ITSMTeam.name) == fg_name.lower(),
            )
            .first()
        )
        if team_in_tenant:
            if not team_in_tenant.is_active:
                fulfillment_errors.append(f"Fulfillment team '{fg_name}' is inactive in this tenant")
        else:
            cross_team = (
                db.query(ITSMTeam)
                .filter(
                    ITSMTeam.tenant_id != tenant_id,
                    func.lower(ITSMTeam.name) == fg_name.lower(),
                )
                .first()
            )
            if cross_team:
                fulfillment_errors.append(f"Fulfillment team '{fg_name}' belongs to another tenant")
            else:
                tenant_has_teams = (
                    db.query(ITSMTeam.id)
                    .filter(ITSMTeam.tenant_id == tenant_id)
                    .first()
                ) is not None
                if tenant_has_teams:
                    fulfillment_errors.append(f"Fulfillment team '{fg_name}' does not exist in this tenant")

    checks.append({
        "category": "fulfillment",
        "name": "Fulfillment Configuration",
        "passed": len(fulfillment_errors) == 0,
        "message": "; ".join(fulfillment_errors) if fulfillment_errors else "Fulfillment team valid and active",
    })
    errors.extend(fulfillment_errors)

    is_valid = len(errors) == 0
    status_str = "READY TO PUBLISH" if is_valid else "VALIDATION FAILED"
    return is_valid, status_str, errors, checks


def require_itsm_platform_admin(request: Request, db: Session = Depends(get_tenant_db)):
    """Enforce that the requesting principal possesses the PLATFORM_ADMINISTRATOR ITSM role."""
    tenant_id = request.state.tenant_id
    user_id = request.state.user_id

    row = db.execute(
        text(
            """
            SELECT itsm_role, has_itsm_access
              FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)
            """
        ),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    ).first()

    if not row or not row.has_itsm_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ITSM access denied",
        )

    if row.itsm_role != "PLATFORM_ADMINISTRATOR":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform Administrator access required",
        )

    return row.itsm_role


def require_itsm_catalog_manager_or_admin(request: Request, db: Session = Depends(get_tenant_db)):
    """Enforce that the requesting principal possesses either CATALOG_MANAGER or PLATFORM_ADMINISTRATOR ITSM role."""
    tenant_id = request.state.tenant_id
    user_id = request.state.user_id

    row = db.execute(
        text(
            """
            SELECT itsm_role, has_itsm_access
              FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)
            """
        ),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    ).first()

    if not row or not row.has_itsm_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ITSM access denied",
        )

    if row.itsm_role not in ("PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Catalog Manager or Platform Administrator access required",
        )

    return row.itsm_role


# =============================================================================
# 1. USER MANAGEMENT (Step 1)
# =============================================================================

@router.get(
    "/users",
    response_model=List[ITSMUserItemResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List tenant users with ITSM access and role status",
)
def list_itsm_users(
    request: Request,
    include_inactive: bool = False,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Return all users in the authenticated tenant with their current ITSM and Governance posture."""
    tenant_id = UUID(tenant_id_str)

    query = db.query(User).filter(User.tenant_id == tenant_id)
    if not include_inactive:
        query = query.filter(User.is_active == True)
    users = query.order_by(User.created_at.asc()).all()
    user_ids = [u.id for u in users]

    access_map: dict[UUID, ITSMUserAccess] = {}
    if user_ids:
        access_records = (
            db.query(ITSMUserAccess)
            .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id.in_(user_ids))
            .all()
        )
        for rec in access_records:
            access_map[rec.user_id] = rec

    result: list[ITSMUserItemResponse] = []
    for u in users:
        rec = access_map.get(u.id)
        itsm_access = rec.has_itsm_access if rec else False
        itsm_role = rec.itsm_role if rec else "REQUESTER"
        if itsm_role == "SERVICE_LEAD":
            itsm_role = "INCIDENT_MANAGER"
        gov_access = rec.has_governance_access if rec else True

        result.append(
            ITSMUserItemResponse(
                id=u.id,
                name=_friendly_name_from_email(u.email),
                email=u.email,
                itsm_access=itsm_access,
                itsm_role=itsm_role,
                governance_access=gov_access,
                status="active" if u.is_active else "inactive",
                created_at=u.created_at,
            )
        )

    return result


@router.get(
    "/users/{user_id}",
    response_model=ITSMUserItemResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Get single tenant user with ITSM access and role status",
)
def get_itsm_user(
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Return single tenant user with their current ITSM and Governance posture."""
    tenant_id = UUID(tenant_id_str)

    target_user = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.id == user_id)
        .first()
    )
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in the current tenant",
        )

    rec = (
        db.query(ITSMUserAccess)
        .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == user_id)
        .first()
    )
    itsm_access = rec.has_itsm_access if rec else False
    itsm_role = rec.itsm_role if rec else "REQUESTER"
    if itsm_role == "SERVICE_LEAD":
        itsm_role = "INCIDENT_MANAGER"
    gov_access = rec.has_governance_access if rec else True

    return ITSMUserItemResponse(
        id=target_user.id,
        name=_friendly_name_from_email(target_user.email),
        email=target_user.email,
        itsm_access=itsm_access,
        itsm_role=itsm_role,
        governance_access=gov_access,
        status="active" if target_user.is_active else "inactive",
        created_at=target_user.created_at,
    )


@router.post(
    "/users/{user_id}/access",
    response_model=ITSMUserItemResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update ITSM access and business role for a user",
)
def update_user_itsm_access(
    user_id: UUID,
    payload: ITSMUserAccessUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Assign or modify ITSM product access, business role, and governance access status."""
    tenant_id = UUID(tenant_id_str)

    target_user = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.id == user_id)
        .first()
    )
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in the current tenant",
        )

    role = payload.itsm_role.strip().upper()
    if role not in VALID_ITSM_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid ITSM role '{role}'. Allowed: {', '.join(VALID_ITSM_ROLES)}",
        )

    now = datetime.now(timezone.utc)

    access_record = (
        db.query(ITSMUserAccess)
        .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == user_id)
        .first()
    )

    if access_record:
        access_record.has_itsm_access = payload.has_itsm_access
        access_record.itsm_role = role
        if payload.has_governance_access is not None:
            access_record.has_governance_access = payload.has_governance_access
        access_record.updated_at = now
    else:
        gov_access = (
            payload.has_governance_access
            if payload.has_governance_access is not None
            else False
        )
        access_record = ITSMUserAccess(
            tenant_id=tenant_id,
            user_id=user_id,
            itsm_role=role,
            has_itsm_access=payload.has_itsm_access,
            has_governance_access=gov_access,
            created_at=now,
            updated_at=now,
        )
        db.add(access_record)

    if payload.has_itsm_access and not target_user.is_active:
        target_user.is_active = True
        target_user.updated_at = now

    db.commit()
    db.refresh(access_record)
    db.refresh(target_user)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=user_access_updated tenant_id=%s admin_user_id=%s target_user_id=%s role=%s itsm_access=%s",
        tenant_id,
        request.state.user_id,
        user_id,
        role,
        payload.has_itsm_access,
    )

    return ITSMUserItemResponse(
        id=target_user.id,
        name=_friendly_name_from_email(target_user.email),
        email=target_user.email,
        itsm_access=access_record.has_itsm_access,
        itsm_role=access_record.itsm_role,
        governance_access=access_record.has_governance_access,
        status="active" if target_user.is_active else "inactive",
        created_at=target_user.created_at,
    )


@router.post(
    "/users/{user_id}/deactivate",
    response_model=ITSMUserItemResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Deactivate a tenant user and revoke their ITSM access",
)
def deactivate_itsm_user(
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Deactivate a tenant user, revoke active sessions, and disable their ITSM access."""
    tenant_id = UUID(tenant_id_str)
    admin_user_id = request.state.user_id

    target_user = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.id == user_id)
        .first()
    )
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in the current tenant",
        )

    if target_user.id == admin_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate the currently authenticated Platform Administrator",
        )

    if target_user.role == "owner":
        active_owner_count = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, User.role == "owner", User.is_active == True)
            .count()
        )
        if active_owner_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate the last active owner",
            )

    now = datetime.now(timezone.utc)

    # 1. Soft-deactivate user account in AuthClaw identity system
    target_user.is_active = False

    # 2. Disable ITSM access in itsm_user_access
    access_record = (
        db.query(ITSMUserAccess)
        .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == user_id)
        .first()
    )
    if access_record:
        access_record.has_itsm_access = False
        access_record.updated_at = now
    else:
        access_record = ITSMUserAccess(
            tenant_id=tenant_id,
            user_id=user_id,
            itsm_role="REQUESTER",
            has_itsm_access=False,
            has_governance_access=False,
            created_at=now,
            updated_at=now,
        )
        db.add(access_record)

    # 3. Revoke active opaque sessions for this user in this tenant
    db.execute(
        text("SELECT authn.revoke_user_sessions(:tenant_id, :user_id)"),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    )

    # 4. Revoke active API keys created by this user
    db.query(APIKey).filter(
        APIKey.tenant_id == tenant_id,
        APIKey.created_by == user_id,
        APIKey.is_active == True,
    ).update(
        {"is_active": False, "revoked_at": now},
        synchronize_session=False,
    )

    db.commit()
    db.refresh(target_user)
    db.refresh(access_record)

    # 5. Audit Logging
    logger.info(
        "[ITSM_ADMIN_AUDIT] action=user_deactivated tenant_id=%s admin_user_id=%s target_user_id=%s email=%s",
        tenant_id,
        admin_user_id,
        target_user.id,
        target_user.email,
    )
    try:
        event = event_backbone.audit_event(
            event_type="user",
            tenant_id=str(tenant_id),
            subject_id=str(target_user.id),
            identity_action=f"user_deactivated:{request.headers.get('x-request-id', '') or target_user.id}",
            action="user:deactivated",
            reason="admin_deactivation",
            provider="itsm_admin",
            request_id=request.headers.get("x-request-id", ""),
        )
        event["actor_id"] = str(admin_user_id)
        event["result"] = "success"
        event["response_status"] = 200
        event_backbone.publish_audit_event(None, str(tenant_id), event)
    except Exception as audit_exc:
        logger.warning("Could not publish audit event for deactivation: %s", audit_exc)

    return ITSMUserItemResponse(
        id=target_user.id,
        name=_friendly_name_from_email(target_user.email),
        email=target_user.email,
        itsm_access=access_record.has_itsm_access,
        itsm_role=access_record.itsm_role,
        governance_access=access_record.has_governance_access,
        status="inactive",
        created_at=target_user.created_at,
    )


@router.delete(
    "/users/{user_id}",
    response_model=ITSMUserItemResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Deactivate a tenant user and revoke their ITSM access",
)
def delete_itsm_user(
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    return deactivate_itsm_user(user_id, request, db, tenant_id_str)


@router.post(
    "/users/invite",
    response_model=ITSMEmployeeInviteResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create or invite an employee with an ITSM role",
)
def invite_itsm_employee(
    payload: ITSMEmployeeInviteRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Invite an employee to the tenant via AuthClaw identity workflow and assign an ITSM role."""
    tenant_id = UUID(tenant_id_str)
    admin_user_id = request.state.user_id
    request_id = request.headers.get("x-request-id", "")
    email = payload.email.strip().lower()
    role = payload.itsm_role.strip().upper()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    # Check if a user already exists in this tenant
    existing_user = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.email == email)
        .first()
    )

    if existing_user and existing_user.is_active:
        # Existing active user: do not duplicate user, do not reset password
        access_rec = (
            db.query(ITSMUserAccess)
            .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == existing_user.id)
            .first()
        )
        return ITSMEmployeeInviteResponse(
            status="already_exists",
            message="This employee already has an AuthClaw account.",
            email=email,
            itsm_role=access_rec.itsm_role if access_rec else role,
            user_id=existing_user.id,
        )

    # If user exists but is inactive, or user does not exist:
    if existing_user:
        target_user = existing_user
    else:
        target_user = User(
            tenant_id=tenant_id,
            email=email,
            role="viewer",
            is_active=False,
        )
        db.add(target_user)
        db.flush()

    # Pre-link or update ITSMUserAccess for this target user
    access_rec = (
        db.query(ITSMUserAccess)
        .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == target_user.id)
        .first()
    )
    if access_rec:
        access_rec.has_itsm_access = True
        access_rec.itsm_role = role
        access_rec.updated_at = now
    else:
        access_rec = ITSMUserAccess(
            tenant_id=tenant_id,
            user_id=target_user.id,
            itsm_role=role,
            has_itsm_access=True,
            has_governance_access=False,
            created_at=now,
            updated_at=now,
        )
        db.add(access_rec)

    # Reuse or create OnboardingEmailOTP invitation
    pending_invite = (
        db.query(OnboardingEmailOTP)
        .filter(
            OnboardingEmailOTP.tenant_id == tenant_id,
            OnboardingEmailOTP.email == email,
            OnboardingEmailOTP.status == "pending",
            OnboardingEmailOTP.purpose == "invite",
        )
        .first()
    )

    otp = _generate_otp()
    if pending_invite:
        invite_row = pending_invite
        invite_row.otp_hash = _otp_hash(email, otp)
        invite_row.attempts = 0
        invite_row.expires_at = expires_at
        invite_row.sent_at = now
        invite_row.resend_count = (invite_row.resend_count or 0) + 1
        invite_row.invited_role = "viewer"
        invite_row.invited_by = admin_user_id
        invite_row.delivery_error = None
    else:
        invite_row = OnboardingEmailOTP(
            email=email,
            tenant_name=tenant.name,
            otp_hash=_otp_hash(email, otp),
            status="pending",
            expires_at=expires_at,
            sent_at=now,
            purpose="invite",
            invited_role="viewer",
            invited_by=admin_user_id,
            tenant_id=tenant_id,
        )
        db.add(invite_row)
    db.flush()

    if not payload.send_email:
        invite_row.last_delivery = "skipped"
        invite_row.delivery_error = None
        db.commit()
        db.refresh(invite_row)
        _emit_invitation_audit(invite_row, "InviteCreated", "invitation_created", request_id, 201)
        logger.info(
            "[ITSM_ADMIN_AUDIT] action=employee_invited tenant_id=%s admin_user_id=%s user_id=%s email=%s role=%s delivery=skipped",
            tenant_id,
            admin_user_id,
            target_user.id,
            email,
            role,
        )
        return ITSMEmployeeInviteResponse(
            status="invited",
            message="Invitation sent successfully.",
            email=email,
            itsm_role=role,
            user_id=target_user.id,
            signup_id=invite_row.id,
            delivery="skipped",
        )

    console_url = (
        os.getenv("PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_CONSOLE_URL")
        or os.getenv("NEXT_PUBLIC_SITE_URL")
        or os.getenv("NEXT_PUBLIC_APP_URL")
        or "http://localhost:3001"
    )
    action_url = f"{console_url.rstrip('/')}/itsm/setup?invite={invite_row.id}&email={quote(email)}"

    try:
        delivery, _dev_otp = _deliver_otp(
            email,
            otp,
            tenant.name,
            purpose="ITSM employee invitation",
            action_url=action_url,
        )
        invite_row.last_delivery = delivery
        invite_row.delivery_error = None
        db.commit()
        db.refresh(invite_row)

        _emit_invitation_audit(invite_row, "InviteCreated", "invitation_created", request_id, 201)
        _emit_invitation_audit(
            invite_row,
            "InviteDeliverySucceeded",
            "delivery_succeeded",
            request_id,
            201,
        )

        logger.info(
            "[ITSM_ADMIN_AUDIT] action=employee_invited tenant_id=%s admin_user_id=%s user_id=%s email=%s role=%s delivery=%s",
            tenant_id,
            admin_user_id,
            target_user.id,
            email,
            role,
            delivery,
        )

        return ITSMEmployeeInviteResponse(
            status="invited",
            message="Invitation sent successfully.",
            email=email,
            itsm_role=role,
            user_id=target_user.id,
            signup_id=invite_row.id,
            delivery=delivery,
            dev_otp=_dev_otp,
        )
    except EmailDeliveryError as exc:
        db.rollback()
        _emit_invitation_audit(
            invite_row,
            "InviteDeliveryFailed",
            "delivery_failed",
            request_id,
            503,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Invitation delivery is temporarily unavailable",
        ) from exc


@router.post(
    "/users/create",
    response_model=ITSMEmployeeCreateManualResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create an employee manually with an AuthClaw password and ITSM role",
)
def create_manual_itsm_employee(
    payload: ITSMEmployeeCreateManualRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Directly create an employee in AuthClaw with password credentials and assign an ITSM role."""
    tenant_id = UUID(tenant_id_str)
    admin_user_id = request.state.user_id
    email = payload.email.strip().lower()
    role = payload.itsm_role.strip().upper()
    now = datetime.now(timezone.utc)

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    # Check if user already exists in this tenant
    existing_user = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.email == email)
        .first()
    )

    if existing_user and existing_user.is_active and not payload.email_credentials:
        # Existing active user and credentials email not requested: do not duplicate user, do not reset password
        access_rec = (
            db.query(ITSMUserAccess)
            .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == existing_user.id)
            .first()
        )
        return ITSMEmployeeCreateManualResponse(
            status="already_exists",
            message="This employee already has an AuthClaw account.",
            email=existing_user.email,
            itsm_role=access_rec.itsm_role if access_rec else "REQUESTER",
            user_id=existing_user.id,
            has_itsm_access=access_rec.has_itsm_access if access_rec else False,
        )

    if existing_user:
        # Reactivate or update credentials for user with the new password
        target_user = existing_user
        target_user.is_active = True
        target_user.password_hash = hash_password(payload.password)
        target_user.updated_at = now
    else:
        # Create new AuthClaw user with hashed password
        target_user = User(
            tenant_id=tenant_id,
            email=email,
            password_hash=hash_password(payload.password),
            role="viewer",
            platform_role="NONE",
            is_active=True,
        )
        db.add(target_user)
        db.flush()

    # Grant ITSM access with selected role, without governance access
    access_rec = (
        db.query(ITSMUserAccess)
        .filter(ITSMUserAccess.tenant_id == tenant_id, ITSMUserAccess.user_id == target_user.id)
        .first()
    )
    if access_rec:
        access_rec.itsm_role = role
        access_rec.has_itsm_access = True
        access_rec.has_governance_access = False
        access_rec.updated_at = now
    else:
        access_rec = ITSMUserAccess(
            tenant_id=tenant_id,
            user_id=target_user.id,
            itsm_role=role,
            has_itsm_access=True,
            has_governance_access=False,
            created_at=now,
            updated_at=now,
        )
        db.add(access_rec)

    db.commit()
    db.refresh(target_user)

    # Optional credentials email
    delivery_method = None
    if payload.email_credentials:
        console_url = (
            os.getenv("PUBLIC_CONSOLE_URL")
            or os.getenv("NEXT_PUBLIC_CONSOLE_URL")
            or os.getenv("NEXT_PUBLIC_APP_URL")
            or "http://localhost:3001"
        )
        login_url = f"{console_url.rstrip('/')}/itsm/login"
        email_subject = f"Your AuthClaw ITSM account credentials ({tenant.name})"
        email_body = (
            f"Hello,\n\n"
            f"Your employee account has been created for {tenant.name} on AuthClaw ITSM with the role '{role}'.\n\n"
            f"Login Email: {email}\n"
            f"Temporary Password: {payload.password}\n"
            f"Portal URL: {login_url}\n\n"
            f"Please sign in and change your password.\n"
        )
        html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="margin-bottom:24px;">
      <span style="font-size:18px;font-weight:700;color:#6D28D9;letter-spacing:-0.02em;">AuthClaw ITSM</span>
    </div>
    <h1 style="font-size:20px;font-weight:700;color:#0e1726;margin:0 0 12px 0;">Your Account Credentials</h1>
    <p style="font-size:14px;line-height:22px;color:#475069;margin:0 0 20px 0;">
      Your employee account has been created for <strong>{tenant.name}</strong> on AuthClaw ITSM with the role <strong>{role.replace('_', ' ')}</strong>.
    </p>
    <div style="background-color:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:20px;margin-bottom:28px;">
      <div style="margin-bottom:12px;">
        <span style="font-size:12px;color:#6b7488;display:block;">Login Email:</span>
        <strong style="font-size:14px;color:#0e1726;font-family:monospace;">{email}</strong>
      </div>
      <div>
        <span style="font-size:12px;color:#6b7488;display:block;">Temporary Password:</span>
        <strong style="font-size:14px;color:#0e1726;font-family:monospace;">{payload.password}</strong>
      </div>
    </div>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="{login_url}" style="display:inline-block;background-color:#6D28D9;color:#ffffff;padding:13px 32px;font-size:14px;font-weight:600;text-decoration:none;border-radius:10px;box-shadow:0 4px 14px rgba(109,40,217,0.35);">Sign In to ITSM Portal &rarr;</a>
    </div>
    <p style="font-size:12px;color:#6b7488;line-height:18px;margin:28px 0 0 0;border-top:1px solid #f1f3f7;padding-top:20px;">
      Portal link: <a href="{login_url}" style="color:#6D28D9;word-break:break-all;">{login_url}</a><br/>
      Please sign in and change your password upon your first login.
    </p>
  </div>
</body>
</html>"""
        try:
            res = send_email(email, email_subject, email_body, html_body=html_body)
            delivery_method = res.method
        except Exception as exc:
            logger.warning("Failed to send credentials email to %s: %s", email, exc)
            delivery_method = "failed"

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=employee_created_manually tenant_id=%s admin_user_id=%s user_id=%s email=%s role=%s email_credentials=%s",
        tenant_id,
        admin_user_id,
        target_user.id,
        email,
        role,
        bool(payload.email_credentials),
    )

    return ITSMEmployeeCreateManualResponse(
        status="created",
        message="Employee created successfully.",
        email=target_user.email,
        itsm_role=role,
        user_id=target_user.id,
        has_itsm_access=True,
        delivery=delivery_method,
    )


# =============================================================================
# 2. TEAMS / GROUPS MANAGEMENT (Step 2)
# =============================================================================

@router.get(
    "/teams",
    response_model=List[ITSMTeamResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List all ITSM operational teams for the tenant",
)
def list_itsm_teams(
    status: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    query = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id)
    if is_active is not None:
        query = query.filter(ITSMTeam.is_active.is_(is_active))
    elif status is not None:
        if status.strip().upper() == "ACTIVE":
            query = query.filter(ITSMTeam.is_active.is_(True))
        elif status.strip().upper() == "INACTIVE":
            query = query.filter(ITSMTeam.is_active.is_(False))

    teams = query.order_by(ITSMTeam.name.asc()).all()

    # Compute member counts per team
    counts_query = (
        db.query(ITSMTeamMember.team_id, func.count(ITSMTeamMember.id))
        .filter(ITSMTeamMember.tenant_id == tenant_id)
        .group_by(ITSMTeamMember.team_id)
        .all()
    )
    counts_map = {row[0]: row[1] for row in counts_query}

    return [
        ITSMTeamResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            is_active=t.is_active,
            member_count=counts_map.get(t.id, 0),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in teams
    ]


@router.post(
    "/teams",
    response_model=ITSMTeamResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create a new ITSM operational team",
)
def create_itsm_team(
    payload: ITSMTeamCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    team_name = payload.name.strip()

    # Verify uniqueness within tenant
    existing = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.name.ilike(team_name)).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Team with name '{team_name}' already exists in this tenant",
        )

    now = datetime.now(timezone.utc)
    team = ITSMTeam(
        tenant_id=tenant_id,
        name=team_name,
        description=payload.description.strip() if payload.description else None,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(team)
    db.commit()
    db.refresh(team)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=team_created tenant_id=%s admin_user_id=%s team_id=%s team_name=%s",
        tenant_id,
        request.state.user_id,
        team.id,
        team.name,
    )

    return ITSMTeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        is_active=team.is_active,
        member_count=0,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


@router.get(
    "/teams/{team_id}",
    response_model=ITSMTeamDetailResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Get team details and members",
)
def get_itsm_team_detail(
    team_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    team = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.id == team_id).first()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found in this tenant",
        )

    # Fetch members joined with User
    members_query = (
        db.query(ITSMTeamMember, User)
        .join(User, ITSMTeamMember.user_id == User.id)
        .filter(ITSMTeamMember.tenant_id == tenant_id, ITSMTeamMember.team_id == team_id)
        .order_by(ITSMTeamMember.created_at.asc())
        .all()
    )

    members_list = [
        ITSMTeamMemberResponse(
            id=m.id,
            user_id=u.id,
            name=_friendly_name_from_email(u.email),
            email=u.email,
            created_at=m.created_at,
        )
        for m, u in members_query
    ]

    return ITSMTeamDetailResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        is_active=team.is_active,
        member_count=len(members_list),
        created_at=team.created_at,
        updated_at=team.updated_at,
        members=members_list,
    )


@router.patch(
    "/teams/{team_id}",
    response_model=ITSMTeamResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update team attributes or status",
)
def update_itsm_team(
    team_id: UUID,
    payload: ITSMTeamUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    team = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.id == team_id).first()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found in this tenant",
        )

    if payload.name is not None:
        new_name = payload.name.strip()
        # Verify no conflict
        conflict = (
            db.query(ITSMTeam)
            .filter(
                ITSMTeam.tenant_id == tenant_id,
                ITSMTeam.name.ilike(new_name),
                ITSMTeam.id != team_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Team with name '{new_name}' already exists in this tenant",
            )
        team.name = new_name

    if payload.description is not None:
        team.description = payload.description.strip() if payload.description else None

    if payload.is_active is not None:
        team.is_active = payload.is_active

    team.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(team)

    count = db.query(func.count(ITSMTeamMember.id)).filter(
        ITSMTeamMember.tenant_id == tenant_id,
        ITSMTeamMember.team_id == team_id,
    ).scalar() or 0

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=team_updated tenant_id=%s admin_user_id=%s team_id=%s is_active=%s",
        tenant_id,
        request.state.user_id,
        team.id,
        team.is_active,
    )

    return ITSMTeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        is_active=team.is_active,
        member_count=count,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


@router.post(
    "/teams/{team_id}/members",
    response_model=ITSMTeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Add an existing tenant user to the team",
)
def add_itsm_team_member(
    team_id: UUID,
    payload: ITSMTeamMemberAddRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    # 1. Verify team exists in tenant
    team = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.id == team_id).first()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found in this tenant",
        )

    # 2. Verify target user exists in tenant
    target_user = db.query(User).filter(User.tenant_id == tenant_id, User.id == payload.user_id).first()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in this tenant",
        )

    # 3. Check if already a member
    existing = (
        db.query(ITSMTeamMember)
        .filter(
            ITSMTeamMember.tenant_id == tenant_id,
            ITSMTeamMember.team_id == team_id,
            ITSMTeamMember.user_id == payload.user_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already a member of this team",
        )

    member = ITSMTeamMember(
        tenant_id=tenant_id,
        team_id=team_id,
        user_id=payload.user_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(member)
    db.commit()
    db.refresh(member)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=team_member_added tenant_id=%s admin_user_id=%s team_id=%s user_id=%s",
        tenant_id,
        request.state.user_id,
        team_id,
        payload.user_id,
    )

    return ITSMTeamMemberResponse(
        id=member.id,
        user_id=target_user.id,
        name=_friendly_name_from_email(target_user.email),
        email=target_user.email,
        created_at=member.created_at,
    )


@router.delete(
    "/teams/{team_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Remove a user from the team",
)
def remove_itsm_team_member(
    team_id: UUID,
    user_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    member = (
        db.query(ITSMTeamMember)
        .filter(
            ITSMTeamMember.tenant_id == tenant_id,
            ITSMTeamMember.team_id == team_id,
            ITSMTeamMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team member record not found",
        )

    db.delete(member)
    db.commit()

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=team_member_removed tenant_id=%s admin_user_id=%s team_id=%s user_id=%s",
        tenant_id,
        request.state.user_id,
        team_id,
        user_id,
    )


# =============================================================================
# 3. SERVICES MANAGEMENT (Step 2)
# =============================================================================

@router.get(
    "/services",
    response_model=List[ITSMServiceResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List all ITSM services for the tenant",
)
def list_itsm_services(
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    services = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id).order_by(ITSMService.name.asc()).all()
    return services


@router.post(
    "/services",
    response_model=ITSMServiceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create a basic ITSM service",
)
def create_itsm_service(
    payload: ITSMServiceCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    service_name = payload.name.strip()
    slug = payload.slug.strip() if payload.slug else _slugify(service_name)

    # Verify unique slug within tenant
    conflict = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.slug == slug).first()
    if conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Service with identifier '{slug}' already exists in this tenant",
        )

    now = datetime.now(timezone.utc)
    service = ITSMService(
        tenant_id=tenant_id,
        name=service_name,
        slug=slug,
        description=payload.description.strip() if payload.description else None,
        tier=payload.tier.strip().upper(),
        status=payload.status.strip().upper(),
        escalation_team=payload.escalation_team.strip() if payload.escalation_team else None,
        created_at=now,
        updated_at=now,
    )
    db.add(service)
    db.commit()
    db.refresh(service)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=service_created tenant_id=%s admin_user_id=%s service_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        service.id,
        service.name,
    )

    return service


@router.patch(
    "/services/{service_id}",
    response_model=ITSMServiceResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update ITSM service attributes or status",
)
def update_itsm_service(
    service_id: UUID,
    payload: ITSMServiceUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    service = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == service_id).first()
    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found in this tenant",
        )

    if payload.name is not None:
        service.name = payload.name.strip()

    if payload.description is not None:
        service.description = payload.description.strip() if payload.description else None

    if payload.tier is not None:
        service.tier = payload.tier.strip().upper()

    if payload.status is not None:
        service.status = payload.status.strip().upper()

    if payload.escalation_team is not None:
        service.escalation_team = payload.escalation_team.strip() if payload.escalation_team else None

    service.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(service)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=service_updated tenant_id=%s admin_user_id=%s service_id=%s status=%s",
        tenant_id,
        request.state.user_id,
        service.id,
        service.status,
    )

    return service


# =============================================================================
# 4. CONFIGURATION ITEMS (BASIC CMDB) MANAGEMENT (Step 2)
# =============================================================================

@router.get(
    "/configuration-items",
    response_model=List[ITSMConfigurationItemResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List all Configuration Items in CMDB for the tenant",
)
def list_itsm_configuration_items(
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    # Left join with itsm_services to fetch service name
    query = (
        db.query(ITSMConfigurationItem, ITSMService.name.label("service_name"))
        .outerjoin(
            ITSMService,
            (ITSMConfigurationItem.service_id == ITSMService.id) & (ITSMService.tenant_id == tenant_id),
        )
        .filter(ITSMConfigurationItem.tenant_id == tenant_id)
        .order_by(ITSMConfigurationItem.name.asc())
        .all()
    )

    return [
        ITSMConfigurationItemResponse(
            id=ci.id,
            name=ci.name,
            ci_type=ci.ci_type,
            service_id=ci.service_id,
            service_name=service_name,
            environment=ci.environment,
            status=ci.status,
            external_resource_id=ci.external_resource_id,
            created_at=ci.created_at,
            updated_at=ci.updated_at,
        )
        for ci, service_name in query
    ]


@router.post(
    "/configuration-items",
    response_model=ITSMConfigurationItemResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Add a Configuration Item to CMDB",
)
def create_itsm_configuration_item(
    payload: ITSMConfigurationItemCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    service_name: Optional[str] = None

    if payload.service_id:
        srv = (
            db.query(ITSMService)
            .filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id)
            .first()
        )
        if not srv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Associated service not found in this tenant",
            )
        service_name = srv.name

    now = datetime.now(timezone.utc)
    ci = ITSMConfigurationItem(
        tenant_id=tenant_id,
        service_id=payload.service_id,
        name=payload.name.strip(),
        ci_type=payload.ci_type.strip().upper(),
        environment=payload.environment.strip().upper(),
        status=payload.status.strip().upper(),
        external_resource_id=payload.external_resource_id.strip() if payload.external_resource_id else None,
        created_at=now,
        updated_at=now,
    )
    db.add(ci)
    db.commit()
    db.refresh(ci)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=ci_created tenant_id=%s admin_user_id=%s ci_id=%s ci_name=%s",
        tenant_id,
        request.state.user_id,
        ci.id,
        ci.name,
    )

    return ITSMConfigurationItemResponse(
        id=ci.id,
        name=ci.name,
        ci_type=ci.ci_type,
        service_id=ci.service_id,
        service_name=service_name,
        environment=ci.environment,
        status=ci.status,
        external_resource_id=ci.external_resource_id,
        created_at=ci.created_at,
        updated_at=ci.updated_at,
    )


@router.patch(
    "/configuration-items/{ci_id}",
    response_model=ITSMConfigurationItemResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update Configuration Item attributes or status",
)
def update_itsm_configuration_item(
    ci_id: UUID,
    payload: ITSMConfigurationItemUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    ci = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant_id, ITSMConfigurationItem.id == ci_id).first()
    if not ci:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Configuration Item not found in this tenant",
        )

    if payload.name is not None:
        ci.name = payload.name.strip()

    if payload.ci_type is not None:
        ci.ci_type = payload.ci_type.strip().upper()

    if payload.service_id is not None:
        if payload.service_id != ci.service_id:
            srv = (
                db.query(ITSMService)
                .filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id)
                .first()
            )
            if not srv:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Associated service not found in this tenant",
                )
        ci.service_id = payload.service_id

    if payload.environment is not None:
        ci.environment = payload.environment.strip().upper()

    if payload.status is not None:
        ci.status = payload.status.strip().upper()

    if payload.external_resource_id is not None:
        ci.external_resource_id = payload.external_resource_id.strip() if payload.external_resource_id else None

    ci.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ci)

    # Fetch associated service name
    service_name = None
    if ci.service_id:
        srv = db.query(ITSMService.name).filter(ITSMService.id == ci.service_id, ITSMService.tenant_id == tenant_id).first()
        if srv:
            service_name = srv[0]

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=ci_updated tenant_id=%s admin_user_id=%s ci_id=%s status=%s",
        tenant_id,
        request.state.user_id,
        ci.id,
        ci.status,
    )

    return ITSMConfigurationItemResponse(
        id=ci.id,
        name=ci.name,
        ci_type=ci.ci_type,
        service_id=ci.service_id,
        service_name=service_name,
        environment=ci.environment,
        status=ci.status,
        external_resource_id=ci.external_resource_id,
        created_at=ci.created_at,
        updated_at=ci.updated_at,
    )


@router.post(
    "/configuration-items/import/dry-run",
    response_model=CIBulkImportDryRunResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Dry-run preview for bulk CI import (CMDB-005)",
    description="Validates, transforms, and checks reconciliation for bulk CSV/JSON CIs without modifying the database.",
)
def bulk_import_ci_dry_run(
    payload: CIBulkImportDryRunRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    return CIImportService.dry_run(
        db=db,
        tenant_id=tenant_id,
        source_filename=payload.source_filename,
        source_type=payload.source_type,
        raw_records=payload.raw_records,
        field_mapping=payload.field_mapping,
    )


@router.post(
    "/configuration-items/import/commit",
    response_model=CIBulkImportCommitResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Confirm and commit bulk CI import (CMDB-005)",
    description="Inserts new CIs and updates existing CIs within a tenant transaction, saving source attribution and generating an audit event.",
)
def bulk_import_ci_commit(
    payload: CIBulkImportCommitRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    actor_id = UUID(str(request.state.user_id))
    return CIImportService.commit_import(
        db=db,
        tenant_id=tenant_id,
        actor_id=actor_id,
        source_filename=payload.source_filename,
        source_type=payload.source_type,
        raw_records=payload.raw_records,
        field_mapping=payload.field_mapping,
        update_existing=payload.update_existing,
    )


# =============================================================================
# 5. SERVICE CATALOG ADMINISTRATION (Step 3)
# =============================================================================

@router.get(
    "/service-catalog",
    response_model=List[ITSMServiceCatalogItemResponse],
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="List all service catalog items for the tenant",
)
def list_itsm_service_catalog_items(
    search: Optional[str] = None,
    service_id: Optional[UUID] = None,
    is_active: Optional[bool] = None,
    fulfillment_group: Optional[str] = None,
    approval_required: Optional[bool] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    query = (
        db.query(ITSMServiceCatalogItem, ITSMService.name.label("service_name"))
        .join(
            ITSMService,
            (ITSMServiceCatalogItem.service_id == ITSMService.id) & (ITSMService.tenant_id == tenant_id),
        )
        .filter(ITSMServiceCatalogItem.tenant_id == tenant_id)
    )

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            ITSMServiceCatalogItem.name.ilike(term)
            | ITSMServiceCatalogItem.description.ilike(term)
            | ITSMService.name.ilike(term)
            | ITSMServiceCatalogItem.fulfillment_group.ilike(term)
        )

    if service_id is not None:
        query = query.filter(ITSMServiceCatalogItem.service_id == service_id)

    if is_active is not None:
        query = query.filter(ITSMServiceCatalogItem.is_active == is_active)

    if fulfillment_group and fulfillment_group.strip():
        query = query.filter(ITSMServiceCatalogItem.fulfillment_group.ilike(fulfillment_group.strip()))

    if approval_required is not None:
        query = query.filter(ITSMServiceCatalogItem.approval_required == approval_required)

    results = query.order_by(ITSMServiceCatalogItem.name.asc()).all()

    return [
        ITSMServiceCatalogItemResponse(
            id=item.id,
            name=item.name,
            slug=item.slug,
            description=item.description,
            service_id=item.service_id,
            service_name=service_name,
            version=item.version,
            approval_required=item.approval_required,
            fulfillment_group=item.fulfillment_group,
            estimated_delivery_hours=item.estimated_delivery_hours,
            is_active=item.is_active,
            intake_schema=item.intake_schema or {},
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item, service_name in results
    ]


@router.post(
    "/service-catalog",
    response_model=ITSMServiceCatalogItemResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Create a new service catalog item",
)
def create_itsm_service_catalog_item(
    payload: ITSMServiceCatalogItemCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    # Verify service exists
    service = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id).first()
    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Associated service not found in this tenant",
        )

    base_slug = payload.slug.strip() if payload.slug else _slugify(payload.name.strip())
    slug = base_slug
    idx = 1
    while db.query(ITSMServiceCatalogItem).filter(ITSMServiceCatalogItem.tenant_id == tenant_id, ITSMServiceCatalogItem.slug == slug).first():
        slug = f"{base_slug[:90]}-{idx}"
        idx += 1

    if payload.intake_schema:
        _validate_intake_schema(payload.intake_schema)

    fulfillment_group_val = _validate_fulfillment_group(db, tenant_id, payload.fulfillment_group)
    now = datetime.now(timezone.utc)
    item = ITSMServiceCatalogItem(
        tenant_id=tenant_id,
        service_id=payload.service_id,
        name=payload.name.strip(),
        slug=slug,
        description=payload.description.strip() if payload.description else None,
        version=1,
        intake_schema=payload.intake_schema or {},
        approval_required=payload.approval_required,
        fulfillment_group=fulfillment_group_val,
        estimated_delivery_hours=payload.estimated_delivery_hours,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_created tenant_id=%s user_id=%s item_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        item.name,
    )

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service.name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/service-catalog/fulfillment-teams",
    response_model=List[ITSMTeamResponse],
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="List active operational teams eligible for catalog fulfillment",
)
def list_catalog_fulfillment_teams(
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    teams = (
        db.query(ITSMTeam)
        .filter(ITSMTeam.tenant_id == tenant_id, ITSMTeam.is_active.is_(True))
        .order_by(ITSMTeam.name.asc())
        .all()
    )

    counts_query = (
        db.query(ITSMTeamMember.team_id, func.count(ITSMTeamMember.id))
        .filter(ITSMTeamMember.tenant_id == tenant_id)
        .group_by(ITSMTeamMember.team_id)
        .all()
    )
    counts_map = {row[0]: row[1] for row in counts_query}

    return [
        ITSMTeamResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            is_active=t.is_active,
            member_count=counts_map.get(t.id, 0),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in teams
    ]


@router.get(
    "/service-catalog/{item_id}",
    response_model=ITSMServiceCatalogItemResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Get single service catalog item detail",
)
def get_itsm_service_catalog_item(
    item_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(ITSMServiceCatalogItem.tenant_id == tenant_id, ITSMServiceCatalogItem.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    service_name = None
    srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id).first()
    if srv:
        service_name = srv[0]

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service_name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.patch(
    "/service-catalog/{item_id}",
    response_model=ITSMServiceCatalogItemResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Update a service catalog item",
)
def update_itsm_service_catalog_item(
    item_id: UUID,
    payload: ITSMServiceCatalogItemUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(ITSMServiceCatalogItem.tenant_id == tenant_id, ITSMServiceCatalogItem.id == item_id).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    if payload.name is not None:
        item.name = payload.name.strip()

    if payload.description is not None:
        item.description = payload.description.strip() if payload.description else None

    if payload.service_id is not None:
        if payload.service_id != item.service_id:
            srv = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id).first()
            if not srv:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Associated service not found in this tenant",
                )
            item.service_id = payload.service_id

    if payload.approval_required is not None:
        item.approval_required = payload.approval_required

    if payload.fulfillment_group is not None:
        item.fulfillment_group = _validate_fulfillment_group(db, tenant_id, payload.fulfillment_group)

    if payload.estimated_delivery_hours is not None:
        item.estimated_delivery_hours = payload.estimated_delivery_hours

    if payload.is_active is not None:
        if payload.is_active is True:
            item.is_active = True
            is_valid, status_str, val_errors, _ = _validate_catalog_offering(db, tenant_id, item)
            if not is_valid:
                item.is_active = False
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Cannot activate catalog item: validation failed. {val_errors[0] if val_errors else ''}".strip(),
                )
        item.is_active = payload.is_active
        logger.info(
            "[ITSM_ADMIN_AUDIT] action=catalog_item_status_toggled tenant_id=%s user_id=%s item_id=%s is_active=%s",
            tenant_id,
            request.state.user_id,
            item.id,
            item.is_active,
        )

    if payload.intake_schema is not None:
        _validate_intake_schema(payload.intake_schema)
        item.intake_schema = payload.intake_schema

    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    service_name = None
    srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id).first()
    if srv:
        service_name = srv[0]

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_updated tenant_id=%s user_id=%s item_id=%s approval_required=%s fulfillment_group=%s estimated_delivery_hours=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        item.approval_required,
        item.fulfillment_group,
        item.estimated_delivery_hours,
    )

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service_name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/service-catalog/{item_id}/validate",
    response_model=ITSMServiceCatalogValidationResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Validate catalog item configuration for publishing readiness",
)
def validate_itsm_service_catalog_item(
    item_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(
        ITSMServiceCatalogItem.tenant_id == tenant_id,
        ITSMServiceCatalogItem.id == item_id,
    ).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    is_valid, status_str, errors, checks = _validate_catalog_offering(db, tenant_id, item)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_validated tenant_id=%s user_id=%s item_id=%s is_valid=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        is_valid,
    )

    return ITSMServiceCatalogValidationResponse(
        is_valid=is_valid,
        status=status_str,
        errors=errors,
        checks=checks,
    )


@router.post(
    "/service-catalog/{item_id}/publish",
    response_model=ITSMServiceCatalogItemResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Publish service catalog item to make it available to requesters",
)
def publish_itsm_service_catalog_item(
    item_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(
        ITSMServiceCatalogItem.tenant_id == tenant_id,
        ITSMServiceCatalogItem.id == item_id,
    ).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    is_valid, status_str, errors, checks = _validate_catalog_offering(db, tenant_id, item)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Cannot publish catalog item: validation failed.",
                "status": status_str,
                "errors": errors,
            },
        )

    item.is_active = True
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_published tenant_id=%s user_id=%s item_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        item.name,
    )

    service_name = None
    srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id).first()
    if srv:
        service_name = srv[0]

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service_name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.post(
    "/service-catalog/{item_id}/deactivate",
    response_model=ITSMServiceCatalogItemResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Deactivate service catalog item to withdraw it from new requests",
)
def deactivate_itsm_service_catalog_item(
    item_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(
        ITSMServiceCatalogItem.tenant_id == tenant_id,
        ITSMServiceCatalogItem.id == item_id,
    ).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    item.is_active = False
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_deactivated tenant_id=%s user_id=%s item_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        item.name,
    )

    service_name = None
    srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id).first()
    if srv:
        service_name = srv[0]

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service_name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.post(
    "/service-catalog/{item_id}/retire",
    response_model=ITSMServiceCatalogItemResponse,
    dependencies=[Depends(require_itsm_catalog_manager_or_admin)],
    summary="Retire service catalog item preserving historical requests and audit trails",
)
def retire_itsm_service_catalog_item(
    item_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    item = db.query(ITSMServiceCatalogItem).filter(
        ITSMServiceCatalogItem.tenant_id == tenant_id,
        ITSMServiceCatalogItem.id == item_id,
    ).first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog item not found in this tenant",
        )

    item.is_active = False
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=catalog_item_retired tenant_id=%s user_id=%s item_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        item.id,
        item.name,
    )

    service_name = None
    srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == item.service_id).first()
    if srv:
        service_name = srv[0]

    return ITSMServiceCatalogItemResponse(
        id=item.id,
        name=item.name,
        slug=item.slug,
        description=item.description,
        service_id=item.service_id,
        service_name=service_name,
        version=item.version,
        approval_required=item.approval_required,
        fulfillment_group=item.fulfillment_group,
        estimated_delivery_hours=item.estimated_delivery_hours,
        is_active=item.is_active,
        intake_schema=item.intake_schema or {},
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


# =============================================================================
# 6. BUSINESS CALENDARS (Step 3)
# =============================================================================

@router.get(
    "/business-calendars",
    response_model=List[ITSMBusinessCalendarResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List all business calendars for the tenant",
)
def list_itsm_business_calendars(
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    calendars = (
        db.query(ITSMBusinessCalendar)
        .filter(ITSMBusinessCalendar.tenant_id == tenant_id)
        .order_by(ITSMBusinessCalendar.name.asc())
        .all()
    )
    return [
        ITSMBusinessCalendarResponse(
            id=c.id,
            name=c.name,
            timezone=c.timezone,
            weekly_hours=c.weekly_hours or {},
            holidays=c.holidays or [],
            is_default=c.is_default,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in calendars
    ]


@router.post(
    "/business-calendars",
    response_model=ITSMBusinessCalendarResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create a business calendar",
)
def create_itsm_business_calendar(
    payload: ITSMBusinessCalendarCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    cal_name = payload.name.strip()

    # Verify unique name
    conflict = db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.name.ilike(cal_name)).first()
    if conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Business calendar with name '{cal_name}' already exists in this tenant",
        )

    # If is_default is true, unset other defaults
    if payload.is_default:
        db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.is_default == True).update({"is_default": False})

    now = datetime.now(timezone.utc)
    calendar = ITSMBusinessCalendar(
        tenant_id=tenant_id,
        name=cal_name,
        timezone=payload.timezone.strip() if payload.timezone else "UTC",
        weekly_hours=payload.weekly_hours or {
            "monday": {"start": "09:00", "end": "17:00"},
            "tuesday": {"start": "09:00", "end": "17:00"},
            "wednesday": {"start": "09:00", "end": "17:00"},
            "thursday": {"start": "09:00", "end": "17:00"},
            "friday": {"start": "09:00", "end": "17:00"},
        },
        holidays=payload.holidays or [],
        is_default=payload.is_default,
        created_at=now,
        updated_at=now,
    )
    db.add(calendar)
    db.commit()
    db.refresh(calendar)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=business_calendar_created tenant_id=%s admin_user_id=%s calendar_id=%s name=%s",
        tenant_id,
        request.state.user_id,
        calendar.id,
        calendar.name,
    )

    return ITSMBusinessCalendarResponse(
        id=calendar.id,
        name=calendar.name,
        timezone=calendar.timezone,
        weekly_hours=calendar.weekly_hours or {},
        holidays=calendar.holidays or [],
        is_default=calendar.is_default,
        created_at=calendar.created_at,
        updated_at=calendar.updated_at,
    )


@router.get(
    "/business-calendars/{calendar_id}",
    response_model=ITSMBusinessCalendarResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Get single business calendar detail",
)
def get_itsm_business_calendar(
    calendar_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    c = db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == calendar_id).first()
    if not c:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Business calendar not found in this tenant",
        )

    return ITSMBusinessCalendarResponse(
        id=c.id,
        name=c.name,
        timezone=c.timezone,
        weekly_hours=c.weekly_hours or {},
        holidays=c.holidays or [],
        is_default=c.is_default,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.patch(
    "/business-calendars/{calendar_id}",
    response_model=ITSMBusinessCalendarResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update business calendar attributes",
)
def update_itsm_business_calendar(
    calendar_id: UUID,
    payload: ITSMBusinessCalendarUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    c = db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == calendar_id).first()
    if not c:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Business calendar not found in this tenant",
        )

    if payload.name is not None:
        new_name = payload.name.strip()
        conflict = (
            db.query(ITSMBusinessCalendar)
            .filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.name.ilike(new_name), ITSMBusinessCalendar.id != calendar_id)
            .first()
        )
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Business calendar with name '{new_name}' already exists in this tenant",
            )
        c.name = new_name

    if payload.timezone is not None:
        c.timezone = payload.timezone.strip()

    if payload.weekly_hours is not None:
        c.weekly_hours = payload.weekly_hours

    if payload.holidays is not None:
        c.holidays = payload.holidays

    if payload.is_default is not None:
        if payload.is_default:
            db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id != calendar_id).update({"is_default": False})
        c.is_default = payload.is_default

    c.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=business_calendar_updated tenant_id=%s admin_user_id=%s calendar_id=%s",
        tenant_id,
        request.state.user_id,
        c.id,
    )

    return ITSMBusinessCalendarResponse(
        id=c.id,
        name=c.name,
        timezone=c.timezone,
        weekly_hours=c.weekly_hours or {},
        holidays=c.holidays or [],
        is_default=c.is_default,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


# =============================================================================
# 7. SLA POLICIES MANAGEMENT (Step 3)
# =============================================================================

@router.get(
    "/sla-policies",
    response_model=List[ITSMSLAPolicyResponse],
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="List all SLA policies for the tenant",
)
def list_itsm_sla_policies(
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    query = (
        db.query(
            ITSMSLAPolicy,
            ITSMService.name.label("service_name"),
            ITSMBusinessCalendar.name.label("calendar_name"),
        )
        .outerjoin(
            ITSMService,
            (ITSMSLAPolicy.service_id == ITSMService.id) & (ITSMService.tenant_id == tenant_id),
        )
        .outerjoin(
            ITSMBusinessCalendar,
            (ITSMSLAPolicy.calendar_id == ITSMBusinessCalendar.id) & (ITSMBusinessCalendar.tenant_id == tenant_id),
        )
        .filter(ITSMSLAPolicy.tenant_id == tenant_id)
        .order_by(ITSMSLAPolicy.priority.asc(), ITSMSLAPolicy.name.asc())
        .all()
    )

    return [
        ITSMSLAPolicyResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            ticket_type=p.ticket_type,
            priority=p.priority,
            service_id=p.service_id,
            service_name=service_name,
            calendar_id=p.calendar_id,
            calendar_name=calendar_name,
            response_target_minutes=p.response_target_minutes,
            resolution_target_minutes=p.resolution_target_minutes,
            is_active=p.is_active,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p, service_name, calendar_name in query
    ]


@router.post(
    "/sla-policies",
    response_model=ITSMSLAPolicyResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Create a new SLA policy",
)
def create_itsm_sla_policy(
    payload: ITSMSLAPolicyCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    priority_val = payload.priority.strip().upper()
    if priority_val not in {"P1", "P2", "P3", "P4"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Priority must be one of: P1, P2, P3, P4",
        )

    service_name = None
    if payload.service_id:
        srv = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id).first()
        if not srv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Associated service not found in this tenant",
            )
        service_name = srv.name

    calendar_name = None
    if payload.calendar_id:
        cal = db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == payload.calendar_id).first()
        if not cal:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Associated business calendar not found in this tenant",
            )
        calendar_name = cal.name

    now = datetime.now(timezone.utc)
    policy = ITSMSLAPolicy(
        tenant_id=tenant_id,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
        ticket_type=payload.ticket_type.strip().upper() if payload.ticket_type else "INCIDENT",
        priority=priority_val,
        service_id=payload.service_id,
        calendar_id=payload.calendar_id,
        response_target_minutes=payload.response_target_minutes,
        resolution_target_minutes=payload.resolution_target_minutes,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(policy)
    db.commit()
    db.refresh(policy)

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=sla_policy_created tenant_id=%s admin_user_id=%s policy_id=%s name=%s priority=%s",
        tenant_id,
        request.state.user_id,
        policy.id,
        policy.name,
        policy.priority,
    )

    return ITSMSLAPolicyResponse(
        id=policy.id,
        name=policy.name,
        description=policy.description,
        ticket_type=policy.ticket_type,
        priority=policy.priority,
        service_id=policy.service_id,
        service_name=service_name,
        calendar_id=policy.calendar_id,
        calendar_name=calendar_name,
        response_target_minutes=policy.response_target_minutes,
        resolution_target_minutes=policy.resolution_target_minutes,
        is_active=policy.is_active,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


@router.get(
    "/sla-policies/{policy_id}",
    response_model=ITSMSLAPolicyResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Get single SLA policy detail",
)
def get_itsm_sla_policy(
    policy_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    policy = db.query(ITSMSLAPolicy).filter(ITSMSLAPolicy.tenant_id == tenant_id, ITSMSLAPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SLA policy not found in this tenant",
        )

    service_name = None
    if policy.service_id:
        srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == policy.service_id).first()
        if srv:
            service_name = srv[0]

    calendar_name = None
    if policy.calendar_id:
        cal = db.query(ITSMBusinessCalendar.name).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == policy.calendar_id).first()
        if cal:
            calendar_name = cal[0]

    return ITSMSLAPolicyResponse(
        id=policy.id,
        name=policy.name,
        description=policy.description,
        ticket_type=policy.ticket_type,
        priority=policy.priority,
        service_id=policy.service_id,
        service_name=service_name,
        calendar_id=policy.calendar_id,
        calendar_name=calendar_name,
        response_target_minutes=policy.response_target_minutes,
        resolution_target_minutes=policy.resolution_target_minutes,
        is_active=policy.is_active,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


@router.patch(
    "/sla-policies/{policy_id}",
    response_model=ITSMSLAPolicyResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Update SLA policy attributes or status",
)
def update_itsm_sla_policy(
    policy_id: UUID,
    payload: ITSMSLAPolicyUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)
    policy = db.query(ITSMSLAPolicy).filter(ITSMSLAPolicy.tenant_id == tenant_id, ITSMSLAPolicy.id == policy_id).first()
    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="SLA policy not found in this tenant",
        )

    if payload.name is not None:
        policy.name = payload.name.strip()

    if payload.description is not None:
        policy.description = payload.description.strip() if payload.description else None

    if payload.priority is not None:
        p_val = payload.priority.strip().upper()
        if p_val not in {"P1", "P2", "P3", "P4"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Priority must be one of: P1, P2, P3, P4",
            )
        policy.priority = p_val

    if payload.service_id is not None:
        if payload.service_id != policy.service_id:
            srv = db.query(ITSMService).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == payload.service_id).first()
            if not srv:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Associated service not found in this tenant",
                )
            policy.service_id = payload.service_id

    if payload.calendar_id is not None:
        if payload.calendar_id != policy.calendar_id:
            cal = db.query(ITSMBusinessCalendar).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == payload.calendar_id).first()
            if not cal:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Associated business calendar not found in this tenant",
                )
            policy.calendar_id = payload.calendar_id

    if payload.response_target_minutes is not None:
        policy.response_target_minutes = payload.response_target_minutes

    if payload.resolution_target_minutes is not None:
        policy.resolution_target_minutes = payload.resolution_target_minutes

    if payload.is_active is not None:
        policy.is_active = payload.is_active
        logger.info(
            "[ITSM_ADMIN_AUDIT] action=sla_policy_status_toggled tenant_id=%s admin_user_id=%s policy_id=%s is_active=%s",
            tenant_id,
            request.state.user_id,
            policy.id,
            policy.is_active,
        )

    policy.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(policy)

    service_name = None
    if policy.service_id:
        srv = db.query(ITSMService.name).filter(ITSMService.tenant_id == tenant_id, ITSMService.id == policy.service_id).first()
        if srv:
            service_name = srv[0]

    calendar_name = None
    if policy.calendar_id:
        cal = db.query(ITSMBusinessCalendar.name).filter(ITSMBusinessCalendar.tenant_id == tenant_id, ITSMBusinessCalendar.id == policy.calendar_id).first()
        if cal:
            calendar_name = cal[0]

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=sla_policy_updated tenant_id=%s admin_user_id=%s policy_id=%s",
        tenant_id,
        request.state.user_id,
        policy.id,
    )

    return ITSMSLAPolicyResponse(
        id=policy.id,
        name=policy.name,
        description=policy.description,
        ticket_type=policy.ticket_type,
        priority=policy.priority,
        service_id=policy.service_id,
        service_name=service_name,
        calendar_id=policy.calendar_id,
        calendar_name=calendar_name,
        response_target_minutes=policy.response_target_minutes,
        resolution_target_minutes=policy.resolution_target_minutes,
        is_active=policy.is_active,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


# =============================================================================
# 8. PLATFORM SETTINGS (Step 4)
# =============================================================================

@router.get(
    "/settings",
    response_model=ITSMPlatformSettingsResponse,
    dependencies=[Depends(require_itsm_platform_admin)],
    summary="Get verified ITSM platform settings and tenant operational summary",
)
def get_itsm_platform_settings(
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    tenant_name = tenant.name if tenant else "Current Tenant"

    active_services = db.query(func.count(ITSMService.id)).filter(
        ITSMService.tenant_id == tenant_id,
        ITSMService.status == "OPERATIONAL"
    ).scalar() or 0

    active_catalog_items = db.query(func.count(ITSMServiceCatalogItem.id)).filter(
        ITSMServiceCatalogItem.tenant_id == tenant_id,
        ITSMServiceCatalogItem.is_active == True
    ).scalar() or 0

    active_sla_policies = db.query(func.count(ITSMSLAPolicy.id)).filter(
        ITSMSLAPolicy.tenant_id == tenant_id,
        ITSMSLAPolicy.is_active == True
    ).scalar() or 0

    default_calendar = db.query(ITSMBusinessCalendar.name).filter(
        ITSMBusinessCalendar.tenant_id == tenant_id,
        ITSMBusinessCalendar.is_default == True
    ).first()
    default_calendar_name = default_calendar[0] if default_calendar else "24x7 Unrestricted Calendar"

    logger.info(
        "[ITSM_ADMIN_AUDIT] action=platform_settings_viewed tenant_id=%s admin_user_id=%s",
        tenant_id,
        request.state.user_id,
    )

    return ITSMPlatformSettingsResponse(
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        platform_edition="AuthClaw ITSM Foundation (Phase 4 MVP)",
        notifications_enabled=True,
        notification_delivery_channel="IN_APP",
        default_priority="P3",
        active_services_count=active_services,
        active_catalog_items_count=active_catalog_items,
        active_sla_policies_count=active_sla_policies,
        default_business_calendar=default_calendar_name,
    )


