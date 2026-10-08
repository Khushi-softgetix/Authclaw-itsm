"""Schemas for ANA-002 Core KPI Library and Analytics."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class KPIDateRange(BaseModel):
    """Metadata describing the evaluated date window."""
    start_time: Optional[datetime] = None
    end_time: datetime
    evaluated_at: datetime


class MTTAKPIResponse(BaseModel):
    """Mean Time to Acknowledge (First Response) KPI."""
    metric: str = "MTTA"
    definition: str = (
        "Average elapsed time from ticket creation until first acknowledgment "
        "or initial response (sla_response_met_at or first agent activity)."
    )
    formula: str = "sum(T_ack - T_create) / count(acknowledged_tickets)"
    count: int = Field(..., description="Number of acknowledged tickets in period")
    unacknowledged_count: int = Field(..., description="Number of unacknowledged tickets")
    total_tickets: int = Field(..., description="Total candidate tickets evaluated")
    mean_seconds: Optional[float] = Field(None, description="Average acknowledgment duration in seconds")
    mean_minutes: Optional[float] = Field(None, description="Average acknowledgment duration in minutes")
    mean_hours: Optional[float] = Field(None, description="Average acknowledgment duration in hours")
    median_seconds: Optional[float] = None
    min_seconds: Optional[float] = None
    max_seconds: Optional[float] = None


class MTTRKPIResponse(BaseModel):
    """Mean Time to Resolve / Recover KPI."""
    metric: str = "MTTR"
    definition: str = (
        "Average duration from ticket creation until resolution (resolved_at or closed_at) "
        "for tickets resolved within the evaluated window."
    )
    formula: str = "sum(T_resolve - T_create) / count(resolved_tickets)"
    count: int = Field(..., description="Number of resolved tickets evaluated")
    mean_seconds: Optional[float] = Field(None, description="Average resolution duration in seconds")
    mean_minutes: Optional[float] = Field(None, description="Average resolution duration in minutes")
    mean_hours: Optional[float] = Field(None, description="Average resolution duration in hours")
    median_seconds: Optional[float] = None
    min_seconds: Optional[float] = None
    max_seconds: Optional[float] = None


class FCRKPIResponse(BaseModel):
    """First Contact Resolution (FCR) KPI."""
    metric: str = "FCR"
    definition: str = (
        "Percentage of resolved tickets resolved on first contact without escalation, "
        "reassignment, or subsequent reopen."
    )
    formula: str = "(count(first_contact_resolved) / count(total_resolved)) * 100"
    resolved_count: int = Field(..., description="Total resolved tickets in period")
    fcr_count: int = Field(..., description="Tickets resolved on first contact")
    fcr_rate_pct: float = Field(..., description="First contact resolution percentage (0-100)")


class ReopenRateKPIResponse(BaseModel):
    """Reopen Rate KPI."""
    metric: str = "REOPEN_RATE"
    definition: str = (
        "Percentage of resolved tickets that were reopened by the requester."
    )
    formula: str = "(count(reopened_tickets) / count(total_resolved)) * 100"
    resolved_count: int = Field(..., description="Total resolved tickets in period")
    reopened_tickets_count: int = Field(..., description="Distinct tickets reopened")
    total_reopen_events: int = Field(..., description="Total reopen transitions logged")
    reopen_rate_pct: float = Field(..., description="Reopen rate percentage (0-100)")


class BacklogAgeKPIResponse(BaseModel):
    """Backlog Age Distribution and Average Age KPI."""
    metric: str = "BACKLOG_AGE"
    definition: str = (
        "Average duration from ticket creation to present for all active open tickets "
        "not in terminal states (RESOLVED, CLOSED, CANCELLED)."
    )
    formula: str = "sum(T_now - T_create) / count(open_tickets)"
    total_open: int = Field(..., description="Current count of unresolved tickets")
    mean_age_seconds: Optional[float] = None
    mean_age_days: Optional[float] = None
    median_age_seconds: Optional[float] = None
    median_age_days: Optional[float] = None
    distribution: Dict[str, int] = Field(
        ...,
        description="Bucket counts: under_24h, days_1_to_7, days_8_to_30, over_30d",
    )


class SLAPerformanceKPIResponse(BaseModel):
    """SLA Performance KPI reusing authoritative compute_sla_details()."""
    metric: str = "SLA_PERFORMANCE"
    definition: str = (
        "Percentage of tickets meeting active SLA commitments without breach, "
        "evaluated using authoritative compute_sla_details()."
    )
    formula: str = "(count(sla_met) / count(sla_evaluated)) * 100"
    total_evaluated: int = Field(..., description="Total tickets evaluated with SLA commitments")
    met_count: int = Field(..., description="Tickets that achieved SLA deadline")
    breached_count: int = Field(..., description="Tickets that breached SLA deadline")
    compliance_rate_pct: float = Field(..., description="SLA compliance percentage (0-100)")
    breach_rate_pct: float = Field(..., description="SLA breach percentage (0-100)")
    active_risk_breakdown: Dict[str, int] = Field(
        ...,
        description="Active ticket SLA risk distribution: within_sla, at_risk, breached, paused",
    )


class CSATKPIResponse(BaseModel):
    """Customer Satisfaction (CSAT) KPI."""
    metric: str = "CSAT"
    definition: str = (
        "Average requester satisfaction rating and percentage of positive ratings "
        "(score >= 4 on 1-5 scale) recorded from ticket feedback activities."
    )
    formula: str = "sum(score) / count(surveys); positive_pct = (count(score >= 4) / count(surveys)) * 100"
    survey_count: int = Field(..., description="Total feedback responses received")
    average_score: Optional[float] = Field(None, description="Average satisfaction rating (1.0 - 5.0)")
    positive_count: int = Field(..., description="Responses with score >= 4")
    satisfaction_rate_pct: Optional[float] = Field(None, description="Positive satisfaction percentage")
    response_rate_pct: float = Field(0.0, description="Survey responses divided by resolved tickets")


class DeflectionKPIResponse(BaseModel):
    """Self-Service and Knowledge Deflection Rate KPI."""
    metric: str = "DEFLECTION"
    definition: str = (
        "Quantifies issues deflected through knowledge base usage without creating analyst tickets."
    )
    formula: str = "(helpful_kb_views / (helpful_kb_views + incidents_created)) * 100"
    helpful_count: int = Field(..., description="Total helpful ratings on published articles")
    total_kb_views: int = Field(..., description="Total article views across knowledge base")
    incidents_created: int = Field(..., description="Total incidents created in evaluated period")
    deflection_rate_pct: float = Field(..., description="Self-service deflection percentage (0-100)")


class ChangeSuccessKPIResponse(BaseModel):
    """Change Success Rate KPI."""
    metric: str = "CHANGE_SUCCESS"
    definition: str = (
        "Percentage of implemented change requests completed successfully without "
        "cancellation or rollback, plus emergency change rate."
    )
    formula: str = "(completed_changes / (completed_changes + failed_changes)) * 100"
    total_changes: int = Field(..., description="All change requests in period")
    implemented_changes: int = Field(..., description="Changes completed or failed post-start")
    successful_changes: int = Field(..., description="Changes completed successfully")
    failed_changes: int = Field(..., description="Changes cancelled or rolled back")
    emergency_changes: int = Field(..., description="Changes classified as EMERGENCY")
    change_success_rate_pct: float = Field(..., description="Change success rate percentage (0-100)")
    emergency_change_rate_pct: float = Field(..., description="Emergency change proportion (0-100)")


class RepeatIncidentsKPIResponse(BaseModel):
    """Repeat Incidents Rate KPI."""
    metric: str = "REPEAT_INCIDENTS"
    definition: str = (
        "Proportion of incidents that recur on the same service or problem within a sliding lookback window."
    )
    formula: str = "(count(repeat_incidents) / count(total_incidents)) * 100"
    total_incidents: int = Field(..., description="Total incidents created in period")
    repeat_incidents_count: int = Field(..., description="Incidents recurring within lookback window")
    repeat_incident_rate_pct: float = Field(..., description="Repeat incident percentage (0-100)")
    lookback_window_days: int = Field(14, description="Sliding lookback window in days")
    top_recurring_services: List[Dict[str, Any]] = Field(default_factory=list)


class CoreKPISummaryResponse(BaseModel):
    """Unified response container for all 10 ANA-002 Core KPIs."""
    tenant_id: UUID
    date_range: KPIDateRange
    mtta: MTTAKPIResponse
    mttr: MTTRKPIResponse
    fcr: FCRKPIResponse
    reopen: ReopenRateKPIResponse
    backlog_age: BacklogAgeKPIResponse
    sla_performance: SLAPerformanceKPIResponse
    csat: CSATKPIResponse
    deflection: DeflectionKPIResponse
    change_success: ChangeSuccessKPIResponse
    repeat_incidents: RepeatIncidentsKPIResponse
