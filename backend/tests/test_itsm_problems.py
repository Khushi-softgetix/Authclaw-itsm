"""Backend test suite for ITSM Problem Management Queue (Step 2).

Covers:
1. PROCESS_CHANGE_MANAGER can access GET /v1/itsm/problems (200 OK)
2. PROCESS_CHANGE_MANAGER can get stats via GET /v1/itsm/problems/stats (200 OK)
3. Status filter properly filters problems (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
4. Search filter matches ticket_number and title
5. Problem detail returns metadata, related incidents, and problem details
6. Unauthenticated request receives 401 Unauthorized
7. Requester role receives 403 Forbidden
8. Service Agent role receives 403 Forbidden
9. Tenant isolation: Problem in Tenant A cannot be retrieved by Tenant B (404 Not Found)
10. Non-existent problem returns 404 Not Found
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMProblemsTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Primary Tenant (Tenant A)
        cls.tenant_id = uuid4()
        cls.pcm_user_id = uuid4()
        cls.pcm_key = f"pcm-test-{uuid4().hex[:12]}"

        # Requester in Tenant A
        cls.req_user_id = uuid4()
        cls.req_key = f"req-test-{uuid4().hex[:12]}"

        # Service Agent in Tenant A
        cls.agent_user_id = uuid4()
        cls.agent_key = f"agent-test-{uuid4().hex[:12]}"

        # Secondary Tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_pcm_id = uuid4()
        cls.tenant_b_pcm_key = f"tb-pcm-{uuid4().hex[:12]}"

        # Problems & Incidents IDs
        cls.problem_a1_id = uuid4()
        cls.problem_a2_id = uuid4()
        cls.problem_b1_id = uuid4()
        cls.incident_a1_id = uuid4()
        cls.incident_a2_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-pcm-a-{uuid4().hex[:8]}"},
            )

            # Tenant A - Problem and Change Manager
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.pcm_user_id, "tenant_id": cls.tenant_id, "email": f"pcm-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.pcm_key), "created_by": cls.pcm_user_id},
            )

            # Tenant A - Requester
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.req_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.req_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.req_key), "created_by": cls.req_user_id},
            )

            # Tenant A - Service Agent
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # 2. Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-pcm-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_pcm_id, "tenant_id": cls.tenant_b_id, "email": f"tb-pcm-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_pcm_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_pcm_key), "created_by": cls.tenant_b_pcm_id},
            )

            # Seed Problem Tickets in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-000001', 'PROBLEM', 'Redis memory leak in session cache', 'Sessions are not expiring properly causing OOM errors', 'HIGH', 'HIGH', 'P1', 'NEW', 'PORTAL', :req_id, 'Database Ops', now(), now())"
                ),
                {"id": cls.problem_a1_id, "tenant_id": cls.tenant_id, "req_id": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, workaround_summary, permanent_solution, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Redis TTL not applied on session update', 'Restart redis container every 12h', 'Deploy patch with TTL re-arm', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.problem_a1_id},
            )

            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-000002', 'PROBLEM', 'VPN routing flapping across gateways', 'BGP route flapping on edge routers', 'MEDIUM', 'HIGH', 'P2', 'RESOLVED', 'PORTAL', :req_id, 'Network Team', now(), now())"
                ),
                {"id": cls.problem_a2_id, "tenant_id": cls.tenant_id, "req_id": cls.pcm_user_id},
            )

            # Seed Related Incidents linked to PRB-000001 in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, linked_problem_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-000010', 'INCIDENT', 'Session timeout failed on prod', 'Users seeing logout failures', 'HIGH', 'HIGH', 'P1', 'RESOLVED', 'PORTAL', :req_id, :problem_id, now(), now())"
                ),
                {"id": cls.incident_a1_id, "tenant_id": cls.tenant_id, "req_id": cls.pcm_user_id, "problem_id": cls.problem_a1_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, linked_problem_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-000011', 'INCIDENT', 'Redis out of memory alert', 'Memory capacity reached 98%', 'HIGH', 'MEDIUM', 'P2', 'RESOLVED', 'PORTAL', :req_id, :problem_id, now(), now())"
                ),
                {"id": cls.incident_a2_id, "tenant_id": cls.tenant_id, "req_id": cls.pcm_user_id, "problem_id": cls.problem_a1_id},
            )

            # Seed Problem Ticket in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-000099', 'PROBLEM', 'Tenant B isolated problem', 'Isolated details', 'LOW', 'LOW', 'P4', 'NEW', 'PORTAL', :req_id, now(), now())"
                ),
                {"id": cls.problem_b1_id, "tenant_id": cls.tenant_b_id, "req_id": cls.tenant_b_pcm_id},
            )

    def test_01_unauthenticated_request_is_unauthorized(self):
        res = self.client.get("/v1/itsm/problems")
        self.assertEqual(res.status_code, 401)

    def test_02_requester_is_forbidden(self):
        res = self.client.get(
            "/v1/itsm/problems",
            headers={"Authorization": f"Bearer {self.req_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_03_service_agent_is_forbidden(self):
        res = self.client.get(
            "/v1/itsm/problems",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_04_pcm_can_list_problems(self):
        res = self.client.get(
            "/v1/itsm/problems",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertIsInstance(items, list)
        self.assertEqual(len(items), 2)
        prb_numbers = [item["ticket_number"] for item in items]
        self.assertIn("PRB-000001", prb_numbers)
        self.assertIn("PRB-000002", prb_numbers)
        # Tenant B problem must not leak
        self.assertNotIn("PRB-000099", prb_numbers)

    def test_05_pcm_can_get_stats(self):
        res = self.client.get(
            "/v1/itsm/problems/stats",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        stats = res.json()
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["open"], 1)  # PRB-000001 has status NEW
        self.assertEqual(stats["resolved"], 1)  # PRB-000002 has status RESOLVED

    def test_06_status_filtering(self):
        # Filter OPEN (matches NEW)
        res_open = self.client.get(
            "/v1/itsm/problems?status=OPEN",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_open.status_code, 200)
        open_items = res_open.json()
        self.assertEqual(len(open_items), 1)
        self.assertEqual(open_items[0]["ticket_number"], "PRB-000001")

        # Filter RESOLVED
        res_resolved = self.client.get(
            "/v1/itsm/problems?status=RESOLVED",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res_resolved.status_code, 200)
        res_items = res_resolved.json()
        self.assertEqual(len(res_items), 1)
        self.assertEqual(res_items[0]["ticket_number"], "PRB-000002")

    def test_07_search_filtering(self):
        res = self.client.get(
            "/v1/itsm/problems?search=Redis",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["ticket_number"], "PRB-000001")

    def test_08_problem_detail_with_related_incidents_and_kedb(self):
        res = self.client.get(
            f"/v1/itsm/problems/{self.problem_a1_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        detail = res.json()
        self.assertEqual(detail["ticket_number"], "PRB-000001")
        self.assertEqual(detail["title"], "Redis memory leak in session cache")
        self.assertEqual(detail["related_incidents_count"], 2)

        # Verify related incidents
        related = detail["related_incidents"]
        self.assertEqual(len(related), 2)
        inc_numbers = [inc["ticket_number"] for inc in related]
        self.assertIn("INC-000010", inc_numbers)
        self.assertIn("INC-000011", inc_numbers)

        # Verify problem details (KEDB)
        self.assertIsNotNone(detail["problem_details"])
        self.assertTrue(detail["problem_details"]["known_error"])
        self.assertEqual(detail["problem_details"]["root_cause_summary"], "Redis TTL not applied on session update")

    def test_09_tenant_isolation_cross_tenant_access_denied(self):
        # PCM in Tenant A tries to access Problem in Tenant B
        res = self.client.get(
            f"/v1/itsm/problems/{self.problem_b1_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 404)

        # PCM in Tenant B tries to access Problem in Tenant A
        res2 = self.client.get(
            f"/v1/itsm/problems/{self.problem_a1_id}",
            headers={"Authorization": f"Bearer {self.tenant_b_pcm_key}"},
        )
        self.assertEqual(res2.status_code, 404)

    def test_10_non_existent_problem_returns_404(self):
        fake_id = uuid4()
        res = self.client.get(
            f"/v1/itsm/problems/{fake_id}",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_11_update_investigation_success(self):
        # Update problem investigation for problem_a1
        update_payload = {
            "root_cause_summary": "Identified memory leak in connection pool buffer handling.",
            "workaround_summary": "Restart connection pool workers every 6 hours.",
            "known_error": True,
            "permanent_solution": "Patch library to v2.4.1 to fix buffer leaks.",
            "investigation_notes": "Diagnostic traces confirm socket memory growth under load.",
            "status": "IN_PROGRESS",
        }
        res = self.client.patch(
            f"/v1/itsm/problems/{self.problem_a1_id}/investigation",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json=update_payload,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "IN_PROGRESS")
        self.assertIsNotNone(data["problem_details"])
        self.assertEqual(data["problem_details"]["root_cause_summary"], update_payload["root_cause_summary"])
        self.assertEqual(data["problem_details"]["workaround_summary"], update_payload["workaround_summary"])
        self.assertTrue(data["problem_details"]["known_error"])
        self.assertEqual(data["problem_details"]["permanent_solution"], update_payload["permanent_solution"])

    def test_12_list_problem_activities(self):
        # Retrieve activities after investigation update
        res = self.client.get(
            f"/v1/itsm/problems/{self.problem_a1_id}/activities",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(res.status_code, 200)
        activities = res.json()
        self.assertIsInstance(activities, list)
        self.assertGreaterEqual(len(activities), 1)

        # Check for investigation note
        investigation_acts = [a for a in activities if a["activity_type"] == "INVESTIGATION"]
        self.assertTrue(len(investigation_acts) > 0)
        self.assertIn("Diagnostic traces confirm socket memory growth", investigation_acts[0]["content"])

    def test_13_update_investigation_forbidden_roles(self):
        # Requester cannot update investigation
        res_req = self.client.patch(
            f"/v1/itsm/problems/{self.problem_a1_id}/investigation",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={"root_cause_summary": "Unauthorized update"},
        )
        self.assertEqual(res_req.status_code, 403)

        # Service Agent cannot update problem investigation
        res_agent = self.client.patch(
            f"/v1/itsm/problems/{self.problem_a1_id}/investigation",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"root_cause_summary": "Unauthorized update"},
        )
        self.assertEqual(res_agent.status_code, 403)

    def test_14_update_investigation_cross_tenant_denied(self):
        # Tenant B PCM tries to update Tenant A problem
        res = self.client.patch(
            f"/v1/itsm/problems/{self.problem_a1_id}/investigation",
            headers={"Authorization": f"Bearer {self.tenant_b_pcm_key}"},
            json={"root_cause_summary": "Cross tenant leak"},
        )
        self.assertEqual(res.status_code, 404)

    def test_15_update_investigation_invalid_status(self):
        res = self.client.patch(
            f"/v1/itsm/problems/{self.problem_a1_id}/investigation",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"status": "INVALID_STATUS_XYZ"},
        )
        self.assertEqual(res.status_code, 400)

    def test_16_resolve_problem_success(self):
        # Resolve problem_a1
        resolve_payload = {
            "resolution_summary": "Upgraded socket connection pool library and adjusted max idle connection limits.",
            "resolution_notes": "Tested in staging with synthetic load test; zero memory leaks detected over 12 hours.",
            "permanent_solution": "Patched connection pool middleware in release v2.4.2.",
        }
        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/resolve",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json=resolve_payload,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "RESOLVED")
        self.assertEqual(data["resolution_summary"], resolve_payload["resolution_summary"])
        self.assertIsNotNone(data["resolved_at"])
        self.assertEqual(data["problem_details"]["permanent_solution"], resolve_payload["permanent_solution"])

        # Check resolution activity was logged
        act_res = self.client.get(
            f"/v1/itsm/problems/{self.problem_a1_id}/activities",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(act_res.status_code, 200)
        acts = act_res.json()
        resolution_acts = [a for a in acts if a["activity_type"] == "RESOLUTION"]
        self.assertTrue(len(resolution_acts) > 0)
        self.assertIn("Problem resolved:", resolution_acts[0]["content"])

    def test_17_close_problem_success(self):
        # Close the resolved problem_a1
        close_payload = {
            "closure_notes": "Production verification confirmed stable operation for 48 hours. Closing problem record.",
        }
        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/close",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json=close_payload,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "CLOSED")
        self.assertIsNotNone(data["closed_at"])

        # Check closure activity was logged
        act_res = self.client.get(
            f"/v1/itsm/problems/{self.problem_a1_id}/activities",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
        )
        self.assertEqual(act_res.status_code, 200)
        acts = act_res.json()
        close_acts = [a for a in acts if a["activity_type"] == "STATUS_CHANGE" and "closed" in (a["content"] or "").lower()]
        self.assertTrue(len(close_acts) > 0)

    def test_18_resolve_problem_forbidden_roles(self):
        # Requester cannot resolve problem
        res_req = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/resolve",
            headers={"Authorization": f"Bearer {self.req_key}"},
            json={"resolution_summary": "Unauthorized resolution attempt"},
        )
        self.assertEqual(res_req.status_code, 403)

        # Service Agent cannot resolve problem
        res_agent = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/resolve",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"resolution_summary": "Unauthorized resolution attempt"},
        )
        self.assertEqual(res_agent.status_code, 403)

    def test_19_close_unresolved_problem_fails(self):
        # Create a temporary OPEN problem in Tenant A
        unresolved_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, source_channel, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-000003', 'PROBLEM', 'Unresolved problem test', 'Testing premature close', 'LOW', 'LOW', 'P4', 'OPEN', 'PORTAL', :req_id, now(), now())"
                ),
                {"id": unresolved_id, "tenant_id": self.tenant_id, "req_id": self.pcm_user_id},
            )
        try:
            # Trying to close an OPEN problem directly must fail with 400
            res = self.client.post(
                f"/v1/itsm/problems/{unresolved_id}/close",
                headers={"Authorization": f"Bearer {self.pcm_key}"},
                json={"closure_notes": "Attempting premature closure"},
            )
            self.assertEqual(res.status_code, 400)
            self.assertIn("must be RESOLVED", res.json()["detail"])
        finally:
            with self.migrator_engine.begin() as conn:
                conn.execute(text("DELETE FROM public.itsm_tickets WHERE id = :id"), {"id": unresolved_id})

    def test_20_cross_tenant_resolve_and_close_denied(self):
        # Tenant B PCM tries to resolve Tenant A problem
        res_res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/resolve",
            headers={"Authorization": f"Bearer {self.tenant_b_pcm_key}"},
            json={"resolution_summary": "Cross tenant resolution"},
        )
        self.assertEqual(res_res.status_code, 404)

        # Tenant B PCM tries to close Tenant A problem
        res_close = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/close",
            headers={"Authorization": f"Bearer {self.tenant_b_pcm_key}"},
            json={"closure_notes": "Cross tenant closure"},
        )
        self.assertEqual(res_close.status_code, 404)


if __name__ == "__main__":
    unittest.main()


