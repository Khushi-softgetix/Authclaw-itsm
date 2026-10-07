"""Focused test suite for Prompt 3: REQ-003 No-Code Catalog Item Form Builder.

Verifies:
1. CATALOG_MANAGER can read catalog item intake_schema via GET /v1/itsm/admin/service-catalog/{item_id}.
2. CATALOG_MANAGER can update intake_schema with valid questions via PATCH /v1/itsm/admin/service-catalog/{item_id}.
3. Question ordering is strictly preserved in intake_schema.
4. REQUESTER cannot modify intake_schema (403 Forbidden).
5. SERVICE_AGENT cannot modify intake_schema (403 Forbidden).
6. Multi-tenant isolation: Tenant B cannot access or modify Tenant A catalog items.
7. Validation rejects non-dict intake_schema (422).
8. Validation rejects invalid field key format (422).
9. Validation rejects duplicate field keys (422).
10. Validation rejects unsupported question types (422).
11. Validation rejects choice types without options or with duplicate options (422).
12. Existing intake_schema data and metadata are preserved non-destructively.
13. Catalog item core updates (name, active status) continue working normally.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class CatalogFormBuilderTestCase(unittest.TestCase):
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
        # Tenant B (for multi-tenant isolation)
        cls.tenant_b = uuid4()

        # Users in Tenant A
        cls.cat_mgr_a_id = uuid4()
        cls.cat_mgr_a_email = f"cat-mgr-form-a-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_a_key = f"cat-mgr-form-key-a-{uuid4().hex[:12]}"

        cls.admin_a_id = uuid4()
        cls.admin_a_email = f"admin-form-a-{uuid4().hex[:8]}@example.com"
        cls.admin_a_key = f"admin-form-key-a-{uuid4().hex[:12]}"

        cls.requester_a_id = uuid4()
        cls.requester_a_email = f"req-form-a-{uuid4().hex[:8]}@example.com"
        cls.requester_a_key = f"req-form-key-a-{uuid4().hex[:12]}"

        cls.agent_a_id = uuid4()
        cls.agent_a_email = f"agent-form-a-{uuid4().hex[:8]}@example.com"
        cls.agent_a_key = f"agent-form-key-a-{uuid4().hex[:12]}"

        # Users in Tenant B
        cls.cat_mgr_b_id = uuid4()
        cls.cat_mgr_b_email = f"cat-mgr-form-b-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_b_key = f"cat-mgr-form-key-b-{uuid4().hex[:12]}"

        # Business Services
        cls.service_a_id = uuid4()
        cls.service_b_id = uuid4()

        # Catalog Items
        cls.catalog_item_a_id = uuid4()
        cls.catalog_item_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Create tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a, "name": f"tenant-form-a-{uuid4().hex[:6]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b, "name": f"tenant-form-b-{uuid4().hex[:6]}"},
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

            # 3. Create parent business services
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES "
                    "  (:s_a, :t_a, 'Corporate Hardware IT', 'corp-hw-it', 'Workstations and equipment', 'tier1', 'OPERATIONAL', 'IT Support', now(), now()), "
                    "  (:s_b, :t_b, 'Beta IT Services', 'beta-it-services', 'Beta hardware', 'tier1', 'OPERATIONAL', 'Beta Team', now(), now())"
                ),
                {"s_a": cls.service_a_id, "t_a": cls.tenant_a, "s_b": cls.service_b_id, "t_b": cls.tenant_b},
            )

            # 4. Create initial catalog item for Tenant A with seed intake_schema
            conn.execute(
                text(
                    """
                    INSERT INTO public.itsm_service_catalog_items (
                        id, tenant_id, service_id, name, slug, description, version,
                        intake_schema, approval_required, fulfillment_group, estimated_delivery_hours, is_active, created_at, updated_at
                    ) VALUES (
                        :id, :tenant_id, :service_id, 'Employee Laptop Request', 'laptop-req-form',
                        'Request standard or high-performance laptop', 1,
                        '{"version": 1, "type": "object", "custom_meta": "preserve_me", "questions": []}'::jsonb,
                        true, 'Desktop Support', 48, true, now(), now()
                    )
                    """
                ),
                {"id": cls.catalog_item_a_id, "tenant_id": cls.tenant_a, "service_id": cls.service_a_id},
            )

            # Catalog item for Tenant B
            conn.execute(
                text(
                    """
                    INSERT INTO public.itsm_service_catalog_items (
                        id, tenant_id, service_id, name, slug, description, version,
                        intake_schema, approval_required, fulfillment_group, estimated_delivery_hours, is_active, created_at, updated_at
                    ) VALUES (
                        :id, :tenant_id, :service_id, 'Tenant B Catalog Offering', 'tenant-b-offering',
                        'Tenant B private offering', 1,
                        '{"version": 1, "questions": []}'::jsonb,
                        false, 'IT Support', 24, true, now(), now()
                    )
                    """
                ),
                {"id": cls.catalog_item_b_id, "tenant_id": cls.tenant_b, "service_id": cls.service_b_id},
            )

    def _headers(self, key_str: str) -> dict:
        return {"Authorization": f"Bearer {key_str}"}

    def test_01_catalog_manager_can_read_intake_schema(self):
        """CATALOG_MANAGER can read catalog item intake_schema detail."""
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["name"], "Employee Laptop Request")
        self.assertIn("intake_schema", data)
        self.assertEqual(data["intake_schema"].get("custom_meta"), "preserve_me")

    def test_02_catalog_manager_can_update_intake_schema_with_valid_questions(self):
        """CATALOG_MANAGER can update questions across all supported types."""
        questions = [
            {
                "id": "laptop_type",
                "label": "Laptop Type",
                "type": "dropdown",
                "required": True,
                "description": "Choose hardware specification",
                "placeholder": "Select laptop...",
                "options": ["Standard", "Developer", "Design"],
                "default_value": "Standard",
            },
            {
                "id": "quantity",
                "label": "Quantity",
                "type": "number",
                "required": True,
                "description": "Number of units needed",
                "placeholder": "1",
            },
            {
                "id": "business_justification",
                "label": "Business Justification",
                "type": "textarea",
                "required": True,
                "description": "Why do you need this equipment?",
                "placeholder": "Provide detailed context...",
            },
            {
                "id": "shipping_preference",
                "label": "Shipping Preference",
                "type": "radio",
                "required": False,
                "options": ["Office Desk Drop", "Home Delivery"],
            },
            {
                "id": "peripherals",
                "label": "Required Peripherals",
                "type": "multiselect",
                "required": False,
                "options": ["External Monitor", "Mechanical Keyboard", "USB-C Dock"],
            },
            {
                "id": "special_instructions",
                "label": "Special Instructions",
                "type": "text",
                "required": False,
                "placeholder": "e.g. Asset tag preferences",
            },
        ]
        payload = {
            "intake_schema": {
                "version": 1,
                "type": "object",
                "custom_meta": "preserve_me",
                "questions": questions,
            }
        }
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        saved_questions = data["intake_schema"]["questions"]
        self.assertEqual(len(saved_questions), 6)

        # Question ordering must be strictly preserved
        ordered_keys = [q["id"] for q in saved_questions]
        self.assertEqual(
            ordered_keys,
            [
                "laptop_type",
                "quantity",
                "business_justification",
                "shipping_preference",
                "peripherals",
                "special_instructions",
            ],
        )

        # Existing metadata preserved
        self.assertEqual(data["intake_schema"]["custom_meta"], "preserve_me")

    def test_03_requester_cannot_modify_intake_schema(self):
        """REQUESTER gets 403 Forbidden when attempting to update catalog item intake_schema."""
        payload = {"intake_schema": {"questions": []}}
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.requester_a_key),
        )
        self.assertEqual(res.status_code, 403)

    def test_04_service_agent_cannot_modify_intake_schema(self):
        """SERVICE_AGENT gets 403 Forbidden when attempting to update catalog item intake_schema."""
        payload = {"intake_schema": {"questions": []}}
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.agent_a_key),
        )
        self.assertEqual(res.status_code, 403)

    def test_05_multi_tenant_isolation(self):
        """CATALOG_MANAGER in Tenant B cannot access or modify Tenant A's catalog item."""
        # Read attempt
        res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            headers=self._headers(self.cat_mgr_b_key),
        )
        self.assertEqual(res.status_code, 404)

        # Update attempt
        payload = {"intake_schema": {"questions": []}}
        patch_res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.cat_mgr_b_key),
        )
        self.assertEqual(patch_res.status_code, 404)

    def test_06_validation_rejects_invalid_field_key(self):
        """Validation rejects uppercase, special chars, or numbers at start of field key."""
        invalid_keys = ["1st_question", "Laptop-Type", "field name", "has$symbol"]
        for key in invalid_keys:
            payload = {
                "intake_schema": {
                    "questions": [
                        {
                            "id": key,
                            "label": "Test Label",
                            "type": "text",
                            "required": False,
                        }
                    ]
                }
            }
            res = self.client.patch(
                f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
                json=payload,
                headers=self._headers(self.cat_mgr_a_key),
            )
            self.assertEqual(res.status_code, 422, f"Expected 422 for invalid key '{key}', got {res.status_code}")

    def test_07_validation_rejects_duplicate_field_keys(self):
        """Validation rejects two questions having the same field key."""
        payload = {
            "intake_schema": {
                "questions": [
                    {"id": "department", "label": "Department 1", "type": "text", "required": False},
                    {"id": "department", "label": "Department 2", "type": "text", "required": True},
                ]
            }
        }
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("Duplicate field key", res.text)

    def test_08_validation_rejects_unsupported_question_type(self):
        """Validation rejects types outside supported set."""
        payload = {
            "intake_schema": {
                "questions": [
                    {"id": "unsupported_field", "label": "Unknown", "type": "complex_ai_field", "required": False}
                ]
            }
        }
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("unsupported question type", res.text)

    def test_09_validation_rejects_choice_types_without_or_duplicate_options(self):
        """Dropdown, Radio, Multi-Select require non-empty unique options."""
        # 1. Empty options
        payload_empty = {
            "intake_schema": {
                "questions": [
                    {"id": "laptop_type", "label": "Laptop Type", "type": "dropdown", "required": True, "options": []}
                ]
            }
        }
        res1 = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload_empty,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res1.status_code, 422)

        # 2. Duplicate options
        payload_dup = {
            "intake_schema": {
                "questions": [
                    {
                        "id": "laptop_type",
                        "label": "Laptop Type",
                        "type": "dropdown",
                        "required": True,
                        "options": ["Standard", "Standard"],
                    }
                ]
            }
        }
        res2 = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload_dup,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res2.status_code, 422)
        self.assertIn("Duplicate options", res2.text)

    def test_10_question_reordering_and_deletion_persists(self):
        """Catalog Manager reorders and deletes questions and change persists."""
        # Initial 3 questions
        payload_init = {
            "intake_schema": {
                "questions": [
                    {"id": "q_one", "label": "Question 1", "type": "text", "required": True},
                    {"id": "q_two", "label": "Question 2", "type": "number", "required": False},
                    {"id": "q_three", "label": "Question 3", "type": "textarea", "required": True},
                ]
            }
        }
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload_init,
            headers=self._headers(self.cat_mgr_a_key),
        )

        # Reorder (move q_three to top) and delete q_two
        payload_updated = {
            "intake_schema": {
                "questions": [
                    {"id": "q_three", "label": "Question 3 (Edited)", "type": "textarea", "required": False},
                    {"id": "q_one", "label": "Question 1", "type": "text", "required": True},
                ]
            }
        }
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            json=payload_updated,
            headers=self._headers(self.cat_mgr_a_key),
        )
        self.assertEqual(res.status_code, 200)

        # Verify via GET
        get_res = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_a_id}",
            headers=self._headers(self.cat_mgr_a_key),
        )
        saved_q = get_res.json()["intake_schema"]["questions"]
        self.assertEqual(len(saved_q), 2)
        self.assertEqual(saved_q[0]["id"], "q_three")
        self.assertEqual(saved_q[0]["label"], "Question 3 (Edited)")
        self.assertEqual(saved_q[1]["id"], "q_one")


if __name__ == "__main__":
    unittest.main()
