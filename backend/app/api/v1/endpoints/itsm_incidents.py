"""API Router for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
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


def _get_itsm_role(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    try:
        row = db.execute(
            text("SELECT itsm_role FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row and row.itsm_role:
            return str(row.itsm_role).upper()
    except Exception:
        pass
    return "ADMIN"


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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if not payload.urgency or str(payload.urgency).strip().upper() not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Urgency selection is required (High, Medium, or Low).",
        )
    payload.urgency = str(payload.urgency).strip().upper()

    if role == "REQUESTER":
        payload.assignee_id = None
        payload.assignment_group = None
        payload.is_major_incident = False

    res = IncidentService.create_incident(
        db=db,
        tenant_id=t_id,
        actor_id=actor_id,
        payload=payload,
    )
    try:
        from app.services.notifications import create_notification
        create_notification(
            db=db,
            tenant_id=t_id,
            user_id=actor_id,
            type="itsm.incident.created",
            severity="info",
            title=f"Incident Created: {res.ticket_number}",
            body=f"Your ticket '{res.title}' has been logged.",
            link=f"/itsm/incidents/{res.id}",
        )
    except Exception:
        pass
    return res


@router.get(
    "",
    response_model=list[IncidentResponse],
    summary="List and filter incidents",
    description="Retrieve paginated incidents for the current tenant with flexible filtering and text search.",
)
def list_incidents(
    request: Request,
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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role == "REQUESTER":
        requester_id = actor_id

    return IncidentService.list_incidents(
        db=db,
        tenant_id=t_id,
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
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    incident = IncidentService.get_incident(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
    )

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    return incident


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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to modify operational incident details",
        )

    return IncidentService.update_incident(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to change incident status",
        )

    return IncidentService.change_status(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to assign incidents",
        )

    return IncidentService.assign_incident(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "REQUESTER":
        if str(incident.requester_id) != str(actor_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
        payload.is_internal = False

    res = IncidentService.add_activity(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
        payload=payload,
    )
    try:
        from app.services.notifications import create_notification
        title = f"Comment added on {incident.ticket_number}" if str(actor_id) == str(incident.requester_id) else f"IT Agent update on {incident.ticket_number}"
        create_notification(
            db=db,
            tenant_id=t_id,
            user_id=incident.requester_id,
            type="itsm.incident.comment",
            severity="info",
            title=title,
            body=payload.content[:120],
            link=f"/itsm/incidents/{incident.id}",
        )
    except Exception:
        pass
    return res


@router.get(
    "/{incident_id}/activities",
    response_model=list[IncidentActivityResponse],
    summary="List incident activity timeline",
    description="Retrieve all chronological activities and notes for an incident.",
)
def list_incident_activities(
    incident_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    activities = IncidentService.list_activities(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
    )

    if role == "REQUESTER":
        activities = [a for a in activities if not getattr(a, "is_internal", False)]

    return activities
