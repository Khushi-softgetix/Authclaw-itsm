"""Unit tests for ITSM Real-Time SLA Countdown & 75% Risk Calculations."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest

from app.services.itsm_sla_service import (
    add_business_minutes,
    business_seconds_between,
    compute_sla_details,
    pause_sla,
    resume_sla,
)


class SLACountdownUnitTest(unittest.TestCase):
    def calendar(self):
        return SimpleNamespace(
            timezone="UTC",
            weekly_hours={
                day: {"start": "09:00", "end": "17:00"}
                for day in ("monday", "tuesday", "wednesday", "thursday", "friday")
            },
            holidays=[],
        )

    def test_sla_healthy_green_less_than_75_percent_elapsed(self):
        """Ticket at < 75% elapsed displays GREEN (WITHIN_SLA)."""
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=4)  # 4 hours total target (240m)
        now = created + timedelta(hours=1)  # 1 hour elapsed = 25% elapsed (< 75%)
        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res = compute_sla_details(ticket, now)
        self.assertEqual(res["status"], "WITHIN_SLA")
        self.assertAlmostEqual(res["elapsed_fraction"], 0.25, places=2)
        self.assertEqual(res["remaining_seconds"], 3 * 3600)

    def test_sla_warning_amber_at_75_percent_elapsed(self):
        """Ticket at exactly 75% elapsed displays AMBER (AT_RISK)."""
        # Prompt example: SLA = 2 hours, 75% elapsed = 90 minutes elapsed, 30 minutes remaining -> Amber
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        now = created + timedelta(minutes=90)
        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res = compute_sla_details(ticket, now)
        self.assertEqual(res["status"], "AT_RISK")
        self.assertAlmostEqual(res["elapsed_fraction"], 0.75, places=2)
        self.assertEqual(res["remaining_seconds"], 30 * 60)

    def test_sla_warning_amber_near_deadline(self):
        """Ticket at > 75% elapsed with very little time remaining displays AMBER."""
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        now = created + timedelta(minutes=115)  # 5 minutes remaining
        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res = compute_sla_details(ticket, now)
        self.assertEqual(res["status"], "AT_RISK")
        self.assertEqual(res["remaining_seconds"], 5 * 60)

    def test_sla_deadline_passed_red_breached(self):
        """Ticket past deadline displays RED (BREACHED)."""
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        now = due + timedelta(minutes=12)  # 12 minutes overdue
        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res = compute_sla_details(ticket, now)
        self.assertEqual(res["status"], "BREACHED")
        self.assertLess(res["remaining_seconds"], 0)
        self.assertEqual(abs(res["remaining_seconds"]), 12 * 60)

    def test_sla_no_policy_neutral(self):
        """Ticket with no SLA deadline returns NO_SLA."""
        ticket = SimpleNamespace(
            created_at=datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc),
            sla_resolution_due_at=None,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="NO_SLA",
            sla_policy=None,
        )
        res = compute_sla_details(ticket)
        self.assertEqual(res["status"], "NO_SLA")
        self.assertIsNone(res["remaining_seconds"])
        self.assertIsNone(res["sla_due_at"])

    def test_sla_with_business_calendar(self):
        """Countdown respects business calendar working hours."""
        cal = self.calendar()
        # Friday at 16:00 (1 hour before close at 17:00) with 2 hour SLA
        start = datetime(2026, 1, 2, 16, 0, tzinfo=timezone.utc)  # Friday
        due = add_business_minutes(start, 120, cal)
        # Should be Monday 10:00 (1 hour remaining on Monday morning)
        self.assertEqual(due, datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc))

        ticket = SimpleNamespace(
            created_at=start,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=SimpleNamespace(calendar=cal, resolution_target_minutes=120),
        )
        # On Saturday (outside working hours), remaining business time is still 1 hour (3600s)
        saturday = datetime(2026, 1, 3, 12, 0, tzinfo=timezone.utc)
        res = compute_sla_details(ticket, saturday)
        self.assertEqual(res["remaining_seconds"], 3600)
        # 1 hour remaining out of 2 hour target = 50% elapsed -> WITHIN_SLA
        self.assertEqual(res["status"], "WITHIN_SLA")

    def test_sla_paused_state(self):
        """Paused ticket freezes remaining time at the paused timestamp."""
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        paused_at = created + timedelta(minutes=30)  # Paused after 30 mins (90 mins left)
        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_paused_at=paused_at,
            sla_status="PAUSED",
            sla_policy=None,
        )
        # Even if now is 3 hours later, paused state preserves remaining time at pause point
        now = created + timedelta(hours=3)
        res = compute_sla_details(ticket, now)
        self.assertTrue(res["is_paused"])
        self.assertEqual(res["status"], "PAUSED")
        self.assertEqual(res["remaining_seconds"], 90 * 60)

    def test_response_vs_resolution_active_deadline(self):
        """Active deadline uses response SLA first, then resolution SLA after response met."""
        created = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        resp_due = created + timedelta(minutes=30)
        resol_due = created + timedelta(hours=4)

        # Response pending
        ticket1 = SimpleNamespace(
            created_at=created,
            sla_response_due_at=resp_due,
            sla_response_met_at=None,
            sla_resolution_due_at=resol_due,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res1 = compute_sla_details(ticket1, created + timedelta(minutes=10))
        self.assertEqual(res1["sla_due_at"], resp_due)
        self.assertEqual(res1["remaining_seconds"], 20 * 60)

        # Response met
        ticket2 = SimpleNamespace(
            created_at=created,
            sla_response_due_at=resp_due,
            sla_response_met_at=created + timedelta(minutes=15),
            sla_resolution_due_at=resol_due,
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )
        res2 = compute_sla_details(ticket2, created + timedelta(minutes=15))
        self.assertEqual(res2["sla_due_at"], resol_due)
        self.assertEqual(res2["remaining_seconds"], 225 * 60)

    def test_sla_resolved_early_freezes_countdown_and_calculates_remaining(self):
        """Prompt Example: Resolution SLA = 1h 55m; ticket resolved after 15m 30s.
        Remaining time is 1h 39m 30s (5970s), status is WITHIN_SLA, and values are frozen.
        """
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        target_minutes = 115  # 1h 55m = 6900s
        due = created + timedelta(minutes=target_minutes)
        resolved_at = created + timedelta(minutes=15, seconds=30)  # 15m 30s elapsed = 930s

        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_response_met_at=None,
            sla_resolution_met_at=resolved_at,
            resolved_at=resolved_at,
            status="RESOLVED",
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )

        # 1. At resolution instant
        res_at_res = compute_sla_details(ticket, now=resolved_at)
        self.assertTrue(res_at_res["is_completed"])
        self.assertTrue(res_at_res["is_resolved"])
        self.assertEqual(res_at_res["status"], "WITHIN_SLA")
        self.assertEqual(res_at_res["remaining_seconds"], 5970)  # 1h 39m 30s
        self.assertEqual(res_at_res["elapsed_seconds"], 930)  # 15m 30s

        # 2. Hours later (simulating page reload, API refresh, worker sweep)
        future_now = created + timedelta(hours=5)
        res_future = compute_sla_details(ticket, now=future_now)
        # Must NOT continue counting down; must remain identical to resolution instant
        self.assertEqual(res_future["status"], "WITHIN_SLA")
        self.assertEqual(res_future["remaining_seconds"], 5970)
        self.assertEqual(res_future["elapsed_seconds"], 930)
        self.assertEqual(res_future["completed_at"], resolved_at)

    def test_sla_resolved_exactly_at_deadline(self):
        """Ticket resolved exactly at the deadline meets SLA with 0 remaining seconds."""
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        resolved_at = due

        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_response_met_at=None,
            sla_resolution_met_at=resolved_at,
            resolved_at=resolved_at,
            status="RESOLVED",
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )

        res = compute_sla_details(ticket, now=created + timedelta(hours=5))
        self.assertEqual(res["status"], "WITHIN_SLA")
        self.assertEqual(res["remaining_seconds"], 0)
        self.assertEqual(res["elapsed_seconds"], 7200)

    def test_sla_resolved_after_deadline_breached(self):
        """Ticket resolved after the deadline is BREACHED and freezes overdue seconds."""
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=1)
        resolved_at = due + timedelta(minutes=10)  # 10 minutes overdue

        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_response_met_at=None,
            sla_resolution_met_at=resolved_at,
            resolved_at=resolved_at,
            status="RESOLVED",
            sla_paused_at=None,
            sla_status="BREACHED",
            sla_policy=None,
        )

        res = compute_sla_details(ticket, now=created + timedelta(hours=4))
        self.assertEqual(res["status"], "BREACHED")
        self.assertEqual(res["remaining_seconds"], -600)  # 10 minutes overdue
        self.assertEqual(res["elapsed_seconds"], 3600 + 600)

    def test_sla_breach_before_resolution_preserves_breach_history(self):
        """Legitimate breach recorded before resolution is preserved upon resolution."""
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=1)
        breached_at = due + timedelta(minutes=5)
        resolved_at = due + timedelta(minutes=20)

        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_response_met_at=None,
            sla_breach_escalated_at=breached_at,
            sla_resolution_met_at=resolved_at,
            resolved_at=resolved_at,
            status="RESOLVED",
            sla_paused_at=None,
            sla_status="BREACHED",
            sla_policy=None,
        )

        res = compute_sla_details(ticket, now=created + timedelta(hours=3))
        self.assertEqual(res["status"], "BREACHED")

    def test_sla_closed_directly_stops_clock_at_closed_at(self):
        """A ticket closed directly without being marked RESOLVED stops SLA at closed_at."""
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=2)
        closed_at = created + timedelta(minutes=40)

        ticket = SimpleNamespace(
            created_at=created,
            sla_resolution_due_at=due,
            sla_response_due_at=None,
            sla_response_met_at=None,
            sla_resolution_met_at=None,
            resolved_at=None,
            closed_at=closed_at,
            status="CLOSED",
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )

        res = compute_sla_details(ticket, now=created + timedelta(hours=6))
        self.assertTrue(res["is_completed"])
        self.assertTrue(res["is_closed"])
        self.assertEqual(res["status"], "WITHIN_SLA")
        self.assertEqual(res["remaining_seconds"], 80 * 60)
        self.assertEqual(res["elapsed_seconds"], 40 * 60)

    def test_response_and_resolution_sla_stop_independently(self):
        """Response SLA and Resolution SLA stop independently at their respective events."""
        created = datetime(2026, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        resp_due = created + timedelta(minutes=30)
        resol_due = created + timedelta(hours=4)

        # 1. Ticket in progress: response SLA met at 10m
        resp_met_at = created + timedelta(minutes=10)
        ticket = SimpleNamespace(
            created_at=created,
            sla_response_due_at=resp_due,
            sla_response_met_at=resp_met_at,
            sla_resolution_due_at=resol_due,
            sla_resolution_met_at=None,
            resolved_at=None,
            status="IN_PROGRESS",
            sla_paused_at=None,
            sla_status="WITHIN_SLA",
            sla_policy=None,
        )

        # Active SLA is now resolution SLA, which is still running
        res1 = compute_sla_details(ticket, now=created + timedelta(minutes=20))
        self.assertEqual(res1["stage"], "RESOLUTION")
        self.assertFalse(res1["is_completed"])
        self.assertEqual(res1["remaining_seconds"], 220 * 60)

        # 2. Later, ticket is resolved at 45m
        resol_met_at = created + timedelta(minutes=45)
        ticket.resolved_at = resol_met_at
        ticket.sla_resolution_met_at = resol_met_at
        ticket.status = "RESOLVED"

        res2 = compute_sla_details(ticket, now=created + timedelta(hours=2))
        self.assertTrue(res2["is_completed"])
        self.assertEqual(res2["stage"], "RESOLUTION")
        self.assertEqual(res2["remaining_seconds"], 195 * 60)  # 240 - 45 = 195m remaining
        self.assertEqual(res2["elapsed_seconds"], 45 * 60)


if __name__ == "__main__":
    unittest.main()
