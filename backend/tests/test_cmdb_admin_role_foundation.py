"""Comprehensive test suite for CMDB_ADMIN backend permissions, tenant isolation, and audit security.

Verifies:
1. Unauthenticated requests are rejected (401 Unauthorized).
2. Authenticated user without active ITSM access is rejected (403 Forbidden).
3. A REQUESTER cannot manage configuration items (403 Forbidden).
4. CMDB_ADMIN can perform permitted CMDB operations within its tenant (GET, POST, PATCH, import).
5. PLATFORM_ADMINISTRATOR retains full existing CMDB access.
6. A user from Tenant A cannot list or access Tenant B's configuration items.
7. A user from Tenant A cannot update a Tenant B CI by substituting its ID (404 Not Found).
8. A user cannot associate a CI with a service from another tenant (404 Not Found on POST and PATCH).
9. Import dry-run and commit both independently enforce authorization and tenant isolation.
10. Unauthorized users cannot bypass restrictions by changing request payloads or query parameters.
11. CMDB_ADMIN cannot access user, role, team, settings, or SLA administration endpoints.
12. Existing role permissions and SERVICE_LEAD compatibility remain unchanged.
13. Successful CMDB mutations (create, update, bulk import) generate authoritative audit events in audit_log_metadata.
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
    CMDB_AUDIT_ACTION_CI_CREATED,
    CMDB_AUDIT_ACTION_CI_UPDATED,
    CMDB_AUDIT_ACTION_BULK_IMPORT,
    ITSMUserAccessUpdateRequest,
    ITSMEmployeeInviteRequest,
    ITSMEmployeeCreateManualRequest,
)
from main import app


class CMDBAdminBackendSecurityTestCase(unittest.TestCase):
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

        # CMDB Admin (with active ITSM access)
        cls.cmdb_admin_user_id = uuid4()
        cls.cmdb_admin_email = f"cmdb-admin-{uuid4().hex[:8]}@example.com"
        cls.cmdb_admin_key = f"cmdb-admin-key-{uuid4().hex[:12]}"

        # CMDB Admin (WITHOUT ITSM access)
        cls.cmdb_admin_no_access_id = uuid4()
        cls.cmdb_admin_no_access_key = f"cmdb-no-access-{uuid4().hex[:12]}"

        # Platform Administrator
        cls.platform_admin_id = uuid4()
        cls.platform_admin_email = f"platform-admin-{uuid4().hex[:8]}@example.com"
        cls.platform_admin_key = f"p-admin-key-{uuid4().hex[:12]}"

        # Requester
        cls.requester_id = uuid4()
        cls.requester_key = f"req-key-{uuid4().hex[:12]}"

        # Service Agent
        cls.agent_id = uuid4()
        cls.agent_key = f"agent-key-{uuid4().hex[:12]}"

        # Catalog Manager
        cls.cat_mgr_id = uuid4()
        cls.cat_mgr_key = f"cat-mgr-key-{uuid4().hex[:12]}"

        # Tenant B (for multi-tenant isolation tests)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_ci_id = uuid4()
        cls.tenant_b_service_id = uuid4()

        # Service in Tenant A
        cls.service_a_id = uuid4()

        # Configuration Item in Tenant A
        cls.ci_a_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-cmdb-a-{uuid4().hex[:8]}"},
            )

            # 2. CMDB Admin in Tenant A (has_itsm_access = true)
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.cmdb_admin_user_id, "tenant_id": cls.tenant_id, "email": cls.cmdb_admin_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CMDB_ADMIN', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'cmdb-admin-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.cmdb_admin_key), "created_by": cls.cmdb_admin_user_id},
            )

            # 3. CMDB Admin WITHOUT ITSM access
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.cmdb_admin_no_access_id, "tenant_id": cls.tenant_id, "email": f"cmdb-denied-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CMDB_ADMIN', false, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_no_access_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'cmdb-denied-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.cmdb_admin_no_access_key), "created_by": cls.cmdb_admin_no_access_id},
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

            # 5. Requester in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'member', 'NONE', true, now(), now())"
                ),
                {"id": cls.requester_id, "tenant_id": cls.tenant_id, "email": f"requester-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'requester-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.requester_key), "created_by": cls.requester_id},
            )

            # 6. Service Agent in Tenant A
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

            # 7. Catalog Manager in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.cat_mgr_id, "tenant_id": cls.tenant_id, "email": f"catmgr-{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CATALOG_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.cat_mgr_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'cat-mgr-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.cat_mgr_key), "created_by": cls.cat_mgr_id},
            )

            # 8. Service in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Core Billing Service', 'core-billing', 'Primary payment processing engine', 'tier1', 'OPERATIONAL', 'Finance Ops', now(), now())"
                ),
                {"id": cls.service_a_id, "tenant_id": cls.tenant_id},
            )

            # 9. Existing CI in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, external_resource_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'srv-billing-prod-01', 'SERVER', 'PRODUCTION', 'ACTIVE', 'i-0123456789abcdef0', now(), now())"
                ),
                {"id": cls.ci_a_id, "tenant_id": cls.tenant_id, "service_id": cls.service_a_id},
            )

            # 10. Tenant B (isolation target)
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-cmdb-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Secret Service', 'tenant-b-secret', 'Confidential isolated service', 'tier1', 'OPERATIONAL', 'Secret Ops', now(), now())"
                ),
                {"id": cls.tenant_b_service_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, external_resource_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'tenant-b-classified-db', 'DATABASE', 'PRODUCTION', 'ACTIVE', 'arn:aws:rds:classified', now(), now())"
                ),
                {"id": cls.tenant_b_ci_id, "tenant_id": cls.tenant_b_id, "service_id": cls.tenant_b_service_id},
            )

    @classmethod
    def tearDownClass(cls):
        with cls.migrator_engine.begin() as conn:
            conn.execute(text("DELETE FROM public.itsm_configuration_items WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            try:
                conn.execute(text("DELETE FROM public.tenants WHERE id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            except Exception:
                pass

    # --- Test 1: Role Definition, Pydantic Validation & SERVICE_LEAD Compatibility ---
    def test_01_role_validation_and_service_lead_compatibility(self):
        """Verify CMDB_ADMIN is in VALID_ITSM_ROLES and SERVICE_LEAD backward-compatibility is preserved."""
        self.assertIn("CMDB_ADMIN", VALID_ITSM_ROLES)
        self.assertIn("SERVICE_LEAD", VALID_ITSM_ROLES)

        # 1. Update Request normalizes SERVICE_LEAD to INCIDENT_MANAGER
        req_lead = ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role="service_lead")
        self.assertEqual(req_lead.itsm_role, "INCIDENT_MANAGER")

        # 2. Update Request accepts CMDB_ADMIN
        req_cmdb = ITSMUserAccessUpdateRequest(has_itsm_access=True, itsm_role="cmdb_admin")
        self.assertEqual(req_cmdb.itsm_role, "CMDB_ADMIN")

        # 3. Invite Request normalizes SERVICE_LEAD and accepts CMDB_ADMIN
        invite_lead = ITSMEmployeeInviteRequest(email="lead@example.com", itsm_role="SERVICE_LEAD")
        self.assertEqual(invite_lead.itsm_role, "INCIDENT_MANAGER")
        invite_cmdb = ITSMEmployeeInviteRequest(email="cmdb@example.com", itsm_role="CMDB_ADMIN")
        self.assertEqual(invite_cmdb.itsm_role, "CMDB_ADMIN")

        # 4. Manual Create Request normalizes SERVICE_LEAD and accepts CMDB_ADMIN
        create_lead = ITSMEmployeeCreateManualRequest(
            email="lead2@example.com", itsm_role="SERVICE_LEAD", password="Password123!", confirm_password="Password123!"
        )
        self.assertEqual(create_lead.itsm_role, "INCIDENT_MANAGER")
        create_cmdb = ITSMEmployeeCreateManualRequest(
            email="cmdb2@example.com", itsm_role="CMDB_ADMIN", password="Password123!", confirm_password="Password123!"
        )
        self.assertEqual(create_cmdb.itsm_role, "CMDB_ADMIN")

    # --- Test 2: Unauthenticated Requests are Rejected (401) ---
    def test_02_unauthenticated_requests_rejected(self):
        """Unauthenticated requests without Authorization header return 401 Unauthorized."""
        res_list = self.client.get("/v1/itsm/admin/configuration-items")
        self.assertEqual(res_list.status_code, 401)

        res_create = self.client.post("/v1/itsm/admin/configuration-items", json={"name": "test", "ci_type": "SERVER"})
        self.assertEqual(res_create.status_code, 401)

        res_update = self.client.patch(f"/v1/itsm/admin/configuration-items/{self.ci_a_id}", json={"status": "ACTIVE"})
        self.assertEqual(res_update.status_code, 401)

        res_dry = self.client.post("/v1/itsm/admin/configuration-items/import/dry-run", json={"source_filename": "a.csv", "source_type": "csv", "raw_records": []})
        self.assertEqual(res_dry.status_code, 401)

        res_commit = self.client.post("/v1/itsm/admin/configuration-items/import/commit", json={"source_filename": "a.csv", "source_type": "csv", "raw_records": []})
        self.assertEqual(res_commit.status_code, 401)

    # --- Test 3: Authenticated User without ITSM Access is Rejected (403) ---
    def test_03_authenticated_user_without_itsm_access_rejected(self):
        """Authenticated principal with has_itsm_access=False is rejected with 403 Forbidden."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_no_access_key}"}
        res = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res.status_code, 403)
        self.assertIn("ITSM access denied", res.text)

    # --- Test 4: REQUESTER Role Cannot Manage CIs (403) ---
    def test_04_requester_role_denied_cmdb_access(self):
        """A user with REQUESTER role is denied on all CMDB management endpoints."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}

        res_get = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res_get.status_code, 403)

        res_post = self.client.post(
            "/v1/itsm/admin/configuration-items",
            json={"name": "rogue-server", "ci_type": "SERVER"},
            headers=headers,
        )
        self.assertEqual(res_post.status_code, 403)

        res_patch = self.client.patch(
            f"/v1/itsm/admin/configuration-items/{self.ci_a_id}",
            json={"status": "MAINTENANCE"},
            headers=headers,
        )
        self.assertEqual(res_patch.status_code, 403)

        res_dry = self.client.post(
            "/v1/itsm/admin/configuration-items/import/dry-run",
            json={"source_filename": "f.csv", "source_type": "csv", "raw_records": []},
            headers=headers,
        )
        self.assertEqual(res_dry.status_code, 403)

    # --- Test 5: Role Assignment API can assign and persist CMDB_ADMIN ---
    def test_05_platform_admin_can_assign_cmdb_admin_role(self):
        """Platform Administrator can assign CMDB_ADMIN role via user access update endpoint."""
        admin_headers = {"Authorization": f"Bearer {self.platform_admin_key}"}
        payload = {
            "has_itsm_access": True,
            "itsm_role": "CMDB_ADMIN",
            "has_governance_access": True,
        }
        res = self.client.post(
            f"/v1/itsm/admin/users/{self.agent_id}/access",
            json=payload,
            headers=admin_headers,
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["itsm_role"], "CMDB_ADMIN")

        # Reset back to SERVICE_AGENT
        payload["itsm_role"] = "SERVICE_AGENT"
        res_reset = self.client.post(
            f"/v1/itsm/admin/users/{self.agent_id}/access",
            json=payload,
            headers=admin_headers,
        )
        self.assertEqual(res_reset.status_code, 200)

    # --- Test 6: CMDB_ADMIN can list CIs within its tenant ---
    def test_06_cmdb_admin_can_list_configuration_items(self):
        """CMDB_ADMIN can read tenant Configuration Items (GET /configuration-items)."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertTrue(any(ci["id"] == str(self.ci_a_id) for ci in items))

    # --- Test 7: CMDB_ADMIN can create CI and generates Audit Event ---
    def test_07_cmdb_admin_can_create_ci_with_audit_event(self):
        """CMDB_ADMIN can create a CI and verify an immutable audit event is recorded in audit_log_metadata."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        payload = {
            "name": f"db-cluster-{uuid4().hex[:6]}",
            "ci_type": "DATABASE",
            "environment": "PRODUCTION",
            "status": "ACTIVE",
            "service_id": str(self.service_a_id),
            "external_resource_id": f"arn:aws:rds:cluster-{uuid4().hex[:6]}",
        }
        res = self.client.post("/v1/itsm/admin/configuration-items", json=payload, headers=headers)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        ci_id = UUID(data["id"])
        self.assertEqual(data["name"], payload["name"])

        # Verify audit event in PostgreSQL audit_log_metadata
        with self.migrator_engine.connect() as conn:
            audit_row = conn.execute(
                text(
                    "SELECT action, actor_id, request_id, tenant_id, reason "
                    "FROM public.audit_log_metadata "
                    "WHERE tenant_id = :tid AND action = :act AND request_id = :rid"
                ),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_CI_CREATED, "rid": str(ci_id)},
            ).first()
            self.assertIsNotNone(audit_row, "Authoritative audit event must exist in audit_log_metadata")
            self.assertEqual(audit_row.action, "itsm.cmdb.ci_created")
            self.assertEqual(audit_row.actor_id, self.cmdb_admin_user_id)
            self.assertEqual(audit_row.tenant_id, self.tenant_id)
            self.assertEqual(audit_row.request_id, str(ci_id))

    # --- Test 8: CMDB_ADMIN can update CI and generates Audit Event ---
    def test_08_cmdb_admin_can_update_ci_with_audit_event(self):
        """CMDB_ADMIN can update a CI and verify an immutable audit event is recorded."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        payload = {
            "status": "MAINTENANCE",
            "environment": "STAGING",
        }
        res = self.client.patch(f"/v1/itsm/admin/configuration-items/{self.ci_a_id}", json=payload, headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "MAINTENANCE")

        # Verify audit event in PostgreSQL audit_log_metadata
        with self.migrator_engine.connect() as conn:
            audit_row = conn.execute(
                text(
                    "SELECT action, actor_id, request_id, tenant_id "
                    "FROM public.audit_log_metadata "
                    "WHERE tenant_id = :tid AND action = :act AND request_id = :rid "
                    "ORDER BY created_at DESC"
                ),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_CI_UPDATED, "rid": str(self.ci_a_id)},
            ).first()
            self.assertIsNotNone(audit_row, "Update audit event must exist in audit_log_metadata")
            self.assertEqual(audit_row.action, "itsm.cmdb.ci_updated")
            self.assertEqual(audit_row.actor_id, self.cmdb_admin_user_id)
            self.assertEqual(audit_row.tenant_id, self.tenant_id)

    # --- Test 9: CMDB_ADMIN can run Bulk Import Dry-Run & Commit with Audit ---
    def test_09_cmdb_admin_bulk_import_with_audit_event(self):
        """CMDB_ADMIN can run import dry-run and commit, recording itsm.cmdb.bulk_import audit event."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        dry_payload = {
            "source_filename": "inventory_batch_01.csv",
            "source_type": "csv",
            "raw_records": [
                {
                    "Hostname": "k8s-ingress-prod-01",
                    "Kind": "LOAD_BALANCER",
                    "Env": "PRODUCTION",
                    "State": "ACTIVE",
                }
            ],
            "field_mapping": {
                "Hostname": "name",
                "Kind": "ci_type",
                "Env": "environment",
                "State": "status",
            },
        }
        res_dry = self.client.post("/v1/itsm/admin/configuration-items/import/dry-run", json=dry_payload, headers=headers)
        self.assertEqual(res_dry.status_code, 200)
        dry_data = res_dry.json()
        self.assertEqual(dry_data["total_records"], 1)
        self.assertEqual(dry_data["valid_records"], 1)

        commit_payload = {
            "source_filename": "inventory_batch_01.csv",
            "source_type": "csv",
            "raw_records": dry_payload["raw_records"],
            "field_mapping": dry_payload["field_mapping"],
        }
        res_commit = self.client.post("/v1/itsm/admin/configuration-items/import/commit", json=commit_payload, headers=headers)
        self.assertEqual(res_commit.status_code, 200)
        commit_data = res_commit.json()
        self.assertEqual(commit_data["total_records"], 1)
        self.assertGreaterEqual(commit_data["inserted_count"], 1)

        # Verify bulk import audit event in PostgreSQL audit_log_metadata
        with self.migrator_engine.connect() as conn:
            audit_row = conn.execute(
                text(
                    "SELECT action, actor_id, tenant_id "
                    "FROM public.audit_log_metadata "
                    "WHERE tenant_id = :tid AND action = :act "
                    "ORDER BY created_at DESC"
                ),
                {"tid": self.tenant_id, "act": CMDB_AUDIT_ACTION_BULK_IMPORT},
            ).first()
            self.assertIsNotNone(audit_row, "Bulk import audit event must exist in audit_log_metadata")
            self.assertEqual(audit_row.action, "itsm.cmdb.bulk_import")
            self.assertEqual(audit_row.actor_id, self.cmdb_admin_user_id)
            self.assertEqual(audit_row.tenant_id, self.tenant_id)

    # --- Test 10: CMDB_ADMIN can read tenant services for CI association ---
    def test_10_cmdb_admin_can_read_services(self):
        """CMDB_ADMIN can read tenant services (GET /services) for association."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        res = self.client.get("/v1/itsm/admin/services", headers=headers)
        self.assertEqual(res.status_code, 200)
        services = res.json()
        self.assertTrue(any(s["id"] == str(self.service_a_id) for s in services))

    # --- Test 11: Cross-Tenant CI Isolation (Cannot list or update Tenant B's CI) ---
    def test_11_cross_tenant_ci_isolation(self):
        """Tenant A cannot see or mutate Tenant B Configuration Items."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. Listing CIs does not leak Tenant B CIs
        res_list = self.client.get("/v1/itsm/admin/configuration-items", headers=headers)
        self.assertEqual(res_list.status_code, 200)
        items = res_list.json()
        self.assertFalse(any(ci["id"] == str(self.tenant_b_ci_id) for ci in items))

        # 2. Updating Tenant B CI by ID returns 404
        res_patch = self.client.patch(
            f"/v1/itsm/admin/configuration-items/{self.tenant_b_ci_id}",
            json={"status": "RETIRED"},
            headers=headers,
        )
        self.assertEqual(res_patch.status_code, 404)
        self.assertIn("Configuration Item not found in this tenant", res_patch.text)

    # --- Test 12: Cross-Tenant Service Association Rejected (POST and PATCH) ---
    def test_12_cross_tenant_service_association_rejected(self):
        """Associating a CI with a service from another tenant is strictly rejected (404)."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. POST with Tenant B's service_id -> 404
        post_payload = {
            "name": "isolated-app-server",
            "ci_type": "SERVER",
            "service_id": str(self.tenant_b_service_id),
        }
        res_post = self.client.post("/v1/itsm/admin/configuration-items", json=post_payload, headers=headers)
        self.assertEqual(res_post.status_code, 404)
        self.assertIn("Associated service not found in this tenant", res_post.text)

        # 2. PATCH with Tenant B's service_id -> 404
        patch_payload = {
            "service_id": str(self.tenant_b_service_id),
        }
        res_patch = self.client.patch(f"/v1/itsm/admin/configuration-items/{self.ci_a_id}", json=patch_payload, headers=headers)
        self.assertEqual(res_patch.status_code, 404)
        self.assertIn("Associated service not found in this tenant", res_patch.text)

    # --- Test 13: Import Dry-Run Rejects Cross-Tenant Service Reference ---
    def test_13_import_cross_tenant_service_rejected(self):
        """Bulk import referencing another tenant's service name is caught as an error."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}
        dry_payload = {
            "source_filename": "cross_tenant_probe.csv",
            "source_type": "csv",
            "raw_records": [
                {
                    "name": "foreign-ci",
                    "ci_type": "SERVER",
                    "service_name": "Tenant B Secret Service",  # Belongs to Tenant B!
                }
            ],
            "field_mapping": {
                "name": "name",
                "ci_type": "ci_type",
                "service_name": "service_name",
            },
        }
        res_dry = self.client.post("/v1/itsm/admin/configuration-items/import/dry-run", json=dry_payload, headers=headers)
        self.assertEqual(res_dry.status_code, 200)
        data = res_dry.json()
        self.assertEqual(data["valid_records"], 0)
        self.assertEqual(data["error_count"], 1)
        self.assertTrue(any("not found in this tenant" in err for err in data["rows"][0]["errors"]))

    # --- Test 14: PLATFORM_ADMINISTRATOR Retains Full CMDB Access ---
    def test_14_platform_administrator_retains_access(self):
        """PLATFORM_ADMINISTRATOR retains full access to CMDB endpoints."""
        admin_headers = {"Authorization": f"Bearer {self.platform_admin_key}"}
        res = self.client.get("/v1/itsm/admin/configuration-items", headers=admin_headers)
        self.assertEqual(res.status_code, 200)

    # --- Test 15: CMDB_ADMIN Denied Access to Unrelated Admin Endpoints ---
    def test_15_cmdb_admin_denied_unrelated_administration(self):
        """CMDB_ADMIN cannot access users, teams, settings, SLA policies, or service mutations."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # 1. User management
        res_users = self.client.get("/v1/itsm/admin/users", headers=headers)
        self.assertEqual(res_users.status_code, 403)
        self.assertIn("Platform Administrator access required", res_users.text)

        # 2. Team creation
        res_team = self.client.post("/v1/itsm/admin/teams", json={"name": "SecOps"}, headers=headers)
        self.assertEqual(res_team.status_code, 403)
        self.assertIn("Platform Administrator access required", res_team.text)

        # 3. Settings & SLA
        res_set = self.client.get("/v1/itsm/admin/settings", headers=headers)
        self.assertEqual(res_set.status_code, 403)

        res_sla = self.client.get("/v1/itsm/admin/sla-policies", headers=headers)
        self.assertEqual(res_sla.status_code, 403)

        # 4. Service mutations (CMDB_ADMIN cannot create or edit services)
        res_svc_post = self.client.post("/v1/itsm/admin/services", json={"name": "BadSvc", "tier": "TIER1", "status": "OPERATIONAL"}, headers=headers)
        self.assertEqual(res_svc_post.status_code, 403)

        res_svc_patch = self.client.patch(f"/v1/itsm/admin/services/{self.service_a_id}", json={"status": "DEGRADED"}, headers=headers)
        self.assertEqual(res_svc_patch.status_code, 403)

    # --- Test 16: Payload / Query Tampering Cannot Bypass Tenant Isolation ---
    def test_16_payload_tampering_cannot_bypass_tenant_isolation(self):
        """Passing fake tenant_id in query parameter or JSON body is ignored by trusted auth context."""
        headers = {"Authorization": f"Bearer {self.cmdb_admin_key}"}

        # Query param tampering
        res = self.client.get(f"/v1/itsm/admin/configuration-items?tenant_id={self.tenant_b_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        # Still only shows Tenant A CIs
        self.assertFalse(any(ci["id"] == str(self.tenant_b_ci_id) for ci in items))

        # Body tampering: inject tenant_id into create payload
        tampered_payload = {
            "name": f"tampered-ci-{uuid4().hex[:6]}",
            "ci_type": "SERVER",
            "tenant_id": str(self.tenant_b_id),
        }
        res_create = self.client.post("/v1/itsm/admin/configuration-items", json=tampered_payload, headers=headers)
        self.assertEqual(res_create.status_code, 201)
        created_id = UUID(res_create.json()["id"])

        # Verify created CI was assigned to Tenant A, NOT Tenant B
        with self.migrator_engine.connect() as conn:
            row = conn.execute(
                text("SELECT tenant_id FROM public.itsm_configuration_items WHERE id = :id"),
                {"id": created_id},
            ).first()
            self.assertEqual(row.tenant_id, self.tenant_id)

    # --- Test 17: Other Roles Denied CMDB Access ---
    def test_17_other_roles_denied_cmdb_endpoints(self):
        """SERVICE_AGENT and CATALOG_MANAGER are denied on CMDB management endpoints."""
        agent_headers = {"Authorization": f"Bearer {self.agent_key}"}
        res_agent = self.client.get("/v1/itsm/admin/configuration-items", headers=agent_headers)
        self.assertEqual(res_agent.status_code, 403)
        self.assertIn("CMDB Admin or Platform Administrator access required", res_agent.text)

        cat_headers = {"Authorization": f"Bearer {self.cat_mgr_key}"}
        res_cat = self.client.get("/v1/itsm/admin/configuration-items", headers=cat_headers)
        self.assertEqual(res_cat.status_code, 403)
        self.assertIn("CMDB Admin or Platform Administrator access required", res_cat.text)


if __name__ == "__main__":
    unittest.main()
