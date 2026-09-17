"""Deterministic SLA deadline calculations for ITSM incidents."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.db.models import ITSMBusinessCalendar, ITSMSLAPolicy, ITSMTicket


def _utc(value: datetime) -> datetime:
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


def apply_sla_policy(ticket: ITSMTicket, policy: ITSMSLAPolicy | None, started_at: datetime) -> None:
    ticket.sla_policy_id = policy.id if policy else None
    ticket.sla_response_due_at = add_business_minutes(started_at, policy.response_target_minutes, policy.calendar) if policy else None
    ticket.sla_resolution_due_at = add_business_minutes(started_at, policy.resolution_target_minutes, policy.calendar) if policy else None
    ticket.sla_status = "WITHIN_SLA" if policy else "NO_SLA"


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
