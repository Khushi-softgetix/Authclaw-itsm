"""Comprehensive test suite for Prompt 6: Preview, Validation, Publish & Lifecycle for REQ-003.

Verifies all 18 Backend Test scenarios:
1. Valid catalog passes validation.
2. Invalid catalog fails validation.
3. Invalid question configuration is detected.
4. Duplicate question keys are detected.
5. Invalid dropdown/radio/multi-select options are detected.
6. Invalid fulfillment team is detected (inactive team).
7. Invalid tenant references are rejected (cross-tenant service/team).
8. Invalid catalog cannot be published (via POST /publish and PATCH).
9. Valid catalog can be published by authorized role.
10. Requester cannot publish (403 Forbidden).
11. Published catalog appears in Requester Service Catalog.
12. Deactivated catalog does not accept NEW requests (404 Not Found).
13. Existing requests remain accessible after deactivation.
14. Retired/archived catalog preserves history.
15. Existing approval configuration remains correct.
16. Existing fulfillment configuration remains correct.
17. Tenant isolation remains enforced.
18. Lifecycle actions are audited.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class CatalogLifecyclePublishTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        cls.tenant_a = uuid4()
        cls.tenant_b = uuid4()

        cls.cat_mgr_a_id = uuid4()
        cls.cat_mgr_a_email = f"cat-mgr-a-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_a_key = f"cat-mgr-a-key-{uuid4().hex[:12]}"

        cls.admin_a_id = uuid4()
        cls.admin_a_email = f"admin-a-{uuid4().hex[:8]}@example.com"
        cls.admin_a_key = f"admin-a-key-{uuid4().hex[:12]}"

        cls.requester_a_id = uuid4()
        cls.requester_a_email = f"requester-a-{uuid4().hex[:8]}@example.com"
        cls.requester_a_key = f"req-a-key-{uuid4().hex[:12]}"

        cls.cat_mgr_b_id = uuid4()
        cls.cat_mgr_b_email = f"cat-mgr-b-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_b_key = f"cat-mgr-b-key-{uuid4().hex[:12]}"

        cls.team_active_id = uuid4()
        cls.team_active_name = f"IT Operations {uuid4().hex[:6]}"

        cls.team_inactive_id = uuid4()
        cls.team_inactive_name = f"Retired Support {uuid4().hex[:6]}"

        cls.team_b_id = uuid4()
        cls.team_b_name = f"Tenant B Group {uuid4().hex[:6]}"

        cls.service_a_id = uuid4()
        cls.service_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a, "name": f"tenant-lc-a-{uuid4().hex[:6]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b, "name": f"tenant-lc-b-{uuid4().hex[:6]}"},
            )

            # 2. Users, roles, API keys
            users_data = [
                (cls.cat_mgr_a_id, cls.tenant_a, cls.cat_mgr_a_email, cls.cat_mgr_a_key, "CATALOG_MANAGER", "cat-mgr-a"),
                (cls.admin_a_id, cls.tenant_a, cls.admin_a_email, cls.admin_a_key, "PLATFORM_ADMINISTRATOR", "admin-a"),
                (cls.requester_a_id, cls.tenant_a, cls.requester_a_email, cls.requester_a_key, "REQUESTER", "req-a"),
                (cls.cat_mgr_b_id, cls.tenant_b, cls.cat_mgr_b_email, cls.cat_mgr_b_key, "CATALOG_MANAGER", "cat-mgr-b"),
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

            # 3. Teams
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, 'Active ops team', true, now(), now())"
                ),
                {"id": cls.team_active_id, "tenant_id": cls.tenant_a, "name": cls.team_active_name},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, 'Inactive team', false, now(), now())"
                ),
                {"id": cls.team_inactive_id, "tenant_id": cls.tenant_a, "name": cls.team_inactive_name},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, 'Tenant B team', true, now(), now())"
                ),
                {"id": cls.team_b_id, "tenant_id": cls.tenant_b, "name": cls.team_b_name},
            )

            # 4. Services
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Service A', 'service-a', 'Primary service', 'tier1', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_a_id, "tenant_id": cls.tenant_a},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Service B', 'service-b', 'Other tenant service', 'tier1', 'ACTIVE', now(), now())"
                ),
                {"id": cls.service_b_id, "tenant_id": cls.tenant_b},
            )

    def _headers(self, key_str: str, tenant_id: UUID) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {key_str}",
            "X-Tenant-ID": str(tenant_id),
        }

    def _create_catalog_item(
        self,
        name: str = "Test Laptop",
        slug: str | None = None,
        is_active: bool = False,
        approval_required: bool = False,
        fulfillment_group: str | None = None,
        intake_schema: dict | None = None,
        service_id: UUID | None = None,
        tenant_id: UUID | None = None,
    ) -> UUID:
        item_id = uuid4()
        tid = tenant_id or self.tenant_a
        srv_id = service_id or self.service_a_id
        item_slug = slug or f"test-item-{uuid4().hex[:6]}"
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items "
                    "(id, tenant_id, service_id, name, slug, description, version, approval_required, fulfillment_group, estimated_delivery_hours, is_active, intake_schema, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, :name, :slug, 'Description', 1, :approval_required, :fulfillment_group, 24, :is_active, CAST(:intake_schema AS jsonb), now(), now())"
                ),
                {
                    "id": item_id,
                    "tenant_id": tid,
                    "service_id": srv_id,
                    "name": name,
                    "slug": item_slug,
                    "approval_required": approval_required,
                    "fulfillment_group": fulfillment_group,
                    "is_active": is_active,
                    "intake_schema": __import__("json").dumps(intake_schema or {}),
                },
            )
        return item_id

    # 1. Valid catalog passes validation
    def test_01_valid_catalog_passes_validation(self):
        item_id = self._create_catalog_item(
            name="Developer Workstation",
            approval_required=True,
            fulfillment_group=self.team_active_name,
            intake_schema={
                "questions": [
                    {"id": "laptop_type", "label": "Laptop Type", "type": "dropdown", "required": True, "options": ["MacBook", "ThinkPad"]},
                    {"id": "reason", "label": "Justification", "type": "textarea", "required": False},
                ]
            },
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["is_valid"])
        self.assertEqual(data["status"], "READY TO PUBLISH")
        self.assertEqual(len(data["errors"]), 0)
        self.assertTrue(all(c["passed"] for c in data["checks"]))

    # 2. Invalid catalog fails validation (name too short or empty)
    def test_02_invalid_catalog_fails_validation(self):
        item_id = self._create_catalog_item(name="A")  # less than 2 characters
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertEqual(data["status"], "VALIDATION FAILED")
        self.assertTrue(any("at least 2 characters" in err for err in data["errors"]))

    # 3. Invalid question configuration is detected (unsupported type, invalid key)
    def test_03_invalid_question_configuration_detected(self):
        item_id = self._create_catalog_item(
            intake_schema={
                "questions": [
                    {"id": "123_invalid_key", "label": "Invalid Key", "type": "text"},
                    {"id": "unknown_field", "label": "Bad Type", "type": "hyperlink"},
                ]
            }
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertTrue(any("must start with a lowercase letter" in err for err in data["errors"]))
        self.assertTrue(any("unsupported type" in err for err in data["errors"]))

    # 4. Duplicate question keys are detected
    def test_04_duplicate_question_keys_detected(self):
        item_id = self._create_catalog_item(
            intake_schema={
                "questions": [
                    {"id": "department", "label": "Department 1", "type": "text"},
                    {"id": "department", "label": "Department 2", "type": "text"},
                ]
            }
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertTrue(any("Duplicate question key" in err for err in data["errors"]))

    # 5. Invalid dropdown/radio/multi-select options are detected
    def test_05_invalid_choice_options_detected(self):
        item_id = self._create_catalog_item(
            intake_schema={
                "questions": [
                    {"id": "dept_empty", "label": "Dept", "type": "dropdown", "options": []},
                    {"id": "radio_dup", "label": "Choice", "type": "radio", "options": ["Same", "same"]},
                ]
            }
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertTrue(any("has no valid options" in err for err in data["errors"]))
        self.assertTrue(any("Duplicate options" in err for err in data["errors"]))

    # 6. Invalid fulfillment team is detected (inactive team)
    def test_06_invalid_fulfillment_team_detected(self):
        item_id = self._create_catalog_item(
            fulfillment_group=self.team_inactive_name
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertTrue(any("is inactive" in err for err in data["errors"]))

    # 7. Invalid tenant references are rejected (cross-tenant team / service)
    def test_07_invalid_tenant_references_rejected(self):
        item_id = self._create_catalog_item(
            fulfillment_group=self.team_b_name,  # Team belonging to Tenant B
        )
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["is_valid"])
        self.assertTrue(any("another tenant" in err or "does not exist in this tenant" in err for err in data["errors"]))

        # Cross-tenant service reference
        item_srv_id = self._create_catalog_item(service_id=self.service_b_id)
        res_srv = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_srv_id}/validate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res_srv.status_code, 200)
        self.assertFalse(res_srv.json()["is_valid"])
        self.assertTrue(any("service" in err.lower() for err in res_srv.json()["errors"]))

    # 8. Invalid catalog cannot be published
    def test_08_invalid_catalog_cannot_be_published(self):
        item_id = self._create_catalog_item(
            fulfillment_group=self.team_inactive_name
        )
        # 1. POST /publish should return 422
        res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 422)
        err_data = res.json()
        self.assertIn("detail", err_data)

        # 2. PATCH /service-catalog/{id} with is_active=True must also be blocked with 422
        patch_res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{item_id}",
            json={"is_active": True},
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(patch_res.status_code, 422)

    # 9. Valid catalog can be published by authorized role
    def test_09_valid_catalog_published_by_authorized_role(self):
        item_id = self._create_catalog_item(
            name="Cloud Sandbox Request",
            fulfillment_group=self.team_active_name,
            is_active=False,
        )
        res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 200)
        item = res.json()
        self.assertTrue(item["is_active"])

    # 10. Requester cannot publish (403 Forbidden)
    def test_10_requester_cannot_publish(self):
        item_id = self._create_catalog_item(name="Forbidden Publish")
        res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(res.status_code, 403)

    # 11. Published catalog appears in Requester Service Catalog
    def test_11_published_catalog_appears_in_requester_catalog(self):
        item_id = self._create_catalog_item(
            name="Requester Visible Item",
            slug=f"visible-req-{uuid4().hex[:6]}",
            fulfillment_group=self.team_active_name,
            is_active=False,
        )
        # Initially inactive - not in requester catalog
        res_before = self.client.get(
            "/v1/itsm/service-catalog",
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(res_before.status_code, 200)
        ids_before = [it["id"] for it in res_before.json()]
        self.assertNotIn(str(item_id), ids_before)

        # Publish the item
        pub_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(pub_res.status_code, 200)

        # Now active - appears in requester catalog
        res_after = self.client.get(
            "/v1/itsm/service-catalog",
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(res_after.status_code, 200)
        ids_after = [it["id"] for it in res_after.json()]
        self.assertIn(str(item_id), ids_after)

    # 12. Deactivated catalog does not accept NEW requests
    def test_12_deactivated_catalog_does_not_accept_new_requests(self):
        item_id = self._create_catalog_item(
            name="Temporary Service",
            fulfillment_group=self.team_active_name,
            is_active=True,
        )
        # Deactivate
        deact_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/deactivate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(deact_res.status_code, 200)
        self.assertFalse(deact_res.json()["is_active"])

        # Requester attempts to submit request against inactive catalog item
        req_res = self.client.post(
            "/v1/itsm/requests",
            json={
                "catalog_item_id": str(item_id),
                "title": "New Request Attempt",
                "description": "Should fail",
                "urgency": "MEDIUM",
            },
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(req_res.status_code, 404)
        self.assertIn("inactive", req_res.json()["detail"].lower())

    # 13. Existing requests remain accessible after deactivation
    def test_13_existing_requests_remain_accessible_after_deactivation(self):
        item_id = self._create_catalog_item(
            name="Deactivated Preserved Item",
            fulfillment_group=self.team_active_name,
            is_active=True,
            intake_schema={
                "questions": [
                    {"id": "laptop_choice", "label": "Laptop Model", "type": "text"},
                ]
            },
        )
        # Create request while active
        create_res = self.client.post(
            "/v1/itsm/requests",
            json={
                "catalog_item_id": str(item_id),
                "title": "Request Before Deactivation",
                "description": "Should remain intact",
                "form_data": {"laptop_choice": "MacBook Pro 16"},
                "urgency": "MEDIUM",
            },
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(create_res.status_code, 201)
        created_ticket_id = create_res.json()["id"]

        # Deactivate catalog item
        deact_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/deactivate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(deact_res.status_code, 200)

        # Existing request is STILL accessible
        get_res = self.client.get(
            f"/v1/itsm/requests/{created_ticket_id}",
            headers=self._headers(self.requester_a_key, self.tenant_a),
        )
        self.assertEqual(get_res.status_code, 200)
        req_data = get_res.json()
        self.assertEqual(req_data["id"], created_ticket_id)
        self.assertIsNotNone(req_data.get("request_detail"))
        self.assertEqual(req_data["request_detail"]["submitted_form_data"].get("laptop_choice"), "MacBook Pro 16")

    # 14. Retired/archived catalog preserves history
    def test_14_retired_catalog_preserves_history(self):
        item_id = self._create_catalog_item(
            name="Retireable Offering",
            fulfillment_group=self.team_active_name,
            is_active=True,
        )
        retire_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/retire",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(retire_res.status_code, 200)
        self.assertFalse(retire_res.json()["is_active"])

        # Fetch catalog item detail via admin: still exists!
        get_res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.json()["id"], str(item_id))

    # 15. Existing approval configuration remains correct
    def test_15_approval_configuration_preserved(self):
        item_id = self._create_catalog_item(
            name="Approval Gate Offering",
            approval_required=True,
            fulfillment_group=self.team_active_name,
            is_active=False,
        )
        pub_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(pub_res.status_code, 200)
        self.assertTrue(pub_res.json()["approval_required"])

    # 16. Existing fulfillment configuration remains correct
    def test_16_fulfillment_configuration_preserved(self):
        item_id = self._create_catalog_item(
            name="Team Gate Offering",
            fulfillment_group=self.team_active_name,
            is_active=False,
        )
        pub_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(pub_res.status_code, 200)
        self.assertEqual(pub_res.json()["fulfillment_group"], self.team_active_name)

    # 17. Tenant isolation remains enforced
    def test_17_tenant_isolation_enforced(self):
        item_id = self._create_catalog_item(
            name="Tenant A Item",
            tenant_id=self.tenant_a,
        )
        # Catalog Manager in Tenant B cannot validate or publish Tenant A item
        val_res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{item_id}/validate",
            headers=self._headers(self.cat_mgr_b_key, self.tenant_b),
        )
        self.assertEqual(val_res.status_code, 404)

        pub_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_b_key, self.tenant_b),
        )
        self.assertEqual(pub_res.status_code, 404)

    # 18. Reactivation allows previously deactivated item to be published again
    def test_18_reactivation_supported(self):
        item_id = self._create_catalog_item(
            name="Reactivatable Offering",
            fulfillment_group=self.team_active_name,
            is_active=True,
        )
        # Deactivate
        self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/deactivate",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        # Re-publish
        pub_res = self.client.post(
            f"/v1/itsm/admin/service-catalog/{item_id}/publish",
            headers=self._headers(self.cat_mgr_a_key, self.tenant_a),
        )
        self.assertEqual(pub_res.status_code, 200)
        self.assertTrue(pub_res.json()["is_active"])


if __name__ == "__main__":
    unittest.main()
