"""API router for ITSM Service Requests (Step 6)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import deny_itsm_auditor_access, deny_itsm_auditor_mutation, get_current_tenant, get_tenant_db
from app.schemas.itsm_incidents import (
    IncidentActivityCreateRequest,
    IncidentActivityResponse,
)
from app.schemas.itsm_requests import (
    ServiceRequestAssignRequest,
    ServiceRequestResponse,
    ServiceRequestStatusUpdateRequest,
)
from app.services.itsm_request_service import RequestService

router = APIRouter()


def _get_user_role_and_validate(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    """Validate user has active ITSM access and retrieve role."""
    try:
        row = db.execute(
            text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row:
            if not row.has_itsm_access:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User does not have active ITSM access in this tenant",
                )
            if row.itsm_role:
                return str(row.itsm_role).upper()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify ITSM access",
        ) from exc
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="User does not have active ITSM access in this tenant",
    )


@router.get(
    "",
    response_model=list[ServiceRequestResponse],
    summary="List service requests",
    description="Retrieve paginated service requests for the current tenant with status and keyword filtering.",
)
def list_requests(
    request: Request,
    status_filter: Optional[str] = Query(default=None, alias="status", description="Filter by status (OPEN, IN_PROGRESS, RESOLVED, etc.)"),
    priority: Optional[str] = Query(default=None, description="Filter by priority (P1, P2, P3, P4)"),
    service_id: Optional[UUID] = Query(default=None, description="Filter by service ID"),
    assignee_id: Optional[UUID] = Query(default=None, description="Filter by assignee user ID"),
    assigned_to_me: bool = Query(default=False, description="Filter requests assigned to the logged-in agent"),
    search: Optional[str] = Query(default=None, description="Search ticket number, title, description"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_access(request, db, role, "request.list")

    requester_id = actor_id if role == "REQUESTER" else None

    return RequestService.list_requests(
        db=db,
        tenant_id=t_id,
        status_filter=status_filter,
        priority=priority,
        service_id=service_id,
        assignee_id=assignee_id,
        assigned_to_me=assigned_to_me,
        actor_id=actor_id,
        requester_id=requester_id,
        search=search,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{request_id}",
    response_model=ServiceRequestResponse,
    summary="Get single service request",
    description="Fetch a single service request with its catalog schema snapshot and submitted form data.",
)
def get_request(
    request_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_access(request, db, role, "request.read")

    res = RequestService.get_request(db=db, tenant_id=t_id, request_id=request_id)

    if role == "REQUESTER" and str(res.requester_id) != str(actor_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Service request '{request_id}' not found",
        )

    return res


@router.post(
    "/{request_id}/status",
    response_model=ServiceRequestResponse,
    summary="Change service request status",
    description="Transition service request lifecycle status according to the approved state machine.",
)
def change_request_status(
    request_id: UUID,
    payload: ServiceRequestStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_mutation(request, db, role, "request.status.change")

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to update service request status",
        )

    return RequestService.change_request_status(
        db=db,
        tenant_id=t_id,
        request_id=request_id,
        actor_id=actor_id,
        payload=payload,
    )


@router.post(
    "/{request_id}/assign",
    response_model=ServiceRequestResponse,
    summary="Assign service request",
    description="Assign or reassign a service request to a team or agent.",
)
def assign_request(
    request_id: UUID,
    payload: ServiceRequestAssignRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_mutation(request, db, role, "request.assign")

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to reassign service requests",
        )

    return RequestService.assign_request(
        db=db,
        tenant_id=t_id,
        request_id=request_id,
        actor_id=actor_id,
        payload=payload,
    )


@router.get(
    "/{request_id}/activities",
    response_model=list[IncidentActivityResponse],
    summary="List request activities",
    description="Retrieve activity timeline for a service request.",
)
def list_request_activities(
    request_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_access(request, db, role, "request.activity.list")

    activities = RequestService.list_activities(db=db, tenant_id=t_id, request_id=request_id)
    if role == "REQUESTER":
        activities = [a for a in activities if not a.is_internal]

    return activities


@router.post(
    "/{request_id}/activities",
    response_model=IncidentActivityResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add request activity",
    description="Post a comment or internal note to a service request.",
)
def add_request_activity(
    request_id: UUID,
    payload: IncidentActivityCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_user_role_and_validate(db, t_id, actor_id)

    deny_itsm_auditor_mutation(request, db, role, "request.activity.create")

    if role == "REQUESTER":
        payload.is_internal = False

    return RequestService.add_activity(
        db=db,
        tenant_id=t_id,
        request_id=request_id,
        actor_id=actor_id,
        payload=payload,
    )
