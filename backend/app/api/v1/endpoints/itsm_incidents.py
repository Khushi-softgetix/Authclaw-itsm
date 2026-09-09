"""API Router for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_incidents import (
    IncidentActivityCreateRequest,
    IncidentActivityResponse,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentResponse,
    IncidentStatusUpdateRequest,
    IncidentUpdateRequest,
)
from app.services.itsm_incident_service import IncidentService

router = APIRouter()


@router.post(
    "",
    response_model=IncidentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new incident",
    description="Logs an incident with automatic sequence number generation, tenant isolation, and optional SLA policy mapping.",
)
def create_incident(
    payload: IncidentCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = request.state.user_id
    return IncidentService.create_incident(
        db=db,
        tenant_id=UUID(tenant_id),
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.get(
    "",
    response_model=list[IncidentResponse],
    summary="List and filter incidents",
    description="Retrieve paginated incidents for the current tenant with flexible filtering and text search.",
)
def list_incidents(
    status: Optional[str] = Query(default=None, description="Filter by status (e.g. NEW, IN_PROGRESS, RESOLVED)"),
    priority: Optional[str] = Query(default=None, description="Filter by priority (e.g. P1, P2, P3, P4)"),
    service_id: Optional[UUID] = Query(default=None, description="Filter by affected service ID"),
    category: Optional[str] = Query(default=None, description="Filter by category"),
    assignee_id: Optional[UUID] = Query(default=None, description="Filter by assigned user ID"),
    requester_id: Optional[UUID] = Query(default=None, description="Filter by requester user ID"),
    created_after: Optional[datetime] = Query(default=None, description="Filter created after timestamp"),
    created_before: Optional[datetime] = Query(default=None, description="Filter created before timestamp"),
    search: Optional[str] = Query(default=None, description="Search in title, description, or ticket number"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return IncidentService.list_incidents(
        db=db,
        tenant_id=UUID(tenant_id),
        status=status,
        priority=priority,
        service_id=service_id,
        category=category,
        assignee_id=assignee_id,
        requester_id=requester_id,
        created_after=created_after,
        created_before=created_before,
        search=search,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/{incident_id}",
    response_model=IncidentResponse,
    summary="Get single incident",
    description="Fetch an incident by UUID within the authenticated tenant context.",
)
def get_incident(
    incident_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return IncidentService.get_incident(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
    )


@router.patch(
    "/{incident_id}",
    response_model=IncidentResponse,
    summary="Update incident details",
    description="Update non-terminal incident fields with automatic activity and audit logging.",
)
def update_incident(
    incident_id: UUID,
    payload: IncidentUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = request.state.user_id
    return IncidentService.update_incident(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.post(
    "/{incident_id}/status",
    response_model=IncidentResponse,
    summary="Change incident lifecycle status",
    description="Transitions incident status according to the approved ITSM state machine.",
)
def change_incident_status(
    incident_id: UUID,
    payload: IncidentStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = request.state.user_id
    return IncidentService.change_status(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.post(
    "/{incident_id}/assign",
    response_model=IncidentResponse,
    summary="Assign or reassign incident",
    description="Assigns incident to a tenant user or team, advancing state from NEW to ASSIGNED if applicable.",
)
def assign_incident(
    incident_id: UUID,
    payload: IncidentAssignRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = request.state.user_id
    return IncidentService.assign_incident(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.post(
    "/{incident_id}/activities",
    response_model=IncidentActivityResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add comment or activity note",
    description="Append a public or internal activity note to the incident timeline.",
)
def add_incident_activity(
    incident_id: UUID,
    payload: IncidentActivityCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = request.state.user_id
    return IncidentService.add_activity(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.get(
    "/{incident_id}/activities",
    response_model=list[IncidentActivityResponse],
    summary="List incident activity timeline",
    description="Retrieve all chronological activities and notes for an incident.",
)
def list_incident_activities(
    incident_id: UUID,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return IncidentService.list_activities(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
    )
