"""Authoritative KPI Calculation Layer for ANA-002 Core KPI Library.

Provides deterministic, reproducible calculations for the 10 core ITSM KPIs:
1. MTTA (Mean Time to Acknowledge / First Response)
2. MTTR (Mean Time to Resolve / Recover)
3. FCR (First Contact Resolution rate)
4. Reopen Rate
5. Backlog Age (Distribution & Average age)
6. SLA Performance (Compliance, breach, active risk breakdown via compute_sla_details)
7. CSAT (Customer satisfaction score, positive rate, response rate)
8. Deflection (Self-service knowledge deflection rate)
9. Change Success (Success rate, emergency rate)
10. Repeat Incidents (Recurring incident rate within lookback window)

Strict tenant isolation is enforced on every query.
Date windowing supports start_time and end_time filtering with deterministic fallbacks.
"""
from __future__ import annotations

import logging
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMChangeRequest,
    ITSMKnowledgeArticle,
    ITSMTicket,
    ITSMTicketActivity,
)
from app.schemas.itsm_analytics import (
    BacklogAgeKPIResponse,
    CSATKPIResponse,
    ChangeSuccessKPIResponse,
    CoreKPISummaryResponse,
    DeflectionKPIResponse,
    FCRKPIResponse,
    KPIDateRange,
    MTTAKPIResponse,
    MTTRKPIResponse,
    OperationalKPIDashboardResponse,
    OperationalKPIIncidentRecord,
    ReopenRateKPIResponse,
    RepeatIncidentsKPIResponse,
    SLAAdherenceDimensionResponse,
    SLAPerformanceKPIResponse,
)
from app.services.itsm_sla_service import compute_sla_details

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = frozenset({"RESOLVED", "CLOSED", "CANCELLED"})
ACTIVE_STATUSES = frozenset({"NEW", "IN_PROGRESS", "ON_HOLD"})


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class ITSMKPIService:
    """Calculates deterministic ITSM KPIs strictly scoped to a tenant."""

    def __init__(self, db: Session, tenant_id: UUID | str):
        self.db = db
        self.tenant_id = UUID(str(tenant_id))

    def _apply_date_filter(
        self,
        query,
        column,
        start_time: Optional[datetime],
        end_time: datetime,
    ):
        """Helper to apply inclusive date bounds [start_time, end_time]."""
        if start_time is not None:
            query = query.filter(column >= start_time)
        query = query.filter(column <= end_time)
        return query

    def _apply_incident_filters(self, query, service_id=None, priority: Optional[str] = None, status: Optional[str] = None):
        """Apply optional dashboard filters after the non-negotiable tenant scope."""
        if service_id is not None:
            query = query.filter(ITSMTicket.service_id == service_id)
        if priority:
            query = query.filter(ITSMTicket.priority == priority.strip().upper())
        if status:
            query = query.filter(ITSMTicket.status == status.strip().upper())
        return query

    def _acknowledgement_at(self, ticket: ITSMTicket) -> Optional[datetime]:
        """Return the persisted response marker or the first qualifying agent activity."""
        acknowledged_at = _utc(ticket.sla_response_met_at)
        if acknowledged_at:
            return acknowledged_at
        first_activity = (
            self.db.query(ITSMTicketActivity.created_at)
            .filter(
                ITSMTicketActivity.tenant_id == self.tenant_id,
                ITSMTicketActivity.ticket_id == ticket.id,
                ITSMTicketActivity.activity_type.in_(["AGENT_NOTE", "STATUS_CHANGE", "COMMENT", "ASSIGNMENT"]),
            )
            .order_by(ITSMTicketActivity.created_at.asc())
            .first()
        )
        return _utc(first_activity[0]) if first_activity and first_activity[0] else None

    # -------------------------------------------------------------------------
    # 1. MTTA: Mean Time to Acknowledge
    # -------------------------------------------------------------------------
    def compute_mtta(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        service_id=None,
        priority: Optional[str] = None,
        status: Optional[str] = None,
    ) -> MTTAKPIResponse:
        """Formula: sum(T_ack - T_create) / count(acknowledged_tickets)

        Acknowledged duration is derived from sla_response_met_at or earliest
        activity timestamp on the ticket.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        query = self._apply_incident_filters(query, service_id, priority, status)
        query = self._apply_date_filter(query, ITSMTicket.created_at, start_time, end_time)
        tickets = query.all()

        total_tickets = len(tickets)
        durations: List[float] = []

        for ticket in tickets:
            t_create = _utc(ticket.created_at)
            t_ack = self._acknowledgement_at(ticket)

            if t_ack and t_create and t_ack >= t_create:
                elapsed = (t_ack - t_create).total_seconds()
                durations.append(max(0.0, elapsed))

        ack_count = len(durations)
        unack_count = total_tickets - ack_count

        if ack_count == 0:
            return MTTAKPIResponse(
                count=0,
                unacknowledged_count=unack_count,
                total_tickets=total_tickets,
                mean_seconds=None,
                mean_minutes=None,
                mean_hours=None,
                median_seconds=None,
                min_seconds=None,
                max_seconds=None,
            )

        mean_sec = round(statistics.mean(durations), 2)
        med_sec = round(statistics.median(durations), 2)
        min_sec = round(min(durations), 2)
        max_sec = round(max(durations), 2)

        return MTTAKPIResponse(
            count=ack_count,
            unacknowledged_count=unack_count,
            total_tickets=total_tickets,
            mean_seconds=mean_sec,
            mean_minutes=round(mean_sec / 60.0, 2),
            mean_hours=round(mean_sec / 3600.0, 2),
            median_seconds=med_sec,
            min_seconds=min_sec,
            max_seconds=max_sec,
        )

    # -------------------------------------------------------------------------
    # 2. MTTR: Mean Time to Resolve
    # -------------------------------------------------------------------------
    def compute_mttr(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        service_id=None,
        priority: Optional[str] = None,
        status: Optional[str] = None,
    ) -> MTTRKPIResponse:
        """Formula: sum(T_resolve - T_create) / count(resolved_tickets)

        T_resolve is ticket.resolved_at or fallback ticket.closed_at.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"]),
        )
        query = self._apply_incident_filters(query, service_id, priority, status)
        # Filter by resolution time window
        resolve_col = func.coalesce(ITSMTicket.resolved_at, ITSMTicket.closed_at)
        query = self._apply_date_filter(query, resolve_col, start_time, end_time)
        tickets = query.all()

        durations: List[float] = []
        for ticket in tickets:
            t_create = _utc(ticket.created_at)
            t_resolve = _utc(ticket.resolved_at) or _utc(ticket.closed_at)
            if t_create and t_resolve and t_resolve >= t_create:
                elapsed = (t_resolve - t_create).total_seconds()
                durations.append(max(0.0, elapsed))

        resolved_count = len(durations)
        if resolved_count == 0:
            return MTTRKPIResponse(
                count=0,
                mean_seconds=None,
                mean_minutes=None,
                mean_hours=None,
                median_seconds=None,
                min_seconds=None,
                max_seconds=None,
            )

        mean_sec = round(statistics.mean(durations), 2)
        med_sec = round(statistics.median(durations), 2)
        min_sec = round(min(durations), 2)
        max_sec = round(max(durations), 2)

        return MTTRKPIResponse(
            count=resolved_count,
            mean_seconds=mean_sec,
            mean_minutes=round(mean_sec / 60.0, 2),
            mean_hours=round(mean_sec / 3600.0, 2),
            median_seconds=med_sec,
            min_seconds=min_sec,
            max_seconds=max_sec,
        )

    # -------------------------------------------------------------------------
    # 3. FCR: First Contact Resolution Rate
    # -------------------------------------------------------------------------
    def compute_fcr(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> FCRKPIResponse:
        """Formula: (count(first_contact_resolved) / count(total_resolved)) * 100

        A ticket is FCR if resolution_code is FIRST_CONTACT_RESOLVED, or if it had
        no reopens and <= 1 agent comment before resolution.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        resolve_col = func.coalesce(ITSMTicket.resolved_at, ITSMTicket.closed_at)
        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"]),
        )
        query = self._apply_date_filter(query, resolve_col, start_time, end_time)
        tickets = query.all()

        total_resolved = len(tickets)
        if total_resolved == 0:
            return FCRKPIResponse(
                resolved_count=0,
                fcr_count=0,
                fcr_rate_pct=0.0,
            )

        fcr_count = 0
        for ticket in tickets:
            if ticket.resolution_code == "FIRST_CONTACT_RESOLVED":
                fcr_count += 1
                continue

            # Check activities for reopen or multiple agent notes
            activities = (
                self.db.query(ITSMTicketActivity)
                .filter(
                    ITSMTicketActivity.tenant_id == self.tenant_id,
                    ITSMTicketActivity.ticket_id == ticket.id,
                )
                .all()
            )
            reopened = any(
                (act.activity_type == "STATUS_CHANGE" and "REOPEN" in (act.content or "").upper())
                or (act.activity_metadata or {}).get("is_reopen") is True
                for act in activities
            )
            if reopened:
                continue

            agent_notes = [
                a for a in activities
                if a.activity_type in ["AGENT_NOTE", "COMMENT"]
                and a.actor_type in ["AGENT", "SERVICE_AGENT", "SYSTEM"]
            ]
            if len(agent_notes) <= 1:
                fcr_count += 1

        rate = round((fcr_count / total_resolved) * 100.0, 2)
        return FCRKPIResponse(
            resolved_count=total_resolved,
            fcr_count=fcr_count,
            fcr_rate_pct=rate,
        )

    # -------------------------------------------------------------------------
    # 4. Reopen Rate
    # -------------------------------------------------------------------------
    def compute_reopen_rate(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> ReopenRateKPIResponse:
        """Formula: (count(reopened_tickets) / count(total_resolved)) * 100

        Detects reopen events via status transition from RESOLVED to IN_PROGRESS
        or explicit activity_metadata.is_reopen == True.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        resolve_col = func.coalesce(ITSMTicket.resolved_at, ITSMTicket.closed_at)
        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"]),
        )
        query = self._apply_date_filter(query, resolve_col, start_time, end_time)
        tickets = query.all()

        total_resolved = len(tickets)
        if total_resolved == 0:
            return ReopenRateKPIResponse(
                resolved_count=0,
                reopened_tickets_count=0,
                total_reopen_events=0,
                reopen_rate_pct=0.0,
            )

        ticket_ids = [t.id for t in tickets]
        activities = (
            self.db.query(ITSMTicketActivity)
            .filter(
                ITSMTicketActivity.tenant_id == self.tenant_id,
                ITSMTicketActivity.ticket_id.in_(ticket_ids),
            )
            .all()
        )

        reopened_ticket_ids = set()
        total_reopen_events = 0

        for act in activities:
            meta = act.activity_metadata or {}
            is_reopen_meta = meta.get("is_reopen") is True
            content = (act.content or "").upper()
            is_status_reopen = (
                act.activity_type == "STATUS_CHANGE"
                and ("REOPEN" in content or ("RESOLVED" in content and "IN_PROGRESS" in content))
            )
            if is_reopen_meta or is_status_reopen:
                reopened_ticket_ids.add(act.ticket_id)
                total_reopen_events += 1

        reopened_count = len(reopened_ticket_ids)
        rate = round((reopened_count / total_resolved) * 100.0, 2)

        return ReopenRateKPIResponse(
            resolved_count=total_resolved,
            reopened_tickets_count=reopened_count,
            total_reopen_events=total_reopen_events,
            reopen_rate_pct=rate,
        )

    # -------------------------------------------------------------------------
    # 5. Backlog Age
    # -------------------------------------------------------------------------
    def compute_backlog_age(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        service_id=None,
        priority: Optional[str] = None,
        status: Optional[str] = None,
    ) -> BacklogAgeKPIResponse:
        """Formula: sum(T_now - T_create) / count(open_tickets)

        Evaluates all non-terminal tickets (NEW, IN_PROGRESS, ON_HOLD)
        created on or before end_time.
        Buckets: under_24h, days_1_to_7, days_8_to_30, over_30d.
        """
        now = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ~ITSMTicket.status.in_(["RESOLVED", "CLOSED", "CANCELLED"]),
            ITSMTicket.created_at <= now,
        )
        query = self._apply_incident_filters(query, service_id, priority, status)
        if start_time is not None:
            query = query.filter(ITSMTicket.created_at >= start_time)

        tickets = query.all()
        total_open = len(tickets)

        distribution = {
            "under_24h": 0,
            "days_1_to_7": 0,
            "days_8_to_30": 0,
            "over_30d": 0,
        }

        if total_open == 0:
            return BacklogAgeKPIResponse(
                total_open=0,
                mean_age_seconds=None,
                mean_age_days=None,
                median_age_seconds=None,
                median_age_days=None,
                distribution=distribution,
            )

        ages_seconds: List[float] = []
        DAY_SEC = 86400.0

        for t in tickets:
            t_create = _utc(t.created_at)
            age = max(0.0, (now - t_create).total_seconds()) if t_create else 0.0
            ages_seconds.append(age)

            if age < DAY_SEC:
                distribution["under_24h"] += 1
            elif age <= 7 * DAY_SEC:
                distribution["days_1_to_7"] += 1
            elif age <= 30 * DAY_SEC:
                distribution["days_8_to_30"] += 1
            else:
                distribution["over_30d"] += 1

        mean_sec = round(statistics.mean(ages_seconds), 2)
        med_sec = round(statistics.median(ages_seconds), 2)

        return BacklogAgeKPIResponse(
            total_open=total_open,
            mean_age_seconds=mean_sec,
            mean_age_days=round(mean_sec / DAY_SEC, 2),
            median_age_seconds=med_sec,
            median_age_days=round(med_sec / DAY_SEC, 2),
            distribution=distribution,
        )

    def _drilldown_record(
        self,
        ticket: ITSMTicket,
        *,
        measured_at: Optional[datetime] = None,
        duration_seconds: Optional[float] = None,
        sla_dimension: Optional[str] = None,
        sla_outcome: Optional[str] = None,
        age_bucket: Optional[str] = None,
    ) -> OperationalKPIIncidentRecord:
        return OperationalKPIIncidentRecord(
            id=ticket.id,
            ticket_number=ticket.ticket_number,
            title=ticket.title,
            priority=ticket.priority,
            status=ticket.status,
            service_id=ticket.service_id,
            created_at=_utc(ticket.created_at),
            measured_at=_utc(measured_at),
            duration_seconds=round(duration_seconds, 2) if duration_seconds is not None else None,
            sla_dimension=sla_dimension,
            sla_outcome=sla_outcome,
            age_bucket=age_bucket,
        )

    def _sla_adherence_dimension(
        self,
        tickets: List[ITSMTicket],
        dimension: str,
        now: datetime,
        drilldown_limit: int,
    ) -> tuple[SLAAdherenceDimensionResponse, List[OperationalKPIIncidentRecord]]:
        """Evaluate one SLA deadline type without treating missing outcomes as compliant."""
        due_field = f"sla_{dimension.lower()}_due_at"
        met_field = f"sla_{dimension.lower()}_met_at"
        total_with_commitment = met_count = breached_count = pending_count = unavailable_count = 0
        records: List[OperationalKPIIncidentRecord] = []

        for ticket in tickets:
            due_at = _utc(getattr(ticket, due_field, None))
            if not due_at:
                continue
            total_with_commitment += 1
            if dimension == "RESPONSE":
                completed_at = _utc(getattr(ticket, met_field, None)) or self._acknowledgement_at(ticket)
            else:
                completed_at = (
                    _utc(getattr(ticket, met_field, None))
                    or _utc(ticket.resolved_at)
                    or _utc(ticket.closed_at)
                )

            if completed_at and completed_at < _utc(ticket.created_at):
                completed_at = None
                unavailable_count += 1
                outcome = "UNAVAILABLE"
            elif completed_at:
                outcome = "MET" if completed_at <= due_at else "BREACHED"
                if outcome == "MET":
                    met_count += 1
                else:
                    breached_count += 1
            elif ticket.sla_paused_at or ticket.sla_status == "PAUSED":
                pending_count += 1
                outcome = "PENDING"
            elif now > due_at:
                breached_count += 1
                outcome = "BREACHED"
            else:
                pending_count += 1
                outcome = "PENDING"

            if len(records) < drilldown_limit:
                records.append(self._drilldown_record(
                    ticket,
                    measured_at=completed_at or due_at,
                    sla_dimension=dimension,
                    sla_outcome=outcome,
                ))

        evaluated_count = met_count + breached_count
        compliance_rate = round((met_count / evaluated_count) * 100.0, 2) if evaluated_count else None
        return SLAAdherenceDimensionResponse(
            dimension=dimension,
            total_with_commitment=total_with_commitment,
            evaluated_count=evaluated_count,
            met_count=met_count,
            breached_count=breached_count,
            pending_count=pending_count,
            unavailable_count=unavailable_count,
            compliance_rate_pct=compliance_rate,
        ), records

    def compute_operational_dashboard(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        service_id=None,
        priority: Optional[str] = None,
        status: Optional[str] = None,
        drilldown_limit: int = 50,
    ) -> OperationalKPIDashboardResponse:
        """Return the Incident Manager's four KPI cards and their exact source records."""
        now = _utc(end_time or datetime.now(timezone.utc))
        start = _utc(start_time)
        drilldown_limit = max(1, min(drilldown_limit, 100))

        mtta = self.compute_mtta(start, now, service_id, priority, status)
        mttr = self.compute_mttr(start, now, service_id, priority, status)
        # Backlog is deliberately an as-of-now view; no historical snapshot table exists.
        backlog_age = self.compute_backlog_age(None, now, service_id, priority, status)

        period_query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        period_query = self._apply_incident_filters(period_query, service_id, priority, status)
        period_tickets = self._apply_date_filter(period_query, ITSMTicket.created_at, start, now).all()

        mtta_records: List[OperationalKPIIncidentRecord] = []
        for ticket in period_tickets:
            acknowledged_at = self._acknowledgement_at(ticket)
            created_at = _utc(ticket.created_at)
            if acknowledged_at and created_at and acknowledged_at >= created_at and len(mtta_records) < drilldown_limit:
                mtta_records.append(self._drilldown_record(
                    ticket,
                    measured_at=acknowledged_at,
                    duration_seconds=(acknowledged_at - created_at).total_seconds(),
                ))

        resolution_column = func.coalesce(ITSMTicket.resolved_at, ITSMTicket.closed_at)
        mttr_query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"]),
        )
        mttr_query = self._apply_incident_filters(mttr_query, service_id, priority, status)
        mttr_tickets = self._apply_date_filter(mttr_query, resolution_column, start, now).all()
        mttr_records: List[OperationalKPIIncidentRecord] = []
        for ticket in mttr_tickets:
            resolved_at = _utc(ticket.resolved_at) or _utc(ticket.closed_at)
            created_at = _utc(ticket.created_at)
            if resolved_at and created_at and resolved_at >= created_at and len(mttr_records) < drilldown_limit:
                mttr_records.append(self._drilldown_record(
                    ticket,
                    measured_at=resolved_at,
                    duration_seconds=(resolved_at - created_at).total_seconds(),
                ))

        backlog_query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ~ITSMTicket.status.in_(list(TERMINAL_STATUSES)),
            ITSMTicket.created_at <= now,
        )
        backlog_tickets = self._apply_incident_filters(backlog_query, service_id, priority, status).all()
        backlog_records: List[OperationalKPIIncidentRecord] = []
        for ticket in backlog_tickets[:drilldown_limit]:
            age_seconds = max(0.0, (now - _utc(ticket.created_at)).total_seconds())
            if age_seconds < 86400:
                bucket = "under_24h"
            elif age_seconds <= 7 * 86400:
                bucket = "days_1_to_7"
            elif age_seconds <= 30 * 86400:
                bucket = "days_8_to_30"
            else:
                bucket = "over_30d"
            backlog_records.append(self._drilldown_record(ticket, duration_seconds=age_seconds, age_bucket=bucket))

        sla_response, response_records = self._sla_adherence_dimension(period_tickets, "RESPONSE", now, drilldown_limit)
        sla_resolution, resolution_records = self._sla_adherence_dimension(period_tickets, "RESOLUTION", now, drilldown_limit)
        return OperationalKPIDashboardResponse(
            date_range=KPIDateRange(start_time=start, end_time=now, evaluated_at=datetime.now(timezone.utc)),
            filters={
                "service_id": str(service_id) if service_id else None,
                "priority": priority.strip().upper() if priority else None,
                "status": status.strip().upper() if status else None,
            },
            mtta=mtta,
            mttr=mttr,
            backlog_age=backlog_age,
            sla_response=sla_response,
            sla_resolution=sla_resolution,
            drilldowns={
                "mtta": mtta_records,
                "mttr": mttr_records,
                "sla_response": response_records,
                "sla_resolution": resolution_records,
                "backlog": backlog_records,
            },
            drilldown_limit=drilldown_limit,
        )

    # -------------------------------------------------------------------------
    # 6. SLA Performance
    # -------------------------------------------------------------------------
    def compute_sla_performance(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> SLAPerformanceKPIResponse:
        """Formula: (count(sla_met) / count(sla_evaluated)) * 100

        Reuses authoritative compute_sla_details() directly without duplicating
        SLA date calculations.
        """
        now = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        # Query tickets that have SLA policy or SLA due dates applied
        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            or_(
                ITSMTicket.sla_policy_id.isnot(None),
                ITSMTicket.sla_resolution_due_at.isnot(None),
                ITSMTicket.sla_response_due_at.isnot(None),
            ),
        )
        query = self._apply_date_filter(query, ITSMTicket.created_at, start_time, now)
        tickets = query.all()

        total_evaluated = len(tickets)
        risk_breakdown = {
            "within_sla": 0,
            "at_risk": 0,
            "breached": 0,
            "paused": 0,
        }

        if total_evaluated == 0:
            return SLAPerformanceKPIResponse(
                total_evaluated=0,
                met_count=0,
                breached_count=0,
                compliance_rate_pct=0.0,
                breach_rate_pct=0.0,
                active_risk_breakdown=risk_breakdown,
            )

        met_count = 0
        breached_count = 0

        for ticket in tickets:
            # Check terminal vs active state
            if ticket.status in TERMINAL_STATUSES:
                # Terminal tickets: Check authoritative fields
                # If breach was recorded or met_at > due_at, it breached
                was_breached = bool(
                    getattr(ticket, "sla_breach_escalated_at", None)
                    or (
                        ticket.sla_resolution_due_at
                        and ticket.sla_resolution_met_at
                        and ticket.sla_resolution_met_at > ticket.sla_resolution_due_at
                    )
                    or (
                        ticket.sla_resolution_due_at
                        and not ticket.sla_resolution_met_at
                        and ticket.resolved_at
                        and ticket.resolved_at > ticket.sla_resolution_due_at
                    )
                )
                if was_breached:
                    breached_count += 1
                    risk_breakdown["breached"] += 1
                else:
                    met_count += 1
                    risk_breakdown["within_sla"] += 1
            else:
                # Active tickets: evaluate with authoritative compute_sla_details()
                sla_details = compute_sla_details(ticket, now)
                status = sla_details.get("status", "NO_SLA")

                if status == "BREACHED":
                    breached_count += 1
                    risk_breakdown["breached"] += 1
                elif status == "AT_RISK":
                    met_count += 1  # Not yet breached
                    risk_breakdown["at_risk"] += 1
                elif status == "PAUSED":
                    met_count += 1
                    risk_breakdown["paused"] += 1
                elif status == "WITHIN_SLA":
                    met_count += 1
                    risk_breakdown["within_sla"] += 1
                else:
                    # NO_SLA or fallback
                    met_count += 1

        compliance_rate = round((met_count / total_evaluated) * 100.0, 2)
        breach_rate = round((breached_count / total_evaluated) * 100.0, 2)

        return SLAPerformanceKPIResponse(
            total_evaluated=total_evaluated,
            met_count=met_count,
            breached_count=breached_count,
            compliance_rate_pct=compliance_rate,
            breach_rate_pct=breach_rate,
            active_risk_breakdown=risk_breakdown,
        )

    # -------------------------------------------------------------------------
    # 7. CSAT: Customer Satisfaction
    # -------------------------------------------------------------------------
    def compute_csat(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> CSATKPIResponse:
        """Formula: sum(score) / count(surveys); positive_pct = count(score >= 4) / count * 100

        Looks up CSAT scores in ITSMTicketActivity records where metadata contains 'csat_score'
        or 'rating', or activity_type in ('CSAT_FEEDBACK', 'CSAT_RATING', 'FEEDBACK').
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        # Count resolved tickets in window for response rate denominator
        resolve_col = func.coalesce(ITSMTicket.resolved_at, ITSMTicket.closed_at)
        resolved_q = self.db.query(func.count(ITSMTicket.id)).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(["RESOLVED", "CLOSED"]),
        )
        resolved_q = self._apply_date_filter(resolved_q, resolve_col, start_time, end_time)
        resolved_count = resolved_q.scalar() or 0

        # Query feedback activities
        query = self.db.query(ITSMTicketActivity).filter(
            ITSMTicketActivity.tenant_id == self.tenant_id,
        )
        query = self._apply_date_filter(query, ITSMTicketActivity.created_at, start_time, end_time)
        activities = query.all()

        scores: List[float] = []
        positive_count = 0

        for act in activities:
            meta = act.activity_metadata or {}
            score = meta.get("csat_score") or meta.get("rating")
            if score is None and act.activity_type in ["CSAT_FEEDBACK", "CSAT_RATING", "FEEDBACK"]:
                try:
                    score = float(act.content) if act.content else None
                except (ValueError, TypeError):
                    score = None

            if score is not None:
                try:
                    val = float(score)
                    if 1.0 <= val <= 5.0:
                        scores.append(val)
                        if val >= 4.0:
                            positive_count += 1
                except (ValueError, TypeError):
                    continue

        survey_count = len(scores)
        if survey_count == 0:
            return CSATKPIResponse(
                survey_count=0,
                average_score=None,
                positive_count=0,
                satisfaction_rate_pct=None,
                response_rate_pct=0.0,
            )

        avg_score = round(statistics.mean(scores), 2)
        sat_rate = round((positive_count / survey_count) * 100.0, 2)
        resp_rate = (
            round((survey_count / resolved_count) * 100.0, 2)
            if resolved_count > 0
            else 0.0
        )

        return CSATKPIResponse(
            survey_count=survey_count,
            average_score=avg_score,
            positive_count=positive_count,
            satisfaction_rate_pct=sat_rate,
            response_rate_pct=resp_rate,
        )

    # -------------------------------------------------------------------------
    # 8. Deflection Rate
    # -------------------------------------------------------------------------
    def compute_deflection(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> DeflectionKPIResponse:
        """Formula: (helpful_kb_views / (helpful_kb_views + incidents_created)) * 100

        Aggregates helpful_count and view_count from published knowledge articles
        and incident creation rate in the window.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        # Knowledge articles metrics
        kb_query = self.db.query(
            func.coalesce(func.sum(ITSMKnowledgeArticle.helpful_count), 0),
            func.coalesce(func.sum(ITSMKnowledgeArticle.view_count), 0),
        ).filter(
            ITSMKnowledgeArticle.tenant_id == self.tenant_id,
            ITSMKnowledgeArticle.status == "PUBLISHED",
        )
        helpful_count, total_kb_views = kb_query.first() or (0, 0)
        helpful_count = int(helpful_count)
        total_kb_views = int(total_kb_views)

        # Incidents created in window
        inc_q = self.db.query(func.count(ITSMTicket.id)).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        inc_q = self._apply_date_filter(inc_q, ITSMTicket.created_at, start_time, end_time)
        incidents_created = inc_q.scalar() or 0

        denominator = helpful_count + incidents_created
        rate = round((helpful_count / denominator) * 100.0, 2) if denominator > 0 else 0.0

        return DeflectionKPIResponse(
            helpful_count=helpful_count,
            total_kb_views=total_kb_views,
            incidents_created=incidents_created,
            deflection_rate_pct=rate,
        )

    # -------------------------------------------------------------------------
    # 9. Change Success Rate
    # -------------------------------------------------------------------------
    def compute_change_success(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> ChangeSuccessKPIResponse:
        """Formula: (completed_changes / (completed_changes + failed_changes)) * 100
        Emergency Rate: (emergency_changes / total_changes) * 100
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        query = self.db.query(ITSMChangeRequest).filter(
            ITSMChangeRequest.tenant_id == self.tenant_id,
        )
        query = self._apply_date_filter(query, ITSMChangeRequest.created_at, start_time, end_time)
        changes = query.all()

        total_changes = len(changes)
        successful_changes = 0
        failed_changes = 0
        emergency_changes = 0

        for c in changes:
            if (c.change_type or "").upper() == "EMERGENCY":
                emergency_changes += 1

            status = (c.status or "").upper()
            if status in ["COMPLETED", "CLOSED"]:
                successful_changes += 1
            elif status in ["CANCELLED", "FAILED", "ROLLED_BACK"]:
                failed_changes += 1

        implemented_changes = successful_changes + failed_changes
        success_rate = (
            round((successful_changes / implemented_changes) * 100.0, 2)
            if implemented_changes > 0
            else 0.0
        )
        emergency_rate = (
            round((emergency_changes / total_changes) * 100.0, 2)
            if total_changes > 0
            else 0.0
        )

        return ChangeSuccessKPIResponse(
            total_changes=total_changes,
            implemented_changes=implemented_changes,
            successful_changes=successful_changes,
            failed_changes=failed_changes,
            emergency_changes=emergency_changes,
            change_success_rate_pct=success_rate,
            emergency_change_rate_pct=emergency_rate,
        )

    # -------------------------------------------------------------------------
    # 10. Repeat Incidents Rate
    # -------------------------------------------------------------------------
    def compute_repeat_incidents(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        lookback_window_days: int = 14,
    ) -> RepeatIncidentsKPIResponse:
        """Formula: (count(repeat_incidents) / count(total_incidents)) * 100

        An incident is a repeat incident if within lookback_window_days prior
        to its creation, another incident occurred on the same service or linked problem.
        """
        end_time = _utc(end_time or datetime.now(timezone.utc))
        start_time = _utc(start_time)

        query = self.db.query(ITSMTicket).filter(
            ITSMTicket.tenant_id == self.tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
        )
        query = self._apply_date_filter(query, ITSMTicket.created_at, start_time, end_time)
        query = query.order_by(ITSMTicket.created_at.asc())
        incidents = query.all()

        total_incidents = len(incidents)
        if total_incidents == 0:
            return RepeatIncidentsKPIResponse(
                total_incidents=0,
                repeat_incidents_count=0,
                repeat_incident_rate_pct=0.0,
                lookback_window_days=lookback_window_days,
                top_recurring_services=[],
            )

        repeat_count = 0
        service_recurrence: Dict[str, int] = {}
        window_delta = timedelta(days=lookback_window_days)

        for inc in incidents:
            t_created = _utc(inc.created_at)
            prior_window_start = t_created - window_delta

            # Match conditions: same service_id or same linked_problem_id
            match_clauses = []
            if inc.service_id is not None:
                match_clauses.append(ITSMTicket.service_id == inc.service_id)
            if inc.linked_problem_id is not None:
                match_clauses.append(ITSMTicket.linked_problem_id == inc.linked_problem_id)
            if not match_clauses and inc.category:
                match_clauses.append(
                    and_(
                        ITSMTicket.category == inc.category,
                        ITSMTicket.subcategory == inc.subcategory,
                    )
                )

            if not match_clauses:
                continue

            prior_exists = (
                self.db.query(ITSMTicket.id)
                .filter(
                    ITSMTicket.tenant_id == self.tenant_id,
                    ITSMTicket.ticket_type == "INCIDENT",
                    ITSMTicket.id != inc.id,
                    ITSMTicket.created_at >= prior_window_start,
                    ITSMTicket.created_at < t_created,
                    or_(*match_clauses),
                )
                .first()
            )

            if prior_exists:
                repeat_count += 1
                svc_key = str(inc.service_id) if inc.service_id else (inc.category or "UNKNOWN")
                service_recurrence[svc_key] = service_recurrence.get(svc_key, 0) + 1

        rate = round((repeat_count / total_incidents) * 100.0, 2)
        top_services = [
            {"service": k, "repeat_count": v}
            for k, v in sorted(service_recurrence.items(), key=lambda x: x[1], reverse=True)[:5]
        ]

        return RepeatIncidentsKPIResponse(
            total_incidents=total_incidents,
            repeat_incidents_count=repeat_count,
            repeat_incident_rate_pct=rate,
            lookback_window_days=lookback_window_days,
            top_recurring_services=top_services,
        )

    # -------------------------------------------------------------------------
    # Comprehensive Summary (All 10 KPIs)
    # -------------------------------------------------------------------------
    def compute_all_kpis(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> CoreKPISummaryResponse:
        """Computes all 10 ANA-002 Core KPIs in a single deterministic pass."""
        now = _utc(end_time or datetime.now(timezone.utc))
        start = _utc(start_time)

        return CoreKPISummaryResponse(
            tenant_id=self.tenant_id,
            date_range=KPIDateRange(
                start_time=start,
                end_time=now,
                evaluated_at=datetime.now(timezone.utc),
            ),
            mtta=self.compute_mtta(start, now),
            mttr=self.compute_mttr(start, now),
            fcr=self.compute_fcr(start, now),
            reopen=self.compute_reopen_rate(start, now),
            backlog_age=self.compute_backlog_age(start, now),
            sla_performance=self.compute_sla_performance(start, now),
            csat=self.compute_csat(start, now),
            deflection=self.compute_deflection(start, now),
            change_success=self.compute_change_success(start, now),
            repeat_incidents=self.compute_repeat_incidents(start, now),
        )
