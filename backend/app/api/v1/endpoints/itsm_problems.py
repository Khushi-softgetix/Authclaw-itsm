"""API Router for ITSM Problem Management."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_changes import ChangeDetailResponse, ChangeSummaryResponse
from app.schemas.itsm_problems import (
    CreateChangeFromProblemRequest,
    LinkChangeRequest,
    ProblemActivityResponse,
    ProblemCloseRequest,
    ProblemDetailResponse,
    ProblemInvestigationUpdateRequest,
    ProblemResolveRequest,
    ProblemStatsResponse,
    ProblemSummaryResponse,
    UnlinkChangeRequest,
    KnownErrorLookupItem,
    PublishWorkaroundRequest,
    RetireWorkaroundRequest,
    WorkaroundGovernanceResponse,
)
from app.services.itsm_problem_service import ProblemService



router = APIRouter()

ALLOWED_ROLES = {
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "ADMIN",
}


def _verify_problem_manager_access(db: Session, tenant_id: UUID, user_id: UUID) -> str:
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


KNOWN_ERROR_LOOKUP_ROLES = {
    "SERVICE_AGENT",
    "INCIDENT_MANAGER",
    "PROCESS_CHANGE_MANAGER",
    "PLATFORM_ADMINISTRATOR",
    "ADMIN",
    "SERVICE_LEAD",
}


def _verify_known_error_lookup_access(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Verify tenant-scoped ITSM entitlement and ensure caller has agent or manager role."""
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
    if role not in KNOWN_ERROR_LOOKUP_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Service Agent or Problem Manager role required for Known Error lookup",
        )
    return role


@router.get(
    "",
    response_model=List[ProblemSummaryResponse],
    summary="List Problem Management queue",
    description="Retrieve problem tickets for the Problem and Change Manager with filtering and search.",
)
def list_problems(
    request: Request,
    status: Optional[str] = Query(default=None, description="Filter by status (e.g. OPEN, IN_PROGRESS, RESOLVED, CLOSED)"),
    search: Optional[str] = Query(default=None, description="Search by problem number or short description"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.list_problems(
        db=db,
        tenant_id=t_id,
        status_filter=status,
        search=search,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/stats",
    response_model=ProblemStatsResponse,
    summary="Problem Management queue statistics",
    description="Summary counts of open, in-progress, resolved, and total problem tickets.",
)
def get_problem_stats(
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.get_problem_stats(db=db, tenant_id=t_id)


@router.get(
    "/known-errors",
    response_model=List[KnownErrorLookupItem],
    summary="Search Known Error Database (KEDB)",
    description="Tenant-scoped read-only search of approved Known Errors and workarounds for service triage.",
)
def search_known_errors(
    request: Request,
    search: Optional[str] = Query(default=None, description="Search term matching symptoms, title, or workaround"),
    service_id: Optional[UUID] = Query(default=None, description="Filter by affected service"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_known_error_lookup_access(db, t_id, actor_id)

    return ProblemService.search_known_errors(
        db=db,
        tenant_id=t_id,
        search=search,
        service_id=service_id,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{problem_id}",
    response_model=ProblemDetailResponse,
    summary="Get Problem detail",
    description="Retrieve full details for a problem ticket including related incidents and KEDB/RCA details.",
)
def get_problem_detail(
    problem_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.get_problem(db=db, tenant_id=t_id, problem_id=problem_id)


@router.patch(
    "/{problem_id}/investigation",
    response_model=ProblemDetailResponse,
    summary="Update Problem investigation and root cause",
    description="Record or update root cause, workaround, known error flag, permanent solution, notes, and status for a problem.",
)
def update_problem_investigation(
    problem_id: UUID,
    payload: ProblemInvestigationUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.update_investigation(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.get(
    "/{problem_id}/activities",
    response_model=List[ProblemActivityResponse],
    summary="List Problem activity history",
    description="Retrieve chronological activity, investigation notes, and status changes for a problem ticket.",
)
def list_problem_activities(
    problem_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.list_problem_activities(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
    )


@router.post(
    "/{problem_id}/resolve",
    response_model=ProblemDetailResponse,
    summary="Resolve Problem ticket",
    description="Mark an investigated problem as RESOLVED, recording resolution summary, permanent solution, and activity note.",
)
def resolve_problem(
    problem_id: UUID,
    payload: ProblemResolveRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.resolve_problem(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.post(
    "/{problem_id}/close",
    response_model=ProblemDetailResponse,
    summary="Close Problem ticket",
    description="Conclude lifecycle and mark a RESOLVED problem as CLOSED with optional closure notes.",
)
def close_problem(
    problem_id: UUID,
    request: Request,
    payload: Optional[ProblemCloseRequest] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.close_problem(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        payload=payload,
        actor_id=actor_id,
    )


@router.get(
    "/{problem_id}/changes",
    response_model=List[ChangeSummaryResponse],
    summary="Get related Change Requests for a Problem ticket",
    description="Retrieve all currently active Change Requests linked to the specified Problem ticket.",
)
def get_related_changes(
    problem_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.get_related_changes(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
    )


@router.post(
    "/{problem_id}/link-change",
    response_model=List[ChangeSummaryResponse],
    summary="Link an existing Change Request to Problem",
    description="Associate an existing Change Request with a Problem ticket, enforcing tenant boundaries.",
)
def link_change(
    problem_id: UUID,
    payload: LinkChangeRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    actor_email = getattr(request.state, "user_email", None)
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.link_change(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        change_id=payload.change_id,
        actor_id=actor_id,
        actor_email=actor_email,
    )


@router.post(
    "/{problem_id}/unlink-change",
    response_model=List[ChangeSummaryResponse],
    summary="Unlink a Change Request from Problem",
    description="Remove the link between a Change Request and Problem ticket without deleting the Change.",
)
def unlink_change(
    problem_id: UUID,
    payload: UnlinkChangeRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    actor_email = getattr(request.state, "user_email", None)
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.unlink_change(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        change_id=payload.change_id,
        actor_id=actor_id,
        actor_email=actor_email,
    )


@router.post(
    "/{problem_id}/create-change",
    response_model=ChangeDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Change Request pre-filled from Problem",
    description="Create a new Change Request derived from Problem details and automatically link them.",
)
def create_change_from_problem(
    problem_id: UUID,
    payload: CreateChangeFromProblemRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    actor_email = getattr(request.state, "user_email", None)
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.create_change_from_problem(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        payload=payload,
        actor_id=actor_id,
        actor_email=actor_email,
    )


@router.post(
    "/{problem_id}/publish-workaround",
    response_model=WorkaroundGovernanceResponse,
    summary="Publish and approve Problem Workaround",
    description="Problem Manager action to approve and publish a workaround, validating non-empty content and recording governance timestamps and activity.",
)
@router.post(
    "/{problem_id}/workaround/publish",
    response_model=WorkaroundGovernanceResponse,
    include_in_schema=False,
)
def publish_workaround(
    problem_id: UUID,
    request: Request,
    payload: Optional[PublishWorkaroundRequest] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.publish_workaround(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        actor_id=actor_id,
        payload=payload,
    )


@router.post(
    "/{problem_id}/retire-workaround",
    response_model=WorkaroundGovernanceResponse,
    summary="Retire Problem Workaround",
    description="Problem Manager action to retire an active workaround. Does not alter the parent problem status.",
)
@router.post(
    "/{problem_id}/workaround/retire",
    response_model=WorkaroundGovernanceResponse,
    include_in_schema=False,
)
def retire_workaround(
    problem_id: UUID,
    request: Request,
    payload: Optional[RetireWorkaroundRequest] = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    _verify_problem_manager_access(db, t_id, actor_id)

    return ProblemService.retire_workaround(
        db=db,
        tenant_id=t_id,
        problem_id=problem_id,
        actor_id=actor_id,
        payload=payload,
    )
