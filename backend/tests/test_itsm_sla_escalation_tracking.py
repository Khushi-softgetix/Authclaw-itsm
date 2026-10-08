"""Focused tests for SLA-003 Escalation Tracking Foundation (Phase 1).

Validates:
1. Both escalation timestamp fields exist on ITSMTicket.
2. Both fields default to None / NULL.
3. Existing tickets remain valid with NULL values.
4. Warning timestamp can be stored, reloaded, and persisted.
5. Breach timestamp can be stored, reloaded, and persisted.
6. Existing SLA calculations (compute_sla_details) remain completely unaffected.
7. IncidentResponse and ServiceRequestResponse schemas safely expose both fields.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
import unittest
from uuid import uuid4

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, ITSMTicket, ITSMSLAPolicy, ITSMBusinessCalendar
from app.schemas.itsm_incidents import IncidentResponse
from app.schemas.itsm_requests import ServiceRequestResponse
from app.services.itsm_sla_service import (
    compute_sla_details,
    evaluate_ticket_escalation,
    evaluate_sla_escalation,
    record_warning_escalation,
    record_breach_escalation,
    record_escalation,
)


class TestSLAEscalationTrackingFoundation(unittest.TestCase):
    """Test suite proving SLA-003 escalation tracking foundation."""

    def test_fields_exist_on_itsmticket_model(self):
        """1. Both fields exist on ITSMTicket with nullable DateTime type."""
        self.assertTrue(hasattr(ITSMTicket, "sla_warning_escalated_at"))
        self.assertTrue(hasattr(ITSMTicket, "sla_breach_escalated_at"))

        warning_col = ITSMTicket.__table__.columns.get("sla_warning_escalated_at")
        breach_col = ITSMTicket.__table__.columns.get("sla_breach_escalated_at")

        self.assertIsNotNone(warning_col, "Column sla_warning_escalated_at must exist in table")
        self.assertIsNotNone(breach_col, "Column sla_breach_escalated_at must exist in table")

        self.assertIsInstance(warning_col.type, DateTime)
        self.assertIsInstance(breach_col.type, DateTime)

        self.assertTrue(warning_col.nullable, "sla_warning_escalated_at must be nullable")
        self.assertTrue(breach_col.nullable, "sla_breach_escalated_at must be nullable")

    def test_fields_default_to_null(self):
        """2. Both fields default to None (NULL) on new ticket instances."""
        ticket = ITSMTicket(
            tenant_id=uuid4(),
            ticket_number="INC-10001",
            title="Database Latency Spike",
            description="Testing SLA escalation default values",
            requester_id=uuid4(),
        )
        self.assertIsNone(ticket.sla_warning_escalated_at)
        self.assertIsNone(ticket.sla_breach_escalated_at)

    def test_existing_ticket_retains_null_values(self):
        """3. An existing ticket retains None (NULL) values without error."""
        ticket = ITSMTicket(
            id=uuid4(),
            tenant_id=uuid4(),
            ticket_number="INC-9999",
            ticket_type="INCIDENT",
            title="Pre-existing Incident",
            description="Ticket created prior to escalation tracking",
            requester_id=uuid4(),
            sla_status="WITHIN_SLA",
            sla_resolution_due_at=datetime.now(timezone.utc) + timedelta(hours=2),
        )
        self.assertIsNone(ticket.sla_warning_escalated_at)
        self.assertIsNone(ticket.sla_breach_escalated_at)

    def test_warning_and_breach_persistence_in_database(self):
        """4 & 5. Warning and breach timestamps can be stored, committed, and reloaded."""
        # Use an in-memory SQLite database to test database storage and reload
        engine = create_engine("sqlite:///:memory:")
        # Create only the required tables (avoid postgres-specific types in other models)
        ITSMTicket.__table__.create(bind=engine)

        Session = sessionmaker(bind=engine)
        session = Session()

        tenant_id = uuid4()
        requester_id = uuid4()
        ticket_id = uuid4()

        # Step 1: Create an existing ticket with NULL escalation timestamps
        ticket = ITSMTicket(
            id=ticket_id,
            tenant_id=tenant_id,
            ticket_number="INC-20001",
            ticket_type="INCIDENT",
            title="Production API Error Rate",
            description="Investigate 500 errors on payments",
            requester_id=requester_id,
            sla_status="WITHIN_SLA",
        )
        session.add(ticket)
        session.commit()
        session.close()

        # Step 2: Reload and verify initial values are NULL
        session = Session()
        reloaded = session.query(ITSMTicket).filter_by(id=ticket_id).one()
        self.assertIsNone(reloaded.sla_warning_escalated_at)
        self.assertIsNone(reloaded.sla_breach_escalated_at)

        # Step 3: Store warning escalation timestamp
        warning_time = datetime(2026, 10, 5, 12, 30, 0, tzinfo=timezone.utc)
        reloaded.sla_warning_escalated_at = warning_time
        session.commit()
        session.close()

        # Step 4: Reload and verify warning escalation persists
        session = Session()
        reloaded = session.query(ITSMTicket).filter_by(id=ticket_id).one()
        self.assertIsNotNone(reloaded.sla_warning_escalated_at)
        # SQLite drops tzinfo, so compare timestamps
        self.assertEqual(
            reloaded.sla_warning_escalated_at.replace(tzinfo=timezone.utc),
            warning_time,
        )
        self.assertIsNone(reloaded.sla_breach_escalated_at)

        # Step 5: Store breach escalation timestamp
        breach_time = datetime(2026, 10, 5, 13, 15, 0, tzinfo=timezone.utc)
        reloaded.sla_breach_escalated_at = breach_time
        session.commit()
        session.close()

        # Step 6: Reload and verify breach escalation persists alongside warning
        session = Session()
        reloaded = session.query(ITSMTicket).filter_by(id=ticket_id).one()
        self.assertEqual(
            reloaded.sla_warning_escalated_at.replace(tzinfo=timezone.utc),
            warning_time,
        )
        self.assertEqual(
            reloaded.sla_breach_escalated_at.replace(tzinfo=timezone.utc),
            breach_time,
        )
        session.close()

    def test_existing_sla_countdown_calculations_unaffected(self):
        """6. Escalation tracking fields do not alter compute_sla_details calculation."""
        created = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)
        due = created + timedelta(hours=4)
        now = created + timedelta(hours=3)  # exactly 75% elapsed -> AT_RISK

        # Ticket with escalation fields set to None
        ticket_clean = ITSMTicket(
            id=uuid4(),
            tenant_id=uuid4(),
            ticket_number="INC-30001",
            title="Clean Ticket",
            description="Testing SLA calculation",
            requester_id=uuid4(),
            created_at=created,
            sla_resolution_due_at=due,
            sla_status="WITHIN_SLA",
            sla_warning_escalated_at=None,
            sla_breach_escalated_at=None,
        )

        res_clean = compute_sla_details(ticket_clean, now)

        # Ticket with warning timestamp recorded
        ticket_warned = ITSMTicket(
            id=uuid4(),
            tenant_id=uuid4(),
            ticket_number="INC-30002",
            title="Warned Ticket",
            description="Testing SLA calculation with warning timestamp set",
            requester_id=uuid4(),
            created_at=created,
            sla_resolution_due_at=due,
            sla_status="WITHIN_SLA",
            sla_warning_escalated_at=datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc),
            sla_breach_escalated_at=None,
        )

        res_warned = compute_sla_details(ticket_warned, now)

        # Calculations must match exactly
        self.assertEqual(res_clean["status"], res_warned["status"])
        self.assertEqual(res_clean["remaining_seconds"], res_warned["remaining_seconds"])
        self.assertEqual(res_clean["elapsed_fraction"], res_warned["elapsed_fraction"])
        self.assertEqual(res_warned["status"], "AT_RISK")

    def test_response_schemas_expose_fields(self):
        """7. IncidentResponse and ServiceRequestResponse schemas safely expose optional fields."""
        # IncidentResponse fields
        self.assertIn("sla_warning_escalated_at", IncidentResponse.model_fields)
        self.assertIn("sla_breach_escalated_at", IncidentResponse.model_fields)
        self.assertIsNone(IncidentResponse.model_fields["sla_warning_escalated_at"].default)
        self.assertIsNone(IncidentResponse.model_fields["sla_breach_escalated_at"].default)

        # ServiceRequestResponse fields
        self.assertIn("sla_warning_escalated_at", ServiceRequestResponse.model_fields)
        self.assertIn("sla_breach_escalated_at", ServiceRequestResponse.model_fields)
        self.assertIsNone(ServiceRequestResponse.model_fields["sla_warning_escalated_at"].default)
        self.assertIsNone(ServiceRequestResponse.model_fields["sla_breach_escalated_at"].default)


class TestSLAEscalationDetectionAndEvaluation(unittest.TestCase):
    """Phase 2 Test Suite: SLA-003 Escalation Detection, Evaluation & Idempotency."""

    def setUp(self):
        self.tenant_id = uuid4()
        self.created_at = datetime(2026, 10, 5, 10, 0, 0, tzinfo=timezone.utc)
        self.due_at = self.created_at + timedelta(hours=4)  # 4 hours target = 240 mins

    def _make_ticket(
        self,
        status: str = "IN_PROGRESS",
        warning_at: datetime | None = None,
        breach_at: datetime | None = None,
        tenant_id: Any | None = None,
        sla_resolution_due_at: datetime | None = ...,
    ):
        return ITSMTicket(
            id=uuid4(),
            tenant_id=tenant_id or self.tenant_id,
            ticket_number="INC-50001",
            ticket_type="INCIDENT",
            title="Service API degradation",
            description="Testing SLA escalation detection",
            requester_id=uuid4(),
            status=status,
            created_at=self.created_at,
            sla_resolution_due_at=self.due_at if sla_resolution_due_at is ... else sla_resolution_due_at,
            sla_status="WITHIN_SLA",
            sla_warning_escalated_at=warning_at,
            sla_breach_escalated_at=breach_at,
        )

    def test_a_ticket_below_75_percent_no_warning_no_breach(self):
        """A. Ticket below 75% elapsed has NO warning escalation and NO breach escalation."""
        ticket = self._make_ticket()
        # 1 hour elapsed out of 4 = 25% elapsed (< 75%)
        now = self.created_at + timedelta(hours=1)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "WITHIN_SLA")
        self.assertFalse(eval_res.warning_eligible)
        self.assertFalse(eval_res.warning_already_escalated)
        self.assertFalse(eval_res.breach_eligible)
        self.assertFalse(eval_res.breach_already_escalated)

    def test_b_ticket_at_or_above_75_percent_warning_eligible_when_null(self):
        """B. Ticket at/above 75% but not breached is warning eligible when warning timestamp is NULL."""
        ticket = self._make_ticket(warning_at=None)
        # Exactly 3 hours elapsed out of 4 = 75% elapsed -> AT_RISK
        now = self.created_at + timedelta(hours=3)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "AT_RISK")
        self.assertTrue(eval_res.warning_eligible)
        self.assertFalse(eval_res.warning_already_escalated)
        self.assertFalse(eval_res.breach_eligible)
        self.assertFalse(eval_res.breach_already_escalated)

        # Dictionary access compatibility
        self.assertTrue(eval_res["warning_eligible"])
        self.assertEqual(eval_res.get("sla_status"), "AT_RISK")

    def test_c_warning_already_escalated_not_eligible_again_and_timestamp_preserved(self):
        """C. When warning is already escalated: not eligible again and existing timestamp remains unchanged."""
        existing_warning_at = datetime(2026, 10, 5, 13, 0, 0, tzinfo=timezone.utc)
        ticket = self._make_ticket(warning_at=existing_warning_at)
        now = self.created_at + timedelta(hours=3, minutes=30)  # 87.5% elapsed

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "AT_RISK")
        self.assertFalse(eval_res.warning_eligible, "Must NOT be eligible again once escalated")
        self.assertTrue(eval_res.warning_already_escalated)
        self.assertFalse(eval_res.breach_eligible)

        # Verify idempotency of recording helper: does not overwrite existing timestamp
        newer_time = now
        recorded = record_warning_escalation(ticket, now=newer_time)
        self.assertFalse(recorded, "record_warning_escalation must return False when already set")
        self.assertEqual(ticket.sla_warning_escalated_at, existing_warning_at, "Timestamp must not be overwritten")

        # Also verify generic record_escalation
        generic_rec = record_escalation(ticket, "WARNING", now=newer_time)
        self.assertFalse(generic_rec)
        self.assertEqual(ticket.sla_warning_escalated_at, existing_warning_at)

    def test_d_breached_ticket_breach_eligible_when_null(self):
        """D. Breached ticket is eligible for breach escalation when breach timestamp is NULL."""
        ticket = self._make_ticket(warning_at=datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc), breach_at=None)
        # 4 hours + 5 minutes elapsed -> BREACHED
        now = self.due_at + timedelta(minutes=5)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "BREACHED")
        self.assertFalse(eval_res.warning_eligible, "Warning should not trigger on breach")
        self.assertTrue(eval_res.breach_eligible, "Breach escalation must be eligible")
        self.assertFalse(eval_res.breach_already_escalated)

        # Test recording breach escalation
        recorded = record_breach_escalation(ticket, now=now)
        self.assertTrue(recorded)
        self.assertEqual(ticket.sla_breach_escalated_at, now)

    def test_e_breach_already_escalated_not_eligible_again_and_timestamp_preserved(self):
        """E. When breach is already escalated: not eligible again and existing timestamp remains unchanged."""
        existing_breach_at = datetime(2026, 10, 5, 14, 5, 0, tzinfo=timezone.utc)
        ticket = self._make_ticket(
            warning_at=datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc),
            breach_at=existing_breach_at,
        )
        now = self.due_at + timedelta(hours=1)  # Even further past deadline

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "BREACHED")
        self.assertFalse(eval_res.breach_eligible, "Must NOT be eligible again once breach is escalated")
        self.assertTrue(eval_res.breach_already_escalated)

        # Verify idempotency: does not overwrite existing breach timestamp
        recorded = record_breach_escalation(ticket, now=now)
        self.assertFalse(recorded)
        self.assertEqual(ticket.sla_breach_escalated_at, existing_breach_at)

        # Verify generic record_escalation
        generic_rec = record_escalation(ticket, "BREACH", now=now)
        self.assertFalse(generic_rec)
        self.assertEqual(ticket.sla_breach_escalated_at, existing_breach_at)

    def test_f_closed_cancelled_resolved_tickets_not_evaluated(self):
        """F. Closed, cancelled, and resolved tickets are excluded from evaluation."""
        now = self.due_at + timedelta(hours=1)

        for terminal_status in ("RESOLVED", "CLOSED", "CANCELLED", "resolved", "Closed"):
            ticket = self._make_ticket(status=terminal_status)
            eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)

            self.assertFalse(
                eval_res.is_eligible_for_evaluation,
                f"Status {terminal_status} must be ineligible for evaluation",
            )
            self.assertEqual(eval_res.sla_status, "INELIGIBLE")
            self.assertFalse(eval_res.warning_eligible)
            self.assertFalse(eval_res.breach_eligible)
            self.assertIn("terminal/inactive", eval_res.reason)

    def test_f2_cross_tenant_ticket_rejected(self):
        """F2. Tickets belonging to a different tenant are ineligible."""
        different_tenant = uuid4()
        ticket = self._make_ticket(tenant_id=different_tenant)
        now = self.created_at + timedelta(hours=3)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)
        self.assertFalse(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "INELIGIBLE")
        self.assertFalse(eval_res.warning_eligible)
        self.assertFalse(eval_res.breach_eligible)
        self.assertIn("tenant", eval_res.reason)

    def test_f3_ticket_without_sla_ineligible(self):
        """F3. Tickets with no SLA target/deadline are not eligible."""
        ticket = self._make_ticket(sla_resolution_due_at=None)
        ticket.sla_response_due_at = None
        now = self.created_at + timedelta(hours=1)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)
        self.assertFalse(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "NO_SLA")
        self.assertFalse(eval_res.warning_eligible)
        self.assertFalse(eval_res.breach_eligible)

    def test_f4_paused_ticket_not_eligible_for_escalation(self):
        """F4. Tickets whose SLA is paused do not trigger warning or breach escalation."""
        ticket = self._make_ticket()
        ticket.sla_status = "PAUSED"
        ticket.sla_paused_at = self.created_at + timedelta(hours=3, minutes=30)
        now = self.due_at + timedelta(hours=1)

        eval_res = evaluate_ticket_escalation(ticket, now=now, tenant_id=self.tenant_id)
        self.assertTrue(eval_res.is_eligible_for_evaluation)
        self.assertEqual(eval_res.sla_status, "PAUSED")
        self.assertFalse(eval_res.warning_eligible)
        self.assertFalse(eval_res.breach_eligible)
        self.assertIn("paused", eval_res.reason)


if __name__ == "__main__":
    unittest.main()

