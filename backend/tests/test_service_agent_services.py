"""Backend test suite for Service Agent Services & Service Context (Step 7).

Covers:
1. SERVICE_AGENT can list services via GET /v1/itsm/services (200 OK)
2. SERVICE_AGENT can search services with keywords (?search=WireGuard)
3. SERVICE_AGENT can filter services by status and tier
4. SERVICE_AGENT can retrieve service detail with linked CIs and recent tickets (200 OK)
5. Unauthenticated request receives 401 Unauthorized
6. User with disabled ITSM access receives 403 Forbidden
7. Tenant isolation: Agent in Tenant A cannot access Tenant B service (404 Not Found)
8. Non-existent service returns 404 Not Found
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentServicesTestCase(unittest.TestCase):
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
        cls.agent_email = f"agent-svc-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-svc-{uuid4().hex[:12]}"

        # User without ITSM access
        cls.no_itsm_user_id = uuid4()
        cls.no_itsm_key = f"no-itsm-svc-{uuid4().hex[:12]}"

        # Tenant B
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-svc-{uuid4().hex[:12]}"

        # Service IDs
        cls.service_a1_id = uuid4()
        cls.service_a2_id = uuid4()
        cls.service_b1_id = uuid4()

        # CI IDs
        cls.ci_a1_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-svc-a-{uuid4().hex[:8]}"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-svc-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # User without ITSM access in Tenant A
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
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', false, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.no_itsm_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'no-itsm-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.no_itsm_key), "created_by": cls.no_itsm_user_id},
            )

            # Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-svc-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"agent-tb-{uuid4().hex[:6]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-svc-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_key), "created_by": cls.tenant_b_agent_id},
            )

            # Seed Services for Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, owner_user_id, created_at, updated_at) "
                    "VALUES (:id, :t_id, 'WireGuard VPN Gateway', 'wireguard-vpn', 'Secure remote access gateway.', 'TIER_1', 'OPERATIONAL', 'Network Ops', :owner_id, now(), now())"
                ),
                {"id": cls.service_a1_id, "t_id": cls.tenant_id, "owner_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, owner_user_id, created_at, updated_at) "
                    "VALUES (:id, :t_id, 'Billing & Invoicing API', 'billing-api', 'Customer payment collection engine.', 'TIER_2', 'DEGRADED', 'Finance Eng', :owner_id, now(), now())"
                ),
                {"id": cls.service_a2_id, "t_id": cls.tenant_id, "owner_id": cls.agent_user_id},
            )

            # Seed CI for Service A1
            conn.execute(
                text(
                    "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                    "VALUES (:id, :t_id, :s_id, 'vpn-edge-01', 'NETWORK', 'PRODUCTION', 'ACTIVE', '{\"ip\": \"10.0.0.1\"}'::jsonb, now(), now())"
                ),
                {"id": cls.ci_a1_id, "t_id": cls.tenant_id, "s_id": cls.service_a1_id},
            )

            # Seed Service for Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, owner_user_id, created_at, updated_at) "
                    "VALUES (:id, :t_id, 'Tenant B Secret Service', 'tb-secret-service', 'Confidential Tenant B infrastructure.', 'TIER_1', 'OPERATIONAL', 'Secret Team', :owner_id, now(), now())"
                ),
                {"id": cls.service_b1_id, "t_id": cls.tenant_b_id, "owner_id": cls.tenant_b_agent_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.migrator_engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_configuration_items WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.tenants WHERE id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})

    def test_01_service_agent_list_services(self):
        """1. SERVICE_AGENT can list services (200 OK)."""
        res = self.client.get(
            "/v1/itsm/services",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 2)
        names = [s["name"] for s in data]
        self.assertIn("WireGuard VPN Gateway", names)
        self.assertIn("Billing & Invoicing API", names)

    def test_02_service_agent_search_services(self):
        """2. SERVICE_AGENT can search services with query keywords."""
        res = self.client.get(
            "/v1/itsm/services?search=WireGuard",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "WireGuard VPN Gateway")

    def test_03_service_agent_filter_services_status_tier(self):
        """3. SERVICE_AGENT can filter services by status and tier."""
        res = self.client.get(
            "/v1/itsm/services?status=DEGRADED",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["status"], "DEGRADED")
        self.assertEqual(data[0]["name"], "Billing & Invoicing API")

        # Filter by tier
        res_tier = self.client.get(
            "/v1/itsm/services?tier=TIER_1",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res_tier.status_code, 200)
        data_tier = res_tier.json()
        self.assertEqual(len(data_tier), 1)
        self.assertEqual(data_tier[0]["tier"], "TIER_1")
        self.assertEqual(data_tier[0]["name"], "WireGuard VPN Gateway")

    def test_04_service_agent_service_detail_with_ci(self):
        """4. SERVICE_AGENT can retrieve service detail with linked CIs."""
        res = self.client.get(
            f"/v1/itsm/services/{self.service_a1_id}",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["id"], str(self.service_a1_id))
        self.assertEqual(data["name"], "WireGuard VPN Gateway")
        self.assertEqual(data["owner_email"], self.agent_email)
        self.assertIn("configuration_items", data)
        self.assertEqual(len(data["configuration_items"]), 1)
        self.assertEqual(data["configuration_items"][0]["name"], "vpn-edge-01")

    def test_05_unauthenticated_request_returns_401(self):
        """5. Unauthenticated request receives 401 Unauthorized."""
        res = self.client.get("/v1/itsm/services")
        self.assertEqual(res.status_code, 401)

    def test_06_inactive_itsm_access_returns_403(self):
        """6. User without active ITSM access receives 403 Forbidden."""
        res = self.client.get(
            "/v1/itsm/services",
            headers={"Authorization": f"Bearer {self.no_itsm_key}"},
        )
        self.assertEqual(res.status_code, 403)

    def test_07_tenant_isolation_cross_tenant_access_blocked(self):
        """7. Tenant isolation: Agent in Tenant A cannot retrieve Tenant B service (404 Not Found)."""
        res = self.client.get(
            f"/v1/itsm/services/{self.service_b1_id}",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 404)

    def test_08_non_existent_service_returns_404(self):
        """8. Non-existent service returns 404 Not Found."""
        res = self.client.get(
            f"/v1/itsm/services/{uuid4()}",
            headers={"Authorization": f"Bearer {self.agent_key}"},
        )
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
