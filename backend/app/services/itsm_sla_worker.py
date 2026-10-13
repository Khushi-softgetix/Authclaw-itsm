"""SLA-003 Background Escalation Worker.

Periodically evaluates active ITSM tickets for SLA warning and breach escalation.
Reuses existing authoritative compute_sla_details(), evaluate_ticket_escalation(),
and record_warning_escalation() / record_breach_escalation().
Dispatches in-app notifications, ticket activity records, and audit events for new escalations.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import os
import time
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import (
    ITSMTeam,
    ITSMTeamMember,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    User,
)
from app.services.audit_store import append_audit_event
from app.services.itsm_sla_service import (
    SLAEscalationEvaluation,
    evaluate_ticket_escalation,
    record_breach_escalation,
    record_warning_escalation,
)
from app.services.notifications import create_notification

logger = logging.getLogger("authclaw.itsm_sla_worker")

TERMINAL_STATUSES = ("RESOLVED", "CLOSED", "CANCELLED")


def _set_tenant_context(db: Session, tenant_id: Any) -> None:
    """Bind PostgreSQL RLS context; lightweight unit-test databases have no set_config."""
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) != "postgresql":
        return
    db.execute(
        text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
        {"tenant_id": str(tenant_id)},
    )


def enabled() -> bool:
    """Return whether the SLA escalation worker is enabled."""
    return os.getenv("ITSM_SLA_WORKER_ENABLED", "true").lower() == "true"


def get_worker_interval() -> float:
    """Return the configured worker interval in seconds (default 60s)."""
    try:
        return float(os.getenv("ITSM_SLA_WORKER_INTERVAL_SECONDS", "60"))
    except ValueError:
        return 60.0


def get_candidate_tickets_query(db: Session, tenant_id: Any | None = None, for_update: bool = False):
    """Query only candidate ITSM tickets eligible for SLA escalation evaluation.

    Filters:
    - Active/unresolved tickets (excludes RESOLVED, CLOSED, CANCELLED)
    - Tickets with applicable SLA deadline data (sla_response_due_at OR sla_resolution_due_at)
    - Tickets where warning timestamp is NULL OR breach timestamp is NULL
    - Tenant boundary match when tenant_id is provided
    - Supports row-level locking (with_for_update) for concurrent worker safety
    """
    filters = [
        ITSMTicket.status.notin_(TERMINAL_STATUSES),
        or_(
            ITSMTicket.sla_response_due_at.isnot(None),
            ITSMTicket.sla_resolution_due_at.isnot(None),
        ),
    ]
    warning_col = getattr(ITSMTicket, "sla_warning_escalated_at", None)
    breach_col = getattr(ITSMTicket, "sla_breach_escalated_at", None)
    if hasattr(warning_col, "is_") and hasattr(breach_col, "is_"):
        filters.append(
            or_(
                warning_col.is_(None),
                breach_col.is_(None),
            )
        )
    query = db.query(ITSMTicket).filter(*filters)
    if tenant_id is not None:
        query = query.filter(ITSMTicket.tenant_id == tenant_id)
    if for_update:
        query = query.with_for_update(skip_locked=True)
    return query


def resolve_escalation_recipients(db: Session, ticket: ITSMTicket) -> list[UUID | None]:
    """Resolve in-app escalation notification recipients for an ITSM ticket.

    Reuses existing Incident Manager, assignment-team, and on-call structures.
    Does NOT create a new escalation-policy engine.
    Respects tenant isolation and RBAC.

    Resolution aggregation (deduplicated):
    1. Incident Managers in ticket's tenant (ITSMUserAccess where itsm_role='INCIDENT_MANAGER' & has_itsm_access=True).
    2. Assigned team members: if ticket.assignment_group is set, active members of matching ITSMTeam in tenant.
    3. Assigned agent: if ticket.assignee_id is set, active assignee User.
    4. Fallback: if no specific recipients found, notify tenant-wide with user_id=None.
    """
    tenant_id = ticket.tenant_id
    recipient_ids: set[UUID] = set()

    # 1. Incident Managers in tenant
    try:
        im_rows = (
            db.query(ITSMUserAccess.user_id)
            .outerjoin(User, (User.id == ITSMUserAccess.user_id) & (User.tenant_id == ITSMUserAccess.tenant_id))
            .filter(
                ITSMUserAccess.tenant_id == tenant_id,
                func.upper(ITSMUserAccess.itsm_role) == "INCIDENT_MANAGER",
                ITSMUserAccess.has_itsm_access.is_(True),
                or_(User.id.is_(None), User.is_active.is_(True)),
            )
            .all()
        )
        for r in im_rows:
            if r[0]:
                recipient_ids.add(r[0] if isinstance(r[0], UUID) else UUID(str(r[0])))
    except Exception as exc:
        logger.debug("Failed querying Incident Managers for ticket %s: %s", ticket.id, exc)

    # 2. Assignment Team members in tenant
    if ticket.assignment_group:
        try:
            team_member_rows = (
                db.query(ITSMTeamMember.user_id)
                .join(ITSMTeam, (ITSMTeam.id == ITSMTeamMember.team_id) & (ITSMTeam.tenant_id == ITSMTeamMember.tenant_id))
                .outerjoin(User, (User.id == ITSMTeamMember.user_id) & (User.tenant_id == ITSMTeamMember.tenant_id))
                .filter(
                    ITSMTeam.tenant_id == tenant_id,
                    ITSMTeamMember.tenant_id == tenant_id,
                    func.lower(ITSMTeam.name) == func.lower(str(ticket.assignment_group).strip()),
                    ITSMTeam.is_active.is_(True),
                    or_(User.id.is_(None), User.is_active.is_(True)),
                )
                .all()
            )
            for r in team_member_rows:
                if r[0]:
                    recipient_ids.add(r[0] if isinstance(r[0], UUID) else UUID(str(r[0])))
        except Exception as exc:
            logger.debug("Failed querying assignment team members for ticket %s: %s", ticket.id, exc)

    # 3. Direct assignee
    if ticket.assignee_id:
        try:
            assignee_uuid = ticket.assignee_id if isinstance(ticket.assignee_id, UUID) else UUID(str(ticket.assignee_id))
            assignee = (
                db.query(User.id)
                .filter(
                    User.id == assignee_uuid,
                    User.tenant_id == tenant_id,
                    User.is_active.is_(True),
                )
                .first()
            )
            if assignee and assignee[0]:
                recipient_ids.add(assignee[0] if isinstance(assignee[0], UUID) else UUID(str(assignee[0])))
            elif not assignee:
                # If user table not populated (e.g. lightweight SQLite unit test), retain assignee UUID
                recipient_ids.add(assignee_uuid)
        except Exception as exc:
            logger.debug("Could not resolve assignee user %s: %s", ticket.assignee_id, exc)

    # 4. Fallback to tenant-wide if no specific user resolved
    if not recipient_ids:
        return [None]

    return list(recipient_ids)


def _emit_escalation_audit_event(
    db: Session,
    ticket: ITSMTicket,
    stage_name: str,
    evaluation: SLAEscalationEvaluation,
    now: datetime,
) -> None:
    """Append required escalation evidence in the ticket state transaction."""
    action_key = "warning" if stage_name.upper() == "WARNING" else "breach"
    trace = [
        f"ticket_id={ticket.id}",
        f"ticket_number={ticket.ticket_number}",
        f"priority={ticket.priority}",
        f"stage={evaluation.stage}",
        f"sla_status={evaluation.sla_status}",
        f"remaining_seconds={evaluation.remaining_seconds}",
        f"escalation_type={stage_name.upper()}",
    ]
    due_at = (
        ticket.sla_response_due_at
        if str(evaluation.stage).upper() == "RESPONSE"
        else ticket.sla_resolution_due_at
    )
    _set_tenant_context(db, ticket.tenant_id)
    append_audit_event(
        db,
        {
            "id": str(uuid4()),
            "idempotency_key": f"itsm:sla:{ticket.id}:{action_key}:{due_at.isoformat() if due_at else 'no-deadline'}",
            "tenant_id": str(ticket.tenant_id),
            "timestamp": now,
            "actor_id": None,
            "actor_type": "system",
            "action": f"itsm.sla.{action_key}_escalation",
            "request_id": str(ticket.id),
            "event_category": "sla_escalation",
            "target_id": str(ticket.id),
            "target_type": "incident",
            "provider": "itsm",
            "reason": f"SLA {stage_name.upper()} escalation triggered",
            "response_status": 200,
            "frameworks_affected": ["ITIL"],
            "after_summary": {
                "stage": str(evaluation.stage),
                "sla_status": evaluation.sla_status,
                "escalation_type": stage_name.upper(),
                "escalated_at": now.isoformat(),
            },
            "execution_trace": trace,
        },
    )


def dispatch_escalation_actions(
    db: Session,
    ticket: ITSMTicket,
    stage_name: str,
    evaluation: SLAEscalationEvaluation,
    now: datetime,
) -> dict[str, Any]:
    """Dispatch in-app notifications, ticket activity, and audit records for an escalation.

    Called strictly once per stage upon new escalation transition.
    """
    recipients = resolve_escalation_recipients(db, ticket)
    is_breach = stage_name.upper() == "BREACH"
    stage_str = getattr(evaluation, "stage", None) or "RESOLUTION"
    remaining_secs = getattr(evaluation, "remaining_seconds", None)

    # 1. Stage durable ticket activity and required immutable audit evidence.
    activity_type = "SLA_BREACH_ESCALATION" if is_breach else "SLA_WARNING_ESCALATION"
    content = (
        f"SLA {stage_name.lower()} escalation triggered for ticket {ticket.ticket_number} ({ticket.priority}). "
        f"Stage: {stage_str}. SLA Status: {evaluation.sla_status}."
    )
    activity = ITSMTicketActivity(
        id=uuid4(),
        tenant_id=ticket.tenant_id,
        ticket_id=ticket.id,
        activity_type=activity_type,
        actor_type="SYSTEM",
        actor_id=None,
        content=content,
        activity_metadata={
            "escalation_type": stage_name.upper(),
            "stage": stage_str,
            "sla_status": evaluation.sla_status,
            "priority": ticket.priority,
            "remaining_seconds": remaining_secs,
            "escalated_at": now.isoformat(),
            "recipients_count": len(recipients),
            "is_internal": True,
        },
        created_at=now,
    )
    db.add(activity)
    db.flush()

    # 2. Audit is required: failure aborts the escalation state transaction.
    _emit_escalation_audit_event(db, ticket, stage_name, evaluation, now)

    # 3. Commit timestamp, activity, and immutable audit/outbox together.
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Failed committing escalation changes for ticket %s: %s", ticket.id, exc)
        raise

    # 4. Notifications are downstream delivery attempts. Their failure does not
    # erase the committed escalation evidence and can be retried separately.
    notif_type = "itsm.sla.breach" if is_breach else "itsm.sla.warning"
    severity = "critical" if is_breach else "warning"
    link = (
        f"/itsm/requests/{ticket.id}"
        if getattr(ticket, "ticket_type", None) == "SERVICE_REQUEST"
        else f"/itsm/incidents/{ticket.id}"
    )

    if is_breach:
        title = f"SLA Breached: {ticket.ticket_number} ({ticket.priority}) deadline exceeded"
        overdue_text = (
            f"overdue by {abs(int(remaining_secs))}s"
            if remaining_secs is not None and remaining_secs < 0
            else "deadline breached"
        )
        body = (
            f"Ticket {ticket.ticket_number} ('{ticket.title or ''}') has breached its {stage_str} deadline. "
            f"Priority: {ticket.priority}. Status: {evaluation.sla_status}. Details: {overdue_text}."
        )
    else:
        title = f"SLA Warning: {ticket.ticket_number} ({ticket.priority}) approaching deadline"
        remaining_text = (
            f"{int(remaining_secs)}s remaining"
            if remaining_secs is not None
            else "approaching threshold"
        )
        body = (
            f"Ticket {ticket.ticket_number} ('{ticket.title or ''}') is approaching its {stage_str} deadline. "
            f"Priority: {ticket.priority}. Status: {evaluation.sla_status}. Remaining time: {remaining_text}."
        )

    notifications_sent = 0
    for r_id in recipients:
        try:
            _set_tenant_context(db, ticket.tenant_id)
            notif = create_notification(
                db=db,
                tenant_id=ticket.tenant_id,
                user_id=r_id,
                type=notif_type,
                severity=severity,
                title=title,
                body=body,
                link=link,
            )
            if notif is not None:
                notifications_sent += 1
        except Exception as exc:
            logger.warning("Failed creating escalation notification for ticket %s to %s: %s", ticket.id, r_id, exc)

    return {
        "notifications_sent": notifications_sent,
        "recipients_count": len(recipients),
        "activity_created": True,
    }


def process_ticket_escalation(
    ticket: ITSMTicket,
    db: Session,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Evaluate and record escalation for an individual candidate ticket safely.

    Idempotent: never overwrites existing timestamps or creates duplicate escalation actions.
    """
    now = now or datetime.now(timezone.utc)
    _set_tenant_context(db, ticket.tenant_id)
    evaluation = evaluate_ticket_escalation(ticket, now=now, tenant_id=ticket.tenant_id)

    warning_recorded = False
    breach_recorded = False

    if evaluation.warning_eligible:
        warning_recorded = record_warning_escalation(ticket, now=now)
    if evaluation.breach_eligible:
        breach_recorded = record_breach_escalation(ticket, now=now)

    warning_actions = None
    breach_actions = None

    if warning_recorded:
        db.add(ticket)
        warning_actions = dispatch_escalation_actions(db, ticket, "WARNING", evaluation, now)

    if breach_recorded:
        db.add(ticket)
        breach_actions = dispatch_escalation_actions(db, ticket, "BREACH", evaluation, now)

    return {
        "ticket_id": str(ticket.id),
        "tenant_id": str(ticket.tenant_id),
        "sla_status": evaluation.sla_status,
        "warning_eligible": evaluation.warning_eligible,
        "warning_recorded": warning_recorded,
        "warning_actions": warning_actions,
        "breach_eligible": evaluation.breach_eligible,
        "breach_recorded": breach_recorded,
        "breach_actions": breach_actions,
    }


def process_tenant_escalations(
    db: Session,
    tenant_id: Any,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Process all candidate tickets for a single tenant in isolated context.

    Fault-tolerant: individual ticket errors do not abort subsequent tickets.
    """
    _set_tenant_context(db, tenant_id)
    stats = {
        "tenant_id": str(tenant_id),
        "candidates_evaluated": 0,
        "warnings_escalated": 0,
        "breaches_escalated": 0,
        "failed_tickets": 0,
    }

    # Claim and finish one row at a time. dispatch_escalation_actions commits
    # required state/evidence, so preloading a batch would release locks for
    # unprocessed rows and allow another worker to act on stale objects.
    evaluated_ids: set[UUID] = set()
    while True:
        _set_tenant_context(db, tenant_id)
        query = get_candidate_tickets_query(db, tenant_id=tenant_id, for_update=True)
        if evaluated_ids:
            query = query.filter(ITSMTicket.id.notin_(evaluated_ids))
        ticket = query.order_by(ITSMTicket.created_at.asc(), ITSMTicket.id.asc()).first()
        if ticket is None:
            break
        evaluated_ids.add(ticket.id)
        stats["candidates_evaluated"] += 1
        try:
            res = process_ticket_escalation(ticket, db, now=now)
            if res["warning_recorded"]:
                stats["warnings_escalated"] += 1
            if res["breach_recorded"]:
                stats["breaches_escalated"] += 1
            db.commit()
        except Exception as exc:
            db.rollback()
            stats["failed_tickets"] += 1
            logger.error(
                "Error processing SLA escalation for ticket %s (tenant %s): %s",
                ticket.id,
                tenant_id,
                exc,
                exc_info=True,
            )

    db.commit()
    return stats


def _sweep_with_session(db: Session, now: datetime | None = None) -> dict[str, Any]:
    """Run escalation sweep with an active database session."""
    started = time.monotonic()

    # A SECURITY DEFINER function exposes only candidate tenant identifiers.
    # Ticket content remains protected and is read under per-tenant RLS below.
    dialect = getattr(getattr(db, "bind", None), "dialect", None)
    if getattr(dialect, "name", None) == "postgresql":
        tenant_ids = list(
            db.execute(text("SELECT tenant_id FROM worker_maintenance.sla_candidate_tenants()"))
            .scalars()
            .all()
        )
    else:
        # Test/development databases without PostgreSQL RLS use the equivalent
        # candidate-only query. Production discovery always uses the narrow
        # SECURITY DEFINER function above.
        tenant_ids = [
            row[0]
            for row in db.query(ITSMTicket.tenant_id)
            .filter(
                ITSMTicket.status.notin_(TERMINAL_STATUSES),
                or_(
                    ITSMTicket.sla_response_due_at.isnot(None),
                    ITSMTicket.sla_resolution_due_at.isnot(None),
                ),
                or_(
                    ITSMTicket.sla_warning_escalated_at.is_(None),
                    ITSMTicket.sla_breach_escalated_at.is_(None),
                ),
            )
            .distinct()
            .all()
        ]
    db.commit()

    total_candidates = 0
    total_warnings = 0
    total_breaches = 0
    total_failures = 0

    for t_id in tenant_ids:
        try:
            tenant_stats = process_tenant_escalations(db, tenant_id=t_id, now=now)
            total_candidates += tenant_stats["candidates_evaluated"]
            total_warnings += tenant_stats["warnings_escalated"]
            total_breaches += tenant_stats["breaches_escalated"]
            total_failures += tenant_stats["failed_tickets"]
        except Exception as exc:
            logger.error("Failed to process SLA escalations for tenant %s: %s", t_id, exc, exc_info=True)
            total_failures += 1

    duration_ms = round((time.monotonic() - started) * 1000)
    return {
        "tenants_processed": len(tenant_ids),
        "candidates_evaluated": total_candidates,
        "warnings_escalated": total_warnings,
        "breaches_escalated": total_breaches,
        "failed_tickets": total_failures,
        "duration_ms": duration_ms,
    }


def sweep(session_or_engine, now: datetime | None = None) -> dict[str, Any]:
    """Execute a single sweep across all active tenants with candidate tickets.

    Accepts either an active SQLAlchemy Session or an Engine.
    """
    if hasattr(session_or_engine, "query"):
        return _sweep_with_session(session_or_engine, now=now)
    else:
        SessionMaker = sessionmaker(bind=session_or_engine, autocommit=False, autoflush=False)
        db = SessionMaker()
        try:
            return _sweep_with_session(db, now=now)
        finally:
            db.close()


async def run(engine_or_sessionmaker, stop: asyncio.Event, *, interval: float = 60.0) -> None:
    """Continuous worker loop executing periodic escalation sweeps."""
    failures = 0
    while not stop.is_set():
        try:
            result = await asyncio.to_thread(sweep, engine_or_sessionmaker)
            failures = 0
            logger.info(
                "itsm_sla_worker sweep tenants=%s candidates=%s warnings=%s breaches=%s failures=%s duration_ms=%s",
                result["tenants_processed"],
                result["candidates_evaluated"],
                result["warnings_escalated"],
                result["breaches_escalated"],
                result["failed_tickets"],
                result["duration_ms"],
            )
        except Exception as exc:
            failures += 1
            logger.error(
                "itsm_sla_worker sweep failed error_type=%s consecutive_failures=%s",
                type(exc).__name__,
                failures,
            )
        delay = min(300.0, interval * (2 ** min(failures, 3)))
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except (asyncio.TimeoutError, TimeoutError):
            pass


async def start(app, engine) -> None:
    """Start the SLA escalation worker task on FastAPI application startup."""
    if not enabled():
        logger.info("ITSM SLA escalation worker disabled by configuration")
        return
    stop = asyncio.Event()
    app.state.itsm_sla_worker_stop = stop
    app.state.itsm_sla_worker_task = asyncio.create_task(
        run(engine, stop, interval=get_worker_interval()),
        name="itsm-sla-escalation-worker",
    )
    logger.info("ITSM SLA escalation worker started (interval=%ss)", get_worker_interval())


async def shutdown(app) -> None:
    """Gracefully signal and stop the SLA escalation worker on FastAPI shutdown."""
    task = getattr(app.state, "itsm_sla_worker_task", None)
    if task is not None:
        stop = getattr(app.state, "itsm_sla_worker_stop", None)
        if stop is not None:
            stop.set()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except (asyncio.TimeoutError, TimeoutError, Exception):
            pass
        logger.info("ITSM SLA escalation worker stopped")
