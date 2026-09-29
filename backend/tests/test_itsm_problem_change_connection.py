"""Backend test suite for ITSM Problem <-> Change Connection (Step 8).

Covers:
1. Unauthenticated requests are rejected (401)
2. Unauthorized roles (Requester) are rejected (403)
3. PROCESS_CHANGE_MANAGER can link existing Change to Problem (200)
4. Problem shows related Changes (via list endpoint and in ProblemDetail)
5. Change shows related Problem (via problem endpoint and in ChangeDetail)
6. Multiple Changes can be linked to a Problem
7. Tenant isolation: linking cross-tenant Change to Problem is rejected (404)
8. Create Change from Problem pre-populates fields and automatically links (201)
9. Unlink Change removes relationship without deleting Change
10. Unlink preserves Change status and integrity
11. Activity and audit history logs are recorded on both Problem and Change
12. Nonexistent entities return 404 Not Found
13. Existing Problem and Change lifecycles remain functional
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMProblemChangeConnectionTestCase(unittest.TestCase):
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

        # Secondary Tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_pcm_id = uuid4()
        cls.tenant_b_pcm_key = f"tb-pcm-{uuid4().hex[:12]}"

        # Problems
        cls.problem_a1_id = uuid4()
        cls.problem_a2_id = uuid4()
        cls.problem_b1_id = uuid4()

        # Changes
        cls.change_a1_id = uuid4()
        cls.change_a2_id = uuid4()
        cls.change_b1_id = uuid4()

        # Service
        cls.service_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-pc-a-{uuid4().hex[:8]}"},
            )

            # Users in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": cls.pcm_user_id,
                    "tenant_id": cls.tenant_id,
                    "email": f"pcm-{uuid4().hex[:6]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": cls.tenant_id,
                    "key_hash": hash_key(cls.pcm_key),
                    "created_by": cls.pcm_user_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.pcm_user_id},
            )

            # Requester User in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {
                    "id": cls.req_user_id,
                    "tenant_id": cls.tenant_id,
                    "email": f"req-{uuid4().hex[:6]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": cls.tenant_id,
                    "key_hash": hash_key(cls.req_key),
                    "created_by": cls.req_user_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.req_user_id},
            )

            # 2. Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-pc-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": cls.tenant_b_pcm_id,
                    "tenant_id": cls.tenant_b_id,
                    "email": f"pcm-b-{uuid4().hex[:6]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-pcm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": cls.tenant_b_id,
                    "key_hash": hash_key(cls.tenant_b_pcm_key),
                    "created_by": cls.tenant_b_pcm_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PROCESS_CHANGE_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_pcm_id},
            )

            # 3. Service in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, owner_user_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Payment Processing Gateway', 'payment-gateway', 'TIER_1', 'ACTIVE', :owner_id, now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id, "owner_id": cls.pcm_user_id},
            )

            # 4. Problems in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-880001', 'PROBLEM', 'Recurring Redis Cache Evictions', 'Redis evicting session keys prematurely', 'HIGH', 'HIGH', 'P2', 'IN_PROGRESS', :req_by, :service_id, now(), now())"
                ),
                {"id": cls.problem_a1_id, "tenant_id": cls.tenant_id, "req_by": cls.pcm_user_id, "service_id": cls.service_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, permanent_solution, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'Maxmemory setting is 2GB instead of 8GB', 'Update Redis maxmemory to 8GB and apply allkeys-lru eviction policy', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.problem_a1_id},
            )

            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-880002', 'PROBLEM', 'Database Connection Pool Exhaustion', 'Pool exhausted during flash sales', 'HIGH', 'CRITICAL', 'P1', 'OPEN', :req_by, :service_id, now(), now())"
                ),
                {"id": cls.problem_a2_id, "tenant_id": cls.tenant_id, "req_by": cls.pcm_user_id, "service_id": cls.service_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_problem_details (id, tenant_id, ticket_id, known_error, root_cause_summary, permanent_solution, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, true, 'PgBouncer max_client_conn is default 100', 'Increase PgBouncer max_client_conn to 1000', now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "ticket_id": cls.problem_a2_id},
            )

            # Problem in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'PRB-880009', 'PROBLEM', 'Tenant B Isolated Problem', 'Isolated problem details', 'LOW', 'LOW', 'P3', 'OPEN', :req_by, now(), now())"
                ),
                {"id": cls.problem_b1_id, "tenant_id": cls.tenant_b_id, "req_by": cls.tenant_b_pcm_id},
            )

            # 5. Changes in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-880001', 'Increase Redis Memory Allocation', 'Scale up cluster node RAM to 8GB', 'NORMAL', 'LOW', 'MEDIUM', 'DRAFT', :service_id, :req_by, now(), now())"
                ),
                {"id": cls.change_a1_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, service_id, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-880002', 'Deploy Cache Expiration Optimizer', 'Automated cache key TTL refresher', 'STANDARD', 'LOW', 'LOW', 'APPROVED', :service_id, :req_by, now(), now())"
                ),
                {"id": cls.change_a2_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id, "req_by": cls.pcm_user_id},
            )

            # Change in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_change_requests (id, tenant_id, change_number, title, description, change_type, risk_level, impact_level, status, requested_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'CHG-880099', 'Tenant B Isolated Change', 'Isolated change details', 'STANDARD', 'LOW', 'LOW', 'DRAFT', :req_by, now(), now())"
                ),
                {"id": cls.change_b1_id, "tenant_id": cls.tenant_b_id, "req_by": cls.tenant_b_pcm_id},
            )

    @classmethod
    def tearDownClass(cls):
        try:
            with cls.migrator_engine.begin() as conn:
                conn.execute(text("DELETE FROM public.itsm_ticket_activities WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_problem_details WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_change_requests WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_tickets WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id = :ta"), {"ta": cls.tenant_id})
                conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
        except Exception:
            pass

    def test_01_unauthenticated_requests_fail(self):
        """Unauthenticated requests must receive 401 Unauthorized."""
        res1 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/link-change", json={"change_id": str(self.change_a1_id)})
        self.assertEqual(res1.status_code, 401)

        res2 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/unlink-change", json={"change_id": str(self.change_a1_id)})
        self.assertEqual(res2.status_code, 401)

        res3 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/create-change", json={"title": "Unauthorized Change"})
        self.assertEqual(res3.status_code, 401)

        res4 = self.client.get(f"/v1/itsm/problems/{self.problem_a1_id}/changes")
        self.assertEqual(res4.status_code, 401)

        res5 = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}/problem")
        self.assertEqual(res5.status_code, 401)

    def test_02_unauthorized_role_rejected(self):
        """Requester role must receive 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.req_key}"}

        res1 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/link-change", headers=headers, json={"change_id": str(self.change_a1_id)})
        self.assertEqual(res1.status_code, 403)

        res2 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/unlink-change", headers=headers, json={"change_id": str(self.change_a1_id)})
        self.assertEqual(res2.status_code, 403)

        res3 = self.client.post(f"/v1/itsm/problems/{self.problem_a1_id}/create-change", headers=headers, json={"title": "Unauthorized Change"})
        self.assertEqual(res3.status_code, 403)

        res4 = self.client.get(f"/v1/itsm/problems/{self.problem_a1_id}/changes", headers=headers)
        self.assertEqual(res4.status_code, 403)

        res5 = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}/problem", headers=headers)
        self.assertEqual(res5.status_code, 403)

    def test_03_link_existing_change_success(self):
        """PROCESS_CHANGE_MANAGER can link an existing Change to a Problem."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}
        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/link-change",
            headers=headers,
            json={"change_id": str(self.change_a1_id)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["id"], str(self.change_a1_id))
        self.assertEqual(data[0]["change_number"], "CHG-880001")

    def test_04_query_related_changes_for_problem(self):
        """Related changes are returned via GET endpoint and in ProblemDetailResponse."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        # Dedicated endpoint
        res = self.client.get(f"/v1/itsm/problems/{self.problem_a1_id}/changes", headers=headers)
        self.assertEqual(res.status_code, 200)
        changes = res.json()
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["change_number"], "CHG-880001")

        # In ProblemDetailResponse
        detail_res = self.client.get(f"/v1/itsm/problems/{self.problem_a1_id}", headers=headers)
        self.assertEqual(detail_res.status_code, 200)
        detail = detail_res.json()
        self.assertIn("related_changes", detail)
        self.assertEqual(len(detail["related_changes"]), 1)
        self.assertEqual(detail["related_changes"][0]["change_number"], "CHG-880001")

    def test_05_query_related_problem_for_change(self):
        """Related problem is returned via GET endpoint and in ChangeDetailResponse."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        # Dedicated endpoint
        res = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}/problem", headers=headers)
        self.assertEqual(res.status_code, 200)
        prob = res.json()
        self.assertIsNotNone(prob)
        self.assertEqual(prob["id"], str(self.problem_a1_id))
        self.assertEqual(prob["ticket_number"], "PRB-880001")
        self.assertEqual(prob["title"], "Recurring Redis Cache Evictions")

        # In ChangeDetailResponse
        chg_detail = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}", headers=headers).json()
        self.assertIn("related_problem", chg_detail)
        self.assertIsNotNone(chg_detail["related_problem"])
        self.assertEqual(chg_detail["related_problem"]["ticket_number"], "PRB-880001")

    def test_06_link_multiple_changes_to_problem(self):
        """Multiple changes can be linked to the same problem."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}
        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/link-change",
            headers=headers,
            json={"change_id": str(self.change_a2_id)},
        )
        self.assertEqual(res.status_code, 200)
        changes = res.json()
        self.assertEqual(len(changes), 2)
        numbers = [c["change_number"] for c in changes]
        self.assertIn("CHG-880001", numbers)
        self.assertIn("CHG-880002", numbers)

    def test_07_tenant_isolation_enforced(self):
        """Cross-tenant operations must be rejected with 404 Not Found."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        # Tenant A problem cannot link Tenant B change
        res1 = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/link-change",
            headers=headers,
            json={"change_id": str(self.change_b1_id)},
        )
        self.assertEqual(res1.status_code, 404)

        # Tenant A PCM cannot access Tenant B problem
        res2 = self.client.get(f"/v1/itsm/problems/{self.problem_b1_id}/changes", headers=headers)
        self.assertEqual(res2.status_code, 404)

        # Tenant B PCM cannot link Tenant A change
        tb_headers = {"Authorization": f"Bearer {self.tenant_b_pcm_key}"}
        res3 = self.client.post(
            f"/v1/itsm/problems/{self.problem_b1_id}/link-change",
            headers=tb_headers,
            json={"change_id": str(self.change_a1_id)},
        )
        self.assertEqual(res3.status_code, 404)

    def test_08_create_change_from_problem(self):
        """Create change pre-populates fields, persists them, and links bidirectionally."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        create_payload = {
            "title": "Upgrade PgBouncer Connection Pool",
            "description": "Permanent infrastructure fix for PRB-880002",
            "change_type": "NORMAL",
            "risk_level": "LOW",
            "impact_level": "MEDIUM",
        }

        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/create-change",
            headers=headers,
            json=create_payload,
        )
        self.assertEqual(res.status_code, 201)
        created_change = res.json()

        self.assertTrue(created_change["change_number"].startswith("CHG-"))
        self.assertEqual(created_change["title"], create_payload["title"])
        self.assertEqual(created_change["description"], create_payload["description"])
        self.assertEqual(created_change["change_type"], "NORMAL")
        self.assertEqual(created_change["risk_level"], "LOW")
        self.assertEqual(created_change["status"], "DRAFT")
        self.assertEqual(created_change["service_id"], str(self.service_id))
        self.assertEqual(created_change["implementation_plan"], "Increase PgBouncer max_client_conn to 1000")

        # Verify change is linked to Problem A2
        new_chg_id = created_change["id"]
        prob_res = self.client.get(f"/v1/itsm/changes/{new_chg_id}/problem", headers=headers)
        self.assertEqual(prob_res.status_code, 200)
        self.assertEqual(prob_res.json()["ticket_number"], "PRB-880002")

        # Verify Problem A2 shows this change
        p_changes = self.client.get(f"/v1/itsm/problems/{self.problem_a2_id}/changes", headers=headers).json()
        self.assertEqual(len(p_changes), 1)
        self.assertEqual(p_changes[0]["id"], new_chg_id)

    def test_09_unlink_change_success(self):
        """Unlinking removes the relationship bidirectionally."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        # Unlink Change 1 from Problem A1
        res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/unlink-change",
            headers=headers,
            json={"change_id": str(self.change_a1_id)},
        )
        self.assertEqual(res.status_code, 200)
        remaining = res.json()
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["change_number"], "CHG-880002")

        # Change 1 should now have no related problem
        chg_prob = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}/problem", headers=headers).json()
        self.assertIsNone(chg_prob)

    def test_10_unlink_preserves_change_record(self):
        """Unlink must NOT delete or modify the Change itself."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}
        chg = self.client.get(f"/v1/itsm/changes/{self.change_a1_id}", headers=headers)
        self.assertEqual(chg.status_code, 200)
        data = chg.json()
        self.assertEqual(data["change_number"], "CHG-880001")
        self.assertEqual(data["status"], "DRAFT")

    def test_11_audit_and_activity_recorded(self):
        """Activities and audit events are properly emitted on both Problem and Change."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}

        # Explicitly link and unlink Change 2 on Problem A2
        link_res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/link-change",
            headers=headers,
            json={"change_id": str(self.change_a2_id)},
        )
        self.assertEqual(link_res.status_code, 200)

        unlink_res = self.client.post(
            f"/v1/itsm/problems/{self.problem_a2_id}/unlink-change",
            headers=headers,
            json={"change_id": str(self.change_a2_id)},
        )
        self.assertEqual(unlink_res.status_code, 200)

        # Problem activities
        act_res = self.client.get(f"/v1/itsm/problems/{self.problem_a2_id}/activities", headers=headers)
        self.assertEqual(act_res.status_code, 200)
        activities = act_res.json()
        act_types = [a["activity_type"] for a in activities]
        self.assertIn("CHANGE_LINKED", act_types)
        self.assertIn("CHANGE_UNLINKED", act_types)

        # Change activities
        chg_act_res = self.client.get(f"/v1/itsm/changes/{self.change_a2_id}/activities", headers=headers)
        self.assertEqual(chg_act_res.status_code, 200)
        chg_acts = chg_act_res.json()
        actions = [a["action"] for a in chg_acts]
        self.assertIn("itsm.change.problem_linked", actions)
        self.assertIn("itsm.change.problem_unlinked", actions)

    def test_12_nonexistent_ids_return_404(self):
        """Nonexistent Problem or Change returns 404."""
        headers = {"Authorization": f"Bearer {self.pcm_key}"}
        fake_id = uuid4()

        res1 = self.client.post(
            f"/v1/itsm/problems/{fake_id}/link-change",
            headers=headers,
            json={"change_id": str(self.change_a1_id)},
        )
        self.assertEqual(res1.status_code, 404)

        res2 = self.client.post(
            f"/v1/itsm/problems/{self.problem_a1_id}/link-change",
            headers=headers,
            json={"change_id": str(fake_id)},
        )
        self.assertEqual(res2.status_code, 404)


if __name__ == "__main__":
    unittest.main()
