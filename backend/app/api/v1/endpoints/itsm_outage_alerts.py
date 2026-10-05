"""HTTP API for the standalone Outage & Alerts workspace."""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_tenant, get_tenant_db
from app.schemas.itsm_outage_alerts import (
    OutageAlertAuditorResponse,
    OutageAlertCreateRequest,
    OutageAlertDraftUpdateRequest,
    OutageAlertLinkRequest,
    OutageAlertLinkResponse,
    OutageAlertLinkableRecordsResponse,
    OutageAlertListResponse,
    OutageAlertManagerResponse,
    OutageAlertSummaryResponse,
    OutageAlertPublicationRequest,
)
from app.services.itsm_outage_alert_service import OutageAlertAuthorization, OutageAlertService


router = APIRouter()


def _actor(request: Request, db: Session, action: str):
    return OutageAlertAuthorization.require(request, db, action)


@router.get("", response_model=OutageAlertListResponse, summary="List role-safe Outage Alerts")
def list_outage_alerts(
    request: Request,
    state: Literal["DRAFT", "ACTIVE", "RECOVERED"] | None = None,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor = _actor(request, db, "READ")
    items, visibility_note = OutageAlertService.list_alerts(db, UUID(tenant_id), actor, state)
    return {"items": items, "visibility_note": visibility_note}


@router.post("", response_model=OutageAlertManagerResponse, status_code=status.HTTP_201_CREATED, summary="Create an Outage Alert draft")
def create_outage_alert(
    payload: OutageAlertCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor = _actor(request, db, "CREATE_DRAFT")
    alert = OutageAlertService.create_draft(db, UUID(tenant_id), actor.user_id, payload)
    return OutageAlertService.project(db, UUID(tenant_id), alert, actor.role)


@router.get("/linkable-records", response_model=OutageAlertLinkableRecordsResponse, summary="List Alert-linkable Incident and Major Incident records")
def list_linkable_records(
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    _actor(request, db, "LINK")
    return OutageAlertService.linkable_records(db, UUID(tenant_id))


@router.get("/related/major-incidents/{major_incident_id}", response_model=OutageAlertListResponse, summary="Read Alerts related to a Major Incident")
def related_major_incident_alerts(
    major_incident_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    _actor(request, db, "LINK")
    return {"items": OutageAlertService.related_major_incident_alerts(db, UUID(tenant_id), major_incident_id)}


@router.get("/{alert_id}", response_model=OutageAlertManagerResponse | OutageAlertAuditorResponse | OutageAlertSummaryResponse, summary="Read a role-safe Outage Alert")
def get_outage_alert(
    alert_id: UUID,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor = _actor(request, db, "READ")
    return OutageAlertService.get_alert(db, UUID(tenant_id), alert_id, actor)


@router.patch("/{alert_id}/draft", response_model=OutageAlertManagerResponse, summary="Edit an Alert draft")
def update_outage_alert_draft(
    alert_id: UUID,
    payload: OutageAlertDraftUpdateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor = _actor(request, db, "UPDATE_DRAFT")
    alert = OutageAlertService.update_draft(db, UUID(tenant_id), actor.user_id, alert_id, payload)
    return OutageAlertService.project(db, UUID(tenant_id), alert, actor.role)


@router.post("/{alert_id}/links", response_model=OutageAlertLinkResponse, status_code=status.HTTP_201_CREATED, summary="Link an Alert to an Incident or Major Incident")
def link_outage_alert(
    alert_id: UUID,
    payload: OutageAlertLinkRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    actor = _actor(request, db, "LINK")
    return OutageAlertService.link(db, UUID(tenant_id), actor.user_id, alert_id, payload)


def _publication_pending(
    alert_id: UUID,
    payload: OutageAlertPublicationRequest,
    request: Request,
    db: Session,
    tenant_id: str,
):
    _actor(request, db, "PUBLISH")
    alert = OutageAlertService._alert(db, UUID(tenant_id), alert_id)
    OutageAlertService.require_publication_readiness(alert)
    # The guard always raises today. This is intentionally retained as a safe
    # future route seam, not a fake publishing action.
    raise RuntimeError(f"Unexpected publication readiness for {payload.message!r}")


@router.post("/{alert_id}/publish", response_model=OutageAlertManagerResponse, summary="Publish an initial Alert when publication policy is configured")
def publish_outage_alert(
    alert_id: UUID,
    payload: OutageAlertPublicationRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return _publication_pending(alert_id, payload, request, db, tenant_id)


@router.post("/{alert_id}/updates", response_model=OutageAlertManagerResponse, summary="Publish an Alert update when publication policy is configured")
def publish_outage_alert_update(
    alert_id: UUID,
    payload: OutageAlertPublicationRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return _publication_pending(alert_id, payload, request, db, tenant_id)


@router.post("/{alert_id}/recover", response_model=OutageAlertManagerResponse, summary="Publish recovery when publication policy is configured")
def publish_outage_alert_recovery(
    alert_id: UUID,
    payload: OutageAlertPublicationRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    tenant_id: str = Depends(get_current_tenant),
):
    return _publication_pending(alert_id, payload, request, db, tenant_id)
