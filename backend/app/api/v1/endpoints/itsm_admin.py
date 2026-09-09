"""API Router for ITSM Platform Administration."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.db.models import (
    ITSMConfigurationItem,
    ITSMService,
    ITSMTeam,
    ITSMTeamMember,
    ITSMUserAccess,
    User,
)
from app.schemas.itsm_admin import (
    VALID_ITSM_ROLES,
    ITSMConfigurationItemCreateRequest,
    ITSMConfigurationItemResponse,
    ITSMConfigurationItemUpdateRequest,
    ITSMServiceCreateRequest,
    ITSMServiceResponse,
    ITSMServiceUpdateRequest,
    ITSMTeamCreateRequest,
    ITSMTeamDetailResponse,
    ITSMTeamMemberAddRequest,
    ITSMTeamMemberResponse,
    ITSMTeamResponse,
    ITSMTeamUpdateRequest,
    ITSMUserAccessUpdateRequest,
    ITSMUserItemResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _friendly_name_from_email(email: str) -> str:
    prefix = email.split("@")[0]
    parts = [p.capitalize() for p in prefix.replace(".", " ").replace("_", " ").split()]
    return " ".join(parts) or email


def _slugify(text_val: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text_val.strip().lower()).strip("-")
    return slug[:100] or "service"


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
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    """Return all users in the authenticated tenant with their current ITSM and Governance posture."""
    tenant_id = UUID(tenant_id_str)

    users = db.query(User).filter(User.tenant_id == tenant_id).order_by(User.created_at.asc()).all()
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

    db.commit()
    db.refresh(access_record)

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
    db: Session = Depends(get_tenant_db),
    tenant_id_str: str = Depends(get_current_tenant),
):
    tenant_id = UUID(tenant_id_str)

    teams = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant_id).order_by(ITSMTeam.created_at.asc()).all()

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
