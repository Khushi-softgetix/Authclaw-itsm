"""API Router for ITSM Analytics and ANA-002 Core KPI Library."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.auth import get_tenant_db, require_itsm_roles
from app.schemas.itsm_analytics import (
    BacklogAgeKPIResponse,
    CSATKPIResponse,
    ChangeSuccessKPIResponse,
    CoreKPISummaryResponse,
    DeflectionKPIResponse,
    FCRKPIResponse,
    MTTAKPIResponse,
    MTTRKPIResponse,
    MetricSnapshotListResponse,
    MetricSnapshotResponse,
    OperationalKPIDashboardResponse,
    ReopenRateKPIResponse,
    RepeatIncidentsKPIResponse,
    SLAPerformanceKPIResponse,
)
from app.services.itsm_kpi_service import ITSMKPIService
from app.services.itsm_metric_snapshot_service import DEFINITION_VERSION, ITSMMetricSnapshotService

ANALYTICS_ROLES = [
    "INCIDENT_MANAGER",
    "SERVICE_LEAD",
    "PROCESS_CHANGE_MANAGER",
    "SERVICE_AGENT",
    "AUDITOR",
]

router = APIRouter(dependencies=[require_itsm_roles(ANALYTICS_ROLES)])


def _get_service(request: Request, db: Session) -> ITSMKPIService:
    tenant_id = request.state.tenant_id
    return ITSMKPIService(db, tenant_id)


@router.get("/kpis/snapshots", response_model=MetricSnapshotListResponse)
def list_metric_snapshots(
    request: Request,
    metric_key: Optional[str] = Query(None, description="Canonical KPI key"),
    period_grain: Optional[str] = Query(None, description="DAILY, WEEKLY, or MONTHLY"),
    start_time: Optional[datetime] = Query(None, description="Earliest period start (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="Latest period end (UTC ISO)"),
    definition_version: Optional[str] = Query(DEFINITION_VERSION, description="Metric definition version"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_tenant_db),
    _evidence_reader: None = require_itsm_roles(["INCIDENT_MANAGER", "AUDITOR"]),
) -> MetricSnapshotListResponse:
    """Read immutable tenant-scoped ANA-004 history; this endpoint never recomputes it."""
    service = ITSMMetricSnapshotService(db, request.state.tenant_id)
    try:
        rows = service.list_snapshots(
            metric_key=metric_key,
            period_grain=period_grain,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            definition_version=definition_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return MetricSnapshotListResponse(
        items=[MetricSnapshotResponse.model_validate(row) for row in rows],
        total=len(rows),
    )


@router.get("/kpis", response_model=CoreKPISummaryResponse)
def get_all_kpis(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> CoreKPISummaryResponse:
    """Retrieve all 10 ANA-002 Core KPIs in a unified summary."""
    service = _get_service(request, db)
    return service.compute_all_kpis(start_time=start_time, end_time=end_time)


@router.get("/kpis/operational-dashboard", response_model=OperationalKPIDashboardResponse)
def get_operational_kpi_dashboard(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of reporting period (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of reporting period/as-of time (UTC ISO)"),
    service_id: Optional[UUID] = Query(None, description="Affected service ID"),
    priority: Optional[str] = Query(None, description="Incident priority"),
    status_filter: Optional[str] = Query(None, alias="status", description="Incident lifecycle status"),
    drilldown_limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    _incident_manager: None = require_itsm_roles(["INCIDENT_MANAGER"]),
) -> OperationalKPIDashboardResponse:
    """Return the Incident Manager four-KPI dashboard with matching tenant-scoped records."""
    service = _get_service(request, db)
    return service.compute_operational_dashboard(
        start_time=start_time,
        end_time=end_time,
        service_id=service_id,
        priority=priority,
        status=status_filter,
        drilldown_limit=drilldown_limit,
    )


@router.get("/kpis/mtta", response_model=MTTAKPIResponse)
def get_mtta_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> MTTAKPIResponse:
    """Retrieve Mean Time to Acknowledge (MTTA) KPI."""
    service = _get_service(request, db)
    return service.compute_mtta(start_time=start_time, end_time=end_time)


@router.get("/kpis/mttr", response_model=MTTRKPIResponse)
def get_mttr_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> MTTRKPIResponse:
    """Retrieve Mean Time to Resolve / Recover (MTTR) KPI."""
    service = _get_service(request, db)
    return service.compute_mttr(start_time=start_time, end_time=end_time)


@router.get("/kpis/fcr", response_model=FCRKPIResponse)
def get_fcr_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> FCRKPIResponse:
    """Retrieve First Contact Resolution (FCR) KPI."""
    service = _get_service(request, db)
    return service.compute_fcr(start_time=start_time, end_time=end_time)


@router.get("/kpis/reopen", response_model=ReopenRateKPIResponse)
def get_reopen_rate_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> ReopenRateKPIResponse:
    """Retrieve Reopen Rate KPI."""
    service = _get_service(request, db)
    return service.compute_reopen_rate(start_time=start_time, end_time=end_time)


@router.get("/kpis/backlog-age", response_model=BacklogAgeKPIResponse)
def get_backlog_age_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> BacklogAgeKPIResponse:
    """Retrieve Backlog Age distribution and averages KPI."""
    service = _get_service(request, db)
    return service.compute_backlog_age(start_time=start_time, end_time=end_time)


@router.get("/kpis/sla", response_model=SLAPerformanceKPIResponse)
def get_sla_performance_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> SLAPerformanceKPIResponse:
    """Retrieve SLA Performance KPI reusing authoritative compute_sla_details()."""
    service = _get_service(request, db)
    return service.compute_sla_performance(start_time=start_time, end_time=end_time)


@router.get("/kpis/csat", response_model=CSATKPIResponse)
def get_csat_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> CSATKPIResponse:
    """Retrieve Customer Satisfaction (CSAT) KPI."""
    service = _get_service(request, db)
    return service.compute_csat(start_time=start_time, end_time=end_time)


@router.get("/kpis/deflection", response_model=DeflectionKPIResponse)
def get_deflection_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> DeflectionKPIResponse:
    """Retrieve Knowledge and Self-Service Deflection KPI."""
    service = _get_service(request, db)
    return service.compute_deflection(start_time=start_time, end_time=end_time)


@router.get("/kpis/change-success", response_model=ChangeSuccessKPIResponse)
def get_change_success_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    db: Session = Depends(get_tenant_db),
) -> ChangeSuccessKPIResponse:
    """Retrieve Change Success and Emergency Change Rate KPI."""
    service = _get_service(request, db)
    return service.compute_change_success(start_time=start_time, end_time=end_time)


@router.get("/kpis/repeat-incidents", response_model=RepeatIncidentsKPIResponse)
def get_repeat_incidents_kpi(
    request: Request,
    start_time: Optional[datetime] = Query(None, description="Start of date window (UTC ISO)"),
    end_time: Optional[datetime] = Query(None, description="End of date window (UTC ISO)"),
    lookback_days: int = Query(14, ge=1, le=90, description="Sliding lookback window in days"),
    db: Session = Depends(get_tenant_db),
) -> RepeatIncidentsKPIResponse:
    """Retrieve Repeat Incidents Rate KPI."""
    service = _get_service(request, db)
    return service.compute_repeat_incidents(
        start_time=start_time,
        end_time=end_time,
        lookback_window_days=lookback_days,
    )
