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


if __name__ == "__main__":
    unittest.main()
