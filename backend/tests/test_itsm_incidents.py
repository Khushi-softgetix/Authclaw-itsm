"""Comprehensive backend test suite for ITSM Incident Management (Phase 4).

Covers:
1. Create incident
2. Create incident with missing required data (422)
3. Get incident
4. List incidents
5. Filter incidents
6. Update incident
7. Assign incident
8. Valid status transitions
9. Invalid status transitions (409 / 400)
10. Add activity / comment
11. Get activities history
12. Tenant isolation
13. Unauthorized access (401)
14. Invalid assignee (400)
15. Ticket number uniqueness
16. Concurrent ticket number generation
17. Incident endpoint does not return service requests
18. Incident endpoint does not return problems
19. Audit behavior
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4
from unittest.mock import MagicMock, patch

from pydantic import ValidationError

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.auth import hash_key
from app.db.models import (
    APIKey,
    ITSMService,
    ITSMSLAPolicy,
    ITSMTicket,
    ITSMTicketActivity,
    ITSMTicketCategory,
    ITSMTicketCounter,
    Tenant,
    User,
)
from main import app
from app.services.itsm_incident_operations import _sla, IDLE_THRESHOLD
from app.services.itsm_sla_service import add_business_minutes
from app.services.itsm_sla_service import add_business_minutes
from app.services.itsm_sla_service import business_seconds_between, pause_sla, resume_sla
from app.services.itsm_incident_service import IncidentService
from app.schemas.itsm_incidents import IncidentCreateRequest, IncidentUpdateRequest, IncidentStatusUpdateRequest
from app.api.v1.endpoints.itsm_incidents import _get_itsm_role


class IncidentReadinessRegressionTest(unittest.TestCase):
    def calendar(self):
        return SimpleNamespace(
            timezone="UTC", holidays=[],
            weekly_hours={day: {"start": "09:00", "end": "17:00"}
                          for day in ("monday", "tuesday", "wednesday", "thursday", "friday")},
        )

    def test_invalid_classification_is_rejected_and_valid_values_normalized(self):
        for field in ("impact", "urgency"):
            with self.subTest(field=field):
                with self.assertRaises(ValidationError):
                    IncidentCreateRequest(title="Incident", description="Evidence", **{field: "INVALID"})
                with self.assertRaises(ValidationError):
                    IncidentUpdateRequest(**{field: "INVALID"})
                self.assertEqual(getattr(IncidentUpdateRequest(**{field: " high "}), field), "HIGH")

    def test_resume_preserves_remaining_working_time_over_weekend(self):
        paused = datetime(2026, 1, 2, 16, tzinfo=timezone.utc)  # Friday
        resumed = datetime(2026, 1, 5, 10, tzinfo=timezone.utc)  # Monday
        ticket = SimpleNamespace(
            sla_paused_at=paused, sla_accumulated_pause_seconds=0,
            sla_resolution_due_at=datetime(2026, 1, 5, 10, tzinfo=timezone.utc),
            sla_response_due_at=datetime(2026, 1, 2, 16, 30, tzinfo=timezone.utc),
            sla_policy=SimpleNamespace(calendar=self.calendar()),
        )
        resume_sla(ticket, resumed)
        self.assertEqual(ticket.sla_resolution_due_at, datetime(2026, 1, 5, 12, tzinfo=timezone.utc))
        self.assertEqual(ticket.sla_response_due_at, datetime(2026, 1, 5, 10, 30, tzinfo=timezone.utc))
        self.assertIsNone(ticket.sla_paused_at)

    def test_resume_does_not_erase_existing_breach_or_move_completed_response(self):
        due = datetime(2026, 1, 1, 9, tzinfo=timezone.utc)
        ticket = SimpleNamespace(
            sla_paused_at=due + timedelta(hours=1), sla_accumulated_pause_seconds=0,
            sla_resolution_due_at=due, sla_response_due_at=due,
            sla_response_met_at=due, sla_policy=None,
        )
        resume_sla(ticket, due + timedelta(hours=2))
        self.assertEqual(ticket.sla_resolution_due_at, due)
        self.assertEqual(ticket.sla_response_due_at, due)

    def test_calendar_preserves_seconds(self):
        start = datetime(2026, 1, 2, 16, 59, 30, tzinfo=timezone.utc)
        self.assertEqual(add_business_minutes(start, 1, self.calendar()),
                         datetime(2026, 1, 5, 9, 0, 30, tzinfo=timezone.utc))

    def test_sla_is_breached_after_deadline_even_outside_working_hours(self):
        due = datetime(2026, 1, 2, 17, tzinfo=timezone.utc)
        ticket = SimpleNamespace(sla_resolution_due_at=due, sla_response_due_at=None,
                                 created_at=due - timedelta(hours=8),
                                 sla_policy=SimpleNamespace(calendar=self.calendar(), resolution_target_minutes=480))
        self.assertEqual(_sla(ticket, due + timedelta(hours=1))["status"], "BREACHED")

    def test_calendar_uses_elapsed_utc_time_across_dst(self):
        calendar = SimpleNamespace(timezone="America/New_York", holidays=[],
                                   weekly_hours={"sunday": {"start": "00:00", "end": "05:00"}})
        start = datetime(2026, 3, 8, 5, tzinfo=timezone.utc)
        end = datetime(2026, 3, 8, 9, tzinfo=timezone.utc)
        self.assertEqual(business_seconds_between(start, end, calendar), 4 * 3600)
        self.assertEqual(add_business_minutes(start, 180, calendar), start + timedelta(hours=3))

    def test_reopen_clears_completion_and_allows_sla_pause(self):
        resolved = datetime(2026, 1, 1, tzinfo=timezone.utc)
        ticket = SimpleNamespace(id=uuid4(), status="RESOLVED", resolved_at=resolved,
                                 sla_resolution_met_at=resolved, sla_policy_id=uuid4(),
                                 sla_paused_at=None, is_major_incident=False,
                                 resolution_code="FIXED", resolution_summary="Previous evidence")
        db = MagicMock()
        with patch.object(IncidentService, "get_incident", return_value=ticket), \
             patch.object(IncidentService, "_record_activity"), \
             patch.object(IncidentService, "_emit_audit_event"):
            IncidentService.change_status(db, uuid4(), uuid4(), uuid4(),
                                          IncidentStatusUpdateRequest(status="IN_PROGRESS"))
        self.assertIsNone(ticket.resolved_at)
        self.assertIsNone(ticket.sla_resolution_met_at)
        self.assertEqual(ticket.resolution_summary, "Previous evidence")
        pause_sla(ticket, resolved + timedelta(days=1))
        self.assertIsNotNone(ticket.sla_paused_at)


class IncidentOperationsUnitTest(unittest.TestCase):
    def ticket(self, due=None, created=None):
        return SimpleNamespace(sla_resolution_due_at=due, sla_response_due_at=None, created_at=created or datetime(2026, 1, 1, tzinfo=timezone.utc))

    def test_sla_states_are_deterministic(self):
        now = datetime(2026, 1, 1, 7, tzinfo=timezone.utc)
        created = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.assertEqual(_sla(self.ticket(created + timedelta(hours=10), created), now)["status"], "WITHIN_SLA")
        self.assertEqual(_sla(self.ticket(created + timedelta(hours=10), created), datetime(2026, 1, 1, 8, tzinfo=timezone.utc))["status"], "AT_RISK")
        self.assertEqual(_sla(self.ticket(created + timedelta(hours=10), created), datetime(2026, 1, 1, 8, 1, tzinfo=timezone.utc))["status"], "AT_RISK")
        self.assertEqual(_sla(self.ticket(created + timedelta(hours=10), created), datetime(2026, 1, 1, 10, 1, tzinfo=timezone.utc))["status"], "BREACHED")
        self.assertEqual(_sla(self.ticket(), now)["status"], "NO_SLA")

    def test_idle_policy_boundary_is_four_hours(self):
        now = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
        self.assertEqual(IDLE_THRESHOLD, timedelta(hours=4))
        self.assertFalse(now - (now - timedelta(hours=3, minutes=59)) >= IDLE_THRESHOLD)
        self.assertTrue(now - (now - timedelta(hours=4)) >= IDLE_THRESHOLD)
        self.assertTrue(now - (now - timedelta(hours=4, seconds=1)) >= IDLE_THRESHOLD)

    def test_business_calendar_skips_closed_time_and_holidays(self):
        calendar = SimpleNamespace(
            timezone="UTC",
            weekly_hours={day: {"start": "09:00", "end": "17:00"} for day in ("monday", "tuesday", "wednesday", "thursday", "friday")},
            holidays=["2026-01-02"],
        )
        start = datetime(2026, 1, 1, 16, tzinfo=timezone.utc)
        self.assertEqual(add_business_minutes(start, 120, calendar), datetime(2026, 1, 5, 10, tzinfo=timezone.utc))

    def test_paging_destination_respects_recipient_workspace_access(self):
        incident_id = uuid4()
        ticket = SimpleNamespace(id=incident_id)
        command_path = f"/itsm/incident-manager/major-incidents?incident={incident_id}"
        no_bridge = SimpleNamespace(bridge_url=None)
        with_bridge = SimpleNamespace(bridge_url="https://meet.example.test/major-incident")

        self.assertEqual(IncidentService._page_destination(ticket, no_bridge, "INCIDENT_MANAGER", command_path), command_path)
        self.assertEqual(IncidentService._page_destination(ticket, no_bridge, "SERVICE_AGENT", command_path), f"/itsm/incidents/{incident_id}")
        self.assertEqual(
            IncidentService._page_destination(ticket, with_bridge, "SERVICE_AGENT", command_path),
            "https://meet.example.test/major-incident",
        )

class ITSMIncidentTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "INCIDENT_MANAGER"):
        tenant_id = uuid4()
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": tenant_id, "name": f"tenant-{suffix}-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": f"user-{suffix}-{uuid4().hex[:8]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access "
                    "(id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'test-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "key_hash": key_hash,
                    "created_by": user_id,
                },
            )

        return tenant_id, user_id, api_key_str

    def create_fixture_user(self, tenant_id, suffix: str, itsm_role: str):
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'operator', 'NONE', true, now(), now())"
                ),
                {"id": user_id, "tenant_id": tenant_id, "email": f"user-{suffix}-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access "
                    "(id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, false, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'test-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "key_hash": hash_key(api_key_str), "created_by": user_id},
            )
        return user_id, api_key_str

    def create_team(self, tenant_id, name: str, member_ids=()):
        team_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams "
                    "(id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, true, now(), now())"
                ),
                {"id": team_id, "tenant_id": tenant_id, "name": name},
            )
            for user_id in member_ids:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_team_members "
                        "(id, tenant_id, team_id, user_id, created_at) "
                        "VALUES (:id, :tenant_id, :team_id, :user_id, now())"
                    ),
                    {"id": uuid4(), "tenant_id": tenant_id, "team_id": team_id, "user_id": user_id},
                )
        return team_id

    # 1. Create incident
    def test_01_create_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("create")
        headers = {"Authorization": f"Bearer {api_key}"}

        payload = {
            "title": "Database connection latency degraded",
            "description": "Postgres connection pool exhaustion observed on reporting cluster",
            "impact": "HIGH",
            "urgency": "HIGH",
            "source_channel": "PORTAL",
        }
        res = self.client.post("/v1/itsm/incidents", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()

        self.assertEqual(data["title"], payload["title"])
        self.assertEqual(data["ticket_type"], "INCIDENT")
        self.assertTrue(data["ticket_number"].startswith("INC-"))
        self.assertEqual(data["status"], "NEW")
        self.assertEqual(data["priority"], "P1")  # High impact + High urgency = P1
        self.assertEqual(data["requester_id"], str(user_id))

    # 2. Missing required data
    def test_02_create_incident_missing_required_data(self):
        _, _, api_key = self.create_fixture_tenant("missing")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Missing description
        res = self.client.post("/v1/itsm/incidents", json={"title": "Missing desc"}, headers=headers)
        self.assertEqual(res.status_code, 422)

        # Missing title
        res = self.client.post("/v1/itsm/incidents", json={"description": "Missing title"}, headers=headers)
        self.assertEqual(res.status_code, 422)

    # 3. Get single incident
    def test_03_get_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("get")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Single incident test", "description": "Details here"},
            headers=headers,
        )
        self.assertEqual(create_res.status_code, 201)
        incident_id = create_res.json()["id"]

        get_res = self.client.get(f"/v1/itsm/incidents/{incident_id}", headers=headers)
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.json()["id"], incident_id)
        self.assertEqual(get_res.json()["title"], "Single incident test")

    # 4. List incidents
    def test_04_list_incidents(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("list")
        headers = {"Authorization": f"Bearer {api_key}"}

        for i in range(3):
            self.client.post(
                "/v1/itsm/incidents",
                json={"title": f"Incident batch {i}", "description": f"Batch {i}"},
                headers=headers,
            )

        list_res = self.client.get("/v1/itsm/incidents", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        items = list_res.json()
        self.assertGreaterEqual(len(items), 3)

    # 5. Filter incidents
    def test_05_filter_incidents(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("filter")
        headers = {"Authorization": f"Bearer {api_key}"}

        self.client.post(
            "/v1/itsm/incidents",
            json={"title": "SearchTargetAlpha API timeout", "description": "Gateway unreachable", "priority": "P1", "priority_override_reason": "Confirmed critical business impact"},
            headers=headers,
        )
        self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Low priority printer queue", "description": "Paper jam", "priority": "P4", "priority_override_reason": "Single-user peripheral issue"},
            headers=headers,
        )

        # Filter by priority P1
        p1_res = self.client.get("/v1/itsm/incidents?priority=P1", headers=headers)
        self.assertEqual(p1_res.status_code, 200)
        p1_items = p1_res.json()
        self.assertTrue(all(item["priority"] == "P1" for item in p1_items))

        # Search by keyword
        search_res = self.client.get("/v1/itsm/incidents?search=SearchTargetAlpha", headers=headers)
        self.assertEqual(search_res.status_code, 200)
        self.assertEqual(len(search_res.json()), 1)
        self.assertIn("SearchTargetAlpha", search_res.json()[0]["title"])

    # 6. Update incident
    def test_06_update_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("update")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Original Title", "description": "Original description", "impact": "LOW"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]

        patch_res = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}",
            json={"title": "Updated Title", "impact": "CRITICAL"},
            headers=headers,
        )
        self.assertEqual(patch_res.status_code, 200)
        data = patch_res.json()
        self.assertEqual(data["title"], "Updated Title")
        self.assertEqual(data["impact"], "CRITICAL")

    # 7. Assign incident
    def test_07_assign_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("assign")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Create a second user in same tenant to be the assignee
        assignee_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'operator', 'NONE', true, now(), now())"
                ),
                {"id": assignee_id, "tenant_id": tenant_id, "email": "assignee@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access "
                    "(id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, 'SERVICE_AGENT', true, false, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": assignee_id},
            )

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Unassigned incident", "description": "Needs triage"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]
        self.assertEqual(create_res.json()["status"], "NEW")

        rejected_group = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignment_group": "SRE OnCall"},
            headers=headers,
        )
        self.assertEqual(rejected_group.status_code, 400, rejected_group.text)
        self.create_team(tenant_id, "SRE OnCall", [assignee_id])

        assign_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignee_id": str(assignee_id), "assignment_group": "SRE OnCall"},
            headers=headers,
        )
        self.assertEqual(assign_res.status_code, 200)
        data = assign_res.json()
        self.assertEqual(data["assignee_id"], str(assignee_id))
        self.assertEqual(data["assignment_group"], "SRE OnCall")
        self.assertEqual(data["status"], "ASSIGNED")  # Advanced from NEW to ASSIGNED

        assignee_only = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignee_id": str(assignee_id)},
            headers=headers,
        )
        self.assertEqual(assignee_only.status_code, 200, assignee_only.text)
        self.assertEqual(assignee_only.json()["assignment_group"], "SRE OnCall")

        cleared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignee_id": None, "assignment_group": None},
            headers=headers,
        )
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()["assignee_id"])
        self.assertIsNone(cleared.json()["assignment_group"])

    # 8. Valid status transitions
    def test_08_status_transition_valid(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("transitions")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Lifecycle test", "description": "Valid flow", "assignee_id": str(user_id)},
            headers=headers,
        )
        incident_id = create_res.json()["id"]
        self.assertEqual(create_res.json()["status"], "ASSIGNED")

        # ASSIGNED -> IN_PROGRESS
        res = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "IN_PROGRESS")

        # IN_PROGRESS -> PENDING (with reason)
        res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/status",
            json={"status": "PENDING", "status_reason": "Waiting on upstream vendor response"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "PENDING")

        # PENDING -> IN_PROGRESS
        res = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "IN_PROGRESS")

        # IN_PROGRESS -> RESOLVED (with resolution details)
        res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/status",
            json={"status": "RESOLVED", "resolution_code": "FIXED", "resolution_summary": "Restarted pods and flushed cache"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "RESOLVED")
        self.assertIsNotNone(res.json()["resolved_at"])

        # RESOLVED -> CLOSED
        res = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "CLOSED"}, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "CLOSED")
        self.assertIsNotNone(res.json()["closed_at"])

    # 9. Invalid status transitions
    def test_09_status_transition_invalid(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("invalid_transitions")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Invalid transition test", "description": "Check guardrails"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]

        # NEW -> CLOSED directly is disallowed
        res = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "CLOSED"}, headers=headers)
        self.assertEqual(res.status_code, 409)

        # Move to RESOLVED without resolution_code -> 400
        res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/status",
            json={"status": "RESOLVED"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 409)  # Not allowed from NEW anyway

    # 10. Add activity / comment
    def test_10_add_activity_comment(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("comment")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Comment test", "description": "Details"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]

        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            json={"content": "Investigating node metrics now", "activity_type": "COMMENT", "is_internal": False},
            headers=headers,
        )
        self.assertEqual(comment_res.status_code, 201)
        data = comment_res.json()
        self.assertEqual(data["content"], "Investigating node metrics now")
        self.assertEqual(data["activity_type"], "COMMENT")
        self.assertFalse(data["is_internal"])

    # 11. Get activities
    def test_11_get_activities(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("activities_list")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Timeline test", "description": "Details"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]

        # Add comment
        self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            json={"content": "Second note", "activity_type": "NOTE"},
            headers=headers,
        )

        act_res = self.client.get(f"/v1/itsm/incidents/{incident_id}/activities", headers=headers)
        self.assertEqual(act_res.status_code, 200)
        acts = act_res.json()
        self.assertGreaterEqual(len(acts), 2)  # CREATED + NOTE
        types = [a["activity_type"] for a in acts]
        self.assertIn("CREATED", types)
        self.assertIn("NOTE", types)

    # 12. Tenant isolation
    def test_12_tenant_isolation(self):
        tenant_a, user_a, key_a = self.create_fixture_tenant("tenant_a")
        tenant_b, user_b, key_b = self.create_fixture_tenant("tenant_b")

        headers_a = {"Authorization": f"Bearer {key_a}"}
        headers_b = {"Authorization": f"Bearer {key_b}"}

        # Create incident in Tenant A
        res_a = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Tenant A Secret Incident", "description": "Confidential"},
            headers=headers_a,
        )
        incident_a_id = res_a.json()["id"]

        # Tenant B cannot get Tenant A's incident
        res_b_get = self.client.get(f"/v1/itsm/incidents/{incident_a_id}", headers=headers_b)
        self.assertEqual(res_b_get.status_code, 404)

        # Tenant B listing does not contain Tenant A's incident
        res_b_list = self.client.get("/v1/itsm/incidents", headers=headers_b)
        self.assertEqual(res_b_list.status_code, 200)
        self.assertFalse(any(i["id"] == incident_a_id for i in res_b_list.json()))

    # 13. Unauthorized access
    def test_13_unauthorized_access(self):
        # Missing header
        res = self.client.get("/v1/itsm/incidents")
        self.assertEqual(res.status_code, 401)

        # Bad key
        res = self.client.get("/v1/itsm/incidents", headers={"Authorization": "Bearer invalid-key"})
        self.assertEqual(res.status_code, 401)

    # 14. Invalid assignee
    def test_14_invalid_assignee(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("bad_assignee")
        headers = {"Authorization": f"Bearer {api_key}"}

        foreign_user_id = str(uuid4())
        res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Bad assignee test", "description": "Details", "assignee_id": foreign_user_id},
            headers=headers,
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid Assignee", res.json()["detail"])

    # 15. Ticket number uniqueness
    def test_15_ticket_number_uniqueness(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("numbering")
        headers = {"Authorization": f"Bearer {api_key}"}

        numbers = set()
        for i in range(5):
            res = self.client.post(
                "/v1/itsm/incidents",
                json={"title": f"Incident {i}", "description": f"Details {i}"},
                headers=headers,
            )
            self.assertEqual(res.status_code, 201)
            num = res.json()["ticket_number"]
            self.assertNotIn(num, numbers)
            numbers.add(num)

        self.assertEqual(len(numbers), 5)

    # 16. Concurrent ticket number generation
    def test_16_concurrent_ticket_number_generation(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("concurrency")
        headers = {"Authorization": f"Bearer {api_key}"}

        def create_one(idx: int):
            return self.client.post(
                "/v1/itsm/incidents",
                json={"title": f"Concurrent Incident {idx}", "description": "Stress testing counter"},
                headers=headers,
            )

        with ThreadPoolExecutor(max_workers=5) as executor:
            responses = list(executor.map(create_one, range(8)))

        self.assertTrue(all(r.status_code == 201 for r in responses))
        numbers = [r.json()["ticket_number"] for r in responses]
        self.assertEqual(len(numbers), len(set(numbers)), f"Duplicate ticket numbers found: {numbers}")

    # 17. Incident endpoint does not return service requests
    def test_17_incident_endpoint_does_not_return_service_requests(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("no_sr")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Directly insert a SERVICE_REQUEST ticket in database
        sr_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, requester_id, status, priority, source_channel, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'REQ-000001', 'SERVICE_REQUEST', 'New Laptop Request', 'Need MacBook Pro', :user_id, 'NEW', 'P3', 'PORTAL', now(), now())"
                ),
                {"id": sr_id, "tenant_id": tenant_id, "user_id": user_id},
            )

        # GET /v1/itsm/incidents must not include SERVICE_REQUEST
        res = self.client.get("/v1/itsm/incidents", headers=headers)
        self.assertEqual(res.status_code, 200)
        returned_ids = [t["id"] for t in res.json()]
        self.assertNotIn(str(sr_id), returned_ids)

        # GET /v1/itsm/incidents/{sr_id} must return 404
        get_res = self.client.get(f"/v1/itsm/incidents/{sr_id}", headers=headers)
        self.assertEqual(get_res.status_code, 404)

    # 18. Incident endpoint does not return problems
    def test_18_incident_endpoint_does_not_return_problems(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("no_problem")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Directly insert a PROBLEM ticket in database
        prb_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, requester_id, status, priority, source_channel, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-000001', 'PROBLEM', 'Recurring memory leak on redis cache', 'Root cause investigation', :user_id, 'NEW', 'P2', 'PORTAL', now(), now())"
                ),
                {"id": prb_id, "tenant_id": tenant_id, "user_id": user_id},
            )

        # GET /v1/itsm/incidents must not include PROBLEM
        res = self.client.get("/v1/itsm/incidents", headers=headers)
        self.assertEqual(res.status_code, 200)
        returned_ids = [t["id"] for t in res.json()]
        self.assertNotIn(str(prb_id), returned_ids)

        # GET /v1/itsm/incidents/{prb_id} must return 404
        get_res = self.client.get(f"/v1/itsm/incidents/{prb_id}", headers=headers)
        self.assertEqual(get_res.status_code, 404)

    # 19. Audit behavior
    def test_19_audit_behavior(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("audit")
        headers = {"Authorization": f"Bearer {api_key}"}

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Audit verification incident", "description": "Verify audit trail"},
            headers=headers,
        )
        self.assertEqual(create_res.status_code, 201)
        incident_id = create_res.json()["id"]

        # Check that activities exist for the incident
        act_res = self.client.get(f"/v1/itsm/incidents/{incident_id}/activities", headers=headers)
        self.assertEqual(act_res.status_code, 200)
        self.assertGreaterEqual(len(act_res.json()), 1)
        self.assertEqual(act_res.json()[0]["activity_type"], "CREATED")

    def test_20_incident_manager_can_declare_and_update_major_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("major", itsm_role="INCIDENT_MANAGER")
        self.create_team(tenant_id, "Incident Response", [user_id])
        service_id, ci_id = uuid4(), uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,created_at,updated_at) VALUES (:id,:tenant,'Payments','payments-command','TIER_1','OPERATIONAL',now(),now())"),
                {"id": service_id, "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_configuration_items (id,tenant_id,service_id,name,ci_type,environment,status,attributes,created_at,updated_at) VALUES (:id,:tenant,:service,'Payments API','APPLICATION','PRODUCTION','ACTIVE','{}'::jsonb,now(),now())"),
                {"id": ci_id, "tenant": tenant_id, "service": service_id},
            )
        headers = {"Authorization": f"Bearer {api_key}"}
        participants = self.client.get(
            "/v1/itsm/incidents/operations/participants",
            headers=headers,
        )
        self.assertEqual(participants.status_code, 200, participants.text)
        self.assertIn(str(user_id), {item["id"] for item in participants.json()})
        created = self.client.post("/v1/itsm/incidents", json={"title": "Payments outage", "description": "Payment processing is unavailable", "priority": "P1", "priority_override_reason": "Payment service unavailable"}, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]

        declared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={
                "communication_lead_id": str(user_id),
                "communication_channel": "war-room",
                "impacted_business_units": ["Payments"],
                "affected_service_ids": [str(service_id)],
                "affected_configuration_item_ids": [str(ci_id)],
                "executive_summary": "Customer payments unavailable",
                "bridge_url": "https://bridge.example.com/payments-war-room",
                "restoration_checkpoints": [{"title": "Failover completed", "owner_id": str(user_id)}],
                "command_decisions": [{"summary": "Fail over payments traffic", "owner_id": str(user_id)}],
                "command_tasks": [{"title": "Validate recovery", "owner_id": str(user_id)}],
                "stakeholders": [{"name": "Payments Operations", "role": "Business owner"}],
                "command_communications": [{"audience": "Support", "channel": "war-room", "message": "Investigation is active"}],
            },
            headers=headers,
        )
        self.assertEqual(declared.status_code, 201, declared.text)
        self.assertEqual(declared.json()["communication_channel"], "war-room")
        self.assertEqual(declared.json()["bridge_url"], "https://bridge.example.com/payments-war-room")
        self.assertEqual(declared.json()["executive_summary"], "Customer payments unavailable")
        self.assertEqual(declared.json()["impacted_business_units"], ["Payments"])
        self.assertEqual(declared.json()["communication_lead_id"], str(user_id))
        self.assertEqual(declared.json()["affected_service_ids"], [str(service_id)])
        self.assertEqual(declared.json()["affected_configuration_item_ids"], [str(ci_id)])
        self.assertEqual(declared.json()["restoration_checkpoints"][0]["title"], "Failover completed")
        self.assertEqual(declared.json()["command_decisions"][0]["summary"], "Fail over payments traffic")
        self.assertEqual(declared.json()["command_tasks"][0]["title"], "Validate recovery")
        self.assertEqual(declared.json()["stakeholders"][0]["name"], "Payments Operations")
        self.assertEqual(declared.json()["command_communications"][0]["status"], "DRAFT")
        self.assertEqual(declared.json()["postmortem_status"], "PENDING")

        updated = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={"postmortem_status": "IN_PROGRESS", "bridge_url": "https://bridge.example.com/updated"},
            headers=headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["postmortem_status"], "IN_PROGRESS")
        self.assertEqual(updated.json()["bridge_url"], "https://bridge.example.com/updated")

        read_command = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            headers=headers,
        )
        self.assertEqual(read_command.status_code, 200, read_command.text)
        self.assertEqual(read_command.json()["postmortem_status"], "IN_PROGRESS")
        self.assertEqual(read_command.json()["bridge_url"], "https://bridge.example.com/updated")
        self.assertEqual(read_command.json()["communication_lead_id"], str(user_id))
        self.assertEqual(read_command.json()["affected_service_ids"], [str(service_id)])
        self.assertEqual(read_command.json()["command_tasks"][0]["title"], "Validate recovery")

        invalid_pir = self.client.patch(f"/v1/itsm/incidents/{incident_id}/major-incident", json={"postmortem_status": "MADE_UP"}, headers=headers)
        self.assertEqual(invalid_pir.status_code, 422)

        _, foreign_user_id, foreign_key = self.create_fixture_tenant("major_foreign")
        invalid_commander = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={"incident_commander_id": str(foreign_user_id)},
            headers=headers,
        )
        self.assertEqual(invalid_commander.status_code, 400)

        foreign_headers = {"Authorization": f"Bearer {foreign_key}"}
        foreign_incident = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Foreign tenant outage", "description": "Must remain isolated", "priority": "P1", "priority_override_reason": "Tenant-wide outage"},
            headers=foreign_headers,
        )
        self.assertEqual(foreign_incident.status_code, 201, foreign_incident.text)
        foreign_incident_id = foreign_incident.json()["id"]
        self.assertEqual(
            self.client.post(
                f"/v1/itsm/incidents/{foreign_incident_id}/major-incident",
                json={},
                headers=foreign_headers,
            ).status_code,
            201,
        )
        self.assertEqual(
            self.client.get(
                f"/v1/itsm/incidents/{foreign_incident_id}/major-incident",
                headers=headers,
            ).status_code,
            404,
        )
        participants_after_foreign_tenant = self.client.get(
            "/v1/itsm/incidents/operations/participants",
            headers=headers,
        ).json()
        self.assertNotIn(
            str(foreign_user_id),
            {item["id"] for item in participants_after_foreign_tenant},
        )

        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/assign", json={"assignment_group": "Incident Response"}, headers=headers).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers).status_code, 200)
        resolved = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "RESOLVED", "resolution_code": "PERMANENT_FIX", "resolution_summary": "Payments restored"}, headers=headers)
        self.assertEqual(resolved.status_code, 200, resolved.text)
        command_after_restore = self.client.get(f"/v1/itsm/incidents/{incident_id}/major-incident", headers=headers)
        self.assertIsNotNone(command_after_restore.json()["resolved_at"])

        closed = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "CLOSED"}, headers=headers)
        self.assertEqual(closed.status_code, 200, closed.text)
        command_after_close = self.client.get(f"/v1/itsm/incidents/{incident_id}/major-incident", headers=headers)
        self.assertIsNotNone(command_after_close.json()["closed_at"])

    def test_28_command_ownership_and_communication_approval_are_enforced(self):
        tenant_id, manager_id, key = self.create_fixture_tenant("command_controls")
        headers = {"Authorization": f"Bearer {key}"}
        agent_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(text("INSERT INTO public.users (id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) VALUES (:id,:tenant,'agent-controls@example.com','developer','NONE',true,now(),now())"), {"id": agent_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_user_access (id,tenant_id,user_id,itsm_role,has_itsm_access,has_governance_access,created_at,updated_at) VALUES (:id,:tenant,:user,'SERVICE_AGENT',true,false,now(),now())"), {"id": uuid4(), "tenant": tenant_id, "user": agent_id})
        created = self.client.post("/v1/itsm/incidents", json={"title": "Command controls", "description": "Verify actual command permissions"}, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        path = f"/v1/itsm/incidents/{created.json()['id']}/major-incident"
        invalid = self.client.post(path, json={"incident_commander_id": str(agent_id)}, headers=headers)
        self.assertEqual(invalid.status_code, 400, invalid.text)
        declared = self.client.post(path, json={}, headers=headers)
        self.assertEqual(declared.status_code, 201, declared.text)
        references = self.client.get("/v1/itsm/incidents/operations/reference-data", headers=headers).json()
        self.assertIn(str(agent_id), {item["id"] for item in references["users"]})
        self.assertNotIn(str(agent_id), {item["id"] for item in references["commanders"]})
        self.assertIn(str(manager_id), {item["id"] for item in references["commanders"]})

        other_manager_id, other_key = uuid4(), f"test-key-command-review-{uuid4().hex}"
        with self.migrator_engine.begin() as conn:
            conn.execute(text("INSERT INTO public.users (id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) VALUES (:id,:tenant,'reviewer-controls@example.com','admin','NONE',true,now(),now())"), {"id": other_manager_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_user_access (id,tenant_id,user_id,itsm_role,has_itsm_access,has_governance_access,created_at,updated_at) VALUES (:id,:tenant,:user,'INCIDENT_MANAGER',true,false,now(),now())"), {"id": uuid4(), "tenant": tenant_id, "user": other_manager_id})
            conn.execute(text("INSERT INTO public.api_keys (id,tenant_id,key_hash,name,scopes,is_active,created_by,created_at,updated_at) VALUES (:id,:tenant,:hash,'reviewer-controls',ARRAY['read','write','admin'],true,:user,now(),now())"), {"id": uuid4(), "tenant": tenant_id, "hash": hash_key(other_key), "user": other_manager_id})
        other_headers = {"Authorization": f"Bearer {other_key}"}

        handed_off = self.client.patch(path, json={"incident_commander_id": str(other_manager_id)}, headers=headers)
        self.assertEqual(handed_off.status_code, 200, handed_off.text)
        self.assertEqual(self.client.get(path, headers=other_headers).status_code, 200)
        removed = self.client.patch(path, json={"incident_commander_id": None}, headers=headers)
        self.assertEqual(removed.status_code, 400, removed.text)

    def test_21_non_incident_manager_cannot_assign_or_declare_major_incident(self):
        _, _, api_key = self.create_fixture_tenant("role_guard", itsm_role="SERVICE_AGENT")
        headers = {"Authorization": f"Bearer {api_key}"}
        created = self.client.post("/v1/itsm/incidents", json={"title": "Role guard", "description": "Verify Incident Manager authorization"}, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]

        self.assertEqual(self.client.patch(f"/v1/itsm/incidents/{incident_id}", json={"priority": "P1"}, headers=headers).status_code, 403)
        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/assign", json={"assignment_group": "Operations"}, headers=headers).status_code, 403)
        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/major-incident", json={}, headers=headers).status_code, 403)
        self.assertEqual(self.client.get(f"/v1/itsm/incidents/{uuid4()}/major-incident", headers=headers).status_code, 403)
        self.assertEqual(self.client.patch(f"/v1/itsm/incidents/{uuid4()}/major-incident", json={}, headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/participants", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/participants").status_code, 401)

    def test_22_operations_dashboard_requires_incident_manager(self):
        _, _, manager_key = self.create_fixture_tenant("dashboard_manager")
        _, _, agent_key = self.create_fixture_tenant("dashboard_agent", itsm_role="SERVICE_AGENT")
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/dashboard", headers={"Authorization": f"Bearer {manager_key}"}).status_code, 200)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/dashboard", headers={"Authorization": f"Bearer {agent_key}"}).status_code, 403)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/dashboard").status_code, 401)

    def test_23_operations_dashboard_aggregates_reasons_workload_and_tenant(self):
        tenant_id, user_id, manager_key = self.create_fixture_tenant("dashboard_complete")
        self.create_team(tenant_id, "Incident Response", [user_id])
        other_tenant_id, _, other_key = self.create_fixture_tenant("dashboard_other")
        headers = {"Authorization": f"Bearer {manager_key}"}

        def create(title: str, priority: str) -> str:
            response = self.client.post(
                "/v1/itsm/incidents",
                json={"title": title, "description": title, "priority": priority, "priority_override_reason": "Deterministic operations fixture"},
                headers=headers,
            )
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()["id"]

        p1_id = create("Priority one", "P1")
        p2_id = create("Priority two", "P2")
        risk_id = create("SLA risk", "P3")
        breach_id = create("SLA breach", "P3")
        stuck_id = create("Stuck incident", "P3")
        healthy_id = create("Healthy incident", "P3")
        assigned = self.client.post(
            f"/v1/itsm/incidents/{p1_id}/assign",
            json={"assignment_group": "Incident Response", "assignee_id": str(user_id)},
            headers=headers,
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)

        with self.migrator_engine.begin() as conn:
            conn.execute(text("UPDATE public.itsm_tickets SET created_at=now()-interval '8 hours', sla_resolution_due_at=now()+interval '2 hours' WHERE id=:id AND tenant_id=:tenant"), {"id": risk_id, "tenant": tenant_id})
            conn.execute(text("UPDATE public.itsm_tickets SET sla_resolution_due_at=now()-interval '1 hour' WHERE id=:id AND tenant_id=:tenant"), {"id": breach_id, "tenant": tenant_id})
            conn.execute(text("UPDATE public.itsm_tickets SET created_at=now(), sla_resolution_due_at=now()+interval '10 hours' WHERE id=:id AND tenant_id=:tenant"), {"id": healthy_id, "tenant": tenant_id})
            conn.execute(text("UPDATE public.itsm_tickets SET updated_at=now()-interval '5 hours' WHERE id=:id AND tenant_id=:tenant"), {"id": stuck_id, "tenant": tenant_id})
            conn.execute(text("UPDATE public.itsm_ticket_activities SET created_at=now()-interval '5 hours' WHERE ticket_id=:id AND tenant_id=:tenant"), {"id": stuck_id, "tenant": tenant_id})

        other_created = self.client.post("/v1/itsm/incidents", json={"title": "Other tenant P1", "description": "Must remain isolated", "priority": "P1", "priority_override_reason": "Tenant isolation fixture"}, headers={"Authorization": f"Bearer {other_key}"})
        self.assertEqual(other_created.status_code, 201, other_created.text)

        response = self.client.get(f"/v1/itsm/incidents/operations/dashboard?tenant_id={other_tenant_id}", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        dashboard = response.json()
        self.assertEqual(dashboard["summary"], {"open_incidents": 6, "p1_p2": 2, "sla_at_risk": 1, "sla_breached": 1, "stuck": 1, "unassigned": 5, "active_major_incidents": 0, "escalation_watch": 5})
        items = {item["incident_id"]: item for item in dashboard["escalation_watch"]}
        self.assertEqual(items[p1_id]["attention_reasons"], ["HIGH_PRIORITY"])
        self.assertEqual(items[p2_id]["attention_reasons"], ["HIGH_PRIORITY"])
        self.assertEqual(items[risk_id]["attention_reasons"], ["SLA_AT_RISK"])
        self.assertEqual(items[breach_id]["attention_reasons"], ["SLA_BREACHED"])
        self.assertEqual(items[stuck_id]["attention_reasons"], ["STUCK_IDLE"])
        self.assertNotIn(healthy_id, items)
        self.assertNotIn(other_created.json()["id"], items)
        self.assertEqual(dashboard["policy"]["risk_remaining_fraction"], 0.20)
        self.assertEqual(dashboard["policy"]["idle_threshold_seconds"], 14400)
        group = next(row for row in dashboard["workload"]["assignment_groups"] if row["key"] == "Incident Response")
        self.assertEqual(group["open_incidents"], 1)
        self.assertEqual(group["p1_p2"], 1)
        assignee = next(row for row in dashboard["workload"]["assignees"] if row["key"] == str(user_id))
        self.assertIn("@example.com", assignee["label"])

    def test_24_operations_queue_filters_paginates_and_isolates_tenant(self):
        tenant_id, user_id, manager_key = self.create_fixture_tenant("operations_queue")
        self.create_team(tenant_id, "Incident Response", [user_id])
        _, _, agent_key = self.create_fixture_tenant("operations_queue_agent", itsm_role="SERVICE_AGENT")
        other_tenant_id, _, other_key = self.create_fixture_tenant("operations_queue_other")
        headers = {"Authorization": f"Bearer {manager_key}"}

        def create(title: str, priority: str) -> str:
            response = self.client.post(
                "/v1/itsm/incidents",
                json={"title": title, "description": title, "priority": priority, "priority_override_reason": "Deterministic queue fixture"},
                headers=headers,
            )
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()["id"]

        p1_id = create("Payments unavailable", "P1")
        p2_id = create("Checkout degraded", "P2")
        p3_id = create("Printer unavailable", "P3")
        assigned = self.client.post(
            f"/v1/itsm/incidents/{p1_id}/assign",
            json={"assignment_group": "Incident Response", "assignee_id": str(user_id)},
            headers=headers,
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)
        other = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Other tenant major", "description": "isolated", "priority": "P1", "priority_override_reason": "Tenant isolation fixture"},
            headers={"Authorization": f"Bearer {other_key}"},
        )
        self.assertEqual(other.status_code, 201, other.text)

        response = self.client.get(
            f"/v1/itsm/incidents/operations/queue?tenant_id={other_tenant_id}&limit=2",
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        queue = response.json()
        self.assertEqual(queue["total"], 3)
        self.assertEqual([row["incident"]["id"] for row in queue["items"]], [p1_id, p2_id])
        self.assertNotIn(other.json()["id"], [row["incident"]["id"] for row in queue["items"]])
        self.assertEqual(queue["items"][0]["operations"]["attention_reasons"], ["HIGH_PRIORITY"])

        group = self.client.get(
            "/v1/itsm/incidents/operations/queue?assignment_group=Incident%20Response",
            headers=headers,
        ).json()
        self.assertEqual(group["total"], 1)
        self.assertEqual(group["items"][0]["incident"]["id"], p1_id)
        assignee = self.client.get(
            f"/v1/itsm/incidents/operations/queue?assignee_id={user_id}",
            headers=headers,
        ).json()
        self.assertEqual(assignee["total"], 1)
        unassigned = self.client.get(
            "/v1/itsm/incidents/operations/queue?unassigned=true",
            headers=headers,
        ).json()
        self.assertEqual(unassigned["total"], 2)
        self.assertEqual(
            {row["incident"]["id"] for row in unassigned["items"]},
            {p2_id, p3_id},
        )
        self.assertTrue(
            all(row["incident"]["assignee_id"] is None for row in unassigned["items"])
        )
        self.assertEqual(
            self.client.get(
                f"/v1/itsm/incidents/operations/queue?unassigned=true&assignee_id={user_id}",
                headers=headers,
            ).status_code,
            422,
        )

        attention = self.client.get(
            "/v1/itsm/incidents/operations/queue?attention=PRIORITY",
            headers=headers,
        ).json()
        self.assertEqual({row["incident"]["id"] for row in attention["items"]}, {p1_id, p2_id})
        command = self.client.get(
            "/v1/itsm/incidents/operations/queue?command_scope=true",
            headers=headers,
        ).json()
        self.assertEqual({row["incident"]["id"] for row in command["items"]}, {p1_id, p2_id})
        self.assertNotIn(p3_id, {row["incident"]["id"] for row in command["items"]})

        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/queue").status_code, 401)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/queue", headers={"Authorization": f"Bearer {agent_key}"}).status_code, 403)
        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/queue?attention=UNKNOWN", headers=headers).status_code, 422)

    def test_25_incident_manager_reference_data_classification_and_major_scope_are_tenant_safe(self):
        tenant_id, _, manager_key = self.create_fixture_tenant("coordination_refs")
        foreign_tenant_id, _, _ = self.create_fixture_tenant("coordination_refs_foreign")
        headers = {"Authorization": f"Bearer {manager_key}"}
        service_id, category_id, ci_id, team_id = uuid4(), uuid4(), uuid4(), uuid4()
        foreign_service_id = uuid4()
        with self.migrator_engine.begin() as conn:
            teams_available = bool(conn.execute(text("SELECT to_regclass('public.itsm_teams') IS NOT NULL")).scalar())
            conn.execute(text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,created_at,updated_at) VALUES (:id,:tenant,'Payments','payments-ref','TIER_1','OPERATIONAL',now(),now())"), {"id": service_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_ticket_categories (id,tenant_id,name,code,is_active,display_order,created_at) VALUES (:id,:tenant,'Application','APP',true,1,now())"), {"id": category_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_configuration_items (id,tenant_id,service_id,name,ci_type,environment,status,attributes,created_at,updated_at) VALUES (:id,:tenant,:service,'Payments API','APPLICATION','PRODUCTION','ACTIVE','{}'::jsonb,now(),now())"), {"id": ci_id, "tenant": tenant_id, "service": service_id})
            if teams_available:
                conn.execute(text("INSERT INTO public.itsm_teams (id,tenant_id,name,is_active,created_at,updated_at) VALUES (:id,:tenant,'Payments Support',true,now(),now())"), {"id": team_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,created_at,updated_at) VALUES (:id,:tenant,'Foreign Service','foreign-ref','TIER_1','OPERATIONAL',now(),now())"), {"id": foreign_service_id, "tenant": foreign_tenant_id})

        references = self.client.get("/v1/itsm/incidents/operations/reference-data", headers=headers)
        self.assertEqual(references.status_code, 200, references.text)
        reference_data = references.json()
        self.assertIn(str(service_id), {item["id"] for item in reference_data["services"]})
        self.assertIn(str(category_id), {item["id"] for item in reference_data["categories"]})
        self.assertIn(str(ci_id), {item["id"] for item in reference_data["configuration_items"]})
        if teams_available:
            self.assertIn("Payments Support", {item["name"] for item in reference_data["teams"]})
        self.assertNotIn(str(foreign_service_id), {item["id"] for item in reference_data["services"]})

        created = self.client.post("/v1/itsm/incidents", json={"title": "Payments degraded", "description": "Classification test"}, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]
        if teams_available:
            self.assertEqual(
                self.client.post(
                    f"/v1/itsm/incidents/{incident_id}/assign",
                    json={"assignment_group": "Invented Team"},
                    headers=headers,
                ).status_code,
                400,
            )
        assigned = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignment_group": "Payments Support"},
            headers=headers,
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)
        classified = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}",
            json={"service_id": str(service_id), "category_id": str(category_id)},
            headers=headers,
        )
        self.assertEqual(classified.status_code, 200, classified.text)
        self.assertEqual(classified.json()["service_id"], str(service_id))
        self.assertEqual(classified.json()["category_id"], str(category_id))
        service_queue = self.client.get(
            f"/v1/itsm/incidents/operations/queue?service_id={service_id}",
            headers=headers,
        )
        self.assertEqual(service_queue.status_code, 200, service_queue.text)
        self.assertEqual(
            {item["incident"]["id"] for item in service_queue.json()["items"]},
            {incident_id},
        )
        category_queue = self.client.get(
            f"/v1/itsm/incidents/operations/queue?category_id={category_id}",
            headers=headers,
        )
        self.assertEqual(category_queue.status_code, 200, category_queue.text)
        self.assertEqual(
            {item["incident"]["id"] for item in category_queue.json()["items"]},
            {incident_id},
        )

        cleared = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}",
            json={"service_id": None, "category_id": None},
            headers=headers,
        )
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()["service_id"])
        self.assertIsNone(cleared.json()["category_id"])

        declared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={"executive_summary": "Major service failure"},
            headers=headers,
        )
        self.assertEqual(declared.status_code, 201, declared.text)
        self.assertEqual(declared.json()["executive_summary"], "Major service failure")

        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/reference-data").status_code, 401)

    def test_26_mvp_sla_priority_routing_and_saved_views(self):
        tenant_id, _, manager_key = self.create_fixture_tenant("mvp_controls")
        _, _, foreign_key = self.create_fixture_tenant("mvp_controls_foreign")
        headers = {"Authorization": f"Bearer {manager_key}"}
        service_id, calendar_id, policy_id = uuid4(), uuid4(), uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(text("INSERT INTO public.itsm_teams (id,tenant_id,name,is_active,created_at,updated_at) VALUES (:id,:tenant,'Payments Support',true,now(),now())"), {"id": uuid4(), "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,escalation_team,created_at,updated_at) VALUES (:id,:tenant,'Payments','payments-mvp','TIER_1','OPERATIONAL','Payments Support',now(),now())"), {"id": service_id, "tenant": tenant_id})
            conn.execute(text("""INSERT INTO public.itsm_business_calendars (id,tenant_id,name,timezone,weekly_hours,holidays,is_default,created_at,updated_at)
                VALUES (:id,:tenant,'Always open','UTC','{"monday":{"start":"00:00","end":"23:59"},"tuesday":{"start":"00:00","end":"23:59"},"wednesday":{"start":"00:00","end":"23:59"},"thursday":{"start":"00:00","end":"23:59"},"friday":{"start":"00:00","end":"23:59"},"saturday":{"start":"00:00","end":"23:59"},"sunday":{"start":"00:00","end":"23:59"}}'::jsonb,'[]'::jsonb,true,now(),now())"""), {"id": calendar_id, "tenant": tenant_id})
            conn.execute(text("INSERT INTO public.itsm_sla_policies (id,tenant_id,calendar_id,name,ticket_type,priority,service_id,response_target_minutes,resolution_target_minutes,is_active,created_at,updated_at) VALUES (:id,:tenant,:calendar,'P1 Payments','INCIDENT','P1',:service,15,120,true,now(),now())"), {"id": policy_id, "tenant": tenant_id, "calendar": calendar_id, "service": service_id})

        created = self.client.post("/v1/itsm/incidents", json={
            "title": "Payments unavailable", "description": "Checkout failures",
            "impact": "HIGH", "urgency": "HIGH", "service_id": str(service_id),
        }, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        incident = created.json()
        self.assertEqual(incident["priority"], "P1")
        self.assertEqual(incident["assignment_group"], "Payments Support")
        self.assertEqual(incident["status"], "ASSIGNED")
        self.assertEqual(incident["sla_policy_id"], str(policy_id))
        self.assertIsNotNone(incident["sla_response_due_at"])
        self.assertIsNotNone(incident["sla_resolution_due_at"])
        self.assertIsNotNone(incident["sla_response_met_at"])

        incident_id = incident["id"]
        recalculated = self.client.patch(f"/v1/itsm/incidents/{incident_id}", json={"impact": "LOW", "urgency": "LOW"}, headers=headers)
        self.assertEqual(recalculated.status_code, 200, recalculated.text)
        self.assertEqual(recalculated.json()["priority"], "P4")
        denied_override = self.client.patch(f"/v1/itsm/incidents/{incident_id}", json={"priority": "P1"}, headers=headers)
        self.assertEqual(denied_override.status_code, 400, denied_override.text)
        approved_override = self.client.patch(f"/v1/itsm/incidents/{incident_id}", json={"priority": "P1", "priority_override_reason": "Confirmed organization-wide payment failure"}, headers=headers)
        self.assertEqual(approved_override.status_code, 200, approved_override.text)

        self.assertEqual(self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers).status_code, 200)
        paused = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "PENDING", "status_reason": "PENDING_VENDOR"}, headers=headers)
        self.assertEqual(paused.status_code, 200, paused.text)
        due_before = datetime.fromisoformat(paused.json()["sla_resolution_due_at"])
        with self.migrator_engine.begin() as conn:
            conn.execute(text("UPDATE public.itsm_tickets SET sla_paused_at=now()-interval '5 minutes' WHERE id=:id AND tenant_id=:tenant"), {"id": incident_id, "tenant": tenant_id})
        resumed = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", json={"status": "IN_PROGRESS"}, headers=headers)
        self.assertEqual(resumed.status_code, 200, resumed.text)
        self.assertGreaterEqual(resumed.json()["sla_accumulated_pause_seconds"], 299)
        self.assertGreater(datetime.fromisoformat(resumed.json()["sla_resolution_due_at"]), due_before)

        self.assertEqual(self.client.get("/v1/itsm/incidents/operations/saved-views", headers=headers).json(), [])
        saved_view = self.client.post(
            "/v1/itsm/incidents/operations/saved-views",
            json={"name": "Payment incidents", "filters": {"search": incident["ticket_number"], "sort_by": "priority"}},
            headers=headers,
        )
        self.assertEqual(saved_view.status_code, 201, saved_view.text)
        self.assertEqual(saved_view.json()["filters"]["search"], incident["ticket_number"])
        self.assertEqual(
            self.client.get("/v1/itsm/incidents/operations/saved-views", headers=headers).json()[0]["name"],
            "Payment incidents",
        )


    def test_27_reopen_and_classification_validation_through_api(self):
        tenant_id, _, key = self.create_fixture_tenant("readiness_regression")
        headers = {"Authorization": f"Bearer {key}"}
        for field in ("impact", "urgency"):
            rejected = self.client.post("/v1/itsm/incidents", headers=headers, json={
                "title": "Invalid classification", "description": "Regression", field: "INVALID",
            })
            self.assertEqual(rejected.status_code, 422, rejected.text)
        created = self.client.post("/v1/itsm/incidents", headers=headers, json={
            "title": "Reopen regression", "description": "Preserve evidence and resume SLA",
        })
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]
        rejected = self.client.patch(f"/v1/itsm/incidents/{incident_id}",
                                     headers=headers, json={"impact": "INVALID"})
        self.assertEqual(rejected.status_code, 422, rejected.text)
        for payload in (
            {"status": "IN_PROGRESS"},
            {"status": "RESOLVED", "resolution_code": "FIXED", "resolution_summary": "Recovery verified"},
            {"status": "IN_PROGRESS"},
        ):
            result = self.client.post(f"/v1/itsm/incidents/{incident_id}/status", headers=headers, json=payload)
            self.assertEqual(result.status_code, 200, result.text)
        with self.migrator_engine.connect() as conn:
            row = conn.execute(text("SELECT resolved_at, sla_resolution_met_at, resolution_summary FROM public.itsm_tickets WHERE id=:id AND tenant_id=:tenant"),
                               {"id": incident_id, "tenant": tenant_id}).one()
        self.assertIsNone(row.resolved_at)
        self.assertIsNone(row.sla_resolution_met_at)
        self.assertEqual(row.resolution_summary, "Recovery verified")

    def test_30_major_incident_page_resolves_on_call_notifies_and_audits(self):
        tenant_id, manager_id, manager_key = self.create_fixture_tenant("major_page")
        responder_id = uuid4()
        responder_key = f"test-key-major-page-responder-{uuid4().hex}"
        service_id, schedule_id = uuid4(), uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO public.users (id,tenant_id,email,role,platform_role,is_active,created_at,updated_at) VALUES (:id,:tenant,'oncall-manager@example.com','admin','NONE',true,now(),now())"),
                {"id": responder_id, "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_user_access (id,tenant_id,user_id,itsm_role,has_itsm_access,has_governance_access,created_at,updated_at) VALUES (:id,:tenant,:user,'INCIDENT_MANAGER',true,false,now(),now())"),
                {"id": uuid4(), "tenant": tenant_id, "user": responder_id},
            )
            conn.execute(
                text("INSERT INTO public.api_keys (id,tenant_id,key_hash,name,scopes,is_active,created_by,created_at,updated_at) VALUES (:id,:tenant,:hash,'major-page-responder',ARRAY['read','write','admin'],true,:user,now(),now())"),
                {"id": uuid4(), "tenant": tenant_id, "hash": hash_key(responder_key), "user": responder_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_teams (id,tenant_id,name,is_active,created_at,updated_at) VALUES (:id,:tenant,'Checkout Support',true,now(),now())"),
                {"id": uuid4(), "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,escalation_team,created_at,updated_at) VALUES (:id,:tenant,'Checkout','checkout-page','TIER_1','OPERATIONAL','Checkout Support',now(),now())"),
                {"id": service_id, "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_oncall_schedules (id,tenant_id,service_id,name,timezone,is_active,created_at,updated_at) VALUES (:id,:tenant,:service,'Checkout primary','UTC',true,now(),now())"),
                {"id": schedule_id, "tenant": tenant_id, "service": service_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_oncall_rotations (id,tenant_id,schedule_id,tier_level,user_ids,rotation_type,rotation_start_at,handoff_time,escalation_delay_minutes,created_at,updated_at) VALUES (:id,:tenant,:schedule,1,ARRAY[CAST(:responder AS uuid)],'WEEKLY',now()-interval '1 day','09:00',15,now(),now())"),
                {"id": uuid4(), "tenant": tenant_id, "schedule": schedule_id, "responder": str(responder_id)},
            )

        manager_headers = {"Authorization": f"Bearer {manager_key}"}
        created = self.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "Checkout unavailable",
                "description": "Customers cannot complete payment",
                "impact": "HIGH",
                "urgency": "HIGH",
                "service_id": str(service_id),
            },
            headers=manager_headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]
        declared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={"communication_channel": "checkout-war-room"},
            headers=manager_headers,
        )
        self.assertEqual(declared.status_code, 201, declared.text)

        missing_confirmation = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident/page",
            headers=manager_headers,
        )
        self.assertEqual(missing_confirmation.status_code, 422, missing_confirmation.text)

        previewed = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/major-incident/page-preview",
            headers=manager_headers,
        )
        self.assertEqual(previewed.status_code, 200, previewed.text)
        preview = previewed.json()
        self.assertEqual(preview["target_kind"], "ON_CALL_ENGINEER")
        self.assertEqual(preview["target_label"], "oncall-manager@example.com")
        self.assertEqual(preview["selection_source"], "ACTIVE_ON_CALL_SCHEDULE")
        self.assertTrue(preview["verified_on_call"])
        self.assertEqual(preview["service_name"], "Checkout")
        self.assertEqual(preview["assignment_group"], "Checkout Support")
        self.assertEqual(preview["team_name"], "Checkout Support")
        self.assertEqual(preview["schedule_name"], "Checkout primary")
        self.assertIsNotNone(preview["on_call_until"])
        self.assertIsNone(preview["warning"])
        self.assertEqual(
            preview["recipients"],
            [{"id": str(responder_id), "name": None, "email": "oncall-manager@example.com"}],
        )

        paged = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident/page",
            json={
                "confirmed_recipient_ids": [str(responder_id)],
                "confirmed_selection_source": preview["selection_source"],
                "preview_resolved_at": preview["resolved_at"],
            },
            headers=manager_headers,
        )
        self.assertEqual(paged.status_code, 200, paged.text)
        result = paged.json()
        self.assertEqual(result["target_kind"], "ON_CALL_ENGINEER")
        self.assertEqual(result["target_label"], "oncall-manager@example.com")
        self.assertEqual(result["selection_source"], "ACTIVE_ON_CALL_SCHEDULE")
        self.assertTrue(result["verified_on_call"])
        self.assertEqual(result["delivery_channel"], "IN_APP")
        self.assertEqual(result["delivery_status"], "IN_APP_CREATED")
        self.assertEqual(result["notification_count"], 1)
        self.assertEqual(result["recipients"], [{"id": str(responder_id), "name": None, "email": "oncall-manager@example.com"}])
        self.assertEqual(result["command_path"], f"/itsm/incident-manager/major-incidents?incident={incident_id}")
        self.assertEqual(result["incident_reference"], created.json()["ticket_number"])
        self.assertIsNotNone(result["correlation_reference"])

        responder_notifications = self.client.get(
            "/v1/notifications",
            headers={"Authorization": f"Bearer {responder_key}"},
        )
        self.assertEqual(responder_notifications.status_code, 200, responder_notifications.text)
        page_notification = next(item for item in responder_notifications.json()["items"] if item["type"] == "itsm.major_incident.page")
        self.assertEqual(page_notification["severity"], "critical")
        self.assertEqual(page_notification["link"], result["command_path"])
        self.assertIn(created.json()["ticket_number"], page_notification["title"])
        self.assertIn("checkout-war-room", page_notification["body"])

        activities = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers=manager_headers,
        )
        self.assertEqual(activities.status_code, 200, activities.text)
        self.assertIn("MAJOR_INCIDENT_PAGED", {item["activity_type"] for item in activities.json()})
        with self.migrator_engine.connect() as conn:
            evidence = conn.execute(
                text("SELECT metadata->'new_value' FROM public.itsm_ticket_activities WHERE tenant_id=:tenant AND ticket_id=:incident AND activity_type='MAJOR_INCIDENT_PAGED' ORDER BY created_at DESC LIMIT 1"),
                {"tenant": tenant_id, "incident": incident_id},
            ).scalar_one()
            audit_count = conn.execute(
                text("SELECT count(*) FROM public.audit_log_metadata WHERE tenant_id=:tenant AND action='itsm.incident.major_incident_paged' AND request_id=:incident"),
                {"tenant": tenant_id, "incident": incident_id},
            ).scalar_one()
        self.assertEqual(evidence["selection_source"], "ACTIVE_ON_CALL_SCHEDULE")
        self.assertEqual(evidence["delivery_status"], "IN_APP_CREATED")
        self.assertEqual(evidence["recipient_ids"], [str(responder_id)])
        self.assertEqual(evidence["incident_reference"], created.json()["ticket_number"])
        self.assertEqual(evidence["correlation_reference"], result["correlation_reference"])
        self.assertIsNotNone(evidence["sent_at"])
        self.assertEqual(audit_count, 1)

        fallback_service_id = uuid4()
        fallback_team_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("INSERT INTO public.itsm_teams (id,tenant_id,name,is_active,created_at,updated_at) VALUES (:id,:tenant,'Inventory Support',true,now(),now())"),
                {"id": fallback_team_id, "tenant": tenant_id},
            )
            conn.execute(
                text("INSERT INTO public.itsm_team_members (id,tenant_id,team_id,user_id,created_at) VALUES (:id,:tenant,:team,:user,now())"),
                {"id": uuid4(), "tenant": tenant_id, "team": fallback_team_id, "user": responder_id},
            )

            conn.execute(
                text("INSERT INTO public.itsm_services (id,tenant_id,name,slug,tier,status,escalation_team,created_at,updated_at) VALUES (:id,:tenant,'Inventory','inventory-page','TIER_2','OPERATIONAL','Inventory Support',now(),now())"),
                {"id": fallback_service_id, "tenant": tenant_id},
            )
        fallback_created = self.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "Inventory sync unavailable",
                "description": "No active schedule exists for this service",
                "impact": "HIGH",
                "urgency": "HIGH",
                "service_id": str(fallback_service_id),
                "assignee_id": str(responder_id),
            },
            headers=manager_headers,
        )
        self.assertEqual(fallback_created.status_code, 201, fallback_created.text)
        fallback_incident_id = fallback_created.json()["id"]
        fallback_declared = self.client.post(
            f"/v1/itsm/incidents/{fallback_incident_id}/major-incident",
            json={"communication_channel": "inventory-war-room"},
            headers=manager_headers,
        )
        self.assertEqual(fallback_declared.status_code, 201, fallback_declared.text)
        fallback_previewed = self.client.get(
            f"/v1/itsm/incidents/{fallback_incident_id}/major-incident/page-preview",
            headers=manager_headers,
        )
        self.assertEqual(fallback_previewed.status_code, 200, fallback_previewed.text)
        fallback_preview = fallback_previewed.json()
        self.assertEqual(fallback_preview["target_kind"], "ASSIGNEE")
        self.assertEqual(fallback_preview["selection_source"], "INCIDENT_ASSIGNEE_FALLBACK")
        self.assertFalse(fallback_preview["verified_on_call"])
        self.assertEqual(fallback_preview["service_name"], "Inventory")
        self.assertEqual(fallback_preview["assignment_group"], "Inventory Support")
        self.assertEqual(fallback_preview["team_name"], "Inventory Support")
        self.assertIsNone(fallback_preview["schedule_id"])
        self.assertIsNone(fallback_preview["on_call_until"])
        self.assertIn("incident assignee", fallback_preview["warning"].lower())

        fallback_paged = self.client.post(
            f"/v1/itsm/incidents/{fallback_incident_id}/major-incident/page",
            json={
                "confirmed_recipient_ids": [str(responder_id)],
                "confirmed_selection_source": fallback_preview["selection_source"],
                "preview_resolved_at": fallback_preview["resolved_at"],
            },
            headers=manager_headers,
        )
        self.assertEqual(fallback_paged.status_code, 200, fallback_paged.text)
        fallback_result = fallback_paged.json()
        self.assertEqual(fallback_result["selection_source"], "INCIDENT_ASSIGNEE_FALLBACK")
        self.assertFalse(fallback_result["verified_on_call"])
        self.assertEqual(fallback_result["delivery_status"], "IN_APP_CREATED")
        with self.migrator_engine.connect() as conn:
            fallback_evidence = conn.execute(
                text("SELECT metadata->'new_value' FROM public.itsm_ticket_activities WHERE tenant_id=:tenant AND ticket_id=:incident AND activity_type='MAJOR_INCIDENT_PAGED' ORDER BY created_at DESC LIMIT 1"),
                {"tenant": tenant_id, "incident": fallback_incident_id},
            ).scalar_one()
        self.assertEqual(fallback_evidence["selection_source"], "INCIDENT_ASSIGNEE_FALLBACK")
        self.assertFalse(fallback_evidence["verified_on_call"])
        self.assertEqual(fallback_evidence["delivery_status"], "IN_APP_CREATED")
        self.assertEqual(fallback_evidence["recipient_ids"], [str(responder_id)])
        self.assertEqual(fallback_evidence["correlation_reference"], fallback_result["correlation_reference"])

        _, _, agent_key = self.create_fixture_tenant("major_page_agent", itsm_role="SERVICE_AGENT")
        denied = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/major-incident/page-preview",
            headers={"Authorization": f"Bearer {agent_key}"},
        )
        self.assertEqual(denied.status_code, 403)


    def test_31_requester_cannot_read_internal_notes(self):
        tenant_id, _, manager_key = self.create_fixture_tenant("internal_note_manager")
        _, requester_key = self.create_fixture_user(tenant_id, "internal_note_requester", "REQUESTER")
        requester_headers = {"Authorization": f"Bearer {requester_key}"}
        manager_headers = {"Authorization": f"Bearer {manager_key}"}
        created = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Requester-visible incident", "description": "Privacy regression", "urgency": "MEDIUM"},
            headers=requester_headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]
        internal = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            json={"content": "operator-only investigation detail", "activity_type": "NOTE", "is_internal": True},
            headers=manager_headers,
        )
        self.assertEqual(internal.status_code, 201, internal.text)
        public = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            json={"content": "public progress update", "activity_type": "COMMENT", "is_internal": False},
            headers=manager_headers,
        )
        self.assertEqual(public.status_code, 201, public.text)

        requester_activities = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers=requester_headers,
        )
        self.assertEqual(requester_activities.status_code, 200, requester_activities.text)
        requester_content = {activity["content"] for activity in requester_activities.json()}
        self.assertIn("public progress update", requester_content)
        self.assertNotIn("operator-only investigation detail", requester_content)
        manager_content = {
            activity["content"]
            for activity in self.client.get(
                f"/v1/itsm/incidents/{incident_id}/activities",
                headers=manager_headers,
            ).json()
        }
        self.assertIn("operator-only investigation detail", manager_content)

    def test_32_requester_priority_is_derived_from_impact_and_urgency(self):
        tenant_id, _, _ = self.create_fixture_tenant("requester_priority_manager")
        _, requester_key = self.create_fixture_user(tenant_id, "requester_priority", "REQUESTER")
        created = self.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "Low-impact requester issue",
                "description": "Requester cannot promote this incident",
                "impact": "LOW",
                "urgency": "LOW",
                "priority": "P1",
                "priority_override_reason": "Requester-supplied override",
            },
            headers={"Authorization": f"Bearer {requester_key}"},
        )
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["priority"], "P4")

    def test_33_assignee_must_belong_to_selected_assignment_group(self):
        tenant_id, manager_id, manager_key = self.create_fixture_tenant("team_membership")
        member_id, _ = self.create_fixture_user(tenant_id, "team_member", "SERVICE_AGENT")
        nonmember_id, _ = self.create_fixture_user(tenant_id, "team_nonmember", "SERVICE_AGENT")
        team_id = self.create_team(tenant_id, "Network Operations", [member_id])
        headers = {"Authorization": f"Bearer {manager_key}"}
        created = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Network incident", "description": "Membership regression"},
            headers=headers,
        )
        self.assertEqual(created.status_code, 201, created.text)
        incident_id = created.json()["id"]

        rejected = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignment_group": "Network Operations", "assignee_id": str(nonmember_id)},
            headers=headers,
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)
        accepted = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignment_group": "Network Operations", "assignee_id": str(member_id)},
            headers=headers,
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        references = self.client.get("/v1/itsm/incidents/operations/reference-data", headers=headers)
        self.assertEqual(references.status_code, 200, references.text)
        team = next(item for item in references.json()["teams"] if item["id"] == str(team_id))
        self.assertEqual(team["member_ids"], [str(member_id)])
        self.assertNotIn(str(manager_id), team["member_ids"])

    def test_34_role_lookup_fails_closed(self):
        db = MagicMock()
        db.execute.side_effect = RuntimeError("role lookup unavailable")
        with self.assertRaises(RuntimeError):
            _get_itsm_role(db, uuid4(), uuid4())

        db.execute.side_effect = None
        db.execute.return_value.first.return_value = None
        with self.assertRaises(HTTPException) as denied:
            _get_itsm_role(db, uuid4(), uuid4())
        self.assertEqual(denied.exception.status_code, 403)

if __name__ == "__main__":
    unittest.main()
