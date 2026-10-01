"""API Router for ITSM Incident Management."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.auth import (
    deny_itsm_auditor_access,
    deny_itsm_auditor_mutation,
    ensure_itsm_role,
    get_current_tenant,
    get_tenant_db,
    require_itsm_roles,
)
from app.schemas.itsm_incidents import (
    IncidentActivityCreateRequest,
    IncidentActivityResponse,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentResponse,
    IncidentStatusUpdateRequest,
    IncidentSummaryStatsResponse,
    IncidentUpdateRequest,
    IncidentOperationsDashboardResponse,
    IncidentOperationsQueueResponse,
    IncidentOperationsReferenceDataResponse,
    MajorIncidentParticipantResponse,
    MajorIncidentDeclareRequest, MajorIncidentResponse, MajorIncidentUpdateRequest,
    IncidentSavedViewCreateRequest, IncidentSavedViewResponse,
)
from app.schemas.itsm_problems import (
    ReportRecurringProblemRequest,
    ReportRecurringProblemResponse,
)
from app.services.itsm_incident_service import IncidentService
from app.services.itsm_problem_service import ProblemService
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


def _get_itsm_role(db: Session, tenant_id: UUID, user_id: UUID) -> str:
    try:
        row = db.execute(
            text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
            {"tenant_id": str(tenant_id), "user_id": str(user_id)},
        ).first()
        if row and row.has_itsm_access and row.itsm_role:
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

    deny_itsm_auditor_mutation(request, db, role, "incident.create")

    if role == "REQUESTER":
        if not payload.urgency or str(payload.urgency).strip().upper() not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Urgency selection is required (High, Medium, or Low).",
            )
        payload.urgency = str(payload.urgency).strip().upper()
        payload.assignee_id = None
        payload.assignment_group = None
        payload.is_major_incident = False
    elif payload.urgency:
        payload.urgency = str(payload.urgency).strip().upper()
    else:
        payload.urgency = "MEDIUM"

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

    deny_itsm_auditor_access(request, db, role, "incident.list")

    agent_scope_id = None
    if role == "REQUESTER":
        requester_id = actor_id
    elif role == "SERVICE_AGENT":
        agent_scope_id = actor_id

    return IncidentService.list_incidents(
        db=db,
        tenant_id=t_id,
        status=status,
        priority=priority,
        service_id=service_id,
        category=category,
        assignee_id=assignee_id,
        requester_id=requester_id,
        agent_scope_id=agent_scope_id,
        created_after=created_after,
        created_before=created_before,
        search=search,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/summary",
    response_model=IncidentSummaryStatsResponse,
    summary="Get incident KPI summary statistics",
    description="Retrieve aggregated incident counts and average resolution times for tenant and requester.",
)
def get_incident_summary(
    request: Request,
    requester_id: Optional[UUID] = Query(default=None, description="Filter by requester user ID"),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role == "REQUESTER":
        requester_id = actor_id

    return IncidentService.get_incident_summary(
        db=db,
        tenant_id=t_id,
        requester_id=requester_id,
    )


@router.get(
    "/queue",
    response_model=list[IncidentResponse],
    summary="List Service Agent work queue",
    description="Retrieve workable incidents for the authenticated Service Agent within tenant context.",
)
def list_agent_queue(
    request: Request,
    filter_mode: str = Query(default="all", description="Queue filter: all, assigned_to_me, high_priority, sla_risk"),
    ticket_status: Optional[str] = Query(default=None, alias="status", description="Filter by lifecycle status"),
    sort_by: str = Query(default="recently_updated", description="Sort order: recently_updated, priority, sla_risk"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    if role != "SERVICE_AGENT":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Service Agents",
        )

    return IncidentService.list_agent_queue(
        db=db,
        tenant_id=t_id,
        agent_id=actor_id,
        filter_mode=filter_mode,
        status=ticket_status,
        sort_by=sort_by,
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
    agent_view: bool = Query(default=False, description="Enforce Service Agent role restriction for agent workspace"),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)
    role = _get_itsm_role(db, t_id, actor_id)

    deny_itsm_auditor_access(request, db, role, "incident.read")

    if agent_view and role != "SERVICE_AGENT":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access restricted to Service Agents",
        )

    incident = IncidentService.get_incident(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
    )

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    if role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
            )

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

    deny_itsm_auditor_mutation(request, db, role, "incident.update")

    if role == "REQUESTER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requesters are not permitted to modify operational incident details",
        )

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
            )

    if any(
        getattr(payload, field) is not None
        for field in ("priority", "assignee_id", "assignment_group", "is_major_incident")
    ):
        ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])

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

    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(t_id), "user_id": str(actor_id)},
    ).first()
    if access_row and not access_row.has_itsm_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITSM access disabled")

    role = str(access_row.itsm_role).upper() if (access_row and access_row.itsm_role) else _get_itsm_role(db, t_id, actor_id)
    deny_itsm_auditor_mutation(request, db, role, "incident.status.change")
    allowed_roles = {"SERVICE_AGENT", "INCIDENT_MANAGER", "PLATFORM_ADMINISTRATOR", "SERVICE_LEAD", "ADMIN"}
    if role not in allowed_roles:
        if role == "REQUESTER":
            target_status = payload.status.strip().upper() if payload.status else ""
            if target_status == "CANCELLED":
                ticket = IncidentService.get_incident(db, t_id, incident_id)
                if str(ticket.requester_id) != str(actor_id):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You can only cancel incidents that you submitted",
                    )
                if ticket.status in {"CLOSED", "CANCELLED"}:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cannot cancel incident in terminal status '{ticket.status}'",
                    )
                if ticket.status == "RESOLVED":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot cancel a resolved incident. You may reopen it if the issue is not fixed",
                    )
                if not payload.status_reason or not payload.status_reason.strip():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="A reason is required to cancel the ticket",
                    )
            elif target_status == "IN_PROGRESS":
                ticket = IncidentService.get_incident(db, t_id, incident_id)
                if str(ticket.requester_id) != str(actor_id):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You can only reopen incidents that you submitted",
                    )
                if ticket.status != "RESOLVED":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cannot reopen incident in status '{ticket.status}'. Only RESOLVED incidents can be reopened",
                    )
                if not payload.status_reason or not payload.status_reason.strip():
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="A reason is required to reopen the ticket",
                    )
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Requesters are only permitted to cancel open incidents or reopen resolved incidents",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Requesters and unauthorized roles are not permitted to change incident status",
            )

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
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
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
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
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)

    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(t_id), "user_id": str(actor_id)},
    ).first()
    if access_row and not access_row.has_itsm_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITSM access disabled")

    role = str(access_row.itsm_role).upper() if (access_row and access_row.itsm_role) else _get_itsm_role(db, t_id, actor_id)
    deny_itsm_auditor_mutation(request, db, role, "incident.activity.create")
    allowed_roles = {"SERVICE_AGENT", "INCIDENT_MANAGER", "PLATFORM_ADMINISTRATOR", "SERVICE_LEAD", "REQUESTER", "ADMIN"}
    if role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized role")

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "REQUESTER":
        if str(incident.requester_id) != str(actor_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
        payload.is_internal = False
    elif role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
            )

    return IncidentService.add_activity(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
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
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)

    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(t_id), "user_id": str(actor_id)},
    ).first()
    if access_row and not access_row.has_itsm_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITSM access disabled")

    role = str(access_row.itsm_role).upper() if (access_row and access_row.itsm_role) else _get_itsm_role(db, t_id, actor_id)
    allowed_roles = {"SERVICE_AGENT", "INCIDENT_MANAGER", "PLATFORM_ADMINISTRATOR", "SERVICE_LEAD", "REQUESTER", "ADMIN"}
    if role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized role")

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)

    if role == "REQUESTER" and str(incident.requester_id) != str(actor_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    elif role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
            )

    activities = IncidentService.list_activities(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
    )

    if role == "REQUESTER":
        activities = [
            a for a in activities
            if not (getattr(a, "is_internal", False) or bool((getattr(a, "activity_metadata", None) or {}).get("is_internal", False)))
        ]

    return activities


@router.post(
    "/{incident_id}/report-recurring-problem",
    response_model=ReportRecurringProblemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report recurring problem from incident",
    description="Service Agent reports a recurring problem from an incident, creating a Problem ticket and linking it.",
)
def report_recurring_problem(
    incident_id: UUID,
    payload: ReportRecurringProblemRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor_id = UUID(str(request.state.user_id))
    t_id = UUID(tenant_id)

    access_row = db.execute(
        text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tenant_id, :user_id)"),
        {"tenant_id": str(t_id), "user_id": str(actor_id)},
    ).first()
    if access_row and not access_row.has_itsm_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITSM access disabled")

    role = str(access_row.itsm_role).upper() if (access_row and access_row.itsm_role) else _get_itsm_role(db, t_id, actor_id)
    allowed_roles = {"SERVICE_AGENT", "ADMIN", "PLATFORM_ADMINISTRATOR"}
    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Service Agent role required to report recurring problem",
        )

    incident = IncidentService.get_incident(db=db, tenant_id=t_id, incident_id=incident_id)
    if role == "SERVICE_AGENT":
        if not IncidentService.check_incident_agent_access(db, t_id, incident, actor_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: Incident is not assigned to you or your team",
            )

    result = ProblemService.report_recurring_problem(
        db=db,
        tenant_id=t_id,
        incident_id=incident_id,
        actor_id=actor_id,
        payload=payload,
    )
    if result.already_reported:
        response.status_code = status.HTTP_200_OK
    else:
        response.status_code = status.HTTP_201_CREATED
    return result


@router.post(
    "/{incident_id}/report-problem",
    response_model=ReportRecurringProblemResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def report_problem_alias(
    incident_id: UUID,
    payload: ReportRecurringProblemRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return report_recurring_problem(
        incident_id=incident_id,
        payload=payload,
        request=request,
        response=response,
        db=db,
        tenant_id=tenant_id,
    )
