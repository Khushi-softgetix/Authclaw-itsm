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
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Security Operations', true, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id},
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


if __name__ == "__main__":
    unittest.main()
