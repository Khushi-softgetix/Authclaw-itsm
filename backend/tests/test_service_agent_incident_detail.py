"""Backend test suite for Service Agent Incident Detail Workspace (Step 2).

Covers:
1. SERVICE_AGENT can retrieve an incident via GET /v1/itsm/incidents/{id} (200 OK)
2. Unauthenticated request receives 401 Unauthorized
3. Requester receives 403 Forbidden when accessing agent workspace (agent_view=true)
4. Platform Admin receives 403 Forbidden when accessing agent workspace (agent_view=true)
5. Tenant isolation: Agent in Tenant A cannot retrieve Tenant B incident (404 Not Found)
6. Non-existent incident returns 404 Not Found
7. Backward compatibility: Standard call (agent_view=false) allows admin/requester access
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentIncidentDetailTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Setup primary tenant (Tenant A)
        cls.tenant_id = uuid4()
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-detail-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-detail-{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_key = f"req-detail-{uuid4().hex[:12]}"

        cls.admin_user_id = uuid4()
        cls.admin_key = f"admin-detail-{uuid4().hex[:12]}"

        # Setup secondary tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-agent-detail-{uuid4().hex[:12]}"

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-detail-a-{uuid4().hex[:8]}"},
            )
            # Service Agent in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": cls.agent_email},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # Requester in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.requester_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.requester_key), "created_by": cls.requester_user_id},
            )

            # Platform Admin in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'ADMIN', true, now(), now())"
                ),
                {"id": cls.admin_user_id, "tenant_id": cls.tenant_id, "email": f"admin-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PLATFORM_ADMINISTRATOR', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.admin_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'admin-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.admin_key), "created_by": cls.admin_user_id},
            )

            # User without ITSM access in Tenant A
            cls.no_itsm_user_id = uuid4()
            cls.no_itsm_key = f"no-itsm-{uuid4().hex[:12]}"
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.no_itsm_user_id, "tenant_id": cls.tenant_id, "email": f"no-itsm-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', false, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.no_itsm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-detail-b-{uuid4().hex[:8]}"},
            )
            # Service Agent in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"tb-agent-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_key), "created_by": cls.tenant_b_agent_id},
            )

        # Create a sample service and incident in Tenant A
        cls.service_id = uuid4()
        with cls.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Identity & SSO Service', :slug, 'TIER_1', 'OPERATIONAL', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id, "slug": f"sso-{uuid4().hex[:8]}"},
            )
            cls.team_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Security Operations', true, now(), now())"
                ),
                {"id": cls.team_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_id, "team_id": cls.team_id, "user_id": cls.agent_user_id},
            )

        agent_headers = {"Authorization": f"Bearer {cls.agent_key}"}
        create_res = cls.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "SSO Token Expired Intermittently",
                "description": "Users reporting premature session termination across SSO gateway.",
                "impact": "HIGH",
                "urgency": "HIGH",
                "service_id": str(cls.service_id),
                "category": "AUTHENTICATION",
                "assignment_group": "Security Operations",
                "assignee_id": str(cls.agent_user_id),
            },
            headers=agent_headers,
        )
        assert create_res.status_code == 201, create_res.text
        cls.ticket_id = create_res.json()["id"]

        # Create an incident in Tenant B
        tb_headers = {"Authorization": f"Bearer {cls.tenant_b_key}"}
        create_tb = cls.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "Tenant B Isolated Incident",
                "description": "Tenant B private server incident.",
                "impact": "LOW",
                "urgency": "LOW",
            },
            headers=tb_headers,
        )
        assert create_tb.status_code == 201, create_tb.text
        cls.tenant_b_ticket_id = create_tb.json()["id"]

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def mutation_headers(self, headers, ticket_id):
        current = self.client.get(
            f"/v1/itsm/incidents/{ticket_id}?agent_view=true",
            headers=headers,
        )
        self.assertEqual(current.status_code, 200, current.text)
        return {**headers, "If-Match": str(current.json()["version"])}

    # 1. SERVICE_AGENT can retrieve an incident
    def test_01_service_agent_can_retrieve_incident(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}?agent_view=true", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["id"], self.ticket_id)
        self.assertEqual(data["title"], "SSO Token Expired Intermittently")
        self.assertEqual(data["service_name"], "Identity & SSO Service")
        self.assertEqual(data["assignee_id"], str(self.agent_user_id))
        self.assertEqual(data["assignee_email"], self.agent_email)
        self.assertEqual(data["priority"], "P1")
        self.assertEqual(data["status"], "ASSIGNED")
        self.assertEqual(data["assignment_group"], "Security Operations")
        self.assertIn("sla_status", data)

    # 2. Unauthenticated user receives 401
    def test_02_unauthenticated_receives_401(self):
        res = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}?agent_view=true")
        self.assertEqual(res.status_code, 401)

    # 3. Requester receives 403 on agent workspace
    def test_03_requester_receives_403_on_agent_workspace(self):
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        res = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}?agent_view=true", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Access restricted to Service Agents", res.json().get("detail", ""))

    # 4. Platform Admin cannot use Service Agent-only endpoint
    def test_04_platform_admin_receives_403_on_agent_workspace(self):
        headers = {"Authorization": f"Bearer {self.admin_key}"}
        res = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}?agent_view=true", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Access restricted to Service Agents", res.json().get("detail", ""))

    # 5. Tenant isolation works
    def test_05_tenant_isolation_enforced(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        # Agent in Tenant A tries to access Tenant B's incident
        res = self.client.get(f"/v1/itsm/incidents/{self.tenant_b_ticket_id}?agent_view=true", headers=headers)
        self.assertEqual(res.status_code, 404)

    # 6. Non-existent incident returns 404
    def test_06_non_existent_incident_returns_404(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/incidents/{uuid4()}?agent_view=true", headers=headers)
        self.assertEqual(res.status_code, 404)

    # 7. Backward compatibility for standard GET calls
    def test_07_backward_compatibility_preserved(self):
        # Admin can fetch without agent_view
        admin_headers = {"Authorization": f"Bearer {self.admin_key}"}
        res_admin = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}", headers=admin_headers)
        self.assertEqual(res_admin.status_code, 200)

        # Agent can fetch without agent_view
        agent_headers = {"Authorization": f"Bearer {self.agent_key}"}
        res_agent = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}", headers=agent_headers)
        self.assertEqual(res_agent.status_code, 200)

    # 8. SERVICE_AGENT can read activities
    def test_08_service_agent_can_read_activities(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}/activities", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)
        first_act = data[0]
        self.assertIn("activity_type", first_act)
        self.assertIn("created_at", first_act)

    # 9. SERVICE_AGENT can create a public comment
    def test_09_service_agent_can_create_public_comment(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        payload = {
            "content": "Checking the authentication server logs now.",
            "activity_type": "COMMENT",
            "is_internal": False,
        }
        res = self.client.post(f"/v1/itsm/incidents/{self.ticket_id}/activities", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["ticket_id"], self.ticket_id)
        self.assertEqual(data["content"], "Checking the authentication server logs now.")
        self.assertEqual(data["is_internal"], False)
        self.assertEqual(data["actor_email"], self.agent_email)

    # 10. SERVICE_AGENT can create an internal note
    def test_10_service_agent_can_create_internal_note(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        payload = {
            "content": "Internal note: Potential memory leak in token validation module.",
            "activity_type": "NOTE",
            "is_internal": True,
        }
        res = self.client.post(f"/v1/itsm/incidents/{self.ticket_id}/activities", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["ticket_id"], self.ticket_id)
        self.assertEqual(data["content"], "Internal note: Potential memory leak in token validation module.")
        self.assertEqual(data["is_internal"], True)
        self.assertEqual(data["actor_email"], self.agent_email)

    # 11. Unauthenticated activity request receives 401
    def test_11_unauthenticated_activity_receives_401(self):
        res_get = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}/activities")
        self.assertEqual(res_get.status_code, 401)

        res_post = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/activities",
            json={"content": "Should fail", "is_internal": False},
        )
        self.assertEqual(res_post.status_code, 401)

    # 12. Unauthorized role receives 403
    def test_12_unauthorized_user_receives_403(self):
        headers = {"Authorization": f"Bearer {self.no_itsm_key}"}
        res_get = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}/activities", headers=headers)
        self.assertEqual(res_get.status_code, 403)

        res_post = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/activities",
            json={"content": "Should fail", "is_internal": False},
            headers=headers,
        )
        self.assertEqual(res_post.status_code, 403)

    # 13. Tenant isolation enforced on activities
    def test_13_tenant_isolation_enforced_on_activities(self):
        # Tenant A agent attempts to read Tenant B activities
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res_get = self.client.get(f"/v1/itsm/incidents/{self.tenant_b_ticket_id}/activities", headers=headers)
        self.assertEqual(res_get.status_code, 404)

        res_post = self.client.post(
            f"/v1/itsm/incidents/{self.tenant_b_ticket_id}/activities",
            json={"content": "Cross-tenant attempt", "is_internal": False},
            headers=headers,
        )
        self.assertEqual(res_post.status_code, 404)

    # 14. Internal notes are NOT exposed to Requester
    def test_14_internal_notes_hidden_from_requester(self):
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        req_ticket_res = self.client.post(
            "/v1/itsm/incidents",
            json={
                "title": "Requester VPN Disconnection",
                "description": "VPN client fails to reconnect.",
                "urgency": "HIGH",
            },
            headers=req_headers,
        )
        self.assertEqual(req_ticket_res.status_code, 201)
        req_ticket_id = req_ticket_res.json()["id"]

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignment_group = 'Security Operations' WHERE id = :id"),
                {"id": req_ticket_id},
            )

        agent_headers = {"Authorization": f"Bearer {self.agent_key}"}
        pub_res = self.client.post(
            f"/v1/itsm/incidents/{req_ticket_id}/activities",
            json={
                "content": "Public response: please restart the tunnel service.",
                "activity_type": "COMMENT",
                "is_internal": False,
            },
            headers=agent_headers,
        )
        self.assertEqual(pub_res.status_code, 201)

        note_res = self.client.post(
            f"/v1/itsm/incidents/{req_ticket_id}/activities",
            json={
                "content": "Internal diagnosis: VPN gateway certificate expires soon.",
                "activity_type": "NOTE",
                "is_internal": True,
            },
            headers=agent_headers,
        )
        self.assertEqual(note_res.status_code, 201)

        res = self.client.get(f"/v1/itsm/incidents/{req_ticket_id}/activities", headers=req_headers)
        self.assertEqual(res.status_code, 200)
        activities = res.json()

        internal_activities = [a for a in activities if a.get("is_internal") is True]
        self.assertEqual(len(internal_activities), 0, "Requester must never see internal notes")

        public_comments = [a for a in activities if a.get("content") == "Public response: please restart the tunnel service."]
        self.assertGreaterEqual(len(public_comments), 1, "Public comment should be visible to requester")

    # 15. SERVICE_AGENT can update incident status via safe status API
    def test_15_service_agent_can_update_status(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        # Current status is ASSIGNED -> transition to IN_PROGRESS
        payload = {
            "status": "IN_PROGRESS",
            "status_reason": "Beginning active troubleshooting of SSO tokens",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json=payload,
            headers=self.mutation_headers(headers, self.ticket_id),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "IN_PROGRESS")

    # 16. Existing assignment functionality requires INCIDENT_MANAGER (SERVICE_AGENT receives 403)
    def test_16_service_agent_cannot_assign_incident(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        payload = {
            "assignee_id": str(self.agent_user_id),
            "assignment_group": "Security Operations",
        }
        res = self.client.post(f"/v1/itsm/incidents/{self.ticket_id}/assign", json=payload, headers=headers)
        self.assertEqual(res.status_code, 403)

    # 17. SERVICE_AGENT can resolve an authorized incident
    def test_17_service_agent_can_resolve_incident(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res_progress = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json={"status": "IN_PROGRESS", "status_reason": "Investigating"},
            headers=self.mutation_headers(headers, self.ticket_id),
        )
        self.assertIn(res_progress.status_code, [200, 409])

        resolve_payload = {
            "status": "RESOLVED",
            "resolution_code": "PERMANENT_FIX",
            "resolution_summary": "Replaced faulty router interface module and verified traffic flow.",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json=resolve_payload,
            headers=self.mutation_headers(headers, self.ticket_id),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "RESOLVED")
        self.assertEqual(data["resolution_code"], "PERMANENT_FIX")
        self.assertEqual(data["resolution_summary"], "Replaced faulty router interface module and verified traffic flow.")
        self.assertIsNotNone(data["resolved_at"])

        res_act = self.client.get(f"/v1/itsm/incidents/{self.ticket_id}/activities", headers=headers)
        self.assertEqual(res_act.status_code, 200)
        activities = res_act.json()
        resolution_activities = [
            a for a in activities
            if a.get("activity_type") == "STATUS_CHANGE" and ("resolved" in (a.get("content") or "").lower() or (a.get("new_value") or {}).get("status") == "RESOLVED")
        ]
        self.assertGreaterEqual(len(resolution_activities), 1)

    # 18. Resolution validation fails when resolution_code or resolution_summary is missing
    def test_18_resolve_validation_fails_without_summary_or_code(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        ticket_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Validation Ticket", "description": "Validation check", "urgency": "MEDIUM", "assignment_group": "Security Operations"},
            headers=headers,
        )
        self.assertEqual(ticket_res.status_code, 201)
        tid = ticket_res.json()["id"]

        progressed = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "IN_PROGRESS"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(progressed.status_code, 200, progressed.text)

        # Missing code
        res1 = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "RESOLVED", "resolution_summary": "Summary only"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(res1.status_code, 400)

        # Missing summary
        res2 = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "RESOLVED", "resolution_code": "PERMANENT_FIX"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(res2.status_code, 400)

    # 19. Unauthorized role cannot resolve incident
    def test_19_unauthorized_user_cannot_resolve(self):
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        resolve_payload = {
            "status": "RESOLVED",
            "resolution_code": "PERMANENT_FIX",
            "resolution_summary": "Requester trying to resolve",
        }
        res_req = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json=resolve_payload,
            headers=req_headers,
        )
        self.assertEqual(res_req.status_code, 403)

        no_itsm_headers = {"Authorization": f"Bearer {self.no_itsm_key}"}
        res_no_itsm = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json=resolve_payload,
            headers=no_itsm_headers,
        )
        self.assertEqual(res_no_itsm.status_code, 403)

    # 20. Unauthenticated resolution returns 401
    def test_20_unauthenticated_resolution_returns_401(self):
        res = self.client.post(
            f"/v1/itsm/incidents/{self.ticket_id}/status",
            json={"status": "RESOLVED", "resolution_code": "PERMANENT_FIX", "resolution_summary": "No auth"},
        )
        self.assertEqual(res.status_code, 401)

    # 21. Cross-tenant resolution is blocked
    def test_21_cross_tenant_resolution_blocked(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        resolve_payload = {
            "status": "RESOLVED",
            "resolution_code": "PERMANENT_FIX",
            "resolution_summary": "Cross tenant resolution attempt",
        }
        res = self.client.post(
            f"/v1/itsm/incidents/{self.tenant_b_ticket_id}/status",
            json=resolve_payload,
            headers=headers,
        )
        self.assertEqual(res.status_code, 404)

    # 22. SERVICE_AGENT can reopen a resolved incident
    def test_22_service_agent_can_reopen_resolved_incident(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        ticket_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Reopen Test Ticket", "description": "Testing reopen", "urgency": "HIGH", "assignment_group": "Security Operations"},
            headers=headers,
        )
        self.assertEqual(ticket_res.status_code, 201)
        tid = ticket_res.json()["id"]

        progressed = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "IN_PROGRESS"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(progressed.status_code, 200, progressed.text)
        res_res = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "RESOLVED", "resolution_code": "WORKAROUND_APPLIED", "resolution_summary": "Temp bypass applied"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(res_res.status_code, 200)
        self.assertIsNotNone(res_res.json()["resolved_at"])

        reopen_payload = {
            "status": "IN_PROGRESS",
            "status_reason": "Customer reported recurrent symptom",
        }
        res_reopen = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json=reopen_payload,
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(res_reopen.status_code, 200)
        data = res_reopen.json()
        self.assertEqual(data["status"], "IN_PROGRESS")
        self.assertIsNone(data["resolved_at"])

        res_act = self.client.get(f"/v1/itsm/incidents/{tid}/activities", headers=headers)
        self.assertEqual(res_act.status_code, 200)
        reopen_acts = [
            a for a in res_act.json()
            if a.get("activity_type") == "STATUS_CHANGE" and "reopened" in (a.get("content") or "").lower()
        ]
        self.assertGreaterEqual(len(reopen_acts), 1)

    # 23. SERVICE_AGENT can close a resolved incident
    def test_23_service_agent_can_close_resolved_incident(self):
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        ticket_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Close Test Ticket", "description": "Testing closure", "urgency": "LOW", "assignment_group": "Security Operations"},
            headers=headers,
        )
        self.assertEqual(ticket_res.status_code, 201)
        tid = ticket_res.json()["id"]

        progressed = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "IN_PROGRESS"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(progressed.status_code, 200, progressed.text)
        resolved = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json={"status": "RESOLVED", "resolution_code": "PERMANENT_FIX", "resolution_summary": "Firmware patch applied"},
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(resolved.status_code, 200, resolved.text)

        close_payload = {"status": "CLOSED"}
        res_close = self.client.post(
            f"/v1/itsm/incidents/{tid}/status",
            json=close_payload,
            headers=self.mutation_headers(headers, tid),
        )
        self.assertEqual(res_close.status_code, 200)
        data = res_close.json()
        self.assertEqual(data["status"], "CLOSED")
        self.assertIsNotNone(data["closed_at"])
        self.assertEqual(data["closed_by"], str(self.agent_user_id))


if __name__ == "__main__":
    unittest.main()
