"""Dedicated ANA-004 snapshot scheduler with durable catch-up jobs."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import os
import socket
from typing import Any, Iterator
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, func, or_, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import (
    ITSMChangeRequest,
    ITSMMetricSnapshotJob,
    ITSMMetricSourceEvent,
    ITSMTicket,
    Tenant,
)
from app.services.itsm_metric_snapshot_service import (
    DEFINITION_VERSION,
    ITSMMetricSnapshotService,
    _dimensions_hash,
)


logger = logging.getLogger("authclaw.itsm_metric_snapshot_worker")
GRAINS = ("DAILY", "WEEKLY", "MONTHLY")


def enabled() -> bool:
    return os.getenv("ITSM_METRIC_SNAPSHOT_WORKER_ENABLED", "true").lower() == "true"


def get_worker_interval() -> float:
    try:
        return max(30.0, float(os.getenv("ITSM_METRIC_SNAPSHOT_WORKER_INTERVAL_SECONDS", "3600")))
    except ValueError:
        return 3600.0


def _batch_size() -> int:
    try:
        return max(1, min(100, int(os.getenv("ITSM_METRIC_SNAPSHOT_MAX_PERIODS_PER_SWEEP", "12"))))
    except ValueError:
        return 12


def _lease_seconds() -> int:
    try:
        return max(60, int(os.getenv("ITSM_METRIC_SNAPSHOT_LEASE_SECONDS", "900")))
    except ValueError:
        return 900


def _candidate_tenants(db: Session) -> list[Any]:
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        return [
            row[0]
            for row in db.execute(
                text("SELECT tenant_id FROM worker_maintenance.metric_snapshot_candidate_tenants()")
            ).all()
        ]
    return [row[0] for row in db.query(Tenant.id).filter(Tenant.status == "active").all()]


def _bind_tenant(db: Session, tenant_id: UUID | str) -> None:
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        db.execute(
            text("SELECT worker_maintenance.bind_metric_snapshot_context(:tenant_id)"),
            {"tenant_id": str(tenant_id)},
        )


def _completed_periods(
    grain: str,
    earliest: datetime,
    reference: datetime,
    timezone_name: str,
    week_start: int,
) -> Iterator[tuple[datetime, datetime]]:
    """Yield every completed local-calendar period intersecting source history."""
    zone = ZoneInfo(timezone_name)
    earliest_local = earliest.astimezone(zone)
    reference_local = reference.astimezone(zone)
    day = earliest_local.replace(hour=0, minute=0, second=0, microsecond=0)
    if grain == "DAILY":
        cursor = day
        advance = lambda value: value + timedelta(days=1)
    elif grain == "WEEKLY":
        cursor = day - timedelta(days=(day.weekday() - week_start) % 7)
        advance = lambda value: value + timedelta(days=7)
    else:
        cursor = day.replace(day=1)

        def advance(value: datetime) -> datetime:
            return (value + timedelta(days=32)).replace(day=1)

    while True:
        following = advance(cursor)
        if following > reference_local:
            break
        yield cursor.astimezone(timezone.utc), following.astimezone(timezone.utc)
        cursor = following


def _earliest_source_at(db: Session, tenant_id: UUID) -> datetime | None:
    candidates = (
        db.query(func.min(ITSMTicket.created_at)).filter(ITSMTicket.tenant_id == tenant_id).scalar(),
        db.query(func.min(ITSMChangeRequest.created_at)).filter(ITSMChangeRequest.tenant_id == tenant_id).scalar(),
        db.query(func.min(ITSMMetricSourceEvent.occurred_at)).filter(ITSMMetricSourceEvent.tenant_id == tenant_id).scalar(),
    )
    available = [value for value in candidates if value is not None]
    if not available:
        return None
    return min(value if value.tzinfo else value.replace(tzinfo=timezone.utc) for value in available)


def _queue_missing_jobs(db: Session, tenant_id: UUID, reference: datetime) -> int:
    service = ITSMMetricSnapshotService(db, tenant_id)
    timezone_name, week_start = service.reporting_calendar()
    dimensions = {"reporting_timezone": timezone_name, "week_start": week_start}
    dimensions_hash = _dimensions_hash(dimensions)
    earliest = _earliest_source_at(db, tenant_id)
    if earliest is None:
        return 0
    rows = []
    for grain in GRAINS:
        for start, end in _completed_periods(grain, earliest, reference, timezone_name, week_start):
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "period_grain": grain,
                    "period_start": start,
                    "period_end": end,
                    "definition_version": DEFINITION_VERSION,
                    "dimensions": dimensions,
                    "dimensions_hash": dimensions_hash,
                    "status": "PENDING",
                    "next_attempt_at": reference,
                }
            )
    if not rows:
        return 0
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        result = db.execute(
            pg_insert(ITSMMetricSnapshotJob)
            .values(rows)
            .on_conflict_do_nothing(constraint="uq_itsm_metric_snapshot_job_identity")
        )
        return max(0, result.rowcount or 0)
    created = 0
    for row in rows:
        exists = db.query(ITSMMetricSnapshotJob.id).filter_by(
            tenant_id=tenant_id,
            period_grain=row["period_grain"],
            period_start=row["period_start"],
            period_end=row["period_end"],
            definition_version=DEFINITION_VERSION,
            dimensions_hash=dimensions_hash,
        ).first()
        if not exists:
            db.add(ITSMMetricSnapshotJob(**row))
            created += 1
    return created


def _claim_jobs(db: Session, tenant_id: UUID, now: datetime, owner: str) -> list[UUID]:
    eligible = or_(
        ITSMMetricSnapshotJob.status.in_(["PENDING", "FAILED"]),
        (ITSMMetricSnapshotJob.status == "RUNNING")
        & (ITSMMetricSnapshotJob.lease_expires_at < now),
    )
    query = (
        db.query(ITSMMetricSnapshotJob)
        .filter(
            ITSMMetricSnapshotJob.tenant_id == tenant_id,
            eligible,
            ITSMMetricSnapshotJob.next_attempt_at <= now,
        )
        .order_by(ITSMMetricSnapshotJob.period_end.asc(), ITSMMetricSnapshotJob.period_grain.asc())
        .limit(_batch_size())
    )
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        query = query.with_for_update(skip_locked=True)
    jobs = query.all()
    lease_until = now + timedelta(seconds=_lease_seconds())
    for job in jobs:
        job.status = "RUNNING"
        job.attempt_count += 1
        job.lease_owner = owner
        job.lease_expires_at = lease_until
        job.started_at = now
        job.updated_at = now
        job.last_error_code = None
    return [job.id for job in jobs]


def _generate_claimed_job(db: Session, tenant_id: UUID, job_id: UUID, owner: str) -> int:
    _bind_tenant(db, tenant_id)
    job = db.query(ITSMMetricSnapshotJob).filter_by(
        id=job_id, tenant_id=tenant_id, status="RUNNING", lease_owner=owner
    ).one_or_none()
    if job is None:
        db.rollback()
        return 0
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        locked = db.execute(
            text("SELECT pg_try_advisory_xact_lock(hashtextextended(:identity, 0))"),
            {"identity": f"{tenant_id}:{job.period_grain}:{job.period_start.isoformat()}:{job.definition_version}"},
        ).scalar_one()
        if not locked:
            db.rollback()
            return 0
    rows = ITSMMetricSnapshotService(db, tenant_id).generate_period(
        job.period_grain,
        job.period_start,
        job.period_end,
        dimensions=dict(job.dimensions or {}),
        commit=False,
    )
    job.status = "SUCCEEDED"
    job.completed_at = datetime.now(timezone.utc)
    job.lease_owner = None
    job.lease_expires_at = None
    job.updated_at = job.completed_at
    db.commit()
    return len(rows)


def sweep(session_or_engine, now: datetime | None = None) -> dict[str, int]:
    """Queue every missing period and process a bounded, retryable batch."""
    owns_session = not hasattr(session_or_engine, "query")
    if owns_session:
        maker = sessionmaker(bind=session_or_engine, autocommit=False, autoflush=False)
        db = maker()
    else:
        db = session_or_engine
    reference = now or datetime.now(timezone.utc)
    owner = f"{socket.gethostname()}:{os.getpid()}"
    generated = failures = jobs_queued = jobs_claimed = 0
    try:
        tenant_ids = _candidate_tenants(db)
        db.commit()
        for raw_tenant_id in tenant_ids:
            tenant_id = UUID(str(raw_tenant_id))
            try:
                _bind_tenant(db, tenant_id)
                jobs_queued += _queue_missing_jobs(db, tenant_id, reference)
                claimed = _claim_jobs(db, tenant_id, reference, owner)
                jobs_claimed += len(claimed)
                db.commit()
            except Exception as exc:
                db.rollback()
                failures += 1
                logger.error(
                    "Metric snapshot queueing failed tenant=%s error_type=%s",
                    tenant_id, type(exc).__name__, exc_info=True,
                )
                continue
            for job_id in claimed:
                try:
                    generated += _generate_claimed_job(db, tenant_id, job_id, owner)
                except Exception as exc:
                    db.rollback()
                    failures += 1
                    logger.error(
                        "Metric snapshot job failed tenant=%s job=%s error_type=%s",
                        tenant_id, job_id, type(exc).__name__, exc_info=True,
                    )
                    try:
                        _bind_tenant(db, tenant_id)
                        job = db.query(ITSMMetricSnapshotJob).filter_by(
                            id=job_id, tenant_id=tenant_id, lease_owner=owner
                        ).one_or_none()
                        if job:
                            job.status = "FAILED"
                            job.last_error_code = type(exc).__name__[:128]
                            delay = min(21600, 60 * (2 ** min(job.attempt_count, 8)))
                            job.next_attempt_at = reference + timedelta(seconds=delay)
                            job.lease_owner = None
                            job.lease_expires_at = None
                            job.updated_at = datetime.now(timezone.utc)
                            db.commit()
                    except Exception:
                        db.rollback()
                        logger.exception("Metric snapshot failure state could not be persisted job=%s", job_id)
        return {
            "tenants_processed": len(tenant_ids),
            "jobs_queued": jobs_queued,
            "jobs_claimed": jobs_claimed,
            "snapshots_available": generated,
            "failures": failures,
        }
    finally:
        if owns_session:
            db.close()


async def run(engine, stop: asyncio.Event, *, interval: float) -> None:
    consecutive_failed_sweeps = 0
    while not stop.is_set():
        try:
            result = await asyncio.to_thread(sweep, engine)
            consecutive_failed_sweeps = consecutive_failed_sweeps + 1 if result["failures"] else 0
            logger.info("metric snapshot sweep result=%s", result)
        except Exception as exc:
            consecutive_failed_sweeps += 1
            logger.error("Metric snapshot sweep failed: %s", type(exc).__name__, exc_info=True)
        delay = min(21600.0, interval * (2 ** min(consecutive_failed_sweeps, 3)))
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except (asyncio.TimeoutError, TimeoutError):
            pass


async def _main() -> None:
    if not enabled():
        logger.info("ITSM metric snapshot worker disabled by configuration")
        return
    database_url = os.getenv("METRIC_SNAPSHOT_DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("METRIC_SNAPSHOT_DATABASE_URL is required for the dedicated worker")
    engine = create_engine(database_url, pool_pre_ping=True)
    stop = asyncio.Event()
    try:
        await run(engine, stop, interval=get_worker_interval())
    finally:
        engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    asyncio.run(_main())
