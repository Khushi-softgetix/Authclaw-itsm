"""Backend test suite for Service Agent Support Scope (/v1/itsm/services/my-scope).

Covers:
1. SERVICE_AGENT can retrieve support scope via GET /v1/itsm/services/my-scope (200 OK)
2. Multiple assigned teams are returned correctly
3. Supported services matching team escalation or user ownership are returned
4. Service catalog responsibilities matching fulfillment groups or parent services are returned
5. Empty states when agent has no teams/services/catalog items
6. Unauthenticated request receives 401 Unauthorized
7. User with disabled ITSM access receives 403 Forbidden
8. Tenant isolation: Agent in Tenant A cannot see Tenant B's teams, services, or catalog items
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentSupportScopeTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Tenant A
        cls.tenant_id = uuid4()
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-scope-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-scope-{uuid4().hex[:12]}"

        # Empty Agent in Tenant A (no teams)
        cls.empty_agent_id = uuid4()
        cls.empty_agent_key = f"empty-agent-{uuid4().hex[:12]}"

        # User without ITSM access
        cls.no_itsm_user_id = uuid4()
        cls.no_itsm_key = f"no-itsm-scope-{uuid4().hex[:12]}"

        # Tenant B
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-scope-{uuid4().hex[:12]}"

        # Teams in Tenant A
        cls.team_a1_id = uuid4()
        cls.team_a2_id = uuid4()
        cls.team_b1_id = uuid4()

        # Services in Tenant A
        cls.service_a1_id = uuid4()
        cls.service_a2_id = uuid4()
        cls.service_b1_id = uuid4()

        # Catalog Items
        cls.catalog_a1_id = uuid4()
        cls.catalog_a2_id = uuid4()
        cls.catalog_b1_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-scope-a-{uuid4().hex[:8]}"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-scope-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # Empty Agent (no teams assigned)
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.empty_agent_id, "tenant_id": cls.tenant_id, "email": f"empty-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.empty_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'empty-agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.empty_agent_key), "created_by": cls.empty_agent_id},
            )

            # User without ITSM access
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.no_itsm_user_id, "tenant_id": cls.tenant_id, "email": f"no-itsm-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-scope-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # 2. Teams in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tier 1 Operations', 'Frontline IT support team', true, now(), now())"
                ),
                {"id": cls.team_a1_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Cloud Reliability', 'SRE and cloud infrastructure team', true, now(), now())"
                ),
                {"id": cls.team_a2_id, "tenant_id": cls.tenant_id},
            )

            # Assign agent to both teams in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_id, "team_id": cls.team_a1_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_id, "team_id": cls.team_a2_id, "user_id": cls.agent_user_id},
            )

            # 3. Services in Tenant A
            # Service 1: Escalation team matches 'Tier 1 Operations'
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Enterprise Email Gateway', 'email-gw-scope', 'TIER_1', 'OPERATIONAL', 'Tier 1 Operations', now(), now())"
                ),
                {"id": cls.service_a1_id, "tenant_id": cls.tenant_id},
            )
            # Service 2: Owned directly by agent user
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, owner_user_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Kubernetes Cloud Pods', 'k8s-cloud-scope', 'TIER_2', 'OPERATIONAL', :owner_id, now(), now())"
                ),
                {"id": cls.service_a2_id, "tenant_id": cls.tenant_id, "owner_id": cls.agent_user_id},
            )

            # 4. Service Catalog Items in Tenant A
            # Catalog Item 1: fulfillment group matches 'Tier 1 Operations'
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, fulfillment_group, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Corporate Mailbox Provisioning', 'mailbox-provisioning', 'Tier 1 Operations', true, now(), now())"
                ),
                {"id": cls.catalog_a1_id, "tenant_id": cls.tenant_id, "service_id": cls.service_a1_id},
            )
            # Catalog Item 2: linked to supported service Kubernetes Cloud Pods
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'K8s Cluster Namespace Request', 'k8s-namespace-req', true, now(), now())"
                ),
                {"id": cls.catalog_a2_id, "tenant_id": cls.tenant_id, "service_id": cls.service_a2_id},
            )

            # 5. Tenant B setup (for tenant isolation)
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-scope-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"agent-b-{uuid4().hex[:8]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-scope-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_key), "created_by": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Secret Team', 'Secret team', true, now(), now())"
                ),
                {"id": cls.team_b1_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_b_id, "team_id": cls.team_b1_id, "user_id": cls.tenant_b_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Isolated Service', 'tb-iso-svc', 'TIER_1', 'OPERATIONAL', 'Tenant B Secret Team', now(), now())"
                ),
                {"id": cls.service_b1_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, fulfillment_group, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Tenant B Catalog Item', 'tb-cat-item', 'Tenant B Secret Team', true, now(), now())"
                ),
                {"id": cls.catalog_b1_id, "tenant_id": cls.tenant_b_id, "service_id": cls.service_b1_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.migrator_engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_service_catalog_items WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_team_members WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_teams WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.tenants WHERE id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})

    def test_01_get_my_scope_success(self):
        """SERVICE_AGENT can retrieve their support scope with teams, services, and catalog responsibilities."""
        resp = self.client.get(
            "/v1/itsm/services/my-scope",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()

        # Check teams
        team_names = [t["name"] for t in data["teams"]]
        self.assertIn("Tier 1 Operations", team_names)
        self.assertIn("Cloud Reliability", team_names)
        self.assertEqual(len(data["teams"]), 2)

        # Check services
        service_names = [s["name"] for s in data["services"]]
        self.assertIn("Enterprise Email Gateway", service_names)
        self.assertIn("Kubernetes Cloud Pods", service_names)

        # Check catalog items
        catalog_names = [c["name"] for c in data["catalog_items"]]
        self.assertIn("Corporate Mailbox Provisioning", catalog_names)
        self.assertIn("K8s Cluster Namespace Request", catalog_names)

    def test_02_empty_state_for_agent_without_teams(self):
        """Service Agent without any assigned teams receives empty scope safely."""
        resp = self.client.get(
            "/v1/itsm/services/my-scope",
            headers={"Authorization": f"Bearer {self.empty_agent_key}"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["teams"], [])
        self.assertEqual(data["services"], [])
        self.assertEqual(data["catalog_items"], [])

    def test_03_unauthenticated_fails(self):
        """Unauthenticated request receives 401 Unauthorized."""
        resp = self.client.get("/v1/itsm/services/my-scope")
        self.assertEqual(resp.status_code, 401)

    def test_04_no_itsm_access_fails(self):
        """User with disabled ITSM access receives 403 Forbidden."""
        resp = self.client.get(
            "/v1/itsm/services/my-scope",
            headers={"Authorization": f"Bearer {self.no_itsm_key}"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_05_tenant_isolation(self):
        """Agent in Tenant A cannot see Tenant B's teams, services, or catalog items."""
        resp_a = self.client.get(
            "/v1/itsm/services/my-scope",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(resp_a.status_code, 200)
        data_a = resp_a.json()

        team_names_a = [t["name"] for t in data_a["teams"]]
        self.assertNotIn("Tenant B Secret Team", team_names_a)

        service_names_a = [s["name"] for s in data_a["services"]]
        self.assertNotIn("Tenant B Isolated Service", service_names_a)

        catalog_names_a = [c["name"] for c in data_a["catalog_items"]]
        self.assertNotIn("Tenant B Catalog Item", catalog_names_a)

        # And Tenant B agent only sees Tenant B
        resp_b = self.client.get(
            "/v1/itsm/services/my-scope",
            headers={"Authorization": f"Bearer {self.tenant_b_key}"},
        )
        self.assertEqual(resp_b.status_code, 200)
        data_b = resp_b.json()

        team_names_b = [t["name"] for t in data_b["teams"]]
        self.assertEqual(team_names_b, ["Tenant B Secret Team"])

        service_names_b = [s["name"] for s in data_b["services"]]
        self.assertEqual(service_names_b, ["Tenant B Isolated Service"])


if __name__ == "__main__":
    unittest.main()
