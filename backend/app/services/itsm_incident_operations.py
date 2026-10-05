"""Read-only Incident Manager operational evaluation."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import ITSMTicket, ITSMTicketActivity, User
from app.services.itsm_sla_service import business_seconds_between, compute_sla_details

RISK_REMAINING_FRACTION = 0.25
IDLE_THRESHOLD = timedelta(hours=4)
OPEN_STATUSES = {"NEW", "ASSIGNED", "IN_PROGRESS", "PENDING"}


def _utc(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def _sla(ticket: ITSMTicket, now: datetime) -> dict[str, Any]:
    details = compute_sla_details(ticket, now)
    status = details["status"]
    if status not in ("NO_SLA", "WITHIN_SLA", "AT_RISK", "BREACHED"):
        status = "WITHIN_SLA"
    return {
        "status": status,
        "remaining_seconds": details["remaining_seconds"],
    }


def evaluate_incident_operations(
    db: Session,
    tenant_id: UUID,
    tickets: list[ITSMTicket],
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    ids = [ticket.id for ticket in tickets]
    latest = {}
    if ids:
        activities = (
            db.query(ITSMTicketActivity)
            .filter(
                ITSMTicketActivity.tenant_id == tenant_id,
                ITSMTicketActivity.ticket_id.in_(ids),
            )
            .order_by(ITSMTicketActivity.created_at.desc())
            .all()
        )
        for activity in activities:
            latest.setdefault(activity.ticket_id, _utc(activity.created_at))
    assignee_ids = {ticket.assignee_id for ticket in tickets if ticket.assignee_id}
    assignee_emails = (
        dict(
            db.query(User.id, User.email)
            .filter(User.tenant_id == tenant_id, User.id.in_(assignee_ids))
            .all()
        )
        if assignee_ids
        else {}
    )
    items: list[dict[str, Any]] = []
    for ticket in tickets:
        activity_at = (
            latest.get(ticket.id) or _utc(ticket.updated_at) or _utc(ticket.created_at)
        )
        idle = activity_at is not None and now - activity_at >= IDLE_THRESHOLD
        sla = _sla(ticket, now)
        reasons = []
        if ticket.priority in {"P1", "P2"}:
            reasons.append("HIGH_PRIORITY")
        if sla["status"] == "AT_RISK":
            reasons.append("SLA_AT_RISK")
        if sla["status"] == "BREACHED":
            reasons.append("SLA_BREACHED")
        if idle:
            reasons.append("STUCK_IDLE")
        item = {
            "incident_id": str(ticket.id),
            "ticket_number": ticket.ticket_number,
            "title": ticket.title,
            "priority": ticket.priority,
            "status": ticket.status,
            "assignment_group": ticket.assignment_group,
            "assignee_id": str(ticket.assignee_id) if ticket.assignee_id else None,
            "assignee_email": assignee_emails.get(ticket.assignee_id),
            "last_activity_at": activity_at.isoformat() if activity_at else None,
            "idle_seconds": (
                (now - activity_at).total_seconds() if activity_at else None
            ),
            "sla": sla,
            "attention_reasons": reasons,
            "watch": "REQUIRES_ATTENTION" if reasons else "NONE",
        }
        items.append(item)
    return items


def build_operations_dashboard(
    db: Session,
    tenant_id: UUID,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    tickets = (
        db.query(ITSMTicket)
        .filter(
            ITSMTicket.tenant_id == tenant_id,
            ITSMTicket.ticket_type == "INCIDENT",
            ITSMTicket.status.in_(OPEN_STATUSES),
        )
        .all()
    )
    items = evaluate_incident_operations(db, tenant_id, tickets, now)
    groups: Counter[str] = Counter()
    assignees: Counter[str] = Counter()
    priority: list[dict[str, Any]] = []
    at_risk: list[dict[str, Any]] = []
    breached: list[dict[str, Any]] = []
    stuck: list[dict[str, Any]] = []
    escalation: list[dict[str, Any]] = []
    group_detail: dict[str, Counter] = defaultdict(Counter)
    assignee_detail: dict[str, Counter] = defaultdict(Counter)
    assignee_labels: dict[str, str] = {}
    for item in items:
        if item["priority"] in {"P1", "P2"}:
            priority.append(item)
        if item["sla"]["status"] == "AT_RISK":
            at_risk.append(item)
        if item["sla"]["status"] == "BREACHED":
            breached.append(item)
        if "STUCK_IDLE" in item["attention_reasons"]:
            stuck.append(item)
        if item["watch"] == "REQUIRES_ATTENTION":
            escalation.append(item)
        dimensions = [
            (group_detail, item["assignment_group"] or "Unassigned"),
            (
                assignee_detail,
                str(item["assignee_id"]) if item["assignee_id"] else "Unassigned",
            ),
        ]
        if item["assignee_id"] and item["assignee_email"]:
            assignee_labels[str(item["assignee_id"])] = item["assignee_email"]
        for detail, key in dimensions:
            detail[key]["open_incidents"] += 1
            if item["priority"] in {"P1", "P2"}:
                detail[key]["p1_p2"] += 1
            if item["sla"]["status"] == "AT_RISK":
                detail[key]["sla_at_risk"] += 1
            if item["sla"]["status"] == "BREACHED":
                detail[key]["sla_breached"] += 1
            if "STUCK_IDLE" in item["attention_reasons"]:
                detail[key]["stuck"] += 1
        groups[item["assignment_group"] or "Unassigned"] += 1
        assignees[str(item["assignee_id"]) if item["assignee_id"] else "Unassigned"] += 1

    def workload_rows(
        detail: dict[str, Counter], assignee: bool = False
    ) -> list[dict[str, Any]]:
        rows = []
        ordered = sorted(
            detail.items(),
            key=lambda pair: (-pair[1]["open_incidents"], pair[0]),
        )
        for key, counts in ordered:
            label = (
                assignee_labels.get(key, key)
                if assignee and key != "Unassigned"
                else key
            )
            rows.append(
                {
                    "key": key,
                    "label": label,
                    **{
                        name: counts[name]
                        for name in (
                            "open_incidents",
                            "p1_p2",
                            "sla_at_risk",
                            "sla_breached",
                            "stuck",
                        )
                    },
                }
            )
        return rows

    return {
        "summary": {
            "open_incidents": len(tickets),
            "p1_p2": len(priority),
            "sla_at_risk": len(at_risk),
            "sla_breached": len(breached),
            "stuck": len(stuck),
            "unassigned": sum(
                1
                for ticket in tickets
                if not ticket.assignment_group and not ticket.assignee_id
            ),
            "active_major_incidents": sum(
                1 for ticket in tickets if ticket.is_major_incident
            ),
            "escalation_watch": len(escalation),
        },
        "priority_watch": priority,
        "sla_at_risk": at_risk,
        "sla_breached": breached,
        "stuck": stuck,
        "escalation_watch": escalation,
        "workload": {
            "by_assignment_group": dict(groups),
            "by_assignee": dict(assignees),
            "assignment_groups": workload_rows(group_detail),
            "assignees": workload_rows(assignee_detail, assignee=True),
        },
        "policy": {
            "risk_remaining_fraction": RISK_REMAINING_FRACTION,
            "idle_threshold_seconds": int(IDLE_THRESHOLD.total_seconds()),
            "escalation_note": (
                "WATCH means requires attention; no escalation was triggered."
            ),
        },
    }
