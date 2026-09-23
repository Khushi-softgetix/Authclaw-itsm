from __future__ import annotations

import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_changes import (
    ChangeActivityItem,
    ChangeAssessmentUpdateRequest,
    ChangeDetailResponse,
    ChangeLifecycleTransitionRequest,
    ChangeStatsResponse,
    ChangeSummaryResponse,
    RelatedProblemSummary,
)
from app.services.itsm_change_service import ITSMChangeService

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_ROLES = {
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "ADMIN",
}


def _verify_change_manager_access(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Verify tenant-scoped ITSM entitlement and ensure caller has PROCESS_CHANGE_MANAGER role."""
    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(tenant_id), "user_id": str(user_id)},
    ).first()

    if not access_row or not access_row.has_itsm_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ITSM access disabled or missing for this user",
        )

    role = str(access_row.itsm_role).upper() if access_row.itsm_role else "REQUESTER"
    if role not in ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Problem and Change Manager role required",
        )
    return role


@router.get(
    "",
    response_model=List[ChangeSummaryResponse],
    summary="List Change Management queue",
    description="Retrieve change requests for the Problem and Change Manager with filtering and search.",
)
def list_changes(
    request: Request,
    status: Optional[str] = Query(default=None, description="Filter by status (e.g. OPEN, IN_PROGRESS, SCHEDULED, COMPLETED)"),
    search: Optional[str] = Query(default=None, description="Search changes by change_number or title"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """List change requests for the authenticated tenant."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.list_changes(
        db=db,
        tenant_id=t_id,
        status_filter=status,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/stats",
    response_model=ChangeStatsResponse,
    summary="Change Management queue statistics",
    description="Summary counts of total, open, in-progress, scheduled, and completed change requests.",
)
def get_change_stats(
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Retrieve aggregate statistics for Change requests."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.get_change_stats(
        db=db,
        tenant_id=t_id,
    )


@router.get(
    "/{change_id}",
    response_model=ChangeDetailResponse,
    summary="Get Change request detail",
    description="Retrieve detailed change request information including affected configuration items.",
)
def get_change(
    change_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Retrieve details for a single change request."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.get_change(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
    )


@router.patch(
    "/{change_id}/assessment",
    response_model=ChangeDetailResponse,
    summary="Update Change assessment",
    description="Update risk level, impact level, change type, implementation plan, and test plan.",
)
def update_change_assessment(
    change_id: UUID,
    payload: ChangeAssessmentUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Update assessment details for a change request."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.update_assessment(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.patch(
    "/{change_id}",
    response_model=ChangeDetailResponse,
    summary="Update Change request",
    description="Update change request assessment and planning fields.",
)
def update_change(
    change_id: UUID,
    payload: ChangeAssessmentUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Alias for updating change assessment fields."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.update_assessment(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.post(
    "/{change_id}/transition",
    response_model=ChangeDetailResponse,
    summary="Transition Change Request lifecycle",
    description="Execute validated lifecycle transition (submit_review, approve, reject, schedule, start_implementation, complete, close, cancel).",
)
def transition_change_lifecycle(
    change_id: UUID,
    payload: ChangeLifecycleTransitionRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Transition change request through supported lifecycle state."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.transition_lifecycle(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.post(
    "/{change_id}/lifecycle",
    response_model=ChangeDetailResponse,
    summary="Alias for Change Request lifecycle transition",
    include_in_schema=False,
)
def transition_change_lifecycle_alias(
    change_id: UUID,
    payload: ChangeLifecycleTransitionRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Alias for transitioning change lifecycle."""
    return transition_change_lifecycle(change_id, payload, request, db, tenant_id)


@router.get(
    "/{change_id}/activities",
    response_model=List[ChangeActivityItem],
    summary="Get Change Request activity and audit history",
    description="Retrieve chronological audit and transition history for a change request.",
)
def get_change_activities(
    change_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Retrieve audit history and activities for a change request."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    return ITSMChangeService.get_change_activities(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
    )


@router.get(
    "/{change_id}/problem",
    response_model=Optional[RelatedProblemSummary],
    summary="Get related Problem ticket for a Change Request",
    description="Retrieve the active Problem ticket linked to this Change Request, if one exists.",
)
def get_related_problem(
    change_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Retrieve related problem ticket for a change request."""
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_change_manager_access(db, t_id, actor_id)

    # Verify change exists in tenant
    ITSMChangeService.get_change(db, t_id, change_id)

    return ITSMChangeService.get_related_problem(
        db=db,
        tenant_id=t_id,
        change_id=change_id,
    )
