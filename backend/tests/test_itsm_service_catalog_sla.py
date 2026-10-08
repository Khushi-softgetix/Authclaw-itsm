"""Focused tests for Service Catalog Estimated Delivery -> Service Request SLA (Phase 6).

Covers:
1. Catalog item with 1-hour delivery creates 1-hour SLA target.
2. Catalog item with different delivery time (e.g. 8 hours).
3. 45-minute completion -> SLA MET (and warning state at 75%).
4. Completion after 1 hour -> SLA BREACHED.
5. Breach does not prevent request completion.
6. SLA-003 warning and breach escalation worker works for service requests.
7. Fallback to existing SLA policy when no valid estimated delivery exists.
8. Business calendar is respected when calculating catalog delivery deadline.
"""
from datetime import datetime, timezone, timedelta
from typing import Any
import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import ARRAY, create_engine
from sqlalchemy.dialects.postgresql import JSONB, ARRAY as PG_ARRAY
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "TEXT"

@compiles(PG_ARRAY, "sqlite")
def compile_pg_array_sqlite(type_, compiler, **kw):
    return "TEXT"

from app.db.models import (
    Base,
    ITSMBusinessCalendar,
    ITSMService,
    ITSMServiceCatalogItem,
    ITSMServiceRequestDetail,
    ITSMSLAPolicy,
    ITSMTeam,
    ITSMTeamMember,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    Notification,
    Tenant,
    User,
)
from app.schemas.itsm_requests import (
    ServiceRequestCreateRequest,
    ServiceRequestStatusUpdateRequest,
)
from app.services.itsm_request_service import RequestService
from app.services.itsm_sla_service import (
    apply_sla_policy,
    compute_sla_details,
    evaluate_ticket_escalation,
)
from app.services.itsm_sla_worker import sweep


class TestServiceCatalogEstimatedDeliverySLA(unittest.TestCase):
    """Test suite proving catalog item estimated delivery drives service request SLA."""

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        for tbl in (
            Tenant,
            User,
            ITSMService,
            ITSMServiceCatalogItem,
            ITSMServiceRequestDetail,
            ITSMSLAPolicy,
            ITSMBusinessCalendar,
            ITSMTicket,
            ITSMTicketActivity,
            Notification,
            ITSMUserAccess,
            ITSMTeam,
            ITSMTeamMember,
        ):
            tbl.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()

        self.tenant_id = uuid4()
        tenant = Tenant(id=self.tenant_id, name="Acme Corp")
        self.db.add(tenant)

        # Create Requester
        self.requester_id = uuid4()
        requester = User(
            id=self.requester_id,
            tenant_id=self.tenant_id,
            email="requester@acme.com",
            is_active=True,
        )
        self.db.add(requester)

        # Create Agent / Incident Manager
        self.agent_id = uuid4()
        agent = User(
            id=self.agent_id,
            tenant_id=self.tenant_id,
            email="manager@acme.com",
            is_active=True,
        )
        self.db.add(agent)

        # Incident manager access
        im_access = ITSMUserAccess(
            id=uuid4(),
            tenant_id=self.tenant_id,
            user_id=self.agent_id,
            itsm_role="INCIDENT_MANAGER",
            has_itsm_access=True,
        )
        self.db.add(im_access)

        # Create Service
        self.service_id = uuid4()
        service = ITSMService(
            id=self.service_id,
            tenant_id=self.tenant_id,
            name="Access Management",
            slug="access-mgmt",
            status="OPERATIONAL",
        )
        self.db.add(service)

        self.ticket_num_patcher = patch(
            "app.services.itsm_incident_service.IncidentService.generate_ticket_number",
            side_effect=lambda db, t, tt, prefix="REQ": f"{prefix}-100{uuid4().hex[:4]}",
        )
        self.ticket_num_patcher.start()

        self.audit_patcher = patch("app.services.itsm_request_service.append_audit_event")
        self.audit_patcher.start()

        self.db.commit()

    def tearDown(self):
        self.audit_patcher.stop()
        self.ticket_num_patcher.stop()
        self.db.close()
        self.engine.dispose()

    def _create_catalog_item(self, hours: int = 1, name: str = "VPN Access") -> ITSMServiceCatalogItem:
        item = ITSMServiceCatalogItem(
            id=uuid4(),
            tenant_id=self.tenant_id,
            service_id=self.service_id,
            name=name,
            slug=f"vpn-access-{uuid4().hex[:6]}",
            description="Request VPN access",
            estimated_delivery_hours=hours,
            is_active=True,
            fulfillment_group="Security Operations",
        )
        self.db.add(item)
        self.db.commit()
        return item

    def test_1_catalog_item_1_hour_delivery_creates_1_hour_sla_target(self):
        """1. Catalog item with 1-hour delivery creates 60-minute resolution SLA target."""
        item = self._create_catalog_item(hours=1, name="1-Hour Access Pass")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Need 1-Hour Access",
            description="Temporary access request",
            priority="P3",
        )

        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )

        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()
        self.assertIsNotNone(ticket)
        self.assertEqual(ticket.ticket_type, "SERVICE_REQUEST")
        self.assertIsNotNone(ticket.sla_resolution_due_at)

        # Difference between created_at and sla_resolution_due_at must be 1 hour (60 minutes)
        diff = ticket.sla_resolution_due_at - ticket.created_at
        self.assertEqual(int(diff.total_seconds()), 3600)

        # compute_sla_details verifies 1-hour total target and initial WITHIN_SLA state
        sla_info = compute_sla_details(ticket, now=ticket.created_at)
        self.assertEqual(sla_info["status"], "WITHIN_SLA")
        self.assertEqual(sla_info["remaining_seconds"], 3600)
        self.assertEqual(sla_info["total_target_seconds"], 3600)
        self.assertAlmostEqual(sla_info["elapsed_fraction"], 0.0, places=2)

    def test_2_catalog_item_different_delivery_time(self):
        """2. Catalog item with 8-hour delivery creates 480-minute resolution SLA target."""
        item = self._create_catalog_item(hours=8, name="Hardware Provisioning")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Need Workstation",
            description="New hardware",
            priority="P3",
        )

        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )

        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()
        diff = ticket.sla_resolution_due_at - ticket.created_at
        self.assertEqual(int(diff.total_seconds()), 8 * 3600)

        sla_info = compute_sla_details(ticket, now=ticket.created_at)
        self.assertEqual(sla_info["total_target_seconds"], 8 * 3600)
        self.assertEqual(sla_info["remaining_seconds"], 8 * 3600)

    def test_3_45_minute_completion_sla_met(self):
        """3. Completion at 45 minutes of a 1-hour SLA -> warning at 75%, resolved -> SLA MET."""
        item = self._create_catalog_item(hours=1, name="Quick Setup")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Quick Setup Request",
            description="Fast task",
            priority="P3",
        )
        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )
        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()

        # At 45 minutes: 75% elapsed -> AT_RISK (Amber)
        at_45m = ticket.created_at + timedelta(minutes=45)
        sla_at_45 = compute_sla_details(ticket, now=at_45m)
        self.assertEqual(sla_at_45["status"], "AT_RISK")
        self.assertAlmostEqual(sla_at_45["elapsed_fraction"], 0.75, places=2)
        self.assertEqual(sla_at_45["remaining_seconds"], 15 * 60)

        # Transition ASSIGNED -> IN_PROGRESS, then RESOLVED at 45 minutes
        RequestService.change_request_status(
            db=self.db,
            tenant_id=self.tenant_id,
            request_id=ticket.id,
            actor_id=self.agent_id,
            payload=ServiceRequestStatusUpdateRequest(status="IN_PROGRESS"),
        )

        status_payload = ServiceRequestStatusUpdateRequest(
            status="RESOLVED",
            resolution_code="FULFILLED",
            resolution_summary="Completed in 45 minutes",
        )
        with patch("app.services.itsm_request_service.datetime") as mock_dt:
            mock_dt.now.return_value = at_45m
            resolved_resp = RequestService.change_request_status(
                db=self.db,
                tenant_id=self.tenant_id,
                request_id=ticket.id,
                actor_id=self.agent_id,
                payload=status_payload,
            )

        self.assertEqual(resolved_resp.status, "RESOLVED")
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_resolution_met_at)
        # Met timestamp is before due timestamp -> SLA was MET
        self.assertLessEqual(ticket.sla_resolution_met_at, ticket.sla_resolution_due_at)

    def test_4_completion_after_1_hour_sla_breached(self):
        """4. Ticket past 1 hour becomes BREACHED, resolution records met_at past deadline."""
        item = self._create_catalog_item(hours=1, name="Express Setup")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Express Setup Request",
            description="Urgent task",
            priority="P3",
        )
        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )
        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()

        # At 70 minutes: 10 minutes overdue -> BREACHED (Red)
        at_70m = ticket.created_at + timedelta(minutes=70)
        sla_at_70 = compute_sla_details(ticket, now=at_70m)
        self.assertEqual(sla_at_70["status"], "BREACHED")
        self.assertLess(sla_at_70["remaining_seconds"], 0)
        self.assertEqual(sla_at_70["remaining_seconds"], -10 * 60)

        # Transition ASSIGNED -> IN_PROGRESS, then RESOLVED at 70 minutes
        RequestService.change_request_status(
            db=self.db,
            tenant_id=self.tenant_id,
            request_id=ticket.id,
            actor_id=self.agent_id,
            payload=ServiceRequestStatusUpdateRequest(status="IN_PROGRESS"),
        )

        status_payload = ServiceRequestStatusUpdateRequest(
            status="RESOLVED",
            resolution_code="FULFILLED",
            resolution_summary="Resolved late",
        )
        with patch("app.services.itsm_request_service.datetime") as mock_dt:
            mock_dt.now.return_value = at_70m
            resolved_resp = RequestService.change_request_status(
                db=self.db,
                tenant_id=self.tenant_id,
                request_id=ticket.id,
                actor_id=self.agent_id,
                payload=status_payload,
            )

        self.assertEqual(resolved_resp.status, "RESOLVED")
        self.db.refresh(ticket)
        # Met timestamp is strictly greater than due timestamp -> SLA BREACHED
        self.assertGreater(ticket.sla_resolution_met_at, ticket.sla_resolution_due_at)

    def test_5_breach_does_not_prevent_request_completion(self):
        """5. A breached service request can still transition to RESOLVED and CLOSED."""
        item = self._create_catalog_item(hours=1, name="Delayed Request")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Delayed Work",
            description="Work",
            priority="P3",
        )
        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )
        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()

        # Transition to IN_PROGRESS
        RequestService.change_request_status(
            db=self.db,
            tenant_id=self.tenant_id,
            request_id=ticket.id,
            actor_id=self.agent_id,
            payload=ServiceRequestStatusUpdateRequest(status="IN_PROGRESS"),
        )

        # 3 hours past deadline
        at_4h = ticket.created_at + timedelta(hours=4)
        with patch("app.services.itsm_request_service.datetime") as mock_dt:
            mock_dt.now.return_value = at_4h
            # Resolve
            res_resp = RequestService.change_request_status(
                db=self.db,
                tenant_id=self.tenant_id,
                request_id=ticket.id,
                actor_id=self.agent_id,
                payload=ServiceRequestStatusUpdateRequest(status="RESOLVED", resolution_code="DONE"),
            )
            self.assertEqual(res_resp.status, "RESOLVED")

            # Close
            close_resp = RequestService.change_request_status(
                db=self.db,
                tenant_id=self.tenant_id,
                request_id=ticket.id,
                actor_id=self.agent_id,
                payload=ServiceRequestStatusUpdateRequest(status="CLOSED"),
            )
            self.assertEqual(close_resp.status, "CLOSED")

    def test_6_sla_003_escalation_worker_for_service_requests(self):
        """6. SLA-003 background worker triggers warning and breach escalation for service requests."""
        item = self._create_catalog_item(hours=1, name="Escalation Test Item")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Escalate Me",
            description="Testing worker escalation",
            priority="P3",
        )
        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )
        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()

        # At 45m: worker sweep triggers warning escalation
        now_45m = ticket.created_at + timedelta(minutes=45)
        with patch("app.services.itsm_sla_worker.append_audit_event"):
            sweep_result = sweep(self.db, now=now_45m)

        self.assertEqual(sweep_result["warnings_escalated"], 1)
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_warning_escalated_at)
        self.assertIsNone(ticket.sla_breach_escalated_at)

        # Check in-app notification link points to /itsm/requests/{id}
        notif = (
            self.db.query(Notification)
            .filter(Notification.tenant_id == self.tenant_id, Notification.type == "itsm.sla.warning")
            .first()
        )
        self.assertIsNotNone(notif)
        self.assertEqual(notif.link, f"/itsm/requests/{ticket.id}")

        # At 75m: worker sweep triggers breach escalation
        now_75m = ticket.created_at + timedelta(minutes=75)
        with patch("app.services.itsm_sla_worker.append_audit_event"):
            sweep_result_2 = sweep(self.db, now=now_75m)

        self.assertEqual(sweep_result_2["breaches_escalated"], 1)
        self.db.refresh(ticket)
        self.assertIsNotNone(ticket.sla_breach_escalated_at)

        # Breach notification created
        breach_notif = (
            self.db.query(Notification)
            .filter(Notification.tenant_id == self.tenant_id, Notification.type == "itsm.sla.breach")
            .first()
        )
        self.assertIsNotNone(breach_notif)
        self.assertEqual(breach_notif.severity, "critical")
        self.assertEqual(breach_notif.link, f"/itsm/requests/{ticket.id}")

    def test_7_no_valid_estimated_delivery_falls_back_to_policy(self):
        """7. Catalog item with no valid delivery hours preserves fallback to SLA policy."""
        # Create dedicated service request SLA policy with 1440m (24h) resolution target
        policy = ITSMSLAPolicy(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="General Service Request Policy",
            ticket_type="SERVICE_REQUEST",
            priority="P3",
            service_id=self.service_id,
            response_target_minutes=120,
            resolution_target_minutes=1440,
            is_active=True,
        )
        self.db.add(policy)
        self.db.commit()

        # Item with 0 hours
        item = self._create_catalog_item(hours=0, name="No Target Item")

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Fallback Request",
            description="Fallback test",
            priority="P3",
        )
        resp = RequestService.create_request(
            db=self.db,
            tenant_id=self.tenant_id,
            actor_id=self.requester_id,
            payload=payload,
        )
        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()

        # Should fall back to 1440 minutes from the policy
        diff = ticket.sla_resolution_due_at - ticket.created_at
        self.assertEqual(int(diff.total_seconds()), 1440 * 60)
        self.assertEqual(ticket.sla_policy_id, policy.id)

    def test_8_business_calendar_respected_for_estimated_delivery(self):
        """8. Estimated delivery deadline calculation respects tenant business calendar."""
        # Business calendar: Mon-Fri 09:00 to 17:00 UTC
        cal = ITSMBusinessCalendar(
            id=uuid4(),
            tenant_id=self.tenant_id,
            name="Standard Office Hours",
            timezone="UTC",
            weekly_hours={
                "monday": {"start": "09:00", "end": "17:00"},
                "tuesday": {"start": "09:00", "end": "17:00"},
                "wednesday": {"start": "09:00", "end": "17:00"},
                "thursday": {"start": "09:00", "end": "17:00"},
                "friday": {"start": "09:00", "end": "17:00"},
            },
            holidays=[],
            is_default=True,
        )
        self.db.add(cal)
        self.db.commit()

        item = self._create_catalog_item(hours=1, name="Calendar Bound Request")

        # Ticket created on Friday at 16:30 UTC (30 minutes before close of business)
        # 1-hour working time target must use 30 minutes on Friday (until 17:00)
        # and remaining 30 minutes on Monday morning (09:00 to 09:30 UTC).
        friday_1630 = datetime(2026, 10, 9, 16, 30, tzinfo=timezone.utc)  # 2026-10-09 is a Friday

        payload = ServiceRequestCreateRequest(
            catalog_item_id=item.id,
            title="Weekend Crossing Request",
            description="Testing business calendar",
            priority="P3",
        )

        with patch("app.services.itsm_request_service.datetime") as mock_dt:
            mock_dt.now.return_value = friday_1630
            resp = RequestService.create_request(
                db=self.db,
                tenant_id=self.tenant_id,
                actor_id=self.requester_id,
                payload=payload,
            )

        ticket = self.db.query(ITSMTicket).filter(ITSMTicket.id == resp.id).first()
        expected_monday_0930 = datetime(2026, 10, 12, 9, 30, tzinfo=timezone.utc)
        due_at = ticket.sla_resolution_due_at
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        self.assertEqual(due_at, expected_monday_0930)


if __name__ == "__main__":
    unittest.main()
