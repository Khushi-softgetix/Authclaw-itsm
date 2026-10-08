"""Focused test suite for SLA-003 Background Escalation Worker (Phase 3).

Covers:
A. Worker finds an eligible warning ticket and records warning timestamp.
B. Worker finds an eligible breached ticket and records breach timestamp.
C. Already-escalated warning ticket is not recorded again.
D. Already-escalated breach ticket is not recorded again.
E. Non-eligible tickets are ignored:
   - WITHIN_SLA (< 75% elapsed)
   - Terminal tickets (RESOLVED, CLOSED, CANCELLED)
   - Paused tickets
   - NO_SLA tickets
F. Multiple tickets can be processed in one worker run.
G. One ticket failure does not stop processing of subsequent tickets.
H. Tenant isolation is preserved.
I. Worker configuration and lifecycle helpers.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any
import unittest
from unittest.mock import patch, MagicMock
from uuid import UUID, uuid4

from sqlalchemy import ARRAY, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"

from app.db.models import (
    ITSMTeam,
    ITSMTeamMember,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    Notification,
    User,
)
from app.services.itsm_sla_worker import (
    dispatch_escalation_actions,
    enabled,
    get_candidate_tickets_query,
    get_worker_interval,
    process_ticket_escalation,
    process_tenant_escalations,
    resolve_escalation_recipients,
    sweep,
)


class TestSLAEscalationWorker(unittest.TestCase):
    """Test suite proving SLA-003 background worker behavior."""

    def setUp(self):
        # Create an isolated in-memory SQLite database per test
        self.engine = create_engine("sqlite:///:memory:")
        for tbl in (ITSMTicket, Notification, ITSMTicketActivity, ITSMTeam, ITSMTeamMember, ITSMUserAccess, User):
            tbl.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()

        self.tenant_a = uuid4()
        self.tenant_b = uuid4()
        self.created_at = datetime(2026, 10, 5, 10, 0, 0, tzinfo=timezone.utc)
        self.due_at = self.created_at + timedelta(hours=4)  # 4 hours SLA target

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _create_user(self, tenant_id: Any, email: str, is_active: bool = True) -> User:
        user = User(
            id=uuid4(),
            tenant_id=tenant_id,
            email=email,
            is_active=is_active,
        )
        self.db.add(user)
        self.db.commit()
        return user

    def _assign_incident_manager(self, tenant_id: Any, user_id: Any) -> ITSMUserAccess:
        access = ITSMUserAccess(
            tenant_id=tenant_id,
            user_id=user_id,
            itsm_role="INCIDENT_MANAGER",
            has_itsm_access=True,
        )
        self.db.add(access)
        self.db.commit()
        return access

    def _create_team_with_member(self, tenant_id: Any, team_name: str, user_id: Any) -> tuple[ITSMTeam, ITSMTeamMember]:
        team = ITSMTeam(
            id=uuid4(),
            tenant_id=tenant_id,
            name=team_name,
            is_active=True,
        )
        self.db.add(team)
        self.db.commit()
        member = ITSMTeamMember(
            id=uuid4(),
            tenant_id=tenant_id,
            team_id=team.id,
            user_id=user_id,
        )
        self.db.add(member)
        self.db.commit()
        return team, member

    def _create_ticket(
        self,
        tenant_id: Any | None = None,
        status: str = "IN_PROGRESS",
        created_at: datetime | None = None,
        due_at: datetime | None = ...,
        warning_at: datetime | None = None,
        breach_at: datetime | None = None,
        paused: bool = False,
    ) -> ITSMTicket:
        ticket = ITSMTicket(
            id=uuid4(),
            tenant_id=tenant_id or self.tenant_a,
            ticket_number=f"INC-{uuid4().hex[:6].upper()}",
            ticket_type="INCIDENT",
            title="Database performance degradation",
            description="Testing SLA worker escalation sweep",
            requester_id=uuid4(),
            status="PAUSED" if paused else status,
            created_at=created_at or self.created_at,
            sla_resolution_due_at=self.due_at if due_at is ... else due_at,
            sla_status="PAUSED" if paused else "WITHIN_SLA",
            sla_paused_at=(self.created_at + timedelta(hours=1)) if paused else None,
            sla_warning_escalated_at=warning_at,
            sla_breach_escalated_at=breach_at,
        )
        self.db.add(ticket)
        self.db.commit()
        return ticket

    def test_a_worker_records_warning_timestamp_for_eligible_ticket(self):
        """A. Worker finds an eligible warning ticket (>= 75% elapsed) and records warning timestamp."""
        ticket = self._create_ticket()
        # 3 hours elapsed out of 4 = 75% elapsed -> AT_RISK
        now = self.created_at + timedelta(hours=3)

        result = sweep(self.db, now=now)

        self.assertEqual(result["candidates_evaluated"], 1)
        self.assertEqual(result["warnings_escalated"], 1)
        self.assertEqual(result["breaches_escalated"], 0)

        # Reload ticket from database
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_warning_escalated_at)
        self.assertIsNone(ticket.sla_breach_escalated_at)

    def test_b_worker_records_breach_timestamp_for_eligible_ticket(self):
        """B. Worker finds an eligible breached ticket and records breach timestamp."""
        warning_time = datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc)
        ticket = self._create_ticket(warning_at=warning_time)
        # Past deadline -> BREACHED
        now = self.due_at + timedelta(minutes=15)

        result = sweep(self.db, now=now)

        self.assertEqual(result["candidates_evaluated"], 1)
        self.assertEqual(result["warnings_escalated"], 0)
        self.assertEqual(result["breaches_escalated"], 1)

        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_breach_escalated_at)
        # Warning timestamp preserved as original
        self.assertEqual(
            ticket.sla_warning_escalated_at.replace(tzinfo=timezone.utc),
            warning_time,
        )

    def test_c_already_escalated_warning_ticket_not_recorded_again(self):
        """C. Already-escalated warning ticket is not recorded again and timestamp is unchanged."""
        original_warning_time = datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc)
        ticket = self._create_ticket(warning_at=original_warning_time)
        now = self.created_at + timedelta(hours=3, minutes=30)  # still at-risk, not breached

        result = sweep(self.db, now=now)

        self.assertEqual(result["warnings_escalated"], 0)
        self.assertEqual(result["breaches_escalated"], 0)

        self.db.refresh(ticket)
        self.assertEqual(
            ticket.sla_warning_escalated_at.replace(tzinfo=timezone.utc),
            original_warning_time,
        )

    def test_d_already_escalated_breach_ticket_not_recorded_again(self):
        """D. Already-escalated breach ticket is not recorded again and timestamp is unchanged."""
        original_warning_time = datetime(2026, 10, 5, 13, 0, tzinfo=timezone.utc)
        original_breach_time = datetime(2026, 10, 5, 14, 5, tzinfo=timezone.utc)
        ticket = self._create_ticket(
            warning_at=original_warning_time,
            breach_at=original_breach_time,
        )
        now = self.due_at + timedelta(hours=2)

        # Candidate query should exclude tickets where BOTH warning and breach are already escalated
        candidates = get_candidate_tickets_query(self.db, tenant_id=self.tenant_a).all()
        self.assertEqual(len(candidates), 0)

        result = sweep(self.db, now=now)
        self.assertEqual(result["warnings_escalated"], 0)
        self.assertEqual(result["breaches_escalated"], 0)

        self.db.refresh(ticket)
        self.assertEqual(
            ticket.sla_breach_escalated_at.replace(tzinfo=timezone.utc),
            original_breach_time,
        )

    def test_e_non_eligible_tickets_are_ignored(self):
        """E. Non-eligible tickets are ignored: WITHIN_SLA, terminal, paused, NO_SLA."""
        now = self.created_at + timedelta(hours=1)  # 25% elapsed

        # 1. WITHIN_SLA (< 75% elapsed)
        t_within = self._create_ticket()

        # 2. Terminal statuses
        t_resolved = self._create_ticket(status="RESOLVED", due_at=self.created_at - timedelta(hours=1))
        t_closed = self._create_ticket(status="CLOSED", due_at=self.created_at - timedelta(hours=1))
        t_cancelled = self._create_ticket(status="CANCELLED", due_at=self.created_at - timedelta(hours=1))

        # 3. Paused ticket
        t_paused = self._create_ticket(paused=True, due_at=self.created_at + timedelta(hours=2))

        # 4. NO_SLA ticket (no resolution or response due date)
        t_no_sla = self._create_ticket(due_at=None)

        result = sweep(self.db, now=now)

        self.assertEqual(result["warnings_escalated"], 0)
        self.assertEqual(result["breaches_escalated"], 0)

        for t in (t_within, t_resolved, t_closed, t_cancelled, t_paused, t_no_sla):
            self.db.refresh(t)
            self.assertIsNone(t.sla_warning_escalated_at)
            self.assertIsNone(t.sla_breach_escalated_at)

    def test_f_multiple_tickets_processed_in_one_run(self):
        """F. Multiple tickets with different statuses can be processed in a single worker run."""
        now = self.created_at + timedelta(hours=3, minutes=10)

        # Ticket 1: 75%+ elapsed -> should trigger warning
        t1 = self._create_ticket()

        # Ticket 2: Breached -> should trigger breach
        t2 = self._create_ticket(due_at=self.created_at + timedelta(hours=2))

        # Ticket 3: Healthy (created 10 mins ago, due in 4 hours) -> no escalation
        t3 = self._create_ticket(created_at=now - timedelta(minutes=10), due_at=now + timedelta(hours=4))

        result = sweep(self.db, now=now)

        self.assertEqual(result["warnings_escalated"], 1)
        self.assertEqual(result["breaches_escalated"], 1)

        self.db.refresh(t1)
        self.db.refresh(t2)
        self.db.refresh(t3)

        self.assertIsNotNone(t1.sla_warning_escalated_at)
        self.assertIsNone(t1.sla_breach_escalated_at)

        self.assertIsNotNone(t2.sla_breach_escalated_at)

        self.assertIsNone(t3.sla_warning_escalated_at)
        self.assertIsNone(t3.sla_breach_escalated_at)

    def test_g_one_ticket_failure_does_not_abort_subsequent_tickets(self):
        """G. An exception on one ticket does not halt processing of other tickets."""
        now = self.created_at + timedelta(hours=3, minutes=10)

        t_bad = self._create_ticket()
        t_good = self._create_ticket()

        original_process = process_ticket_escalation

        def faulty_process(ticket, db, now=None):
            if ticket.id == t_bad.id:
                raise RuntimeError("Simulated transient processing error on bad ticket")
            return original_process(ticket, db, now=now)

        with patch("app.services.itsm_sla_worker.process_ticket_escalation", side_effect=faulty_process):
            stats = process_tenant_escalations(self.db, tenant_id=self.tenant_a, now=now)

        self.assertEqual(stats["failed_tickets"], 1)
        self.assertEqual(stats["warnings_escalated"], 1)

        self.db.refresh(t_good)
        self.assertIsNotNone(t_good.sla_warning_escalated_at)

    def test_h_tenant_isolation_is_preserved(self):
        """H. Processing a tenant's escalations only touches tickets for that specific tenant."""
        now = self.created_at + timedelta(hours=3, minutes=15)

        t_tenant_a = self._create_ticket(tenant_id=self.tenant_a)
        t_tenant_b = self._create_ticket(tenant_id=self.tenant_b)

        # Process Tenant A only
        stats = process_tenant_escalations(self.db, tenant_id=self.tenant_a, now=now)

        self.assertEqual(stats["tenant_id"], str(self.tenant_a))
        self.assertEqual(stats["warnings_escalated"], 1)

        self.db.refresh(t_tenant_a)
        self.db.refresh(t_tenant_b)

        # Tenant A's ticket received escalation
        self.assertIsNotNone(t_tenant_a.sla_warning_escalated_at)
        # Tenant B's ticket is completely untouched
        self.assertIsNone(t_tenant_b.sla_warning_escalated_at)

    def test_i_worker_helpers_and_configuration(self):
        """I. Configuration and interval helpers function correctly."""
        self.assertTrue(enabled())
        with patch.dict("os.environ", {"ITSM_SLA_WORKER_ENABLED": "false"}):
            self.assertFalse(enabled())

        self.assertEqual(get_worker_interval(), 60.0)
        with patch.dict("os.environ", {"ITSM_SLA_WORKER_INTERVAL_SECONDS": "30"}):
            self.assertEqual(get_worker_interval(), 30.0)

    # -------------------------------------------------------------------------
    # PHASE 4: SLA-003 Escalation Actions & Evidence Tests
    # -------------------------------------------------------------------------

    def test_phase4_warning_escalation_actions_and_evidence(self):
        """Phase 4.1: Warning escalation creates in-app notifications, activity, and audit record."""
        mgr = self._create_user(self.tenant_a, "mgr@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, mgr.id)

        assignee = self._create_user(self.tenant_a, "assignee@tenant-a.com")
        team_member = self._create_user(self.tenant_a, "oncall@tenant-a.com")
        self._create_team_with_member(self.tenant_a, "Platform Support", team_member.id)

        ticket = self._create_ticket(tenant_id=self.tenant_a)
        ticket.assignee_id = assignee.id
        ticket.assignment_group = "Platform Support"
        ticket.priority = "P1"
        self.db.add(ticket)
        self.db.commit()

        # 3 hours elapsed out of 4 = 75% -> warning threshold
        now = self.created_at + timedelta(hours=3)

        with patch("app.services.itsm_sla_worker.append_audit_event") as mock_audit:
            result = sweep(self.db, now=now)

        self.assertEqual(result["warnings_escalated"], 1)

        # 1. Ticket timestamp recorded
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_warning_escalated_at)
        self.assertIsNone(ticket.sla_breach_escalated_at)

        # 2. In-app notifications created for each resolved recipient (Manager, Team Member, Assignee)
        notifs = self.db.query(Notification).filter(Notification.tenant_id == self.tenant_a).all()
        self.assertEqual(len(notifs), 3)

        notif_user_ids = {n.user_id for n in notifs}
        self.assertIn(mgr.id, notif_user_ids)
        self.assertIn(team_member.id, notif_user_ids)
        self.assertIn(assignee.id, notif_user_ids)

        for n in notifs:
            self.assertEqual(n.type, "itsm.sla.warning")
            self.assertEqual(n.severity, "warning")
            self.assertIn(ticket.ticket_number, n.title)
            self.assertIn("P1", n.title)
            self.assertIn("RESOLUTION", n.body)
            self.assertEqual(n.link, f"/itsm/incidents/{ticket.id}")

        # 3. ITSMTicketActivity created with system actor and structured metadata
        activities = (
            self.db.query(ITSMTicketActivity)
            .filter(ITSMTicketActivity.ticket_id == ticket.id)
            .all()
        )
        self.assertEqual(len(activities), 1)
        act = activities[0]
        self.assertEqual(act.activity_type, "SLA_WARNING_ESCALATION")
        self.assertEqual(act.actor_type, "SYSTEM")
        self.assertIsNone(act.actor_id)
        self.assertEqual(act.activity_metadata["escalation_type"], "WARNING")
        self.assertEqual(act.activity_metadata["priority"], "P1")
        self.assertEqual(act.activity_metadata["stage"], "RESOLUTION")
        self.assertEqual(act.activity_metadata["sla_status"], "AT_RISK")
        self.assertEqual(act.activity_metadata["recipients_count"], 3)

        # 4. Audit event emitted with required execution trace
        mock_audit.assert_called_once()
        audit_payload = mock_audit.call_args[0][1]
        self.assertEqual(audit_payload["action"], "itsm.sla.warning_escalation")
        self.assertEqual(audit_payload["actor_type"], "system")
        self.assertEqual(audit_payload["provider"], "itsm")
        self.assertEqual(audit_payload["frameworks_affected"], ["ITIL"])
        trace_str = " ".join(audit_payload["execution_trace"])
        self.assertIn(f"ticket_id={ticket.id}", trace_str)
        self.assertIn(f"ticket_number={ticket.ticket_number}", trace_str)
        self.assertIn("priority=P1", trace_str)
        self.assertIn("stage=RESOLUTION", trace_str)

    def test_phase4_breach_escalation_actions_and_evidence(self):
        """Phase 4.2: Breach escalation creates critical in-app notifications, activity, and audit record."""
        mgr = self._create_user(self.tenant_a, "breach_mgr@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, mgr.id)

        assignee = self._create_user(self.tenant_a, "breach_assignee@tenant-a.com")

        ticket = self._create_ticket(tenant_id=self.tenant_a)
        ticket.assignee_id = assignee.id
        ticket.priority = "P1"
        self.db.add(ticket)
        self.db.commit()

        # Past deadline -> BREACHED
        now = self.due_at + timedelta(minutes=30)

        with patch("app.services.itsm_sla_worker.append_audit_event") as mock_audit:
            result = sweep(self.db, now=now)

        self.assertEqual(result["breaches_escalated"], 1)

        # 1. Breach timestamp recorded
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_breach_escalated_at)

        # 2. Critical in-app notifications created
        notifs = self.db.query(Notification).filter(Notification.tenant_id == self.tenant_a).all()
        self.assertEqual(len(notifs), 2)
        for n in notifs:
            self.assertEqual(n.type, "itsm.sla.breach")
            self.assertEqual(n.severity, "critical")
            self.assertIn("Breached", n.title)
            self.assertIn(ticket.ticket_number, n.title)
            self.assertIn("P1", n.title)
            self.assertIn("breached its RESOLUTION deadline", n.body)

        # 3. ITSMTicketActivity created
        activities = (
            self.db.query(ITSMTicketActivity)
            .filter(ITSMTicketActivity.ticket_id == ticket.id)
            .all()
        )
        self.assertEqual(len(activities), 1)
        act = activities[0]
        self.assertEqual(act.activity_type, "SLA_BREACH_ESCALATION")
        self.assertEqual(act.actor_type, "SYSTEM")
        self.assertEqual(act.activity_metadata["escalation_type"], "BREACH")
        self.assertEqual(act.activity_metadata["sla_status"], "BREACHED")

        # 4. Audit event emitted
        mock_audit.assert_called_once()
        audit_payload = mock_audit.call_args[0][1]
        self.assertEqual(audit_payload["action"], "itsm.sla.breach_escalation")
        self.assertEqual(audit_payload["actor_type"], "system")
        self.assertEqual(audit_payload["frameworks_affected"], ["ITIL"])

    def test_phase4_repeated_worker_runs_create_zero_duplicates(self):
        """Phase 4.3: Repeated worker runs do not dispatch duplicate notifications, activities, or audit events."""
        mgr = self._create_user(self.tenant_a, "repeat_mgr@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, mgr.id)

        ticket = self._create_ticket(tenant_id=self.tenant_a)
        now_1 = self.created_at + timedelta(hours=3)

        with patch("app.services.itsm_sla_worker.append_audit_event") as mock_audit:
            # Run 1: Should fire warning escalation
            res_1 = sweep(self.db, now=now_1)
            self.assertEqual(res_1["warnings_escalated"], 1)
            self.assertEqual(mock_audit.call_count, 1)

            notifs_run_1 = self.db.query(Notification).count()
            activities_run_1 = self.db.query(ITSMTicketActivity).count()
            self.assertEqual(notifs_run_1, 1)
            self.assertEqual(activities_run_1, 1)

            # Run 2: 1 minute later, ticket still at risk
            now_2 = now_1 + timedelta(minutes=1)
            res_2 = sweep(self.db, now=now_2)
            self.assertEqual(res_2["warnings_escalated"], 0)
            self.assertEqual(mock_audit.call_count, 1)  # No new audit call

            notifs_run_2 = self.db.query(Notification).count()
            activities_run_2 = self.db.query(ITSMTicketActivity).count()
            self.assertEqual(notifs_run_2, notifs_run_1)  # Zero duplicates
            self.assertEqual(activities_run_2, activities_run_1)  # Zero duplicates

            # Run 3: 10 minutes later, still before breach
            now_3 = now_1 + timedelta(minutes=10)
            res_3 = sweep(self.db, now=now_3)
            self.assertEqual(res_3["warnings_escalated"], 0)
            self.assertEqual(mock_audit.call_count, 1)

            self.assertEqual(self.db.query(Notification).count(), notifs_run_1)
            self.assertEqual(self.db.query(ITSMTicketActivity).count(), activities_run_1)

    def test_phase4_breach_after_warning_escalates_each_stage_once(self):
        """Phase 4.4: A ticket transitioning from warning to breach fires each stage once."""
        mgr = self._create_user(self.tenant_a, "progression_mgr@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, mgr.id)

        ticket = self._create_ticket(tenant_id=self.tenant_a)

        # Stage 1: Warning threshold
        now_warn = self.created_at + timedelta(hours=3)
        res_warn = sweep(self.db, now=now_warn)
        self.assertEqual(res_warn["warnings_escalated"], 1)
        self.assertEqual(res_warn["breaches_escalated"], 0)
        self.assertEqual(self.db.query(Notification).count(), 1)
        self.assertEqual(self.db.query(ITSMTicketActivity).count(), 1)

        # Stage 2: Past deadline -> breach threshold
        now_breach = self.due_at + timedelta(minutes=5)
        res_breach = sweep(self.db, now=now_breach)
        self.assertEqual(res_breach["warnings_escalated"], 0)
        self.assertEqual(res_breach["breaches_escalated"], 1)
        self.assertEqual(self.db.query(Notification).count(), 2)  # 1 warning + 1 breach
        self.assertEqual(self.db.query(ITSMTicketActivity).count(), 2)  # 1 warning + 1 breach

        # Stage 3: Repeated sweep after breach -> zero new actions
        now_after = now_breach + timedelta(minutes=10)
        res_after = sweep(self.db, now=now_after)
        self.assertEqual(res_after["warnings_escalated"], 0)
        self.assertEqual(res_after["breaches_escalated"], 0)
        self.assertEqual(self.db.query(Notification).count(), 2)
        self.assertEqual(self.db.query(ITSMTicketActivity).count(), 2)

    def test_phase4_recipient_deduplication(self):
        """Phase 4.5: A user who is both Incident Manager and Assignee receives only one notification."""
        user = self._create_user(self.tenant_a, "dual_role@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, user.id)

        ticket = self._create_ticket(tenant_id=self.tenant_a)
        ticket.assignee_id = user.id
        self.db.add(ticket)
        self.db.commit()

        recipients = resolve_escalation_recipients(self.db, ticket)
        self.assertEqual(len(recipients), 1)
        self.assertEqual(recipients[0], user.id)

        now = self.created_at + timedelta(hours=3)
        sweep(self.db, now=now)

        user_notifs = self.db.query(Notification).filter(Notification.user_id == user.id).all()
        self.assertEqual(len(user_notifs), 1)

    def test_phase4_fallback_tenant_wide_notification(self):
        """Phase 4.6: If no Incident Manager or Assignee exists, falls back to tenant-wide notification."""
        ticket = self._create_ticket(tenant_id=self.tenant_a)
        ticket.assignee_id = None
        ticket.assignment_group = None
        self.db.add(ticket)
        self.db.commit()

        recipients = resolve_escalation_recipients(self.db, ticket)
        self.assertEqual(recipients, [None])

        now = self.created_at + timedelta(hours=3)
        sweep(self.db, now=now)

        notifs = self.db.query(Notification).filter(Notification.tenant_id == self.tenant_a).all()
        self.assertEqual(len(notifs), 1)
        self.assertIsNone(notifs[0].user_id)

    def test_phase4_tenant_isolation_actions(self):
        """Phase 4.7: Escalations for Tenant A never generate notifications or activity for Tenant B."""
        mgr_a = self._create_user(self.tenant_a, "mgr_a@tenant-a.com")
        self._assign_incident_manager(self.tenant_a, mgr_a.id)

        mgr_b = self._create_user(self.tenant_b, "mgr_b@tenant-b.com")
        self._assign_incident_manager(self.tenant_b, mgr_b.id)

        # Ticket belongs exclusively to Tenant A
        t_a = self._create_ticket(tenant_id=self.tenant_a)

        now = self.created_at + timedelta(hours=3)
        process_tenant_escalations(self.db, tenant_id=self.tenant_a, now=now)

        # Tenant A has notifications; Tenant B has ZERO
        notifs_a = self.db.query(Notification).filter(Notification.tenant_id == self.tenant_a).all()
        notifs_b = self.db.query(Notification).filter(Notification.tenant_id == self.tenant_b).all()
        self.assertEqual(len(notifs_a), 1)
        self.assertEqual(len(notifs_b), 0)

        # Tenant B's manager received nothing
        mgr_b_notifs = self.db.query(Notification).filter(Notification.user_id == mgr_b.id).all()
        self.assertEqual(len(mgr_b_notifs), 0)

    def test_phase4_concurrent_worker_safety(self):
        """Phase 4.8: If ticket is evaluated by concurrent worker, second worker performs zero actions."""
        ticket = self._create_ticket(tenant_id=self.tenant_a)
        now = self.created_at + timedelta(hours=3)

        # Worker 1 processes ticket
        res_1 = process_ticket_escalation(ticket, self.db, now=now)
        self.assertTrue(res_1["warning_recorded"])
        self.assertIsNotNone(res_1["warning_actions"])

        # Worker 2 processes same ticket (e.g., concurrent sweep)
        res_2 = process_ticket_escalation(ticket, self.db, now=now)
        self.assertFalse(res_2["warning_recorded"])
        self.assertIsNone(res_2["warning_actions"])


if __name__ == "__main__":
    unittest.main()
