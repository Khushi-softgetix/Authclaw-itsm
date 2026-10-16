"""ANA-004 immutable historical KPI snapshot generation and retrieval."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import (
    ITSMChangeRequest,
    ITSMBusinessCalendar,
    ITSMKnowledgeArticle,
    ITSMMetricSnapshot,
    ITSMMetricSourceEvent,
    ITSMTicket,
    ITSMTicketActivity,
)
from app.services.itsm_kpi_service import ITSMKPIService


DEFINITION_VERSION = "ANA-004-v2"
SUPPORTED_GRAINS = frozenset({"DAILY", "WEEKLY", "MONTHLY"})
METRIC_FIELDS = {
    "MTTA": "mtta",
    "MTTR": "mttr",
    "FCR": "fcr",
    "REOPEN_RATE": "reopen",
    "BACKLOG_AGE": "backlog_age",
    "SLA_PERFORMANCE": "sla_performance",
    "CSAT": "csat",
    "DEFLECTION": "deflection",
    "CHANGE_SUCCESS": "change_success",
    "REPEAT_INCIDENTS": "repeat_incidents",
}


def normalize_period(
    grain: str,
    reference: datetime,
    *,
    reporting_timezone: str = "UTC",
    week_start: int = 0,
) -> tuple[datetime, datetime]:
    """Return the latest completed local-calendar period as UTC instants."""
    grain = grain.strip().upper()
    if grain not in SUPPORTED_GRAINS:
        raise ValueError(f"Unsupported snapshot grain '{grain}'")
    if week_start not in range(7):
        raise ValueError("week_start must be between 0 (Monday) and 6 (Sunday)")
    reference = reference if reference.tzinfo else reference.replace(tzinfo=timezone.utc)
    try:
        zone = ZoneInfo(reporting_timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown reporting timezone '{reporting_timezone}'") from exc
    local_reference = reference.astimezone(zone)
    current_day = local_reference.replace(hour=0, minute=0, second=0, microsecond=0)
    if grain == "DAILY":
        start, end = current_day - timedelta(days=1), current_day
    elif grain == "WEEKLY":
        current_week = current_day - timedelta(days=(current_day.weekday() - week_start) % 7)
        start, end = current_week - timedelta(days=7), current_week
    else:
        end = current_day.replace(day=1)
        start = (end - timedelta(days=1)).replace(day=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _dimensions_hash(dimensions: dict[str, Any]) -> str:
    encoded = json.dumps(dimensions, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class ITSMMetricSnapshotService:
    """Generate idempotent immutable rows from the canonical KPI service."""

    def __init__(self, db: Session, tenant_id: UUID | str):
        self.db = db
        self.tenant_id = UUID(str(tenant_id))

    def reporting_calendar(self) -> tuple[str, int]:
        """Resolve a configured tenant timezone; keep week start configurable."""
        calendar = (
            self.db.query(ITSMBusinessCalendar)
            .filter(
                ITSMBusinessCalendar.tenant_id == self.tenant_id,
                ITSMBusinessCalendar.is_default.is_(True),
            )
            .order_by(ITSMBusinessCalendar.created_at.asc())
            .first()
        )
        timezone_name = (
            calendar.timezone if calendar and calendar.timezone else
            os.getenv("ITSM_METRIC_DEFAULT_TIMEZONE", "UTC")
        )
        try:
            week_start = int(os.getenv("ITSM_METRIC_WEEK_START", "0"))
        except ValueError:
            week_start = 0
        return timezone_name, week_start

    def _source_manifest(self, start: datetime, end: datetime) -> dict[str, Any]:
        """Record bounded source classes, counts, and a deterministic manifest digest."""
        ticket_count = (
            self.db.query(func.count(ITSMTicket.id))
            .filter(
                ITSMTicket.tenant_id == self.tenant_id,
                ITSMTicket.created_at >= start,
                ITSMTicket.created_at < end,
            )
            .scalar()
            or 0
        )
        activity_count = (
            self.db.query(func.count(ITSMTicketActivity.id))
            .filter(
                ITSMTicketActivity.tenant_id == self.tenant_id,
                ITSMTicketActivity.created_at >= start,
                ITSMTicketActivity.created_at < end,
            )
            .scalar()
            or 0
        )
        change_count = (
            self.db.query(func.count(ITSMChangeRequest.id))
            .filter(
                ITSMChangeRequest.tenant_id == self.tenant_id,
                ITSMChangeRequest.created_at >= start,
                ITSMChangeRequest.created_at < end,
            )
            .scalar()
            or 0
        )
        knowledge_count = (
            self.db.query(func.count(ITSMKnowledgeArticle.id))
            .filter(
                ITSMKnowledgeArticle.tenant_id == self.tenant_id,
                ITSMKnowledgeArticle.status == "PUBLISHED",
            )
            .scalar()
            or 0
        )
        source_event_count = (
            self.db.query(func.count(ITSMMetricSourceEvent.id))
            .filter(
                ITSMMetricSourceEvent.tenant_id == self.tenant_id,
                ITSMMetricSourceEvent.occurred_at >= start,
                ITSMMetricSourceEvent.occurred_at < end,
            )
            .scalar()
            or 0
        )
        source_event_total = (
            self.db.query(func.count(ITSMMetricSourceEvent.id))
            .filter(ITSMMetricSourceEvent.tenant_id == self.tenant_id)
            .scalar()
            or 0
        )
        manifest = {
            "window": {"start": start.isoformat(), "end_exclusive": end.isoformat()},
            "record_counts": {
                "itsm_tickets": int(ticket_count),
                "itsm_ticket_activities": int(activity_count),
                "itsm_change_requests": int(change_count),
                "published_knowledge_articles": int(knowledge_count),
                "immutable_metric_source_events": int(source_event_count),
            },
            "source_contract": "tenant-scoped canonical ANA-002 queries",
            "event_capture": {
                "immutable_events_available": bool(source_event_total),
                "legacy_rows_may_require_current-state_fallback": not bool(source_event_total),
            },
        }
        digest_input = json.dumps(manifest, sort_keys=True, separators=(",", ":"))
        manifest["manifest_sha256"] = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()
        return manifest

    def generate_completed_period(
        self,
        grain: str,
        reference: datetime | None = None,
    ) -> list[ITSMMetricSnapshot]:
        grain = grain.strip().upper()
        timezone_name, week_start = self.reporting_calendar()
        start, end = normalize_period(
            grain,
            reference or datetime.now(timezone.utc),
            reporting_timezone=timezone_name,
            week_start=week_start,
        )
        return self.generate_period(
            grain,
            start,
            end,
            dimensions={"reporting_timezone": timezone_name, "week_start": week_start},
        )

    def generate_period(
        self,
        grain: str,
        start: datetime,
        end: datetime,
        *,
        dimensions: dict[str, Any] | None = None,
        commit: bool = True,
    ) -> list[ITSMMetricSnapshot]:
        """Persist all canonical KPI facts for one explicit completed UTC period."""
        grain = grain.strip().upper()
        if grain not in SUPPORTED_GRAINS:
            raise ValueError(f"Unsupported snapshot grain '{grain}'")
        if end <= start:
            raise ValueError("Snapshot period end must be after its start")
        dimensions = dict(dimensions or {})
        dimensions_hash = _dimensions_hash(dimensions)
        existing = (
            self.db.query(ITSMMetricSnapshot)
            .filter(
                ITSMMetricSnapshot.tenant_id == self.tenant_id,
                ITSMMetricSnapshot.period_grain == grain,
                ITSMMetricSnapshot.period_start == start,
                ITSMMetricSnapshot.period_end == end,
                ITSMMetricSnapshot.definition_version == DEFINITION_VERSION,
                ITSMMetricSnapshot.dimensions_hash == dimensions_hash,
            )
            .order_by(ITSMMetricSnapshot.metric_key.asc())
            .all()
        )
        if len(existing) == len(METRIC_FIELDS):
            return existing

        summary = ITSMKPIService(self.db, self.tenant_id).compute_all_kpis(
            start_time=start,
            end_time=end - timedelta(microseconds=1),
        )
        source_events = self._source_manifest(start, end)
        rows: list[dict[str, Any]] = []
        for metric_key, field_name in METRIC_FIELDS.items():
            metric_value = getattr(summary, field_name).model_dump(mode="json")
            rows.append(
                {
                    "id": uuid4(),
                    "tenant_id": self.tenant_id,
                    "metric_key": metric_key,
                    "period_grain": grain,
                    "period_start": start,
                    "period_end": end,
                    "dimensions": dimensions,
                    "dimensions_hash": dimensions_hash,
                    "value": metric_value,
                    "definition_version": DEFINITION_VERSION,
                    "source_events": source_events,
                    "generated_at": datetime.now(timezone.utc),
                }
            )

        dialect = getattr(getattr(self.db, "bind", None), "dialect", None)
        if getattr(dialect, "name", None) == "postgresql":
            statement = pg_insert(ITSMMetricSnapshot).values(rows).on_conflict_do_nothing(
                constraint="uq_itsm_metric_snapshot_identity"
            )
            self.db.execute(statement)
        else:
            for row in rows:
                exists = (
                    self.db.query(ITSMMetricSnapshot.id)
                    .filter(
                        ITSMMetricSnapshot.tenant_id == self.tenant_id,
                        ITSMMetricSnapshot.metric_key == row["metric_key"],
                        ITSMMetricSnapshot.period_grain == grain,
                        ITSMMetricSnapshot.period_start == start,
                        ITSMMetricSnapshot.period_end == end,
                        ITSMMetricSnapshot.definition_version == DEFINITION_VERSION,
                        ITSMMetricSnapshot.dimensions_hash == dimensions_hash,
                    )
                    .first()
                )
                if not exists:
                    self.db.add(ITSMMetricSnapshot(**row))
        if commit:
            self.db.commit()
        else:
            self.db.flush()
        return (
            self.db.query(ITSMMetricSnapshot)
            .filter(
                ITSMMetricSnapshot.tenant_id == self.tenant_id,
                ITSMMetricSnapshot.period_grain == grain,
                ITSMMetricSnapshot.period_start == start,
                ITSMMetricSnapshot.period_end == end,
                ITSMMetricSnapshot.definition_version == DEFINITION_VERSION,
                ITSMMetricSnapshot.dimensions_hash == dimensions_hash,
            )
            .order_by(ITSMMetricSnapshot.metric_key.asc())
            .all()
        )

    def list_snapshots(
        self,
        *,
        metric_key: str | None,
        period_grain: str | None,
        start_time: datetime | None,
        end_time: datetime | None,
        limit: int,
        definition_version: str | None = None,
    ) -> list[ITSMMetricSnapshot]:
        query = self.db.query(ITSMMetricSnapshot).filter(
            ITSMMetricSnapshot.tenant_id == self.tenant_id
        )
        if metric_key:
            query = query.filter(ITSMMetricSnapshot.metric_key == metric_key.strip().upper())
        if period_grain:
            grain = period_grain.strip().upper()
            if grain not in SUPPORTED_GRAINS:
                raise ValueError(f"Unsupported snapshot grain '{period_grain}'")
            query = query.filter(ITSMMetricSnapshot.period_grain == grain)
        if start_time:
            query = query.filter(ITSMMetricSnapshot.period_start >= start_time)
        if end_time:
            query = query.filter(ITSMMetricSnapshot.period_end <= end_time)
        if definition_version:
            query = query.filter(ITSMMetricSnapshot.definition_version == definition_version)
        return query.order_by(
            ITSMMetricSnapshot.period_end.desc(),
            ITSMMetricSnapshot.metric_key.asc(),
        ).limit(limit).all()
