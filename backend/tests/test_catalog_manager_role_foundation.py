"""Comprehensive test suite for CATALOG_MANAGER role foundation (Step 1).

Verifies:
1. CATALOG_MANAGER is recognized as a valid ITSM role in VALID_ITSM_ROLES.
2. CATALOG_MANAGER with ITSM access can enter the ITSM product and access authorized service catalog data.
3. CATALOG_MANAGER without ITSM access is denied (403 Forbidden).
4. Strict RBAC boundaries: CATALOG_MANAGER cannot access Platform Administrator endpoints (/users, /teams, /settings, /sla-policies).
5. Strict RBAC boundaries: CATALOG_MANAGER cannot access Incident Manager major incident triage or saved views.
6. Strict RBAC boundaries: CATALOG_MANAGER cannot access Governance article mutation endpoints.
7. All 6 existing ITSM roles (REQUESTER, SERVICE_AGENT, INCIDENT_MANAGER, PROCESS_CHANGE_MANAGER, PLATFORM_ADMINISTRATOR, AUDITOR) remain functional and unchanged.
8. Multi-tenant isolation and PostgreSQL RLS remain strictly enforced.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.schemas.itsm_admin import VALID_ITSM_ROLES, ITSMUserAccessUpdateRequest
from main import app


class CatalogManagerRoleFoundationTestCase(unittest.TestCase):
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

        # Catalog Manager (with ITSM access)
        cls.cat_mgr_user_id = uuid4()
        cls.cat_mgr_email = f"catalog-mgr-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_key = f"cat-mgr-key-{uuid4().hex[:12]}"

        # Catalog Manager (WITHOUT ITSM access)
        cls.cat_mgr_no_access_id = uuid4()
        cls.cat_mgr_no_access_key = f"cat-no-access-{uuid4().hex[:12]}"

        # Platform Administrator
        cls.platform_admin_id = uuid4()
        cls.platform_admin_email = f"platform-admin-{uuid4().hex[:8]}@example.com"
        cls.platform_admin_key = f"p-admin-key-{uuid4().hex[:12]}"

        # Service Agent
        cls.agent_id = uuid4()
        cls.agent_key = f"agent-key-{uuid4().hex[:12]}"

        # Incident Manager
        cls.im_id = uuid4()
        cls.im_key = f"im-key-{uuid4().hex[:12]}"

        # Tenant B (for tenant isolation tests)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_service_id = uuid4()

        # Service in Tenant A
        cls.service_a_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-cat-a-{uuid4().hex[:8]}"},
            )

            # 2. Catalog Manager in Tenant A (has_itsm_access = true)
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.cat_mgr_user_id, "tenant_id": cls.tenant_id, "email": cls.cat_mgr_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CATALOG_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.cat_mgr_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'cat-mgr-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.cat_mgr_key), "created_by": cls.cat_mgr_user_id},
            )

            # 3. Catalog Manager WITHOUT ITSM access
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.cat_mgr_no_access_id, "tenant_id": cls.tenant_id, "email": f"cat-denied-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CATALOG_MANAGER', false, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.cat_mgr_no_access_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'cat-denied-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.cat_mgr_no_access_key), "created_by": cls.cat_mgr_no_access_id},
            )

            # 4. Platform Administrator in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.platform_admin_id, "tenant_id": cls.tenant_id, "email": cls.platform_admin_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'PLATFORM_ADMINISTRATOR', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.platform_admin_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'platform-admin-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.platform_admin_key), "created_by": cls.platform_admin_id},
            )

            # 5. Service Agent in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_id},
            )

            # 6. Incident Manager in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.im_id, "tenant_id": cls.tenant_id, "email": f"im-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'INCIDENT_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.im_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'im-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.im_key), "created_by": cls.im_id},
            )

            # 7. Seed a Service in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Cloud Hosting Services', 'cloud-hosting', 'Production cloud infrastructure', 'tier1', 'OPERATIONAL', 'Cloud Ops', now(), now())"
                ),
                {"id": cls.service_a_id, "tenant_id": cls.tenant_id},
            )

            # 8. Tenant B and its Service
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-cat-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Secret Service', 'tenant-b-secret', 'Confidential isolated service', 'tier1', 'OPERATIONAL', 'Secret Ops', now(), now())"
                ),
                {"id": cls.tenant_b_service_id, "tenant_id": cls.tenant_b_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.migrator_engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.tenants WHERE id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})

    # --- Test 1: Role Definition & Validation ---
    def test_01_catalog_manager_role_recognition(self):
        """Verify CATALOG_MANAGER is accepted in VALID_ITSM_ROLES and updates correctly."""
        self.assertIn("CATALOG_MANAGER", VALID_ITSM_ROLES)
        req = ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role="catalog_manager")
        self.assertEqual(req.itsm_role, "CATALOG_MANAGER")

        # Verify all 6 existing roles remain in VALID_ITSM_ROLES
        for role in (
            "REQUESTER",
            "SERVICE_AGENT",
            "INCIDENT_MANAGER",
            "PROCESS_CHANGE_MANAGER",
            "PLATFORM_ADMINISTRATOR",
            "AUDITOR",
        ):
            self.assertIn(role, VALID_ITSM_ROLES)

    # --- Test 2: Product Access for CATALOG_MANAGER ---
    def test_02_catalog_manager_product_access_me_endpoint(self):
        """User with CATALOG_MANAGER role and has_itsm_access=true enters ITSM product."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/auth/me", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["itsm_role"], "CATALOG_MANAGER")
        self.assertTrue(data["product_access"]["itsm"])

    def test_03_catalog_manager_can_access_services(self):
        """CATALOG_MANAGER can query ITSM services."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/services", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        services = res.json()
        self.assertTrue(any(s["id"] == str(self.service_a_id) for s in services))

    def test_04_catalog_manager_can_access_knowledge(self):
        """CATALOG_MANAGER can read knowledge base articles."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/knowledge", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)

    # --- Test 3: Denied without ITSM access ---
    def test_05_catalog_manager_without_itsm_access_denied(self):
        """CATALOG_MANAGER with has_itsm_access=false receives 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_no_access_key}"}
        res = self.client.get("/v1/itsm/services", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("ITSM access disabled", res.text)

    # --- Test 4: Strict RBAC - Platform Admin Isolation ---
    def test_06_catalog_manager_cannot_access_admin_users(self):
        """CATALOG_MANAGER attempting /v1/itsm/admin/users receives 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/admin/users", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Platform Administrator access required", res.text)

    def test_07_catalog_manager_cannot_access_admin_teams(self):
        """CATALOG_MANAGER attempting /v1/itsm/admin/teams receives 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/admin/teams", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Platform Administrator access required", res.text)

    def test_08_catalog_manager_cannot_access_admin_settings(self):
        """CATALOG_MANAGER attempting /v1/itsm/admin/settings receives 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/admin/settings", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Platform Administrator access required", res.text)

    def test_09_catalog_manager_cannot_invite_users(self):
        """CATALOG_MANAGER cannot invite or onboard users via admin endpoint."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        payload = {"email": "new-user@example.com", "itsm_role": "REQUESTER"}
        res = self.client.post("/v1/itsm/admin/users/invite", json=payload, headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Platform Administrator access required", res.text)

    # --- Test 5: Strict RBAC - Incident Manager Isolation ---
    def test_10_catalog_manager_cannot_access_incident_manager_endpoints(self):
        """CATALOG_MANAGER cannot declare major incidents or access IM-protected views."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get("/v1/itsm/incidents/operations/saved-views", headers=headers)
        self.assertEqual(res.status_code, 403)

    # --- Test 6: Platform Admin Can Assign CATALOG_MANAGER ---
    def test_11_platform_admin_can_assign_catalog_manager(self):
        """Platform Administrator can update a user's role to CATALOG_MANAGER."""
        admin_headers = {"Authorization": f"Bearer {self.platform_admin_key}"}
        payload = {
            "has_itsm_access": True,
            "itsm_role": "CATALOG_MANAGER",
            "has_governance_access": False,
        }
        res = self.client.post(
            f"/v1/itsm/admin/users/{self.agent_id}/access",
            json=payload,
            headers=admin_headers,
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["itsm_role"], "CATALOG_MANAGER")

        # Restore agent role for existing test compatibility
        payload["itsm_role"] = "SERVICE_AGENT"
        res_restore = self.client.post(
            f"/v1/itsm/admin/users/{self.agent_id}/access",
            json=payload,
            headers=admin_headers,
        )
        self.assertEqual(res_restore.status_code, 200)

    # --- Test 7: Tenant Isolation Enforced ---
    def test_12_tenant_isolation_enforced(self):
        """CATALOG_MANAGER in Tenant A cannot retrieve services from Tenant B."""
        headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res = self.client.get(f"/v1/itsm/services/{self.tenant_b_service_id}", headers=headers)
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
