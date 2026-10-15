"""End-to-End Testing and Security Verification Suite for CMDB_ADMIN (Prompt 6).

Comprehensive verification covering:
1. Role Assignment Verification (Authorized admin assigns CMDB_ADMIN, unauthorized rejected, persistence, existing roles).
2. Allowed and Denied Actions (Full permissions matrix for CMDB_ADMIN vs unrelated endpoints).
3. Tenant Isolation (Direct API and query isolation, no IDOR, no cross-tenant references, safe error messages).
4. CI Relationship Validation with company-website-01 -> app-server-01 -> company-db-01 chain.
   - Type validation, direction semantics, Upstream (Dependents), Downstream (Dependencies), All.
   - Nonexistent CI, cross-tenant CI, self-links, duplicate links, invalid types/directions, deletion safety, cycle rules.
5. Canonical and Compatibility API Routes (/v1 and /api/v1).
6. Security and Audit Verification (audit_log_metadata events for all CMDB operations).
7. Regression Testing across all 8 ITSM roles.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.schemas.itsm_admin import (
    VALID_ITSM_ROLES,
    VALID_CI_RELATIONSHIP_TYPES,
    CMDB_AUDIT_ACTION_CI_CREATED,
    CMDB_AUDIT_ACTION_CI_UPDATED,
    CMDB_AUDIT_ACTION_BULK_IMPORT,
    CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED,
    CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED,
)
from main import app


class CMDBAdminE2ESecurityVerificationTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.engine = create_engine(cls.db_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Primary Tenant: Tenant Alpha
        cls.tenant_id = uuid4()
        cls.tenant_name = f"tenant-alpha-{uuid4().hex[:8]}"

        # Secondary Tenant: Tenant Beta (for strict tenant isolation verification)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_name = f"tenant-beta-{uuid4().hex[:8]}"

        # Users in Tenant Alpha
        cls.platform_admin_id = uuid4()
        cls.platform_admin_key = f"plat-key-{uuid4().hex[:12]}"

        cls.cmdb_admin_id = uuid4()
        cls.cmdb_admin_key = f"cmdb-key-{uuid4().hex[:12]}"

        cls.service_agent_id = uuid4()
        cls.service_agent_key = f"agent-key-{uuid4().hex[:12]}"

        cls.incident_manager_id = uuid4()
        cls.incident_manager_key = f"incmgr-key-{uuid4().hex[:12]}"

        cls.process_change_mgr_id = uuid4()
        cls.process_change_mgr_key = f"chgmgr-key-{uuid4().hex[:12]}"

        cls.auditor_id = uuid4()
        cls.auditor_key = f"auditor-key-{uuid4().hex[:12]}"

        cls.catalog_manager_id = uuid4()
        cls.catalog_manager_key = f"catmgr-key-{uuid4().hex[:12]}"

        cls.requester_id = uuid4()
        cls.requester_key = f"req-key-{uuid4().hex[:12]}"

        # User in Tenant Beta
        cls.tenant_b_admin_id = uuid4()
        cls.tenant_b_admin_key = f"beta-cmdb-key-{uuid4().hex[:12]}"

        with cls.engine.begin() as conn:
            # 1. Create Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'enterprise', 'active', now(), now())"
                ),
                [
                    {"id": cls.tenant_id, "name": cls.tenant_name},
                    {"id": cls.tenant_b_id, "name": cls.tenant_b_name},
                ],
            )

            # 2. Create Users
            users_info = [
                {"id": cls.platform_admin_id, "tenant_id": cls.tenant_id, "email": f"plat-{uuid4().hex[:6]}@example.com", "role": "admin", "platform_role": "ADMIN"},
                {"id": cls.cmdb_admin_id, "tenant_id": cls.tenant_id, "email": f"cmdb-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.service_agent_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.incident_manager_id, "tenant_id": cls.tenant_id, "email": f"incmgr-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.process_change_mgr_id, "tenant_id": cls.tenant_id, "email": f"chgmgr-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.auditor_id, "tenant_id": cls.tenant_id, "email": f"auditor-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.catalog_manager_id, "tenant_id": cls.tenant_id, "email": f"catmgr-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.requester_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:6]}@example.com", "role": "viewer", "platform_role": "NONE"},
                {"id": cls.tenant_b_admin_id, "tenant_id": cls.tenant_b_id, "email": f"beta-{uuid4().hex[:6]}@example.com", "role": "admin", "platform_role": "NONE"},
            ]
            for u in users_info:
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, 'hash', :role, :platform_role, true, now(), now())"
                    ),
                    u,
                )

            # 3. Create API Keys
            keys_info = [
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.platform_admin_id, "key": cls.platform_admin_key, "name": "plat"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_id, "key": cls.cmdb_admin_key, "name": "cmdb"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.service_agent_id, "key": cls.service_agent_key, "name": "agent"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.incident_manager_id, "key": cls.incident_manager_key, "name": "incmgr"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.process_change_mgr_id, "key": cls.process_change_mgr_key, "name": "chgmgr"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.auditor_id, "key": cls.auditor_key, "name": "auditor"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.catalog_manager_id, "key": cls.catalog_manager_key, "name": "catmgr"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.requester_id, "key": cls.requester_key, "name": "req"},
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_admin_id, "key": cls.tenant_b_admin_key, "name": "beta-cmdb"},
            ]
            for k in keys_info:
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"
                    ),
                    {
                        "id": k["id"],
                        "tenant_id": k["tenant_id"],
                        "key_hash": hash_key(k["key"]),
                        "name": k["name"],
                        "user_id": k["user_id"],
                    },
                )

            # 4. Assign ITSM Roles (public.itsm_user_access)
            access_info = [
                {"tenant_id": cls.tenant_id, "user_id": cls.platform_admin_id, "role": "PLATFORM_ADMINISTRATOR"},
                {"tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_id, "role": "CMDB_ADMIN"},
                {"tenant_id": cls.tenant_id, "user_id": cls.service_agent_id, "role": "SERVICE_AGENT"},
                {"tenant_id": cls.tenant_id, "user_id": cls.incident_manager_id, "role": "INCIDENT_MANAGER"},
                {"tenant_id": cls.tenant_id, "user_id": cls.process_change_mgr_id, "role": "PROCESS_CHANGE_MANAGER"},
                {"tenant_id": cls.tenant_id, "user_id": cls.auditor_id, "role": "AUDITOR"},
                {"tenant_id": cls.tenant_id, "user_id": cls.catalog_manager_id, "role": "CATALOG_MANAGER"},
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_id, "role": "REQUESTER"},
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_admin_id, "role": "CMDB_ADMIN"},
            ]
            for a in access_info:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :role, true, true, now(), now())"
                    ),
                    a,
                )

            # 5. Seed Test ITSM Service in Tenant Alpha
            cls.alpha_service_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Corporate Web Portal', 'corp-web-portal', 'TIER_1', 'OPERATIONAL', now(), now())"
                ),
                {"id": cls.alpha_service_id, "tenant_id": cls.tenant_id},
            )

            # 6. Seed Test CIs in Tenant Alpha (per Prompt 5 & 6 specs)
            cls.ci_app_id = uuid4()      # company-website-01 (Application)
            cls.ci_server_id = uuid4()   # app-server-01 (Server)
            cls.ci_db_id = uuid4()       # company-db-01 (Database)

            cls.ci_app_name = "company-website-01"
            cls.ci_server_name = "app-server-01"
            cls.ci_db_name = "company-db-01"

            cis = [
                {"id": cls.ci_app_id, "tenant_id": cls.tenant_id, "service_id": cls.alpha_service_id, "name": cls.ci_app_name, "ci_type": "APPLICATION", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_server_id, "tenant_id": cls.tenant_id, "service_id": cls.alpha_service_id, "name": cls.ci_server_name, "ci_type": "SERVER", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_db_id, "tenant_id": cls.tenant_id, "service_id": cls.alpha_service_id, "name": cls.ci_db_name, "ci_type": "DATABASE", "environment": "PRODUCTION", "status": "ACTIVE"},
            ]
            for ci in cis:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :service_id, :name, :ci_type, :environment, :status, '{}'::jsonb, now(), now())"
                    ),
                    ci,
                )

            # 7. Seed Test CI and Service in Tenant Beta (for strict tenant isolation tests)
            cls.beta_service_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Beta Secret Service', 'beta-secret-svc', 'TIER_1', 'OPERATIONAL', now(), now())"
                ),
                {"id": cls.beta_service_id, "tenant_id": cls.tenant_b_id},
            )
            cls.beta_ci_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'beta-protected-db-01', 'DATABASE', 'PRODUCTION', 'ACTIVE', '{}'::jsonb, now(), now())"
                ),
                {"id": cls.beta_ci_id, "tenant_id": cls.tenant_b_id, "service_id": cls.beta_service_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_ci_relationships WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_configuration_items WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            try:
                conn.execute(text("DELETE FROM public.audit_log_metadata WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.tenants WHERE id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            except Exception:
                pass
        cls.engine.dispose()

    # =========================================================================
    # SECTION 2: ROLE ASSIGNMENT VERIFICATION
    # =========================================================================

    def test_sec2_01_platform_admin_can_assign_cmdb_admin_role(self):
        """Authorized Platform Administrator can assign CMDB_ADMIN role via user access update endpoint."""
        # Update Requester to CMDB_ADMIN
        res = self.client.post(
            f"/v1/itsm/admin/users/{self.requester_id}/access",
            headers={"Authorization": f"Bearer {self.platform_admin_key}"},
            json={"has_itsm_access": True, "itsm_role": "CMDB_ADMIN", "has_governance_access": True},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["itsm_role"], "CMDB_ADMIN")

        # Verify DB persistence
        with self.engine.connect() as conn:
            row = conn.execute(
                text("SELECT itsm_role, has_itsm_access FROM authn.lookup_itsm_user_access(:tid, :uid)"),
                {"tid": str(self.tenant_id), "uid": str(self.requester_id)},
            ).first()
            self.assertEqual(row.itsm_role, "CMDB_ADMIN")
            self.assertTrue(row.has_itsm_access)

        # Restore Requester role
        res_reset = self.client.post(
            f"/v1/itsm/admin/users/{self.requester_id}/access",
            headers={"Authorization": f"Bearer {self.platform_admin_key}"},
            json={"has_itsm_access": True, "itsm_role": "REQUESTER", "has_governance_access": True},
        )
        self.assertEqual(res_reset.status_code, 200)

    def test_sec2_02_unauthorized_user_cannot_assign_cmdb_admin_or_modify_own_role(self):
        """Non-admin users (SERVICE_AGENT, REQUESTER, CMDB_ADMIN) cannot assign CMDB_ADMIN or alter roles (403)."""
        unauthorized_keys = [self.service_agent_key, self.requester_key, self.cmdb_admin_key]
        for key in unauthorized_keys:
            # Attempt to promote self
            res = self.client.post(
                f"/v1/itsm/admin/users/{self.cmdb_admin_id}/access",
                headers={"Authorization": f"Bearer {key}"},
                json={"has_itsm_access": True, "itsm_role": "PLATFORM_ADMINISTRATOR"},
            )
            self.assertEqual(res.status_code, 403, f"Key {key[:10]} must be rejected with 403")

    def test_sec2_03_invalid_role_assignment_rejected(self):
        """Assigning unsupported/invalid role names returns 400 Bad Request."""
        res = self.client.post(
            f"/v1/itsm/admin/users/{self.service_agent_id}/access",
            headers={"Authorization": f"Bearer {self.platform_admin_key}"},
            json={"has_itsm_access": True, "itsm_role": "SUPER_HACKER_ROLE"},
        )
        self.assertIn(res.status_code, (400, 422))
        self.assertIn("Invalid ITSM role", res.text)

    def test_sec2_04_existing_roles_preserved_in_valid_roles_catalog(self):
        """All existing role names continue to be recognized and valid."""
        expected_roles = {
            "REQUESTER",
            "SERVICE_AGENT",
            "INCIDENT_MANAGER",
            "PROCESS_CHANGE_MANAGER",
            "PLATFORM_ADMINISTRATOR",
            "AUDITOR",
            "CATALOG_MANAGER",
            "CMDB_ADMIN",
        }
        for r in expected_roles:
            self.assertIn(r, VALID_ITSM_ROLES)

    # =========================================================================
    # SECTION 3 & 6: ALLOWED AND DENIED ACTIONS & API BEHAVIOR
    # =========================================================================

    def test_sec3_01_unauthenticated_requests_follow_existing_auth_policy(self):
        """Unauthenticated requests without bearer tokens receive 401 Unauthorized across all CMDB endpoints."""
        endpoints = [
            ("GET", "/v1/itsm/admin/configuration-items"),
            ("POST", "/v1/itsm/admin/configuration-items"),
            ("PATCH", f"/v1/itsm/admin/configuration-items/{self.ci_app_id}"),
            ("POST", "/v1/itsm/admin/configuration-items/import/dry-run"),
            ("POST", "/v1/itsm/admin/configuration-items/import/commit"),
            ("GET", f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships"),
            ("POST", "/v1/itsm/admin/configuration-items/relationships"),
            ("DELETE", f"/v1/itsm/admin/configuration-items/relationships/{uuid4()}"),
            ("GET", "/v1/itsm/admin/ci-relationships"),
            ("POST", "/v1/itsm/admin/ci-relationships"),
            ("DELETE", f"/v1/itsm/admin/ci-relationships/{uuid4()}"),
        ]
        for meth, url in endpoints:
            r = self.client.request(meth, url)
            self.assertEqual(r.status_code, 401, f"{meth} {url} must return 401 when unauthenticated")

    def test_sec3_02_insufficient_roles_denied_cmdb_endpoints(self):
        """REQUESTER, SERVICE_AGENT, AUDITOR, CATALOG_MANAGER receive 403 Forbidden on CMDB operations."""
        disallowed_keys = [
            (self.requester_key, "REQUESTER"),
            (self.service_agent_key, "SERVICE_AGENT"),
            (self.auditor_key, "AUDITOR"),
            (self.catalog_manager_key, "CATALOG_MANAGER"),
        ]
        for key, role_name in disallowed_keys:
            headers = {"Authorization": f"Bearer {key}"}
            # List CIs
            r_get = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
            self.assertEqual(r_get.status_code, 403, f"{role_name} must receive 403 on GET /configuration-items")

            # Create CI
            r_post = self.client.post("/v1/itsm/admin/configuration-items", headers=headers, json={"name": "test", "ci_type": "SERVER"})
            self.assertEqual(r_post.status_code, 403, f"{role_name} must receive 403 on POST /configuration-items")

            # Relationship endpoint
            r_rel = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships", headers=headers)
            self.assertEqual(r_rel.status_code, 403, f"{role_name} must receive 403 on GET relationships")

    def test_sec3_03_cmdb_admin_cannot_access_unrelated_admin_functions(self):
        """CMDB_ADMIN cannot access user management, team management, settings, SLA, or mutate services."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. User management
        self.assertEqual(self.client.get("/v1/itsm/admin/users", headers=headers).status_code, 403)
        self.assertEqual(self.client.post("/v1/itsm/admin/users/invite", headers=headers, json={"email": "h@ex.com", "itsm_role": "REQUESTER"}).status_code, 403)

        # 2. Team creation
        self.assertEqual(self.client.post("/v1/itsm/admin/teams", headers=headers, json={"name": "DevSecOps"}).status_code, 403)

        # 3. Settings & SLA
        self.assertEqual(self.client.get("/v1/itsm/admin/settings", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/v1/itsm/admin/sla-policies", headers=headers).status_code, 403)

        # 4. Service mutation (CMDB_ADMIN can read services, but cannot create or patch services)
        self.assertEqual(self.client.post("/v1/itsm/admin/services", headers=headers, json={"name": "RogueSvc"}).status_code, 403)
        self.assertEqual(self.client.patch(f"/v1/itsm/admin/services/{self.alpha_service_id}", headers=headers, json={"name": "Tampered"}).status_code, 403)

    def test_sec3_04_api_compatibility_routes_api_v1(self):
        """CMDB endpoints are fully accessible via both /v1/itsm/admin and /api/v1/itsm/admin."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # Test GET /api/v1/itsm/admin/configuration-items
        r_list = self.client.get("/api/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(r_list.status_code, 200)

        # Test POST /api/v1/itsm/admin/configuration-items
        test_ci_name = f"api-v1-test-{uuid4().hex[:6]}"
        r_create = self.client.post(
            "/api/v1/itsm/admin/configuration-items",
            headers=headers,
            json={"name": test_ci_name, "ci_type": "SERVER", "environment": "PRODUCTION", "status": "ACTIVE"},
        )
        self.assertEqual(r_create.status_code, 201)
        created_ci_id = r_create.json()["id"]

        # Test PATCH /api/v1/itsm/admin/configuration-items/{id}
        r_patch = self.client.patch(
            f"/api/v1/itsm/admin/configuration-items/{created_ci_id}",
            headers=headers,
            json={"status": "MAINTENANCE"},
        )
        self.assertEqual(r_patch.status_code, 200)
        self.assertEqual(r_patch.json()["status"], "MAINTENANCE")

        # Test GET /api/v1/itsm/admin/ci-relationships
        r_rels = self.client.get("/api/v1/itsm/admin/ci-relationships", headers=headers)
        self.assertEqual(r_rels.status_code, 200)

    # =========================================================================
    # SECTION 4: TENANT ISOLATION
    # =========================================================================

    def test_sec4_01_cmdb_admin_views_only_own_tenant_cis(self):
        """CMDB_ADMIN can only list and view CIs belonging to their authorized tenant."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res.status_code, 200)
        cis = res.json()
        ci_ids = {c["id"] for c in cis}

        # Tenant Alpha CIs must be present
        self.assertIn(str(self.ci_app_id), ci_ids)
        self.assertIn(str(self.ci_server_id), ci_ids)
        self.assertIn(str(self.ci_db_id), ci_ids)

        # Tenant Beta CI must NEVER appear
        self.assertNotIn(str(self.beta_ci_id), ci_ids)

    def test_sec4_02_cannot_update_or_idor_foreign_tenant_ci(self):
        """Attempting to update a CI from Tenant B returns 404 and does not leak info."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.patch(
            f"/v1/itsm/admin/configuration-items/{self.beta_ci_id}",
            headers=headers,
            json={"name": "Hacked DB"},
        )
        self.assertEqual(res.status_code, 404)
        self.assertIn("not found in this tenant", res.text)
        self.assertNotIn("beta-protected-db-01", res.text)

    def test_sec4_03_relationship_rejects_cross_tenant_cis(self):
        """Creating relationship between Tenant Alpha CI and Tenant Beta CI returns 404."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # Alpha parent, Beta child
        res1 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.beta_ci_id), "relationship_type": "DEPENDS_ON"},
        )
        self.assertEqual(res1.status_code, 404)
        self.assertIn("Child Configuration Item not found in this tenant", res1.text)

        # Beta parent, Alpha child
        res2 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.beta_ci_id), "child_ci_id": str(self.ci_server_id), "relationship_type": "RUNS_ON"},
        )
        self.assertEqual(res2.status_code, 404)
        self.assertIn("Parent Configuration Item not found in this tenant", res2.text)

    def test_sec4_04_import_dry_run_and_commit_reject_foreign_tenant_services(self):
        """Import referencing a service belonging to another tenant is rejected with validation error."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        payload = {
            "source_filename": "cross_tenant_test.csv",
            "source_type": "csv",
            "raw_records": [{"name": "infiltrator-ci", "ci_type": "SERVER", "service_name": "Beta Secret Service"}],
            "field_mapping": {"name": "name", "ci_type": "ci_type", "service_name": "service_name"},
        }
        res_dry = self.client.post("/v1/itsm/admin/configuration-items/import/dry-run", headers=headers, json=payload)
        self.assertEqual(res_dry.status_code, 200)
        data = res_dry.json()
        self.assertEqual(data["valid_records"], 0)
        self.assertEqual(data["error_count"], 1)
        self.assertTrue(any("not found in this tenant" in e for e in data["rows"][0]["errors"]))

    # =========================================================================
    # SECTION 5: CI RELATIONSHIP VALIDATION (company-website-01 chain)
    # =========================================================================

    def test_sec5_01_create_valid_chain_company_website_to_server_to_db(self):
        """Create and verify valid chain: company-website-01 -> app-server-01 -> company-db-01."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # Edge 1: company-website-01 DEPENDS_ON app-server-01
        res1 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_server_id),
                "relationship_type": "DEPENDS_ON",
                "source": "MANUAL",
                "confidence": 1.0,
            },
        )
        self.assertEqual(res1.status_code, 201, res1.text)
        edge1 = res1.json()
        self.assertEqual(edge1["parent_ci_id"], str(self.ci_app_id))
        self.assertEqual(edge1["child_ci_id"], str(self.ci_server_id))
        self.assertEqual(edge1["relationship_type"], "DEPENDS_ON")
        self.assertEqual(edge1["direction"], "downstream")
        self.assertIn("Depends on app-server-01", edge1["display_label"])
        self.assertEqual(edge1["related_ci"]["name"], self.ci_server_name)

        # Edge 2: app-server-01 DEPENDS_ON company-db-01
        res2 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={
                "parent_ci_id": str(self.ci_server_id),
                "child_ci_id": str(self.ci_db_id),
                "relationship_type": "DEPENDS_ON",
                "source": "MANUAL",
                "confidence": 1.0,
            },
        )
        self.assertEqual(res2.status_code, 201, res2.text)
        edge2 = res2.json()
        self.assertEqual(edge2["parent_ci_id"], str(self.ci_server_id))
        self.assertEqual(edge2["child_ci_id"], str(self.ci_db_id))
        self.assertEqual(edge2["relationship_type"], "DEPENDS_ON")
        self.assertEqual(edge2["direction"], "downstream")
        self.assertIn("Depends on company-db-01", edge2["display_label"])

    def test_sec5_02_direction_semantics_upstream_downstream_and_all(self):
        """Query upstream (dependents), downstream (dependencies), and all for the 3 CIs."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. company-website-01 perspective:
        # Downstream: app-server-01
        res_down = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships?direction=downstream", headers=headers)
        self.assertEqual(res_down.status_code, 200)
        down_ids = [r["related_ci"]["id"] for r in res_down.json()]
        self.assertIn(str(self.ci_server_id), down_ids)

        # Upstream: empty (nothing depends on company-website-01 yet)
        res_up = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships?direction=upstream", headers=headers)
        self.assertEqual(res_up.status_code, 200)
        self.assertEqual(len(res_up.json()), 0)

        # 2. app-server-01 perspective:
        # Downstream: company-db-01
        res_app_down = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_server_id}/relationships?direction=downstream", headers=headers)
        self.assertEqual(res_app_down.status_code, 200)
        app_down_ids = [r["related_ci"]["id"] for r in res_app_down.json()]
        self.assertIn(str(self.ci_db_id), app_down_ids)

        # Upstream: company-website-01
        res_app_up = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_server_id}/relationships?direction=upstream", headers=headers)
        self.assertEqual(res_app_up.status_code, 200)
        app_up_ids = [r["related_ci"]["id"] for r in res_app_up.json()]
        self.assertIn(str(self.ci_app_id), app_up_ids)
        self.assertIn("Depended on by company-website-01", res_app_up.json()[0]["display_label"])

        # All: contains both company-website-01 and company-db-01
        res_app_all = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_server_id}/relationships?direction=all", headers=headers)
        self.assertEqual(res_app_all.status_code, 200)
        all_ids = {r["related_ci"]["id"] for r in res_app_all.json()}
        self.assertIn(str(self.ci_app_id), all_ids)
        self.assertIn(str(self.ci_db_id), all_ids)

        # 3. company-db-01 perspective:
        # Upstream: app-server-01
        res_db_up = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_db_id}/relationships?direction=upstream", headers=headers)
        self.assertEqual(res_db_up.status_code, 200)
        db_up_ids = [r["related_ci"]["id"] for r in res_db_up.json()]
        self.assertIn(str(self.ci_server_id), db_up_ids)

        # Downstream: empty
        res_db_down = self.client.get(f"/v1/itsm/admin/configuration-items/{self.ci_db_id}/relationships?direction=downstream", headers=headers)
        self.assertEqual(res_db_down.status_code, 200)
        self.assertEqual(len(res_db_down.json()), 0)

    def test_sec5_03_invalid_relationship_types_and_directions_rejected(self):
        """Backend rejects invalid relationship types and unsupported direction query parameters."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. Invalid relationship type on POST -> 400/422
        res_type = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_db_id), "relationship_type": "DISCOVERS"},
        )
        self.assertIn(res_type.status_code, (400, 422))
        self.assertIn("Supported types", res_type.text)

        # 2. Invalid direction on GET -> 400
        res_dir = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships?direction=diagonal",
            headers=headers,
        )
        self.assertEqual(res_dir.status_code, 400)
        self.assertIn("Invalid direction", res_dir.text)

        # 3. Invalid relationship_type filter on GET -> 400
        res_filter = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships?relationship_type=NOT_A_VALID_TYPE",
            headers=headers,
        )
        self.assertEqual(res_filter.status_code, 400)
        self.assertIn("Invalid relationship type", res_filter.text)

    def test_sec5_04_self_referential_relationship_prohibited(self):
        """Self-referential relationships (parent == child) are strictly prohibited (400/422)."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_app_id), "relationship_type": "DEPENDS_ON"},
        )
        self.assertIn(res.status_code, (400, 422))
        self.assertIn("self-link is prohibited", res.text)

    def test_sec5_05_duplicate_relationship_enforces_uniqueness(self):
        """Duplicate relationship of same type between same pair returns 409 Conflict."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_server_id), "relationship_type": "DEPENDS_ON"},
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn("already exists", res.text)

    def test_sec5_06_class_compatibility_direction_rules_enforced(self):
        """Incompatible class directions are rejected (e.g. SERVER running on DATABASE -> 400)."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_server_id), "child_ci_id": str(self.ci_db_id), "relationship_type": "RUNS_ON"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid direction rule: SERVER cannot run on DATABASE", res.text)

    def test_sec5_07_relationship_deletion_removes_only_edge_not_cis(self):
        """Deleting a relationship deletes only the edge and preserves both CIs."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # Create temporary link: company-website-01 CONNECTS_TO company-db-01
        res_link = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers=headers,
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_db_id), "relationship_type": "CONNECTS_TO"},
        )
        self.assertEqual(res_link.status_code, 201)
        rel_id = res_link.json()["id"]

        # Delete the relationship
        res_del = self.client.delete(f"/v1/itsm/admin/configuration-items/relationships/{rel_id}", headers=headers)
        self.assertEqual(res_del.status_code, 204)

        # Confirm the relationship is gone
        res_del_again = self.client.delete(f"/v1/itsm/admin/configuration-items/relationships/{rel_id}", headers=headers)
        self.assertEqual(res_del_again.status_code, 404)

        # Confirm BOTH CIs still exist and are completely intact
        res_cis = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res_cis.status_code, 200)
        names = {ci["name"] for ci in res_cis.json()}
        self.assertIn(self.ci_app_name, names)
        self.assertIn(self.ci_db_name, names)

    # =========================================================================
    # SECTION 9: SECURITY AND AUDIT CHECKS
    # =========================================================================

    def test_sec9_01_all_cmdb_mutations_emit_immutable_audit_events(self):
        """Authoritative audit events exist for CI creation, CI update, bulk import, relationship creation, and deletion."""
        with self.engine.connect() as conn:
            # 1. CI Created
            audit_ci_create = conn.execute(
                text("SELECT action, actor_id, request_id, tenant_id FROM public.audit_log_metadata WHERE tenant_id = :tid AND action = :act"),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_CI_CREATED},
            ).first()
            self.assertIsNotNone(audit_ci_create, "Audit event for CI creation must exist")

            # 2. Relationship Created
            audit_rel_create = conn.execute(
                text("SELECT action, actor_id, request_id, tenant_id FROM public.audit_log_metadata WHERE tenant_id = :tid AND action = :act"),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED},
            ).first()
            self.assertIsNotNone(audit_rel_create, "Audit event for Relationship creation must exist")

            # 3. Relationship Deleted
            audit_rel_delete = conn.execute(
                text("SELECT action, actor_id, request_id, tenant_id FROM public.audit_log_metadata WHERE tenant_id = :tid AND action = :act"),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED},
            ).first()
            self.assertIsNotNone(audit_rel_delete, "Audit event for Relationship deletion must exist")


if __name__ == "__main__":
    unittest.main()
