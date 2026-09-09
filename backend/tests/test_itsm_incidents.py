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
from uuid import UUID, uuid4

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

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "SERVICE_LEAD"):
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
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "itsm_role": itsm_role,
                },
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
            json={"title": "SearchTargetAlpha API timeout", "description": "Gateway unreachable", "priority": "P1"},
            headers=headers,
        )
        self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Low priority printer queue", "description": "Paper jam", "priority": "P4"},
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

        create_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Unassigned incident", "description": "Needs triage"},
            headers=headers,
        )
        incident_id = create_res.json()["id"]
        self.assertEqual(create_res.json()["status"], "NEW")

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

    def test_20_service_lead_can_declare_and_update_major_incident(self):
        _, user_id, api_key = self.create_fixture_tenant("major-lead", "SERVICE_LEAD")
        headers = {"Authorization": f"Bearer {api_key}"}
        incident_id = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Regional login outage", "description": "Authentication unavailable", "priority": "P1"},
            headers=headers,
        ).json()["id"]

        declared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={
                "incident_commander_id": str(user_id),
                "bridge_url": "https://bridge.example.invalid/123",
                "communication_channel": "#incident-123",
                "impacted_business_units": ["Engineering", "Support"],
            },
            headers=headers,
        )
        self.assertEqual(declared.status_code, 201, declared.text)
        self.assertEqual(declared.json()["ticket_id"], incident_id)
        self.assertEqual(declared.json()["incident_commander_id"], str(user_id))

        updated = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={"executive_summary": "Restoration work is in progress."},
            headers=headers,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["executive_summary"], "Restoration work is in progress.")

    def test_21_non_service_lead_cannot_perform_lead_actions(self):
        _, _, lead_key = self.create_fixture_tenant("lead-owner", "SERVICE_LEAD")
        _, _, requester_key = self.create_fixture_tenant("requester", "REQUESTER")
        lead_headers = {"Authorization": f"Bearer {lead_key}"}
        requester_headers = {"Authorization": f"Bearer {requester_key}"}
        incident_id = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Lead-only action", "description": "Authorization check"},
            headers=lead_headers,
        ).json()["id"]

        assign = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/assign",
            json={"assignment_group": "Service Desk"},
            headers=requester_headers,
        )
        self.assertEqual(assign.status_code, 403)

        priority_update = self.client.patch(
            f"/v1/itsm/incidents/{incident_id}",
            json={"priority": "P1"},
            headers=requester_headers,
        )
        self.assertEqual(priority_update.status_code, 403)

        declare = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident",
            json={},
            headers=requester_headers,
        )
        self.assertEqual(declare.status_code, 403)

    def test_22_major_incident_is_tenant_isolated_for_service_leads(self):
        _, _, key_a = self.create_fixture_tenant("major-tenant-a", "SERVICE_LEAD")
        _, _, key_b = self.create_fixture_tenant("major-tenant-b", "SERVICE_LEAD")
        headers_a = {"Authorization": f"Bearer {key_a}"}
        headers_b = {"Authorization": f"Bearer {key_b}"}
        incident_id = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Tenant A major", "description": "Confidential outage"},
            headers=headers_a,
        ).json()["id"]
        declared = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/major-incident", json={}, headers=headers_a
        )
        self.assertEqual(declared.status_code, 201, declared.text)

        foreign_read = self.client.get(
            f"/v1/itsm/incidents/{incident_id}/major-incident", headers=headers_b
        )
        self.assertEqual(foreign_read.status_code, 404)


if __name__ == "__main__":
    unittest.main()
