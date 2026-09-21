"""API Router for ITSM Problem Management."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_problems import (
    ProblemActivityResponse,
    ProblemCloseRequest,
    ProblemDetailResponse,
    ProblemInvestigationUpdateRequest,
    ProblemResolveRequest,
    ProblemStatsResponse,
    ProblemSummaryResponse,
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


