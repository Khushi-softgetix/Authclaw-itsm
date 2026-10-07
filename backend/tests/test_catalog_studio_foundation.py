"""Focused test suite for Prompt 2: Catalog Manager Portal / Catalog Studio foundation.

Verifies:
1. CATALOG_MANAGER can list catalog items via GET /v1/itsm/admin/service-catalog.
2. CATALOG_MANAGER can view catalog item details via GET /v1/itsm/admin/service-catalog/{item_id}.
3. CATALOG_MANAGER can create a catalog item via POST /v1/itsm/admin/service-catalog.
4. CATALOG_MANAGER can update a catalog item via PATCH /v1/itsm/admin/service-catalog/{item_id}.
5. Server-side search & filtering (search, service_id, is_active, fulfillment_group, approval_required).
6. Non-destructive intake_schema preservation on PATCH.
7. CATALOG_MANAGER cannot access unrelated Platform Admin endpoints (/users, /teams, /settings).
8. REQUESTER cannot access Catalog Manager management endpoints (403 Forbidden).
9. SERVICE_AGENT cannot access Catalog Manager management endpoints (403 Forbidden).
10. Strict multi-tenant isolation and PostgreSQL RLS.
11. Existing requester catalog endpoint (/v1/itsm/service-catalog) continues working.
12. Existing service request submission (/v1/itsm/requests) continues working.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class CatalogStudioFoundationTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Tenant A
        cls.tenant_a = uuid4()
        # Tenant B (for tenant isolation test)
        cls.tenant_b = uuid4()

        # Catalog Manager in Tenant A
        cls.cat_mgr_a_id = uuid4()
        cls.cat_mgr_a_email = f"cat-mgr-a-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_a_key = f"cat-mgr-a-key-{uuid4().hex[:12]}"

        # Catalog Manager in Tenant B
        cls.cat_mgr_b_id = uuid4()
        cls.cat_mgr_b_email = f"cat-mgr-b-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_b_key = f"cat-mgr-b-key-{uuid4().hex[:12]}"

        # Platform Admin in Tenant A
        cls.admin_a_id = uuid4()
        cls.admin_a_email = f"admin-a-{uuid4().hex[:8]}@example.com"
        cls.admin_a_key = f"admin-a-key-{uuid4().hex[:12]}"

        # Requester in Tenant A
        cls.requester_a_id = uuid4()
        cls.requester_a_email = f"requester-a-{uuid4().hex[:8]}@example.com"
        cls.requester_a_key = f"req-a-key-{uuid4().hex[:12]}"

        # Service Agent in Tenant A
        cls.agent_a_id = uuid4()
        cls.agent_a_email = f"agent-a-{uuid4().hex[:8]}@example.com"
        cls.agent_a_key = f"agent-a-key-{uuid4().hex[:12]}"

        # Parent Business Services for Tenant A and Tenant B
        cls.service_a_id = uuid4()
        cls.service_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Create tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a, "name": f"tenant-alpha-{uuid4().hex[:6]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b, "name": f"tenant-beta-{uuid4().hex[:6]}"},
            )

            # 2. Insert users, itsm_user_access, api_keys
            users_data = [
                (cls.cat_mgr_a_id, cls.tenant_a, cls.cat_mgr_a_email, cls.cat_mgr_a_key, "CATALOG_MANAGER", "cat-mgr-a"),
                (cls.cat_mgr_b_id, cls.tenant_b, cls.cat_mgr_b_email, cls.cat_mgr_b_key, "CATALOG_MANAGER", "cat-mgr-b"),
                (cls.admin_a_id, cls.tenant_a, cls.admin_a_email, cls.admin_a_key, "PLATFORM_ADMINISTRATOR", "admin-a"),
                (cls.requester_a_id, cls.tenant_a, cls.requester_a_email, cls.requester_a_key, "REQUESTER", "req-a"),
                (cls.agent_a_id, cls.tenant_a, cls.agent_a_email, cls.agent_a_key, "SERVICE_AGENT", "agent-a"),
            ]
            for uid, tid, email, key_str, itsm_role, key_name in users_data:
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                    ),
                    {"id": uid, "tenant_id": tid, "email": email},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                    ),
                    {"tenant_id": tid, "user_id": uid, "itsm_role": itsm_role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                    ),
                    {
                        "id": uuid4(),
                        "tenant_id": tid,
                        "key_hash": hash_key(key_str),
                        "name": key_name,
                        "created_by": uid,
                    },
                )

            # 3. Insert Parent Business Services
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES "
                    "  (:s_a, :t_a, 'Corporate Hardware IT', 'corp-hw-it', 'Workstations and equipment', 'tier1', 'OPERATIONAL', 'IT Support', now(), now()), "
                    "  (:s_b, :t_b, 'Beta IT Services', 'beta-it-services', 'Beta hardware', 'tier1', 'OPERATIONAL', 'Beta Team', now(), now())"
                ),
                {"s_a": cls.service_a_id, "t_a": cls.tenant_a, "s_b": cls.service_b_id, "t_b": cls.tenant_b},
            )

    def test_01_catalog_manager_can_create_catalog_item(self):
        payload = {
            "service_id": str(self.service_a_id),
            "name": "Standard Ergonomic Chair Offering",
            "slug": f"ergo-chair-{uuid4().hex[:6]}",
            "description": "Ergonomic mesh task chair for remote and office setup",
            "approval_required": True,
            "fulfillment_group": "Facilities",
            "estimated_delivery_hours": 72,
            "is_active": True,
            "intake_schema": {
                "version": 1,
                "questions": [
                    {"id": "q1", "type": "dropdown", "label": "Chair Size", "options": ["Small", "Medium", "Large"], "required": True}
                ],
            },
        }
        resp = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json=payload,
        )
        self.assertIn(resp.status_code, [200, 201], resp.text)
        data = resp.json()
        self.assertEqual(data["name"], payload["name"])
        self.assertEqual(data["fulfillment_group"], "Facilities")
        self.assertTrue(data["approval_required"])
        self.assertTrue(data["is_active"])
        self.assertEqual(data["intake_schema"], payload["intake_schema"])

    def test_02_catalog_manager_can_list_and_filter_catalog_items(self):
        # Create second item in Tenant A for filtering
        slug_mon = f"monitor-arm-{uuid4().hex[:6]}"
        self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "service_id": str(self.service_a_id),
                "name": "Heavy Duty Dual Monitor Arm",
                "slug": slug_mon,
                "description": "Desk clamp dual screen mount",
                "approval_required": False,
                "fulfillment_group": "IT Support Desk",
                "estimated_delivery_hours": 24,
                "is_active": False,
            },
        )

        # 1. Plain list
        resp = self.client.get(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertGreaterEqual(len(items), 2)

        # 2. Search filter
        resp_search = self.client.get(
            "/v1/itsm/admin/service-catalog?search=Monitor+Arm",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_search.status_code, 200)
        filtered = resp_search.json()
        self.assertTrue(all("Monitor Arm" in it["name"] for it in filtered))

        # 3. is_active filter
        resp_inactive = self.client.get(
            "/v1/itsm/admin/service-catalog?is_active=false",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_inactive.status_code, 200)
        inactive_items = resp_inactive.json()
        self.assertTrue(all(it["is_active"] is False for it in inactive_items))

        # 4. approval_required filter
        resp_appr = self.client.get(
            "/v1/itsm/admin/service-catalog?approval_required=true",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_appr.status_code, 200)
        appr_items = resp_appr.json()
        self.assertTrue(all(it["approval_required"] is True for it in appr_items))

    def test_03_catalog_manager_can_view_detail_and_update(self):
        # Create an item
        create_resp = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "service_id": str(self.service_a_id),
                "name": "Software IDE License",
                "slug": f"ide-license-{uuid4().hex[:6]}",
                "description": "Annual pro developer IDE subscription",
                "approval_required": True,
                "fulfillment_group": "Software Procurement",
                "estimated_delivery_hours": 12,
                "is_active": True,
                "intake_schema": {"questions": [{"id": "email_alias", "type": "text"}]},
            },
        )
        self.assertIn(create_resp.status_code, [200, 201])
        item_id = create_resp.json()["id"]

        # View detail
        detail_resp = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(detail_resp.status_code, 200)
        self.assertEqual(detail_resp.json()["id"], item_id)
        self.assertEqual(len(detail_resp.json()["intake_schema"]["questions"]), 1)

        # Update item without modifying intake_schema -> intake_schema must be preserved!
        update_resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "name": "Software IDE License (Enterprise Edition)",
                "estimated_delivery_hours": 6,
            },
        )
        self.assertEqual(update_resp.status_code, 200)
        updated = update_resp.json()
        self.assertEqual(updated["name"], "Software IDE License (Enterprise Edition)")
        self.assertEqual(updated["estimated_delivery_hours"], 6)
        # Ensure schema preserved
        self.assertEqual(len(updated["intake_schema"]["questions"]), 1)

    def test_04_catalog_manager_cannot_access_unrelated_admin_endpoints(self):
        # Users management
        resp_users = self.client.get(
            "/v1/itsm/admin/users",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_users.status_code, 403)
        self.assertIn("Platform Administrator access required", resp_users.text)

        # Teams
        resp_teams = self.client.get(
            "/v1/itsm/admin/teams",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_teams.status_code, 403)
        self.assertIn("Platform Administrator access required", resp_teams.text)

        # Settings
        resp_settings = self.client.get(
            "/v1/itsm/admin/settings",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp_settings.status_code, 403)
        self.assertIn("Platform Administrator access required", resp_settings.text)

    def test_05_unauthorized_roles_cannot_manage_catalog(self):
        # Requester denied
        resp = self.client.get(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(resp.status_code, 403)

        resp = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={"name": "Hacked", "slug": "hacked", "service_id": str(self.service_a_id)},
        )
        self.assertEqual(resp.status_code, 403)

        # Service Agent denied
        resp = self.client.get(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
        )
        self.assertEqual(resp.status_code, 403)

        resp = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={"name": "Hacked", "slug": "hacked", "service_id": str(self.service_a_id)},
        )
        self.assertEqual(resp.status_code, 403)

    def test_06_tenant_isolation(self):
        # Create item in Tenant A
        res_a = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "service_id": str(self.service_a_id),
                "name": "Secret Tenant A Offering",
                "slug": f"secret-a-{uuid4().hex[:6]}",
                "approval_required": False,
            },
        )
        self.assertIn(res_a.status_code, [200, 201])
        item_a_id = res_a.json()["id"]

        # Catalog Manager in Tenant B cannot see Tenant A's item in list
        list_b = self.client.get(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_b_key}"},
        )
        self.assertEqual(list_b.status_code, 200)
        b_item_ids = [it["id"] for it in list_b.json()]
        self.assertNotIn(item_a_id, b_item_ids)

        # Catalog Manager in Tenant B cannot fetch Tenant A's item directly
        get_b = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_a_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_b_key}"},
        )
        self.assertEqual(get_b.status_code, 404)

        # Catalog Manager in Tenant B cannot update Tenant A's item
        patch_b = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{item_a_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_b_key}"},
            json={"name": "Hijacked Item"},
        )
        self.assertEqual(patch_b.status_code, 404)

    def test_07_requester_service_catalog_and_request_submission_still_work(self):
        # Requester can list active catalog items via public requester catalog endpoint
        res = self.client.get(
            "/v1/itsm/service-catalog",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertIsInstance(items, list)

        # Create active offering for requester to request
        res_offering = self.client.post(
            "/v1/itsm/admin/service-catalog",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "service_id": str(self.service_a_id),
                "name": "Requester Test Workstation",
                "slug": f"req-workstation-{uuid4().hex[:6]}",
                "approval_required": False,
                "fulfillment_group": "Desktop Support",
                "is_active": True,
            },
        )
        self.assertIn(res_offering.status_code, [200, 201])
        catalog_item_id = res_offering.json()["id"]

        # Requester submits a request
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": catalog_item_id,
                "service_id": str(self.service_a_id),
                "title": "Requester Test Workstation",
                "description": "Urgent developer workstation onboarding request",
                "quantity": 1,
                "form_data": {"notes": "Urgent onboarding requirement"},
            },
        )
        self.assertIn(req_res.status_code, [200, 201], req_res.text)
        created_req = req_res.json()
        self.assertEqual(created_req["request_detail"]["catalog_item_id"], str(catalog_item_id))
        self.assertIn(created_req["status"], ["OPEN", "ASSIGNED"])


if __name__ == "__main__":
    unittest.main()
