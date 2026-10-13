"""Protected APIs for standalone Outage & Alerts."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.auth import ensure_itsm_role, get_current_tenant, get_tenant_db
from app.db.models import (
    ITSMChangeRequest, ITSMConfigurationItem, ITSMMajorIncident, ITSMOutageAlert,
    ITSMProblemDetail,
    ITSMService, ITSMServiceConsumer, ITSMServiceSupportTeam, ITSMTeam, ITSMTicket,
    ITSMTeamMember, ITSMUserAccess, User,
)
from app.schemas.itsm_outage_alerts import (
    AlertDetail, AlertDraftRequest, AlertEvidencePage, AlertPreview, AlertPreviewRequest,
    AlertPublicationRequest, AlertReferenceData, AlertSummary, ServiceConsumerRequest,
    ServiceSupportTeamRequest,
)
from app.services.itsm_outage_alert_service import OutageAlertService

router = APIRouter()


def _identity(request: Request, tenant_id: str) -> tuple[UUID, UUID]:
    return UUID(tenant_id), UUID(str(request.state.user_id))


@router.get("", response_model=list[AlertSummary])
def list_alerts(request: Request, alert_status: str | None = Query(default=None, alias="status"), linked_type: str | None = Query(default=None), linked_id: UUID | None = Query(default=None), db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return OutageAlertService.list_visible(db, tenant, actor, alert_status, linked_type, linked_id)


@router.get("/active", response_model=list[AlertSummary])
def list_active_alerts(request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return OutageAlertService.list_visible(db, tenant, actor, "ACTIVE")


@router.get("/auditor-evidence", response_model=AlertEvidencePage)
def list_auditor_evidence(
    request: Request,
    search: str | None = Query(default=None, min_length=1, max_length=120),
    lifecycle_status: str | None = Query(default=None, alias="status", pattern="^(DRAFT|ACTIVE|RECOVERED|CANCELLED)$"),
    severity: str | None = Query(default=None, pattern="^(CRITICAL|HIGH|MEDIUM|LOW)$"),
    audience: str | None = Query(default=None, max_length=32),
    actor: str | None = Query(default=None, min_length=1, max_length=255),
    delivery_status: str | None = Query(default=None, pattern="^(QUEUED|AVAILABLE|FAILED|RETRYING|PERMANENTLY_FAILED)$"),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    tenant, actor_id = _identity(request, tenant_id)
    return OutageAlertService.list_auditor_evidence(
        db,
        tenant,
        actor_id,
        search=search,
        lifecycle_status=lifecycle_status,
        severity=severity,
        audience=audience,
        actor=actor,
        delivery_status=delivery_status,
        start=start,
        end=end,
        offset=offset,
        limit=limit,
    )


@router.get("/reference-data", response_model=AlertReferenceData)
def reference_data(request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])
    tenant = UUID(tenant_id)
    actor = UUID(str(request.state.user_id))
    service_scope = OutageAlertService.permission_scope(db, tenant, actor, "OUTAGE_ALERT:CREATE")
    service_query = db.query(ITSMService).filter(ITSMService.tenant_id == tenant)
    ci_query = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant)
    team_query = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant, ITSMTeam.is_active.is_(True))
    if service_scope is not None:
        service_query = service_query.filter(ITSMService.id.in_(service_scope))
        ci_query = ci_query.filter(ITSMConfigurationItem.service_id.in_(service_scope))
        team_query = team_query.join(
            ITSMServiceSupportTeam,
            (ITSMServiceSupportTeam.team_id == ITSMTeam.id)
            & (ITSMServiceSupportTeam.tenant_id == ITSMTeam.tenant_id),
        ).filter(ITSMServiceSupportTeam.service_id.in_(service_scope))
    services = service_query.order_by(ITSMService.name).all()
    cis = ci_query.order_by(ITSMConfigurationItem.name).all()
    teams = team_query.distinct().order_by(ITSMTeam.name).all()
    records = []
    try:
        link_scope = OutageAlertService.permission_scope(db, tenant, actor, "OUTAGE_ALERT:LINK")
    except HTTPException:
        link_scope = set()
    ticket_query = db.query(ITSMTicket).filter(ITSMTicket.tenant_id == tenant, ITSMTicket.ticket_type.in_(["INCIDENT", "PROBLEM"]))
    major_query = db.query(ITSMMajorIncident).join(ITSMTicket, ITSMTicket.id == ITSMMajorIncident.ticket_id).filter(
        ITSMMajorIncident.tenant_id == tenant,
        ITSMTicket.tenant_id == tenant,
    )
    change_query = db.query(ITSMChangeRequest).filter(ITSMChangeRequest.tenant_id == tenant)
    if link_scope is not None:
        ticket_query = ticket_query.filter(ITSMTicket.service_id.in_(link_scope))
        major_query = major_query.filter(ITSMTicket.service_id.in_(link_scope))
        change_query = change_query.filter(ITSMChangeRequest.service_id.in_(link_scope))
    for row in ticket_query.order_by(ITSMTicket.created_at.desc()).limit(200):
        records.append({"id": str(row.id), "type": row.ticket_type, "number": row.ticket_number, "title": row.title})
    for row in major_query.order_by(ITSMMajorIncident.created_at.desc()).limit(100):
        records.append({"id": str(row.id), "type": "MAJOR_INCIDENT", "number": row.ticket.ticket_number, "title": row.ticket.title})
    for row in change_query.order_by(ITSMChangeRequest.created_at.desc()).limit(100):
        records.append({"id": str(row.id), "type": "CHANGE", "number": row.change_number, "title": row.title})
    return {
        "services": [{"id": str(row.id), "name": row.name, "status": row.status} for row in services],
        "configuration_items": [{"id": str(row.id), "name": row.name, "service_id": str(row.service_id) if row.service_id else None, "status": row.status} for row in cis],
        "teams": [{"id": str(row.id), "name": row.name} for row in teams],
        "related_records": records,
        "supported_channels": ["IN_APP", "PORTAL"],
    }


@router.get("/reference-options")
def reference_options(
    request: Request,
    kind: str = Query(pattern="^(SERVICE|CONFIGURATION_ITEM|TEAM|RELATED_RECORD|RECIPIENT)$"),
    search: str | None = Query(default=None, max_length=120),
    record_type: str | None = Query(default=None, pattern="^(INCIDENT|MAJOR_INCIDENT|PROBLEM|CHANGE)$"),
    service_ids: list[UUID] | None = Query(default=None),
    related_records: list[str] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    """Return a small, authorized page of reference choices for large alert forms."""
    ensure_itsm_role(request, db, ["INCIDENT_MANAGER"])
    tenant = UUID(tenant_id)
    actor = UUID(str(request.state.user_id))
    permission = "OUTAGE_ALERT:LINK" if kind == "RELATED_RECORD" else "OUTAGE_ALERT:CREATE"
    scope = OutageAlertService.permission_scope(db, tenant, actor, permission)
    requested_services = set(service_ids or ())
    if scope is not None and requested_services and not requested_services.issubset(scope):
        raise HTTPException(status_code=403, detail="Reference lookup is outside the authorized service scope")
    term = (search or "").strip()
    pattern = f"%{term}%"

    if kind == "SERVICE":
        query = db.query(ITSMService).filter(ITSMService.tenant_id == tenant)
        if scope is not None:
            query = query.filter(ITSMService.id.in_(scope))
        if term:
            query = query.filter(ITSMService.name.ilike(pattern))
        total = query.count()
        rows = query.order_by(ITSMService.name.asc()).offset(offset).limit(limit).all()
        items = [{"value": str(row.id), "label": row.name, "meta": row.status} for row in rows]
    elif kind == "CONFIGURATION_ITEM":
        query = db.query(ITSMConfigurationItem).filter(ITSMConfigurationItem.tenant_id == tenant)
        if scope is not None:
            query = query.filter(ITSMConfigurationItem.service_id.in_(scope))
        if service_ids:
            query = query.filter(ITSMConfigurationItem.service_id.in_(service_ids))
        if term:
            query = query.filter(ITSMConfigurationItem.name.ilike(pattern))
        total = query.count()
        rows = query.order_by(ITSMConfigurationItem.name.asc()).offset(offset).limit(limit).all()
        items = [{"value": str(row.id), "label": row.name, "meta": row.status} for row in rows]
    elif kind == "TEAM":
        query = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant, ITSMTeam.is_active.is_(True))
        if scope is not None:
            query = query.join(
                ITSMServiceSupportTeam,
                (ITSMServiceSupportTeam.team_id == ITSMTeam.id)
                & (ITSMServiceSupportTeam.tenant_id == ITSMTeam.tenant_id),
            ).filter(ITSMServiceSupportTeam.service_id.in_(scope))
        if term:
            query = query.filter(ITSMTeam.name.ilike(pattern))
        total = query.distinct().count()
        rows = query.distinct().order_by(ITSMTeam.name.asc()).offset(offset).limit(limit).all()
        items = [{"value": str(row.id), "label": row.name, "meta": "Active team"} for row in rows]
    elif kind == "RELATED_RECORD":
        requested_types = {record_type} if record_type else {"INCIDENT", "MAJOR_INCIDENT", "PROBLEM", "CHANGE"}
        fetch_limit = offset + limit + 1
        records: list[tuple[object, dict]] = []
        total = 0

        if requested_types & {"INCIDENT", "PROBLEM"}:
            ticket_query = db.query(ITSMTicket).filter(
                ITSMTicket.tenant_id == tenant,
                ITSMTicket.ticket_type.in_(list(requested_types & {"INCIDENT", "PROBLEM"})),
            )
            if scope is not None:
                ticket_query = ticket_query.filter(ITSMTicket.service_id.in_(scope))
            if service_ids:
                ticket_query = ticket_query.filter(ITSMTicket.service_id.in_(service_ids))
            if term:
                ticket_query = ticket_query.filter(or_(ITSMTicket.ticket_number.ilike(pattern), ITSMTicket.title.ilike(pattern)))
            total += ticket_query.count()
            for row in ticket_query.order_by(ITSMTicket.created_at.desc()).limit(fetch_limit).all():
                records.append((row.created_at, {"value": f"{row.ticket_type}:{row.id}", "label": f"{row.ticket_number} — {row.title}", "meta": row.ticket_type.replace("_", " ")}))

        if "MAJOR_INCIDENT" in requested_types:
            major_query = db.query(ITSMMajorIncident).join(ITSMTicket, ITSMTicket.id == ITSMMajorIncident.ticket_id).filter(
                ITSMMajorIncident.tenant_id == tenant,
                ITSMTicket.tenant_id == tenant,
            )
            if scope is not None:
                major_query = major_query.filter(ITSMTicket.service_id.in_(scope))
            if service_ids:
                major_query = major_query.filter(ITSMTicket.service_id.in_(service_ids))
            if term:
                major_query = major_query.filter(or_(ITSMTicket.ticket_number.ilike(pattern), ITSMTicket.title.ilike(pattern)))
            total += major_query.count()
            for row in major_query.order_by(ITSMMajorIncident.created_at.desc()).limit(fetch_limit).all():
                records.append((row.created_at, {"value": f"MAJOR_INCIDENT:{row.id}", "label": f"{row.ticket.ticket_number} — {row.ticket.title}", "meta": "MAJOR INCIDENT"}))

        if "CHANGE" in requested_types:
            change_query = db.query(ITSMChangeRequest).filter(ITSMChangeRequest.tenant_id == tenant)
            if scope is not None:
                change_query = change_query.filter(ITSMChangeRequest.service_id.in_(scope))
            if service_ids:
                change_query = change_query.filter(ITSMChangeRequest.service_id.in_(service_ids))
            if term:
                change_query = change_query.filter(or_(ITSMChangeRequest.change_number.ilike(pattern), ITSMChangeRequest.title.ilike(pattern)))
            total += change_query.count()
            for row in change_query.order_by(ITSMChangeRequest.created_at.desc()).limit(fetch_limit).all():
                records.append((row.created_at, {"value": f"CHANGE:{row.id}", "label": f"{row.change_number} — {row.title}", "meta": "CHANGE"}))

        records.sort(key=lambda entry: entry[0], reverse=True)
        items = [entry[1] for entry in records[offset:offset + limit]]

    else:
        candidate_ids: set[UUID] = set()
        now = datetime.now(timezone.utc)
        if requested_services:
            candidate_ids.update(row.user_id for row in db.query(ITSMServiceConsumer.user_id).filter(
                ITSMServiceConsumer.tenant_id == tenant,
                ITSMServiceConsumer.service_id.in_(requested_services),
                ITSMServiceConsumer.is_active.is_(True),
                ITSMServiceConsumer.effective_from <= now,
                or_(
                    ITSMServiceConsumer.effective_until.is_(None),
                    ITSMServiceConsumer.effective_until > now,
                ),
            ).all())
            candidate_ids.update(row.user_id for row in db.query(ITSMTeamMember.user_id).join(
                ITSMTeam,
                (ITSMTeam.id == ITSMTeamMember.team_id)
                & (ITSMTeam.tenant_id == ITSMTeamMember.tenant_id),
            ).join(
                ITSMServiceSupportTeam,
                (ITSMServiceSupportTeam.team_id == ITSMTeamMember.team_id)
                & (ITSMServiceSupportTeam.tenant_id == ITSMTeamMember.tenant_id),
            ).filter(
                ITSMTeamMember.tenant_id == tenant,
                ITSMTeam.is_active.is_(True),
                ITSMServiceSupportTeam.service_id.in_(requested_services),
            ).all())
            candidate_ids.update(row.owner_user_id for row in db.query(ITSMService.owner_user_id).filter(
                ITSMService.tenant_id == tenant,
                ITSMService.id.in_(requested_services),
                ITSMService.owner_user_id.isnot(None),
            ).all())

        problem_ids: set[UUID] = set()
        change_ids: set[UUID] = set()
        for raw in related_records or ():
            try:
                target_type, target_id = raw.split(":", 1)
                parsed_id = UUID(target_id)
            except (ValueError, AttributeError):
                raise HTTPException(status_code=422, detail="Invalid related record reference")
            if target_type == "PROBLEM":
                problem_ids.add(parsed_id)
            elif target_type == "CHANGE":
                change_ids.add(parsed_id)
        if problem_ids:
            candidate_ids.update(row.assigned_investigator_id for row in db.query(
                ITSMProblemDetail.assigned_investigator_id,
            ).join(
                ITSMTicket,
                (ITSMTicket.id == ITSMProblemDetail.ticket_id)
                & (ITSMTicket.tenant_id == ITSMProblemDetail.tenant_id),
            ).filter(
                ITSMProblemDetail.tenant_id == tenant,
                ITSMProblemDetail.ticket_id.in_(problem_ids),
                ITSMProblemDetail.assigned_investigator_id.isnot(None),
                ITSMTicket.service_id.in_(requested_services),
            ).all())
        if change_ids:
            candidate_ids.update(row.assigned_to_id for row in db.query(
                ITSMChangeRequest.assigned_to_id,
            ).filter(
                ITSMChangeRequest.tenant_id == tenant,
                ITSMChangeRequest.id.in_(change_ids),
                ITSMChangeRequest.assigned_to_id.isnot(None),
                ITSMChangeRequest.service_id.in_(requested_services),
            ).all())

        query = db.query(User, ITSMUserAccess).join(
            ITSMUserAccess,
            (ITSMUserAccess.user_id == User.id)
            & (ITSMUserAccess.tenant_id == User.tenant_id),
        ).filter(
            User.tenant_id == tenant,
            User.id.in_(candidate_ids or {UUID(int=0)}),
            User.is_active.is_(True),
            ITSMUserAccess.has_itsm_access.is_(True),
            ITSMUserAccess.itsm_role.in_([
                "REQUESTER",
                "SERVICE_AGENT",
                "PROCESS_CHANGE_MANAGER",
                "CATALOG_MANAGER",
            ]),
        )
        if term:
            query = query.filter(User.email.ilike(pattern))
        total = query.count()
        rows = query.order_by(User.email.asc()).offset(offset).limit(limit).all()
        items = [{
            "value": str(user.id),
            "label": user.email,
            "meta": str(access.itsm_role).replace("_", " ").title(),
        } for user, access in rows]

    return {"items": items, "total": total, "offset": offset, "limit": limit, "has_more": offset + len(items) < total}


@router.post("", response_model=AlertDetail, status_code=status.HTTP_201_CREATED)
def create_draft(payload: AlertDraftRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    alert = OutageAlertService.create_draft(db, tenant, actor, payload)
    return OutageAlertService.detail(db, tenant, actor, alert.id)


@router.put("/{alert_id}", response_model=AlertDetail)
def update_draft(alert_id: UUID, payload: AlertDraftRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    OutageAlertService.update_draft(db, tenant, actor, alert_id, payload)
    return OutageAlertService.detail(db, tenant, actor, alert_id)


@router.get("/{alert_id}", response_model=AlertDetail)
def get_alert(alert_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return OutageAlertService.detail(db, tenant, actor, alert_id)


@router.post("/{alert_id}/preview", response_model=AlertPreview)
def preview_alert(alert_id: UUID, request: Request, payload: AlertPreviewRequest | None = None, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return OutageAlertService.preview(db, tenant, actor, alert_id, payload)


def _publication_response(publication):
    return {"publication_id": str(publication.id), "alert_id": str(publication.alert_id), "version": publication.version, "publication_type": publication.publication_type, "recipient_count": publication.recipient_count, "published_at": publication.published_at}


@router.post("/{alert_id}/publish")
def publish_alert(alert_id: UUID, payload: AlertPublicationRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return _publication_response(OutageAlertService.publish(db, tenant, actor, alert_id, payload, "INITIAL"))


@router.post("/{alert_id}/updates")
def publish_update(alert_id: UUID, payload: AlertPublicationRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return _publication_response(OutageAlertService.publish(db, tenant, actor, alert_id, payload, "UPDATE"))


@router.post("/{alert_id}/recovery")
def publish_recovery(alert_id: UUID, payload: AlertPublicationRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    return _publication_response(OutageAlertService.publish(db, tenant, actor, alert_id, payload, "RECOVERY"))


@router.post("/{alert_id}/acknowledge", status_code=status.HTTP_204_NO_CONTENT)
def acknowledge(alert_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    OutageAlertService.acknowledge(db, tenant, actor, alert_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_draft(alert_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    tenant, actor = _identity(request, tenant_id)
    OutageAlertService.cancel_draft(db, tenant, actor, alert_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/services/{service_id}/targeting")
def get_service_targeting(service_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"])
    tenant = UUID(tenant_id)
    service = db.query(ITSMService).filter(ITSMService.tenant_id == tenant, ITSMService.id == service_id).first()
    if not service:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Service not found")
    active_requester_count = db.query(func.count(User.id)).join(
        ITSMUserAccess,
        (ITSMUserAccess.user_id == User.id)
        & (ITSMUserAccess.tenant_id == User.tenant_id),
    ).filter(
        User.tenant_id == tenant,
        User.is_active.is_(True),
        ITSMUserAccess.has_itsm_access.is_(True),
        ITSMUserAccess.itsm_role == "REQUESTER",
    ).scalar() or 0
    now = datetime.now(timezone.utc)
    entitled_requester_count = db.query(func.count(User.id.distinct())).join(
        ITSMUserAccess,
        (ITSMUserAccess.user_id == User.id)
        & (ITSMUserAccess.tenant_id == User.tenant_id),
    ).join(
        ITSMServiceConsumer,
        (ITSMServiceConsumer.user_id == User.id)
        & (ITSMServiceConsumer.tenant_id == User.tenant_id),
    ).filter(
        User.tenant_id == tenant,
        User.is_active.is_(True),
        ITSMUserAccess.has_itsm_access.is_(True),
        ITSMUserAccess.itsm_role == "REQUESTER",
        ITSMServiceConsumer.service_id == service_id,
        ITSMServiceConsumer.is_active.is_(True),
        ITSMServiceConsumer.effective_from <= now,
        or_(
            ITSMServiceConsumer.effective_until.is_(None),
            ITSMServiceConsumer.effective_until > now,
        ),
    ).scalar() or 0
    teams = db.query(ITSMTeam).filter(ITSMTeam.tenant_id == tenant, ITSMTeam.is_active.is_(True)).order_by(ITSMTeam.name).all()
    support = {row.team_id for row in db.query(ITSMServiceSupportTeam).filter(ITSMServiceSupportTeam.tenant_id == tenant, ITSMServiceSupportTeam.service_id == service_id).all()}
    return {
        "service_id": str(service_id),
        "alert_recipient_scope": service.alert_recipient_scope,
        "active_requester_count": active_requester_count,
        "entitled_requester_count": entitled_requester_count,
        "eligible_requester_count": (
            active_requester_count
            if service.alert_recipient_scope == "ALL_REQUESTERS"
            else entitled_requester_count
        ),
        "teams": [{"id": str(team.id), "name": team.name, "selected": team.id in support} for team in teams],
    }


@router.put("/services/{service_id}/consumers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def configure_consumer(service_id: UUID, user_id: UUID, payload: ServiceConsumerRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"])
    tenant = UUID(tenant_id)
    if payload.user_id != user_id:
        raise ValueError("Path and body user must match")
    service = db.query(ITSMService.id).filter(ITSMService.tenant_id == tenant, ITSMService.id == service_id).first()
    access = db.query(ITSMUserAccess).join(User, User.id == ITSMUserAccess.user_id).filter(ITSMUserAccess.tenant_id == tenant, ITSMUserAccess.user_id == user_id, ITSMUserAccess.itsm_role == "REQUESTER", User.is_active.is_(True)).first()
    if not service or not access:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Service or active Requester is unavailable")
    row = db.query(ITSMServiceConsumer).filter(ITSMServiceConsumer.tenant_id == tenant, ITSMServiceConsumer.service_id == service_id, ITSMServiceConsumer.user_id == user_id).first()
    if row:
        row.is_active = payload.is_active
    else:
        db.add(ITSMServiceConsumer(tenant_id=tenant, service_id=service_id, user_id=user_id, is_active=payload.is_active, source="ADMIN"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/services/{service_id}/support-teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def configure_support_team(service_id: UUID, team_id: UUID, payload: ServiceSupportTeamRequest, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"])
    tenant = UUID(tenant_id)
    if payload.team_id != team_id:
        raise ValueError("Path and body team must match")
    service = db.query(ITSMService.id).filter(ITSMService.tenant_id == tenant, ITSMService.id == service_id).first()
    team = db.query(ITSMTeam.id).filter(ITSMTeam.tenant_id == tenant, ITSMTeam.id == team_id, ITSMTeam.is_active.is_(True)).first()
    if not service or not team:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Service or support team is unavailable")
    row = db.query(ITSMServiceSupportTeam.id).filter(ITSMServiceSupportTeam.tenant_id == tenant, ITSMServiceSupportTeam.service_id == service_id, ITSMServiceSupportTeam.team_id == team_id).first()
    if not row:
        db.add(ITSMServiceSupportTeam(tenant_id=tenant, service_id=service_id, team_id=team_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/services/{service_id}/consumers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_consumer(service_id: UUID, user_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"])
    tenant = UUID(tenant_id)
    row = db.query(ITSMServiceConsumer).filter(ITSMServiceConsumer.tenant_id == tenant, ITSMServiceConsumer.service_id == service_id, ITSMServiceConsumer.user_id == user_id).first()
    if row:
        db.delete(row); db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/services/{service_id}/support-teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_support_team(service_id: UUID, team_id: UUID, request: Request, db: Session = Depends(get_tenant_db), tenant_id: str = Depends(get_current_tenant)):
    ensure_itsm_role(request, db, ["PLATFORM_ADMINISTRATOR", "CATALOG_MANAGER"])
    tenant = UUID(tenant_id)
    row = db.query(ITSMServiceSupportTeam).filter(ITSMServiceSupportTeam.tenant_id == tenant, ITSMServiceSupportTeam.service_id == service_id, ITSMServiceSupportTeam.team_id == team_id).first()
    if row:
        db.delete(row); db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

