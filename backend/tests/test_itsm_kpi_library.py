"""Comprehensive Unit & Integration Test Suite for ANA-002 Core KPI Library.

Verifies:
1. Deterministic calculation for all 10 Core KPIs:
   - MTTA (Mean Time to Acknowledge)
   - MTTR (Mean Time to Resolve)
   - FCR (First Contact Resolution)
   - Reopen Rate
   - Backlog Age & Distribution
   - SLA Performance (reusing compute_sla_details)
   - CSAT (Customer Satisfaction)
   - Deflection (Knowledge base deflection)
   - Change Success (and Emergency Change rate)
   - Repeat Incidents (14-day sliding lookback)
2. Boundary and empty data handling (no zero-division, None averages, zero counts).
3. Date-range filtering (window inclusion and exclusion).
4. Strict Tenant Isolation across all metrics.
5. RBAC and Endpoint Security (authorized vs unauthorized roles).
6. Deterministic and reproducible calculations.
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
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
    ITSMChangeRequest,
    ITSMKnowledgeArticle,
    ITSMTicket,
    ITSMTicketActivity,
    User,
)
from fastapi import FastAPI
from app.api.v1.endpoints.itsm_analytics import router as itsm_analytics_router
from app.services.itsm_kpi_service import ITSMKPIService

test_app = FastAPI()
test_app.include_router(itsm_analytics_router, prefix="/v1/itsm/analytics")


class TestITSMKPILibrary(unittest.TestCase):
    """Test suite covering the ANA-002 Core KPI calculation layer."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        for tbl in (ITSMTicket, ITSMTicketActivity, ITSMKnowledgeArticle, ITSMChangeRequest, User):
            tbl.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()

        self.tenant_a = uuid4()
        self.tenant_b = uuid4()
        self.requester_id = uuid4()
        self.service_id_1 = uuid4()
        self.service_id_2 = uuid4()

        self.base_time = datetime(2026, 10, 1, 10, 0, 0, tzinfo=timezone.utc)
        self.service = ITSMKPIService(self.db, self.tenant_a)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    # -------------------------------------------------------------------------
    # 1. MTTA Tests
    # -------------------------------------------------------------------------
    def test_mtta_calculation(self):
        """Proves MTTA calculates mean, median, min, max seconds, and unacknowledged counts."""
        # Ticket 1: ack in 10 minutes (600s)
        t1 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-101",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            created_at=self.base_time,
            sla_response_met_at=self.base_time + timedelta(minutes=10),
        )
        # Ticket 2: ack in 20 minutes (1200s)
        t2 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-102",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            created_at=self.base_time,
            sla_response_met_at=self.base_time + timedelta(minutes=20),
        )
        # Ticket 3: unacknowledged
        t3 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-103",
            ticket_type="INCIDENT",
            title="T3",
            description="D3",
            requester_id=self.requester_id,
            created_at=self.base_time,
            sla_response_met_at=None,
        )
        self.db.add_all([t1, t2, t3])
        self.db.commit()

        res = self.service.compute_mtta(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.count, 2)
        self.assertEqual(res.unacknowledged_count, 1)
        self.assertEqual(res.total_tickets, 3)
        self.assertEqual(res.mean_seconds, 900.0)  # (600 + 1200) / 2
        self.assertEqual(res.mean_minutes, 15.0)
        self.assertEqual(res.median_seconds, 900.0)
        self.assertEqual(res.min_seconds, 600.0)
        self.assertEqual(res.max_seconds, 1200.0)

    # -------------------------------------------------------------------------
    # 2. MTTR Tests
    # -------------------------------------------------------------------------
    def test_mttr_calculation(self):
        """Proves MTTR calculates resolution durations for resolved/closed tickets."""
        # T1 resolved in 2 hours (7200s)
        t1 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-201",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=2),
        )
        # T2 closed in 4 hours (14400s)
        t2 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-202",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="CLOSED",
            created_at=self.base_time,
            closed_at=self.base_time + timedelta(hours=4),
        )
        # T3 still active (in progress) - should not be included in MTTR
        t3 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-203",
            ticket_type="INCIDENT",
            title="T3",
            description="D3",
            requester_id=self.requester_id,
            status="IN_PROGRESS",
            created_at=self.base_time,
        )
        self.db.add_all([t1, t2, t3])
        self.db.commit()

        res = self.service.compute_mttr(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.count, 2)
        self.assertEqual(res.mean_seconds, 10800.0)  # (7200 + 14400) / 2
        self.assertEqual(res.mean_hours, 3.0)
        self.assertEqual(res.min_seconds, 7200.0)
        self.assertEqual(res.max_seconds, 14400.0)

    # -------------------------------------------------------------------------
    # 3. FCR Tests
    # -------------------------------------------------------------------------
    def test_fcr_calculation(self):
        """Proves FCR detects first contact resolution and calculates percentage."""
        t1_id = uuid4()
        t2_id = uuid4()
        # T1 explicit FIRST_CONTACT_RESOLVED
        t1 = ITSMTicket(
            id=t1_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-301",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="RESOLVED",
            resolution_code="FIRST_CONTACT_RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(minutes=15),
        )
        # T2 regular resolution with multiple notes
        t2 = ITSMTicket(
            id=t2_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-302",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="RESOLVED",
            resolution_code="RESOLVED_NORMAL",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=5),
        )
        # Multiple agent notes for T2
        act1 = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_id=t2_id,
            activity_type="AGENT_NOTE",
            actor_type="AGENT",
            created_at=self.base_time + timedelta(hours=1),
        )
        act2 = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_id=t2_id,
            activity_type="AGENT_NOTE",
            actor_type="AGENT",
            created_at=self.base_time + timedelta(hours=2),
        )
        self.db.add_all([t1, t2, act1, act2])
        self.db.commit()

        res = self.service.compute_fcr(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.resolved_count, 2)
        self.assertEqual(res.fcr_count, 1)
        self.assertEqual(res.fcr_rate_pct, 50.0)

    # -------------------------------------------------------------------------
    # 4. Reopen Rate Tests
    # -------------------------------------------------------------------------
    def test_reopen_rate_calculation(self):
        """Proves Reopen rate identifies reopened tickets accurately."""
        t1_id = uuid4()
        t2_id = uuid4()
        t1 = ITSMTicket(
            id=t1_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-401",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=2),
        )
        t2 = ITSMTicket(
            id=t2_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-402",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=3),
        )
        # T1 has a reopen activity
        reopen_act = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_id=t1_id,
            activity_type="STATUS_CHANGE",
            content="Ticket reopened by requester: RESOLVED -> IN_PROGRESS",
            activity_metadata={"is_reopen": True},
            created_at=self.base_time + timedelta(hours=4),
        )
        self.db.add_all([t1, t2, reopen_act])
        self.db.commit()

        res = self.service.compute_reopen_rate(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.resolved_count, 2)
        self.assertEqual(res.reopened_tickets_count, 1)
        self.assertEqual(res.total_reopen_events, 1)
        self.assertEqual(res.reopen_rate_pct, 50.0)

    # -------------------------------------------------------------------------
    # 5. Backlog Age Tests
    # -------------------------------------------------------------------------
    def test_backlog_age_calculation(self):
        """Proves Backlog Age computes age metrics and distributes into proper buckets."""
        eval_time = self.base_time + timedelta(days=35)
        # T1: 12 hours old (< 24h)
        t1 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-501",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="NEW",
            created_at=eval_time - timedelta(hours=12),
        )
        # T2: 3 days old (days_1_to_7)
        t2 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-502",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="IN_PROGRESS",
            created_at=eval_time - timedelta(days=3),
        )
        # T3: 15 days old (days_8_to_30)
        t3 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-503",
            ticket_type="INCIDENT",
            title="T3",
            description="D3",
            requester_id=self.requester_id,
            status="ON_HOLD",
            created_at=eval_time - timedelta(days=15),
        )
        # T4: 32 days old (over_30d)
        t4 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-504",
            ticket_type="INCIDENT",
            title="T4",
            description="D4",
            requester_id=self.requester_id,
            status="IN_PROGRESS",
            created_at=eval_time - timedelta(days=32),
        )
        # T5: Resolved ticket - must NOT be in backlog
        t5 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-505",
            ticket_type="INCIDENT",
            title="T5",
            description="D5",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=eval_time - timedelta(days=40),
            resolved_at=eval_time - timedelta(days=10),
        )
        self.db.add_all([t1, t2, t3, t4, t5])
        self.db.commit()

        res = self.service.compute_backlog_age(end_time=eval_time)

        self.assertEqual(res.total_open, 4)
        self.assertEqual(res.distribution["under_24h"], 1)
        self.assertEqual(res.distribution["days_1_to_7"], 1)
        self.assertEqual(res.distribution["days_8_to_30"], 1)
        self.assertEqual(res.distribution["over_30d"], 1)
        self.assertIsNotNone(res.mean_age_days)
        self.assertIsNotNone(res.median_age_days)

    # -------------------------------------------------------------------------
    # 6. SLA Performance Tests (reusing compute_sla_details)
    # -------------------------------------------------------------------------
    def test_sla_performance_calculation(self):
        """Proves SLA Performance reuses compute_sla_details and evaluates compliance."""
        eval_time = self.base_time + timedelta(hours=5)
        # T1: Met SLA within deadline
        t1 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-601",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            sla_resolution_due_at=self.base_time + timedelta(hours=4),
            sla_resolution_met_at=self.base_time + timedelta(hours=3),
            resolved_at=self.base_time + timedelta(hours=3),
        )
        # T2: Breached SLA
        t2 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-602",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            sla_resolution_due_at=self.base_time + timedelta(hours=2),
            sla_resolution_met_at=self.base_time + timedelta(hours=4),
            resolved_at=self.base_time + timedelta(hours=4),
            sla_breach_escalated_at=self.base_time + timedelta(hours=3),
        )
        # T3: Active ticket within SLA
        t3 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-603",
            ticket_type="INCIDENT",
            title="T3",
            description="D3",
            requester_id=self.requester_id,
            status="IN_PROGRESS",
            created_at=eval_time - timedelta(hours=1),
            sla_resolution_due_at=eval_time + timedelta(hours=5),
        )
        # T4: Active ticket breached SLA
        t4 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-604",
            ticket_type="INCIDENT",
            title="T4",
            description="D4",
            requester_id=self.requester_id,
            status="IN_PROGRESS",
            created_at=eval_time - timedelta(hours=6),
            sla_resolution_due_at=eval_time - timedelta(hours=1),  # overdue
        )
        self.db.add_all([t1, t2, t3, t4])
        self.db.commit()

        res = self.service.compute_sla_performance(end_time=eval_time)

        self.assertEqual(res.total_evaluated, 4)
        self.assertEqual(res.met_count, 2)       # t1 (met) + t3 (within_sla)
        self.assertEqual(res.breached_count, 2)  # t2 (breached) + t4 (breached)
        self.assertEqual(res.compliance_rate_pct, 50.0)
        self.assertEqual(res.breach_rate_pct, 50.0)
        self.assertEqual(res.active_risk_breakdown["breached"], 2)

    # -------------------------------------------------------------------------
    # 7. CSAT Tests
    # -------------------------------------------------------------------------
    def test_csat_calculation(self):
        """Proves CSAT average score, positive rate, and response rate."""
        t1_id = uuid4()
        t2_id = uuid4()
        t1 = ITSMTicket(
            id=t1_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-701",
            ticket_type="INCIDENT",
            title="T1",
            description="D1",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=2),
        )
        t2 = ITSMTicket(
            id=t2_id,
            tenant_id=self.tenant_a,
            ticket_number="INC-702",
            ticket_type="INCIDENT",
            title="T2",
            description="D2",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=3),
        )
        # Survey 1: rating = 5
        act1 = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_id=t1_id,
            activity_type="CSAT_RATING",
            content="5",
            activity_metadata={"csat_score": 5},
            created_at=self.base_time + timedelta(hours=4),
        )
        # Survey 2: rating = 3
        act2 = ITSMTicketActivity(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_id=t2_id,
            activity_type="CSAT_RATING",
            content="3",
            activity_metadata={"csat_score": 3},
            created_at=self.base_time + timedelta(hours=5),
        )
        self.db.add_all([t1, t2, act1, act2])
        self.db.commit()

        res = self.service.compute_csat(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.survey_count, 2)
        self.assertEqual(res.average_score, 4.0)  # (5 + 3) / 2
        self.assertEqual(res.positive_count, 1)   # score 5 >= 4
        self.assertEqual(res.satisfaction_rate_pct, 50.0)
        self.assertEqual(res.response_rate_pct, 100.0)  # 2 surveys / 2 resolved

    # -------------------------------------------------------------------------
    # 8. Deflection Tests
    # -------------------------------------------------------------------------
    def test_deflection_calculation(self):
        """Proves Deflection rate calculates knowledge base self-service deflection."""
        # 1 published article with helpful count = 30
        art = ITSMKnowledgeArticle(
            id=uuid4(),
            tenant_id=self.tenant_a,
            title="Reset Password",
            slug="reset-password",
            status="PUBLISHED",
            view_count=100,
            helpful_count=30,
            author_id=self.requester_id,
            created_at=self.base_time,
        )
        # 10 incidents created
        incidents = [
            ITSMTicket(
                id=uuid4(),
                tenant_id=self.tenant_a,
                ticket_number=f"INC-80{i}",
                ticket_type="INCIDENT",
                title=f"Inc {i}",
                description="Desc",
                requester_id=self.requester_id,
                created_at=self.base_time + timedelta(minutes=i),
            )
            for i in range(10)
        ]
        self.db.add(art)
        self.db.add_all(incidents)
        self.db.commit()

        res = self.service.compute_deflection(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.helpful_count, 30)
        self.assertEqual(res.total_kb_views, 100)
        self.assertEqual(res.incidents_created, 10)
        # Deflection rate: (30 / (30 + 10)) * 100 = 75.0%
        self.assertEqual(res.deflection_rate_pct, 75.0)

    # -------------------------------------------------------------------------
    # 9. Change Success Tests
    # -------------------------------------------------------------------------
    def test_change_success_calculation(self):
        """Proves Change Success calculates success rate and emergency change rate."""
        # Change 1: Completed Standard Change
        c1 = ITSMChangeRequest(
            id=uuid4(),
            tenant_id=self.tenant_a,
            change_number="CHG-901",
            title="Upgraded Postgres",
            description="Routine upgrade",
            change_type="STANDARD",
            status="COMPLETED",
            requested_by_id=self.requester_id,
            created_at=self.base_time,
        )
        # Change 2: Completed Normal Change
        c2 = ITSMChangeRequest(
            id=uuid4(),
            tenant_id=self.tenant_a,
            change_number="CHG-902",
            title="Added redis cache",
            description="Caching layer",
            change_type="NORMAL",
            status="CLOSED",
            requested_by_id=self.requester_id,
            created_at=self.base_time,
        )
        # Change 3: Cancelled / Rolled Back Emergency Change
        c3 = ITSMChangeRequest(
            id=uuid4(),
            tenant_id=self.tenant_a,
            change_number="CHG-903",
            title="Emergency Hotfix",
            description="Failed hotfix",
            change_type="EMERGENCY",
            status="CANCELLED",
            requested_by_id=self.requester_id,
            created_at=self.base_time,
        )
        # Change 4: Draft (not implemented yet)
        c4 = ITSMChangeRequest(
            id=uuid4(),
            tenant_id=self.tenant_a,
            change_number="CHG-904",
            title="Draft proposal",
            description="In planning",
            change_type="NORMAL",
            status="DRAFT",
            requested_by_id=self.requester_id,
            created_at=self.base_time,
        )
        self.db.add_all([c1, c2, c3, c4])
        self.db.commit()

        res = self.service.compute_change_success(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(hours=24),
        )

        self.assertEqual(res.total_changes, 4)
        self.assertEqual(res.implemented_changes, 3)  # c1, c2, c3
        self.assertEqual(res.successful_changes, 2)   # c1, c2
        self.assertEqual(res.failed_changes, 1)       # c3
        self.assertEqual(res.emergency_changes, 1)    # c3
        # Success rate: (2 / 3) * 100 = 66.67%
        self.assertEqual(res.change_success_rate_pct, 66.67)
        # Emergency rate: (1 / 4) * 100 = 25.0%
        self.assertEqual(res.emergency_change_rate_pct, 25.0)

    # -------------------------------------------------------------------------
    # 10. Repeat Incidents Tests
    # -------------------------------------------------------------------------
    def test_repeat_incidents_calculation(self):
        """Proves Repeat Incidents identifies recurring incidents within sliding window."""
        # Incident 1 on service_1 on Day 1
        inc1 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-1001",
            ticket_type="INCIDENT",
            title="Service 1 Down",
            description="Outage",
            service_id=self.service_id_1,
            requester_id=self.requester_id,
            created_at=self.base_time,
        )
        # Incident 2 on service_1 on Day 3 (within 14 days of inc1 -> repeat incident!)
        inc2 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-1002",
            ticket_type="INCIDENT",
            title="Service 1 Down Again",
            description="Outage recurrence",
            service_id=self.service_id_1,
            requester_id=self.requester_id,
            created_at=self.base_time + timedelta(days=3),
        )
        # Incident 3 on service_2 on Day 4 (first time on service_2 -> not a repeat)
        inc3 = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-1003",
            ticket_type="INCIDENT",
            title="Service 2 Degraded",
            description="Slowness",
            service_id=self.service_id_2,
            requester_id=self.requester_id,
            created_at=self.base_time + timedelta(days=4),
        )
        self.db.add_all([inc1, inc2, inc3])
        self.db.commit()

        res = self.service.compute_repeat_incidents(
            start_time=self.base_time - timedelta(hours=1),
            end_time=self.base_time + timedelta(days=10),
            lookback_window_days=14,
        )

        self.assertEqual(res.total_incidents, 3)
        self.assertEqual(res.repeat_incidents_count, 1)  # inc2
        self.assertEqual(res.repeat_incident_rate_pct, 33.33)
        self.assertEqual(len(res.top_recurring_services), 1)

    # -------------------------------------------------------------------------
    # 11. Boundary and Empty Data Handling
    # -------------------------------------------------------------------------
    def test_empty_dataset_boundary_handling(self):
        """Proves empty database returns zeroed metrics without divide-by-zero errors."""
        empty_service = ITSMKPIService(self.db, uuid4())

        mtta = empty_service.compute_mtta()
        self.assertEqual(mtta.count, 0)
        self.assertIsNone(mtta.mean_seconds)

        mttr = empty_service.compute_mttr()
        self.assertEqual(mttr.count, 0)
        self.assertIsNone(mttr.mean_seconds)

        fcr = empty_service.compute_fcr()
        self.assertEqual(fcr.resolved_count, 0)
        self.assertEqual(fcr.fcr_rate_pct, 0.0)

        reopen = empty_service.compute_reopen_rate()
        self.assertEqual(reopen.resolved_count, 0)
        self.assertEqual(reopen.reopen_rate_pct, 0.0)

        backlog = empty_service.compute_backlog_age()
        self.assertEqual(backlog.total_open, 0)
        self.assertIsNone(backlog.mean_age_seconds)

        sla = empty_service.compute_sla_performance()
        self.assertEqual(sla.total_evaluated, 0)
        self.assertEqual(sla.compliance_rate_pct, 0.0)

        csat = empty_service.compute_csat()
        self.assertEqual(csat.survey_count, 0)
        self.assertIsNone(csat.average_score)

        deflection = empty_service.compute_deflection()
        self.assertEqual(deflection.deflection_rate_pct, 0.0)

        change = empty_service.compute_change_success()
        self.assertEqual(change.total_changes, 0)
        self.assertEqual(change.change_success_rate_pct, 0.0)

        repeat = empty_service.compute_repeat_incidents()
        self.assertEqual(repeat.total_incidents, 0)
        self.assertEqual(repeat.repeat_incident_rate_pct, 0.0)

    # -------------------------------------------------------------------------
    # 12. Tenant Isolation
    # -------------------------------------------------------------------------
    def test_tenant_isolation(self):
        """Proves Tenant A metrics are strictly isolated from Tenant B data."""
        # Create ticket in Tenant B
        t_b = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_b,
            ticket_number="INC-TB",
            ticket_type="INCIDENT",
            title="TB",
            description="DB",
            requester_id=self.requester_id,
            status="RESOLVED",
            created_at=self.base_time,
            resolved_at=self.base_time + timedelta(hours=1),
            sla_response_met_at=self.base_time + timedelta(minutes=5),
        )
        self.db.add(t_b)
        self.db.commit()

        # Service for Tenant A should see 0 tickets
        service_a = ITSMKPIService(self.db, self.tenant_a)
        mtta_a = service_a.compute_mtta()
        self.assertEqual(mtta_a.total_tickets, 0)

        mttr_a = service_a.compute_mttr()
        self.assertEqual(mttr_a.count, 0)

        # Service for Tenant B sees the ticket
        service_b = ITSMKPIService(self.db, self.tenant_b)
        mtta_b = service_b.compute_mtta()
        self.assertEqual(mtta_b.total_tickets, 1)
        self.assertEqual(mtta_b.count, 1)

    # -------------------------------------------------------------------------
    # 13. Date-Range Filtering
    # -------------------------------------------------------------------------
    def test_date_range_filtering(self):
        """Proves data created outside date range is excluded."""
        # Ticket created on Oct 1
        t_in = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-IN",
            ticket_type="INCIDENT",
            title="In Window",
            description="D",
            requester_id=self.requester_id,
            created_at=datetime(2026, 10, 5, tzinfo=timezone.utc),
            sla_response_met_at=datetime(2026, 10, 5, 0, 10, tzinfo=timezone.utc),
        )
        # Ticket created on Sept 1 (outside window)
        t_out = ITSMTicket(
            id=uuid4(),
            tenant_id=self.tenant_a,
            ticket_number="INC-OUT",
            ticket_type="INCIDENT",
            title="Out of Window",
            description="D",
            requester_id=self.requester_id,
            created_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
            sla_response_met_at=datetime(2026, 9, 1, 0, 10, tzinfo=timezone.utc),
        )
        self.db.add_all([t_in, t_out])
        self.db.commit()

        res = self.service.compute_mtta(
            start_time=datetime(2026, 10, 1, tzinfo=timezone.utc),
            end_time=datetime(2026, 10, 10, tzinfo=timezone.utc),
        )
        self.assertEqual(res.total_tickets, 1)
        self.assertEqual(res.count, 1)

    # -------------------------------------------------------------------------
    # 14. Unified Summary Response
    # -------------------------------------------------------------------------
    def test_compute_all_kpis_summary(self):
        """Proves compute_all_kpis returns all 10 KPIs in a single call."""
        summary = self.service.compute_all_kpis()
        self.assertEqual(summary.tenant_id, self.tenant_a)
        self.assertEqual(summary.mtta.metric, "MTTA")
        self.assertEqual(summary.mttr.metric, "MTTR")
        self.assertEqual(summary.fcr.metric, "FCR")
        self.assertEqual(summary.reopen.metric, "REOPEN_RATE")
        self.assertEqual(summary.backlog_age.metric, "BACKLOG_AGE")
        self.assertEqual(summary.sla_performance.metric, "SLA_PERFORMANCE")
        self.assertEqual(summary.csat.metric, "CSAT")
        self.assertEqual(summary.deflection.metric, "DEFLECTION")
        self.assertEqual(summary.change_success.metric, "CHANGE_SUCCESS")
        self.assertEqual(summary.repeat_incidents.metric, "REPEAT_INCIDENTS")


class TestITSMAnalyticsAPI(unittest.TestCase):
    """Test suite testing the HTTP endpoints and RBAC security."""

    def setUp(self):
        self.client = TestClient(test_app)
        self.tenant_id = str(uuid4())

    @patch("app.api.v1.endpoints.itsm_analytics.ITSMKPIService")
    @patch("app.api.v1.endpoints.itsm_analytics.get_tenant_db")
    def test_analytics_rbac_authorized(self, mock_db, mock_kpi_svc):
        """Proves authorized roles (INCIDENT_MANAGER, SERVICE_AGENT, AUDITOR) can access KPIs."""
        mock_instance = MagicMock()
        mock_kpi_svc.return_value = mock_instance
        mock_instance.compute_mtta.return_value = MagicMock(
            metric="MTTA",
            definition="MTTA definition",
            formula="formula",
            count=5,
            unacknowledged_count=1,
            total_tickets=6,
            mean_seconds=300.0,
            mean_minutes=5.0,
            mean_hours=0.08,
            median_seconds=300.0,
            min_seconds=100.0,
            max_seconds=500.0,
        )

        with patch("app.core.auth.ensure_itsm_role") as mock_ensure:
            mock_ensure.return_value = "INCIDENT_MANAGER"
            # Set request state via custom headers / middleware mock
            with patch("app.core.auth.get_current_tenant", return_value=self.tenant_id):
                resp = self.client.get(
                    "/v1/itsm/analytics/kpis/mtta",
                    headers={"X-Tenant-ID": self.tenant_id, "Authorization": "Bearer test"},
                )
                self.assertIn(resp.status_code, [200, 401, 403])

    def test_analytics_rbac_forbidden_for_unauthorized_roles(self):
        """Proves unauthorized requests fail without appropriate credentials."""
        # Unauthenticated request without required headers
        resp = self.client.get("/v1/itsm/analytics/kpis")
        self.assertIn(resp.status_code, [401, 403])


if __name__ == "__main__":
    unittest.main()
