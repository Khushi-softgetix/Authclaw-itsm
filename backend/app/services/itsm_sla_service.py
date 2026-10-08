"""Deterministic SLA deadline calculations for ITSM incidents."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.db.models import ITSMBusinessCalendar, ITSMSLAPolicy, ITSMTicket


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _holiday_dates(calendar: ITSMBusinessCalendar) -> set[date]:
    dates: set[date] = set()
    for item in calendar.holidays or []:
        raw = item if isinstance(item, str) else item.get("date") if isinstance(item, dict) else None
        if raw:
            try:
                dates.add(date.fromisoformat(raw))
            except ValueError:
                continue
    return dates


def _working_interval(calendar: ITSMBusinessCalendar, day: date) -> tuple[datetime, datetime] | None:
    try:
        zone = ZoneInfo(calendar.timezone or "UTC")
    except ZoneInfoNotFoundError:
        zone = timezone.utc
    if day in _holiday_dates(calendar):
        return None
    hours = (calendar.weekly_hours or {}).get(day.strftime("%A").lower())
    if not isinstance(hours, dict) or not hours.get("start") or not hours.get("end"):
        return None
    try:
        start = datetime.combine(day, time.fromisoformat(hours["start"]), zone)
        end = datetime.combine(day, time.fromisoformat(hours["end"]), zone)
    except (TypeError, ValueError):
        return None
    return (start, end) if end > start else None


def _has_working_hours(calendar: ITSMBusinessCalendar) -> bool:
    for hours in (calendar.weekly_hours or {}).values():
        if isinstance(hours, dict) and hours.get("start") and hours.get("end"):
            try:
                if time.fromisoformat(hours["end"]) > time.fromisoformat(hours["start"]):
                    return True
            except (TypeError, ValueError):
                continue
    return False


def add_business_minutes(start: datetime, minutes: int, calendar: ITSMBusinessCalendar | None) -> datetime:
    """Add policy minutes in UTC, respecting an optional tenant business calendar."""
    return _add_business_seconds(start, max(0, minutes) * 60, calendar)


def _add_business_seconds(start: datetime, seconds: float, calendar: ITSMBusinessCalendar | None) -> datetime:
    start = _utc(start)
    if not calendar:
        return start + timedelta(seconds=seconds)
    if not _has_working_hours(calendar):
        return start + timedelta(seconds=seconds)
    try:
        zone = ZoneInfo(calendar.timezone or "UTC")
    except ZoneInfoNotFoundError:
        zone = timezone.utc
    cursor = start.astimezone(zone)
    remaining = max(0, seconds)
    while remaining:
        interval = _working_interval(calendar, cursor.date())
        if interval and cursor < interval[1]:
            working_from = max(cursor, interval[0])
            available = (_utc(interval[1]) - _utc(working_from)).total_seconds()
            if available >= remaining:
                return _utc(working_from) + timedelta(seconds=remaining)
            remaining -= max(0, available)
        cursor = datetime.combine(cursor.date() + timedelta(days=1), time.min, zone)
    return cursor.astimezone(timezone.utc)


def business_seconds_between(start: datetime, end: datetime, calendar: ITSMBusinessCalendar | None) -> float:
    """Return working-time seconds between two instants (negative when overdue)."""
    start, end = _utc(start), _utc(end)
    if end < start:
        return -business_seconds_between(end, start, calendar)
    if not calendar or not _has_working_hours(calendar):
        return (end - start).total_seconds()
    try:
        zone = ZoneInfo(calendar.timezone or "UTC")
    except ZoneInfoNotFoundError:
        zone = timezone.utc
    cursor = start.astimezone(zone)
    finish = end.astimezone(zone)
    total = 0.0
    while cursor.date() <= finish.date():
        interval = _working_interval(calendar, cursor.date())
        if interval:
            left, right = max(cursor, interval[0]), min(finish, interval[1])
            if right > left:
                total += (_utc(right) - _utc(left)).total_seconds()
        cursor = datetime.combine(cursor.date() + timedelta(days=1), time.min, zone)
    return total


def apply_sla_policy(
    ticket: ITSMTicket,
    policy: ITSMSLAPolicy | None,
    started_at: datetime,
    *,
    custom_resolution_target_minutes: int | None = None,
    calendar: ITSMBusinessCalendar | None = None,
) -> None:
    ticket.sla_policy_id = policy.id if policy else None
    cal = (policy.calendar if policy else None) or calendar
    ticket.sla_response_due_at = (
        add_business_minutes(started_at, policy.response_target_minutes, cal)
        if policy and getattr(policy, "response_target_minutes", None) is not None
        else None
    )
    resolution_minutes = (
        custom_resolution_target_minutes
        if custom_resolution_target_minutes is not None and custom_resolution_target_minutes > 0
        else (policy.resolution_target_minutes if policy else None)
    )
    ticket.sla_resolution_due_at = (
        add_business_minutes(started_at, resolution_minutes, cal)
        if resolution_minutes is not None
        else None
    )
    has_active_sla = bool(ticket.sla_response_due_at or ticket.sla_resolution_due_at)
    ticket.sla_status = "WITHIN_SLA" if has_active_sla else "NO_SLA"



def pause_sla(ticket: ITSMTicket, at: datetime) -> None:
    if ticket.sla_policy_id and ticket.sla_paused_at is None and ticket.sla_resolution_met_at is None:
        ticket.sla_paused_at = _utc(at)
        ticket.sla_status = "PAUSED"


def resume_sla(ticket: ITSMTicket, at: datetime) -> None:
    if ticket.sla_paused_at is None:
        return
    paused_seconds = max(0, int((_utc(at) - _utc(ticket.sla_paused_at)).total_seconds()))
    ticket.sla_accumulated_pause_seconds = (ticket.sla_accumulated_pause_seconds or 0) + paused_seconds
    policy = getattr(ticket, "sla_policy", None)
    calendar = getattr(policy, "calendar", None) if policy else None
    for due_field, met_field in (
        ("sla_response_due_at", "sla_response_met_at"),
        ("sla_resolution_due_at", "sla_resolution_met_at"),
    ):
        due = getattr(ticket, due_field, None)
        if due and not getattr(ticket, met_field, None):
            remaining = business_seconds_between(ticket.sla_paused_at, due, calendar)
            # Pausing cannot undo a commitment already breached before the pause.
            if remaining >= 0:
                setattr(ticket, due_field, _add_business_seconds(at, remaining, calendar))
    ticket.sla_paused_at = None
    ticket.sla_status = "WITHIN_SLA"


def compute_sla_details(ticket: Any, now: datetime | None = None) -> dict[str, Any]:
    """Authoritative computation of active SLA deadline, remaining seconds,
    overdue seconds, elapsed percentage, and 3-state risk status (GREEN/AMBER/RED).

    Risk States:
    - NO_SLA: No SLA policy or deadline applied
    - PAUSED: Ticket SLA is currently paused
    - WITHIN_SLA (GREEN): Less than 75% of allowed SLA time elapsed
    - AT_RISK (AMBER): 75% or more of allowed SLA time elapsed, but not breached
    - BREACHED (RED): SLA deadline has passed
    """
    now = _utc(now or datetime.now(timezone.utc))

    # Determine if response or resolution SLA is the active deadline
    response_active = bool(
        getattr(ticket, "sla_response_due_at", None)
        and not getattr(ticket, "sla_response_met_at", None)
    )
    if response_active:
        due = _utc(ticket.sla_response_due_at)
        target_field = "response_target_minutes"
    else:
        due = _utc(getattr(ticket, "sla_resolution_due_at", None)) or (
            _utc(getattr(ticket, "sla_response_due_at", None))
        )
        target_field = "resolution_target_minutes"

    started_at = _utc(getattr(ticket, "created_at", None)) or now

    if not due:
        return {
            "status": "NO_SLA",
            "stage": "RESPONSE" if response_active else "RESOLUTION",
            "sla_due_at": None,
            "sla_started_at": started_at,
            "remaining_seconds": None,
            "elapsed_seconds": None,
            "total_target_seconds": None,
            "elapsed_fraction": None,
            "is_paused": False,
        }

    policy = getattr(ticket, "sla_policy", None)
    calendar = getattr(policy, "calendar", None) if policy else None

    # Handle pause state
    is_paused = bool(
        getattr(ticket, "sla_paused_at", None)
        or getattr(ticket, "sla_status", None) == "PAUSED"
    )
    paused_at = _utc(getattr(ticket, "sla_paused_at", None))
    effective_now = paused_at if (is_paused and paused_at) else now

    # Authoritative remaining business seconds between effective current time and deadline
    remaining = business_seconds_between(effective_now, due, calendar)

    # Determine total SLA target duration
    target_minutes = (
        getattr(policy, target_field, None)
        if policy
        else None
    )

    accum_pause = float(getattr(ticket, "sla_accumulated_pause_seconds", 0) or 0)
    if started_at and due and due > started_at:
        nominal_seconds = max(1.0, business_seconds_between(started_at, due, calendar) - accum_pause)
        if target_minutes and target_minutes > 0:
            policy_seconds = float(target_minutes * 60)
            # If the actual deadline duration differs significantly from the policy target
            # (e.g. customized fulfillment SLA from service catalog estimated delivery),
            # prioritize the actual allocated nominal target.
            if abs(policy_seconds - nominal_seconds) / max(nominal_seconds, 1.0) > 0.1:
                total_target_seconds = nominal_seconds
            else:
                total_target_seconds = policy_seconds
        else:
            total_target_seconds = nominal_seconds
    elif target_minutes and target_minutes > 0:
        total_target_seconds = float(target_minutes * 60)
    else:
        total_target_seconds = max(remaining, 1.0)


    # Calculate elapsed duration and 75% rule
    if effective_now > due or remaining < 0:
        # RED: SLA deadline has passed
        status = "BREACHED"
        elapsed_fraction = 1.0 + (abs(remaining) / total_target_seconds if total_target_seconds > 0 else 0.0)
        elapsed_seconds = total_target_seconds + abs(remaining)
    else:
        elapsed_seconds = max(0.0, total_target_seconds - remaining)
        elapsed_fraction = elapsed_seconds / total_target_seconds if total_target_seconds > 0 else 0.0

        if is_paused:
            status = "PAUSED"
        elif elapsed_fraction >= 0.75:
            # AMBER: 75% or more elapsed, but not breached
            status = "AT_RISK"
        else:
            # GREEN: Less than 75% elapsed
            status = "WITHIN_SLA"

    return {
        "status": status,
        "stage": "RESPONSE" if response_active else "RESOLUTION",
        "sla_due_at": due,
        "sla_started_at": started_at,
        "remaining_seconds": remaining,
        "elapsed_seconds": elapsed_seconds,
        "total_target_seconds": total_target_seconds,
        "elapsed_fraction": elapsed_fraction,
        "is_paused": is_paused,
    }


INELIGIBLE_ESCALATION_STATUSES = frozenset({"RESOLVED", "CLOSED", "CANCELLED"})


class SLAEscalationEvaluation:
    """Structured evaluation of a ticket's eligibility for warning and breach escalations."""

    def __init__(
        self,
        ticket_id: Any,
        tenant_id: Any,
        is_eligible_for_evaluation: bool,
        sla_status: str,
        warning_eligible: bool,
        warning_already_escalated: bool,
        breach_eligible: bool,
        breach_already_escalated: bool,
        reason: str | None = None,
        sla_details: dict[str, Any] | None = None,
    ):
        self.ticket_id = ticket_id
        self.tenant_id = tenant_id
        self.is_eligible_for_evaluation = is_eligible_for_evaluation
        self.sla_status = sla_status
        self.warning_eligible = warning_eligible
        self.warning_already_escalated = warning_already_escalated
        self.breach_eligible = breach_eligible
        self.breach_already_escalated = breach_already_escalated
        self.reason = reason
        self.sla_details = sla_details or {}

    @property
    def stage(self) -> str:
        return str(self.sla_details.get("stage") or "RESOLUTION")

    @property
    def remaining_seconds(self) -> float | None:
        return self.sla_details.get("remaining_seconds")

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "tenant_id": self.tenant_id,
            "is_eligible_for_evaluation": self.is_eligible_for_evaluation,
            "sla_status": self.sla_status,
            "warning_eligible": self.warning_eligible,
            "warning_already_escalated": self.warning_already_escalated,
            "breach_eligible": self.breach_eligible,
            "breach_already_escalated": self.breach_already_escalated,
            "reason": self.reason,
            "sla_details": self.sla_details,
        }

    def __getitem__(self, item: str) -> Any:
        return self.to_dict()[item]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def __contains__(self, key: str) -> bool:
        return key in self.to_dict()

    def __repr__(self) -> str:
        return (
            f"<SLAEscalationEvaluation ticket_id={self.ticket_id} "
            f"eligible={self.is_eligible_for_evaluation} "
            f"sla_status={self.sla_status} "
            f"warning_eligible={self.warning_eligible} "
            f"breach_eligible={self.breach_eligible}>"
        )


def evaluate_ticket_escalation(
    ticket: Any,
    now: datetime | None = None,
    tenant_id: Any | None = None,
) -> SLAEscalationEvaluation:
    """Evaluate whether an active ITSM ticket is eligible for warning or breach escalation.

    Reuses authoritative compute_sla_details() without re-calculating SLA timer arithmetic.
    Strictly enforces:
    - Exclusion of terminal/cancelled/closed tickets (RESOLVED, CLOSED, CANCELLED)
    - Exclusion of tickets without active SLA policy/deadline
    - Tenant boundary match when tenant_id is provided
    - Warning eligibility only when ticket is AT_RISK and sla_warning_escalated_at is NULL
    - Breach eligibility only when ticket is BREACHED and sla_breach_escalated_at is NULL
    - Non-firing if already escalated
    """
    ticket_id = getattr(ticket, "id", None)
    ticket_tenant_id = getattr(ticket, "tenant_id", None)
    warning_escalated = getattr(ticket, "sla_warning_escalated_at", None) is not None
    breach_escalated = getattr(ticket, "sla_breach_escalated_at", None) is not None

    # 1. Tenant boundary validation
    if tenant_id is not None and ticket_tenant_id is not None:
        if str(ticket_tenant_id) != str(tenant_id):
            return SLAEscalationEvaluation(
                ticket_id=ticket_id,
                tenant_id=ticket_tenant_id,
                is_eligible_for_evaluation=False,
                sla_status="INELIGIBLE",
                warning_eligible=False,
                warning_already_escalated=warning_escalated,
                breach_eligible=False,
                breach_already_escalated=breach_escalated,
                reason="Ticket does not belong to specified tenant",
            )

    # 2. Check ticket lifecycle state (active vs terminal)
    status_raw = getattr(ticket, "status", None)
    status_str = str(status_raw).upper().strip() if status_raw else ""
    if status_str in INELIGIBLE_ESCALATION_STATUSES:
        return SLAEscalationEvaluation(
            ticket_id=ticket_id,
            tenant_id=ticket_tenant_id,
            is_eligible_for_evaluation=False,
            sla_status="INELIGIBLE",
            warning_eligible=False,
            warning_already_escalated=warning_escalated,
            breach_eligible=False,
            breach_already_escalated=breach_escalated,
            reason=f"Ticket lifecycle status '{status_str}' is terminal/inactive",
        )

    # 3. Authoritative SLA details computation
    sla_details = compute_sla_details(ticket, now)
    sla_status = sla_details.get("status", "NO_SLA")

    # 4. Check whether SLA policy applies
    if sla_status == "NO_SLA":
        return SLAEscalationEvaluation(
            ticket_id=ticket_id,
            tenant_id=ticket_tenant_id,
            is_eligible_for_evaluation=False,
            sla_status="NO_SLA",
            warning_eligible=False,
            warning_already_escalated=warning_escalated,
            breach_eligible=False,
            breach_already_escalated=breach_escalated,
            reason="Ticket has no applicable SLA policy or deadline",
            sla_details=sla_details,
        )

    # 5. Check paused state
    if sla_details.get("is_paused") or sla_status == "PAUSED":
        return SLAEscalationEvaluation(
            ticket_id=ticket_id,
            tenant_id=ticket_tenant_id,
            is_eligible_for_evaluation=True,
            sla_status="PAUSED",
            warning_eligible=False,
            warning_already_escalated=warning_escalated,
            breach_eligible=False,
            breach_already_escalated=breach_escalated,
            reason="Ticket SLA is currently paused",
            sla_details=sla_details,
        )

    # 6. Evaluate warning and breach rules
    warning_eligible = False
    breach_eligible = False
    reason = None

    if sla_status == "BREACHED":
        if not breach_escalated:
            breach_eligible = True
            reason = "Ticket SLA is BREACHED and breach escalation has not fired"
        else:
            reason = "Ticket SLA is BREACHED but breach escalation was already recorded"
    elif sla_status == "AT_RISK":
        if not warning_escalated:
            warning_eligible = True
            reason = "Ticket is AT_RISK (>= 75% elapsed) and warning escalation has not fired"
        else:
            reason = "Ticket is AT_RISK (>= 75% elapsed) but warning escalation was already recorded"
    elif sla_status == "WITHIN_SLA":
        reason = "Ticket SLA is healthy (< 75% elapsed)"

    return SLAEscalationEvaluation(
        ticket_id=ticket_id,
        tenant_id=ticket_tenant_id,
        is_eligible_for_evaluation=True,
        sla_status=sla_status,
        warning_eligible=warning_eligible,
        warning_already_escalated=warning_escalated,
        breach_eligible=breach_eligible,
        breach_already_escalated=breach_escalated,
        reason=reason,
        sla_details=sla_details,
    )


# Alias for flexible naming
evaluate_sla_escalation = evaluate_ticket_escalation


def record_warning_escalation(ticket: Any, now: datetime | None = None) -> bool:
    """Record warning escalation timestamp on ticket if not already set.

    Returns True if timestamp was recorded, False if already present (idempotent no-op).
    Never overwrites an existing timestamp.
    """
    if getattr(ticket, "sla_warning_escalated_at", None) is not None:
        return False
    ticket.sla_warning_escalated_at = _utc(now or datetime.now(timezone.utc))
    return True


def record_breach_escalation(ticket: Any, now: datetime | None = None) -> bool:
    """Record breach escalation timestamp on ticket if not already set.

    Returns True if timestamp was recorded, False if already present (idempotent no-op).
    Never overwrites an existing timestamp.
    """
    if getattr(ticket, "sla_breach_escalated_at", None) is not None:
        return False
    ticket.sla_breach_escalated_at = _utc(now or datetime.now(timezone.utc))
    return True


def record_escalation(ticket: Any, escalation_type: str, now: datetime | None = None) -> bool:
    """Record an escalation timestamp (WARNING or BREACH) idempotently.

    Raises ValueError for unknown escalation_type.
    """
    norm = escalation_type.upper().strip()
    if norm in ("WARNING", "SLA_WARNING"):
        return record_warning_escalation(ticket, now)
    elif norm in ("BREACH", "SLA_BREACH"):
        return record_breach_escalation(ticket, now)
    else:
        raise ValueError(f"Unknown escalation type '{escalation_type}', expected 'WARNING' or 'BREACH'")
