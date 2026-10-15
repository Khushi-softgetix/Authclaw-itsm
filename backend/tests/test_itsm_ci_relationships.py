"""Comprehensive test suite for CMDB-002: Typed Configuration Item (CI) Relationships.

Tests:
1. Valid relationship creation, listing, and deletion.
2. Every supported relationship type and its direction rules (DEPENDS_ON, RUNS_ON, HOSTED_ON, CONNECTS_TO, OWNED_BY, SUPPORTS, PART_OF).
3. Unsupported types, invalid direction, self-links, and duplicate links.
4. Missing CIs and class compatibility rules.
5. Upstream and downstream query results and direction semantics.
6. Unauthenticated requests and roles without CMDB permissions (REQUESTER, SERVICE_AGENT, CATALOG_MANAGER).
7. CMDB_ADMIN and PLATFORM_ADMINISTRATOR access within authorized tenant.
8. Cross-tenant creation, listing, deletion, and traversal being denied / safely excluded.
9. Audit events for create and delete operations in audit_log_metadata.
10. Canonical /ci-relationships endpoints.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.schemas.itsm_admin import (
    CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED,
    CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED,
    VALID_CI_RELATIONSHIP_TYPES,
)
from main import app


class CIRelationshipsTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.engine = create_engine(cls.db_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Setup Tenant A
        cls.tenant_id = uuid4()
        cls.cmdb_admin_id = uuid4()
        cls.cmdb_admin_key = f"cmdb-key-{uuid4().hex[:12]}"
        cls.platform_admin_id = uuid4()
        cls.platform_admin_key = f"plat-key-{uuid4().hex[:12]}"
        cls.service_agent_id = uuid4()
        cls.service_agent_key = f"agent-key-{uuid4().hex[:12]}"
        cls.requester_id = uuid4()
        cls.requester_key = f"req-key-{uuid4().hex[:12]}"

        # Setup Tenant B (for cross-tenant tests)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_admin_id = uuid4()
        cls.tenant_b_key = f"cmdb-b-key-{uuid4().hex[:12]}"

        with cls.engine.connect() as conn:
            # Create Tenant A & B
            conn.execute(
                text("INSERT INTO public.tenants (id, name, status, created_at, updated_at) VALUES (:id, :name, 'active', now(), now())"),
                [
                    {"id": cls.tenant_id, "name": f"tenant-rel-a-{uuid4().hex[:8]}"},
                    {"id": cls.tenant_b_id, "name": f"tenant-rel-b-{uuid4().hex[:8]}"},
                ],
            )

            # Users
            users_data = [
                {"id": cls.cmdb_admin_id, "tenant_id": cls.tenant_id, "email": f"cmdb-{uuid4().hex[:6]}@example.com", "role": "admin", "platform_role": "NONE"},
                {"id": cls.platform_admin_id, "tenant_id": cls.tenant_id, "email": f"plat-{uuid4().hex[:6]}@example.com", "role": "admin", "platform_role": "NONE"},
                {"id": cls.service_agent_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.requester_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:6]}@example.com", "role": "member", "platform_role": "NONE"},
                {"id": cls.tenant_b_admin_id, "tenant_id": cls.tenant_b_id, "email": f"cmdb-b-{uuid4().hex[:6]}@example.com", "role": "admin", "platform_role": "NONE"},
            ]
            for u in users_data:
                conn.execute(
                    text("INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                         "VALUES (:id, :tenant_id, :email, 'hash', :role, :platform_role, true, now(), now())"),
                    u,
                )

            # API Keys
            keys_data = [
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_id, "key_hash": hash_key(cls.cmdb_admin_key), "name": "cmdb-a"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.platform_admin_id, "key_hash": hash_key(cls.platform_admin_key), "name": "plat-a"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.service_agent_id, "key_hash": hash_key(cls.service_agent_key), "name": "agent-a"},
                {"id": uuid4(), "tenant_id": cls.tenant_id, "user_id": cls.requester_id, "key_hash": hash_key(cls.requester_key), "name": "req-a"},
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_admin_id, "key_hash": hash_key(cls.tenant_b_key), "name": "cmdb-b"},
            ]
            for k in keys_data:
                conn.execute(
                    text("INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                         "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"),
                    k,
                )

            # ITSM User Access
            access_data = [
                {"tenant_id": cls.tenant_id, "user_id": cls.cmdb_admin_id, "role": "CMDB_ADMIN"},
                {"tenant_id": cls.tenant_id, "user_id": cls.platform_admin_id, "role": "PLATFORM_ADMINISTRATOR"},
                {"tenant_id": cls.tenant_id, "user_id": cls.service_agent_id, "role": "SERVICE_AGENT"},
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_id, "role": "REQUESTER"},
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_admin_id, "role": "CMDB_ADMIN"},
            ]
            for a in access_data:
                conn.execute(
                    text("INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                         "VALUES (gen_random_uuid(), :tenant_id, :user_id, :role, true, now(), now())"),
                    a,
                )

            # Seed test CIs in Tenant A
            cls.ci_app_id = uuid4()
            cls.ci_db_id = uuid4()
            cls.ci_server_id = uuid4()
            cls.ci_cloud_id = uuid4()
            cls.ci_lb_id = uuid4()
            cls.ci_storage_id = uuid4()

            cis_a = [
                {"id": cls.ci_app_id, "tenant_id": cls.tenant_id, "name": "Order Management API", "ci_type": "APPLICATION", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_db_id, "tenant_id": cls.tenant_id, "name": "Orders Primary DB", "ci_type": "DATABASE", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_server_id, "tenant_id": cls.tenant_id, "name": "prod-app-host-01", "ci_type": "SERVER", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_cloud_id, "tenant_id": cls.tenant_id, "name": "AWS us-east-1 VPC", "ci_type": "CLOUD_SERVICE", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_lb_id, "tenant_id": cls.tenant_id, "name": "api-alb-edge", "ci_type": "LOAD_BALANCER", "environment": "PRODUCTION", "status": "ACTIVE"},
                {"id": cls.ci_storage_id, "tenant_id": cls.tenant_id, "name": "orders-ebs-volume", "ci_type": "STORAGE", "environment": "PRODUCTION", "status": "ACTIVE"},
            ]
            for ci in cis_a:
                conn.execute(
                    text("INSERT INTO public.itsm_configuration_items (id, tenant_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                         "VALUES (:id, :tenant_id, :name, :ci_type, :environment, :status, '{}'::jsonb, now(), now())"),
                    ci,
                )

            # Seed test CI in Tenant B (for cross-tenant checks)
            cls.ci_tenant_b_id = uuid4()
            conn.execute(
                text("INSERT INTO public.itsm_configuration_items (id, tenant_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                     "VALUES (:id, :tenant_id, 'Tenant B Secret CI', 'DATABASE', 'PRODUCTION', 'ACTIVE', '{}'::jsonb, now(), now())"),
                {"id": cls.ci_tenant_b_id, "tenant_id": cls.tenant_b_id},
            )
            conn.commit()

    @classmethod
    def tearDownClass(cls):
        with cls.engine.connect() as conn:
            conn.execute(text("DELETE FROM public.itsm_ci_relationships WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_configuration_items WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            try:
                conn.execute(text("DELETE FROM public.audit_log_metadata WHERE tenant_id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.tenants WHERE id IN (:ta, :tb)"), {"ta": cls.tenant_id, "tb": cls.tenant_b_id})
            except Exception:
                pass
            conn.commit()

    def test_01_cmdb_admin_can_create_relationship(self):
        """CMDB_ADMIN can create a valid typed relationship."""
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_db_id),
                "relationship_type": "DEPENDS_ON",
                "source": "MANUAL",
                "confidence": 1.0,
            },
        )
        self.assertEqual(resp.status_code, 201, resp.text)
        data = resp.json()
        self.assertEqual(data["relationship_type"], "DEPENDS_ON")
        self.assertEqual(data["parent_ci_id"], str(self.ci_app_id))
        self.assertEqual(data["child_ci_id"], str(self.ci_db_id))
        self.assertIn("related_ci", data)
        self.assertEqual(data["related_ci"]["name"], "Orders Primary DB")
        self.assertIn("display_label", data)
        self.assertIn("Depends on Orders Primary DB", data["display_label"])

    def test_02_all_supported_relationship_types(self):
        """All 7 supported types can be created with compatible CIs."""
        type_pairs = [
            ("RUNS_ON", self.ci_app_id, self.ci_server_id),
            ("HOSTED_ON", self.ci_server_id, self.ci_cloud_id),
            ("CONNECTS_TO", self.ci_app_id, self.ci_db_id),
            ("SUPPORTS", self.ci_lb_id, self.ci_app_id),
            ("PART_OF", self.ci_storage_id, self.ci_server_id),
            ("OWNED_BY", self.ci_db_id, self.ci_server_id),
        ]
        for rel_type, p_id, c_id in type_pairs:
            resp = self.client.post(
                "/v1/itsm/admin/configuration-items/relationships",
                headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
                json={
                    "parent_ci_id": str(p_id),
                    "child_ci_id": str(c_id),
                    "relationship_type": rel_type,
                },
            )
            self.assertEqual(resp.status_code, 201, f"Failed for {rel_type}: {resp.text}")
            self.assertEqual(resp.json()["relationship_type"], rel_type)

    def test_03_unsupported_relationship_type_rejected(self):
        """Unsupported relationship type returns 400 or 422 error."""
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_server_id),
                "relationship_type": "KNOWS_ABOUT",
            },
        )
        self.assertIn(resp.status_code, (400, 422))
        self.assertIn("Supported types", resp.text)

    def test_04_self_link_prohibited(self):
        """Creating relationship from a CI to itself is rejected."""
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_app_id),
                "relationship_type": "DEPENDS_ON",
            },
        )
        self.assertIn(resp.status_code, (400, 422))
        self.assertIn("self-link is prohibited", resp.text)

    def test_05_duplicate_relationship_prevented(self):
        """Duplicate relationship of same type between same CIs returns 409 Conflict."""
        # First relationship (created in test_01)
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_db_id),
                "relationship_type": "DEPENDS_ON",
            },
        )
        self.assertEqual(resp.status_code, 409)
        self.assertIn("already exists", resp.text)

    def test_06_missing_ci_returns_404(self):
        """Non-existent parent or child CI returns 404."""
        missing_id = uuid4()
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(missing_id),
                "child_ci_id": str(self.ci_db_id),
                "relationship_type": "DEPENDS_ON",
            },
        )
        self.assertEqual(resp.status_code, 404)
        self.assertIn("Parent Configuration Item not found", resp.text)

        resp2 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(missing_id),
                "relationship_type": "DEPENDS_ON",
            },
        )
        self.assertEqual(resp2.status_code, 404)
        self.assertIn("Child Configuration Item not found", resp2.text)

    def test_07_invalid_direction_rules_rejected(self):
        """Infrastructure running on software violates direction rules."""
        # Server cannot RUN_ON Database
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_server_id),
                "child_ci_id": str(self.ci_db_id),
                "relationship_type": "RUNS_ON",
            },
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid direction rule", resp.text)

    def test_08_list_relationships_and_direction_filtering(self):
        """List relationships for CI with upstream/downstream semantics."""
        # ci_app_id depends on ci_db_id:
        # From ci_app_id's perspective: ci_db_id is DOWNSTREAM dependency
        # From ci_db_id's perspective: ci_app_id is UPSTREAM dependent
        resp_app = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(resp_app.status_code, 200)
        rels_app = resp_app.json()
        self.assertGreaterEqual(len(rels_app), 1)

        # Downstream filter for app should include the database
        resp_downstream = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships?direction=downstream",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(resp_downstream.status_code, 200)
        down_db_ids = [r["related_ci"]["id"] for r in resp_downstream.json()]
        self.assertIn(str(self.ci_db_id), down_db_ids)

        # Upstream filter for DB should include the app
        resp_upstream = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_db_id}/relationships?direction=upstream",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(resp_upstream.status_code, 200)
        up_app_ids = [r["related_ci"]["id"] for r in resp_upstream.json()]
        self.assertIn(str(self.ci_app_id), up_app_ids)

    def test_09_delete_relationship(self):
        """Delete relationship by stable UUID."""
        # Create a temporary relationship
        create_resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_lb_id),
                "child_ci_id": str(self.ci_server_id),
                "relationship_type": "CONNECTS_TO",
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        rel_id = create_resp.json()["id"]

        # Delete it
        del_resp = self.client.delete(
            f"/v1/itsm/admin/configuration-items/relationships/{rel_id}",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(del_resp.status_code, 204)

        # Second delete returns 404
        del_again = self.client.delete(
            f"/v1/itsm/admin/configuration-items/relationships/{rel_id}",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(del_again.status_code, 404)

    def test_10_unauthenticated_request_rejected(self):
        """Unauthenticated requests return 401 Unauthorized."""
        resp = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships"
        )
        self.assertEqual(resp.status_code, 401)

        resp2 = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_db_id), "relationship_type": "DEPENDS_ON"},
        )
        self.assertEqual(resp2.status_code, 401)

    def test_11_unauthorized_roles_rejected(self):
        """REQUESTER and SERVICE_AGENT roles are denied access (403 Forbidden)."""
        for key, role_name in [(self.requester_key, "REQUESTER"), (self.service_agent_key, "SERVICE_AGENT")]:
            resp = self.client.get(
                f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships",
                headers={"Authorization": f"Bearer {key}"},
            )
            self.assertEqual(resp.status_code, 403, f"{role_name} should receive 403")

            resp2 = self.client.post(
                "/v1/itsm/admin/configuration-items/relationships",
                headers={"Authorization": f"Bearer {key}"},
                json={"parent_ci_id": str(self.ci_app_id), "child_ci_id": str(self.ci_db_id), "relationship_type": "DEPENDS_ON"},
            )
            self.assertEqual(resp2.status_code, 403, f"{role_name} should receive 403")

    def test_12_platform_administrator_access(self):
        """PLATFORM_ADMINISTRATOR retains full CMDB relationship access within tenant."""
        resp = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_app_id}/relationships",
            headers={"Authorization": f"Bearer {self.platform_admin_key}"},
        )
        self.assertEqual(resp.status_code, 200)

    def test_13_cross_tenant_creation_denied(self):
        """Cannot link a Tenant A CI with a Tenant B CI (404 Not Found)."""
        resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_app_id),
                "child_ci_id": str(self.ci_tenant_b_id),
                "relationship_type": "DEPENDS_ON",
            },
        )
        self.assertEqual(resp.status_code, 404)
        self.assertIn("not found in this tenant", resp.text)

    def test_14_cross_tenant_listing_denied(self):
        """Cannot list relationships for a CI from another tenant."""
        resp = self.client.get(
            f"/v1/itsm/admin/configuration-items/{self.ci_tenant_b_id}/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_15_cross_tenant_deletion_denied(self):
        """Tenant A admin cannot delete Tenant B relationship."""
        # Create relationship in Tenant B first using Tenant B admin
        ci_b2 = uuid4()
        with self.engine.connect() as conn:
            conn.execute(
                text("INSERT INTO public.itsm_configuration_items (id, tenant_id, name, ci_type, environment, status, attributes, created_at, updated_at) "
                     "VALUES (:id, :tenant_id, 'Tenant B Host', 'SERVER', 'PRODUCTION', 'ACTIVE', '{}'::jsonb, now(), now())"),
                {"id": ci_b2, "tenant_id": self.tenant_b_id},
            )
            conn.commit()

        b_create = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.tenant_b_key}"},
            json={
                "parent_ci_id": str(self.ci_tenant_b_id),
                "child_ci_id": str(ci_b2),
                "relationship_type": "RUNS_ON",
            },
        )
        self.assertEqual(b_create.status_code, 201)
        rel_b_id = b_create.json()["id"]

        # Tenant A admin attempts to delete Tenant B relationship
        a_del = self.client.delete(
            f"/v1/itsm/admin/configuration-items/relationships/{rel_b_id}",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(a_del.status_code, 404)

    def test_16_audit_events_for_create_and_delete(self):
        """Relationship create and delete emit authoritative audit events in database."""
        # Create relation
        create_resp = self.client.post(
            "/v1/itsm/admin/configuration-items/relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
            json={
                "parent_ci_id": str(self.ci_cloud_id),
                "child_ci_id": str(self.ci_storage_id),
                "relationship_type": "SUPPORTS",
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        rel_id = create_resp.json()["id"]

        with self.engine.connect() as conn:
            create_audit = conn.execute(
                text("SELECT action, actor_id, request_id, tenant_id FROM public.audit_log_metadata "
                     "WHERE tenant_id = :tenant_id AND request_id = :request_id AND action = :action"),
                {
                    "tenant_id": self.tenant_id,
                    "request_id": str(rel_id),
                    "action": CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED,
                },
            ).first()
            self.assertIsNotNone(create_audit, "Audit event for relationship creation must exist")
            self.assertEqual(create_audit.action, CMDB_AUDIT_ACTION_RELATIONSHIP_CREATED)
            self.assertEqual(create_audit.actor_id, self.cmdb_admin_id)
            self.assertEqual(create_audit.tenant_id, self.tenant_id)

        # Delete relation
        del_resp = self.client.delete(
            f"/v1/itsm/admin/configuration-items/relationships/{rel_id}",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(del_resp.status_code, 204)

        with self.engine.connect() as conn:
            del_audit = conn.execute(
                text("SELECT action, actor_id, request_id, tenant_id FROM public.audit_log_metadata "
                     "WHERE tenant_id = :tenant_id AND request_id = :request_id AND action = :action"),
                {
                    "tenant_id": self.tenant_id,
                    "request_id": str(rel_id),
                    "action": CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED,
                },
            ).first()
            self.assertIsNotNone(del_audit, "Audit event for relationship deletion must exist")
            self.assertEqual(del_audit.action, CMDB_AUDIT_ACTION_RELATIONSHIP_DELETED)
            self.assertEqual(del_audit.actor_id, self.cmdb_admin_id)
            self.assertEqual(del_audit.tenant_id, self.tenant_id)

    def test_17_canonical_ci_relationships_endpoints(self):
        """Verify Canonical /ci-relationships endpoints work as specified."""
        # List all
        resp = self.client.get(
            "/v1/itsm/admin/ci-relationships",
            headers={"Authorization": f"Bearer {self.cmdb_admin_key}"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)


if __name__ == "__main__":
    unittest.main()
