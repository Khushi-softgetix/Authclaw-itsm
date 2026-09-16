"""API Router for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import ensure_itsm_role, get_current_tenant, get_tenant_db, require_itsm_roles
from app.schemas.itsm_incidents import (
    IncidentActivityCreateRequest,
    IncidentActivityResponse,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentResponse,
    IncidentStatusUpdateRequest,
    IncidentUpdateRequest,
    IncidentOperationsDashboardResponse,
    IncidentOperationsQueueResponse,
    IncidentOperationsReferenceDataResponse,
    MajorIncidentParticipantResponse,
    MajorIncidentDeclareRequest, MajorIncidentResponse, MajorIncidentUpdateRequest,
    IncidentSavedViewCreateRequest, IncidentSavedViewResponse,
)
from app.services.itsm_incident_service import IncidentService
from app.services.itsm_incident_operations import (
    OPEN_STATUSES,
    build_operations_dashboard,
    evaluate_incident_operations,
)

router = APIRouter()


@router.get("/operations/saved-views", response_model=list[IncidentSavedViewResponse])
def list_incident_saved_views(request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    return IncidentService.list_saved_views(db, UUID(tenant_id), UUID(str(request.state.user_id)))


@router.post("/operations/saved-views", response_model=IncidentSavedViewResponse, status_code=status.HTTP_201_CREATED)
def save_incident_view(payload: IncidentSavedViewCreateRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    return IncidentService.create_saved_view(db, UUID(tenant_id), UUID(str(request.state.user_id)), payload)


@router.delete("/operations/saved-views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_incident_saved_view(view_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    IncidentService.delete_saved_view(db, UUID(tenant_id), UUID(str(request.state.user_id)), view_id)


@router.get(
    "/operations/reference-data",
    response_model=IncidentOperationsReferenceDataResponse,
    summary="Incident Manager coordination reference data",
)
def incident_manager_reference_data(
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
):
    return IncidentService.get_incident_reference_data(db, UUID(tenant_id))


@router.get(
    "/operations/participants",
    response_model=list[MajorIncidentParticipantResponse],
    summary="List eligible Major Incident command participants",
)
def incident_manager_command_participants(
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
):
    return IncidentService.list_major_command_participants(db, UUID(tenant_id), commanders_only=True)


@router.get(
    "/operations/queue",
    response_model=IncidentOperationsQueueResponse,
    summary="Incident Manager operational queue",
)
def incident_manager_operations_queue(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    priority: Optional[str] = Query(default=None),
    attention: Optional[str] = Query(
        default=None,
        description="WATCH, PRIORITY, SLA_AT_RISK, SLA_BREACHED, or STUCK",
    ),
    assignment_group: Optional[str] = Query(default=None),
    assignee_id: Optional[UUID] = Query(default=None),
    unassigned: bool = Query(default=False, description="Only incidents without an individual assignee"),
    search: Optional[str] = Query(default=None),
    command_scope: bool = Query(default=False),
    sort_by: str = Query(default="priority", pattern="^(priority|sla_due|updated)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
):
    tenant_uuid = UUID(tenant_id)
    if unassigned and assignee_id:
        raise HTTPException(status_code=422, detail="assignee_id and unassigned cannot be combined")
    incident_ids = None
    if attention:
        normalized_attention = attention.strip().upper()
        dashboard = build_operations_dashboard(db, tenant_uuid)
        attention_sources = {
            "WATCH": dashboard["escalation_watch"],
            "PRIORITY": dashboard["priority_watch"],
            "SLA_AT_RISK": dashboard["sla_at_risk"],
            "SLA_BREACHED": dashboard["sla_breached"],
            "STUCK": dashboard["stuck"],
        }
        if normalized_attention not in attention_sources:
            raise HTTPException(status_code=422, detail="Unsupported attention filter")
        incident_ids = {
            UUID(str(item["incident_id"]))
            for item in attention_sources[normalized_attention]
        }

    incidents, total = IncidentService.list_incident_operations_queue(
        db,
        tenant_uuid,
        status_filter=status_filter,
        priority=priority,
        assignment_group=assignment_group,
        assignee_id=assignee_id,
        unassigned_only=unassigned,
        search=search,
        incident_ids=incident_ids,
        command_scope=command_scope,
        sort_by=sort_by,
        offset=offset,
        limit=limit,
    )
    open_incidents = [ticket for ticket in incidents if ticket.status in OPEN_STATUSES]
    operations = {
        UUID(str(item["incident_id"])): item
        for item in evaluate_incident_operations(db, tenant_uuid, open_incidents)
    }
    return {
        "items": [
            {"incident": ticket, "operations": operations.get(ticket.id)}
            for ticket in incidents
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/operations/dashboard", response_model=IncidentOperationsDashboardResponse, summary="Incident Manager operational dashboard")
def incident_manager_dashboard(
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
):
    return build_operations_dashboard(db, UUID(tenant_id))


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
    if any(getattr(payload, field) is not None for field in ("priority", "assignee_id", "assignment_group", "is_major_incident")):
        ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])
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
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
):
    actor_id = request.state.user_id
    return IncidentService.assign_incident(
        db=db,
        tenant_id=UUID(tenant_id),
        incident_id=incident_id,
        actor_id=UUID(str(actor_id)),
        payload=payload,
    )


@router.post("/{incident_id}/major-incident", response_model=MajorIncidentResponse, status_code=status.HTTP_201_CREATED, summary="Declare a major incident")
def declare_major_incident(incident_id: UUID, payload: MajorIncidentDeclareRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    return IncidentService.declare_major_incident(db, UUID(tenant_id), incident_id, UUID(str(request.state.user_id)), payload)


@router.get("/{incident_id}/major-incident", response_model=MajorIncidentResponse, summary="Read major incident command details")
def get_major_incident(incident_id: UUID, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    return IncidentService.get_major_incident(db, UUID(tenant_id), incident_id)


@router.patch("/{incident_id}/major-incident", response_model=MajorIncidentResponse, summary="Update major incident command details")
def update_major_incident(incident_id: UUID, payload: MajorIncidentUpdateRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant), _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"])):
    return IncidentService.update_major_incident(db, UUID(tenant_id), incident_id, UUID(str(request.state.user_id)), payload)


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
