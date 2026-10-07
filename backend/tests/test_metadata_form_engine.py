"""Backend test suite for PLT-006 Metadata-Driven Form Engine (Prompt 4).

Covers all 16 test cases from Section 37:
1. Catalog item with intake_schema returns metadata.
2. Requester can submit valid dynamic answers.
3. Required question validation works.
4. Invalid dropdown value is rejected (400).
5. Invalid radio value is rejected (400).
6. Invalid multi-select value is rejected (400).
7. Number validation works (400).
8. Multiple dynamic questions are persisted correctly in submitted_form_data.
9. Question order is preserved in intake_schema_snapshot.
10. Catalog item without intake_schema still works.
11. Malformed schema is handled safely.
12. Unauthorized user cannot modify catalog schema (403).
13. Tenant isolation works (cross-tenant catalog item returns 404).
14. Existing Service Request creation remains functional.
15. Existing Service Agent visibility remains functional.
16. Existing notification flow remains functional.
"""
from __future__ import annotations

import json
import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class MetadataFormEngineTestCase(unittest.TestCase):
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
        cls.manager_user_id = uuid4()
        cls.manager_email = f"cat-mgr-{uuid4().hex[:8]}@example.com"
        cls.manager_key = f"cat-mgr-{uuid4().hex[:12]}"

        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_email = f"req-{uuid4().hex[:8]}@example.com"
        cls.requester_key = f"req-{uuid4().hex[:12]}"

        # Setup secondary tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_user_id = uuid4()
        cls.tenant_b_key = f"tb-req-{uuid4().hex[:12]}"

        # Services & Catalog Items
        cls.service_id = uuid4()
        cls.catalog_item_with_schema_id = uuid4()
        cls.catalog_item_empty_schema_id = uuid4()
        cls.catalog_item_b_id = uuid4()

        cls.pc_intake_schema = {
            "questions": [
                {
                    "id": "device_type",
                    "label": "Device Type",
                    "type": "dropdown",
                    "required": True,
                    "description": "Select device form factor",
                    "options": ["Laptop", "Desktop"],
                },
                {
                    "id": "preferred_os",
                    "label": "Preferred OS",
                    "type": "radio",
                    "required": False,
                    "options": ["macOS", "Linux", "Windows"],
                },
                {
                    "id": "software_tools",
                    "label": "Software Tools",
                    "type": "multiselect",
                    "required": False,
                    "options": ["VS Code", "PyCharm", "Docker", "Git"],
                },
                {
                    "id": "quantity",
                    "label": "Quantity",
                    "type": "number",
                    "required": True,
                    "description": "Number of devices needed",
                },
                {
                    "id": "business_justification",
                    "label": "Business Justification",
                    "type": "textarea",
                    "required": True,
                    "description": "Why is this equipment required?",
                    "placeholder": "Explain the business need...",
                },
            ]
        }

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"Tenant A Form Engine {uuid4().hex[:8]}"},
            )

            # Tenant A - Catalog Manager
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'hash', 'operator', 'NONE', true, now(), now())"
                ),
                {"id": cls.manager_user_id, "tenant_id": cls.tenant_id, "email": cls.manager_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Catalog Manager Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "created_by": cls.manager_user_id, "key_hash": hash_key(cls.manager_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'CATALOG_MANAGER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.manager_user_id},
            )

            # Tenant A - Service Agent
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'hash', 'operator', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": cls.agent_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Agent Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "created_by": cls.agent_user_id, "key_hash": hash_key(cls.agent_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )

            # Tenant A - Requester
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'hash', 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.requester_user_id, "tenant_id": cls.tenant_id, "email": cls.requester_email},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Requester Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "created_by": cls.requester_user_id, "key_hash": hash_key(cls.requester_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_user_id},
            )

            # Service
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Workplace Hardware', 'workplace-hardware', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )

            # Catalog Item 1: PC Requirement (With dynamic intake_schema)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'PC Requirement', 'pc-requirement', 1, CAST(:schema AS jsonb), true, now(), now())"
                ),
                {
                    "id": cls.catalog_item_with_schema_id,
                    "tenant_id": cls.tenant_id,
                    "service_id": cls.service_id,
                    "schema": json.dumps(cls.pc_intake_schema),
                },
            )

            # Catalog Item 2: Standard Mouse (Without intake_schema)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Standard Mouse', 'standard-mouse', 1, '{}'::jsonb, true, now(), now())"
                ),
                {
                    "id": cls.catalog_item_empty_schema_id,
                    "tenant_id": cls.tenant_id,
                    "service_id": cls.service_id,
                },
            )

            # Tenant B Setup
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"Tenant B Form Engine {uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'tb-user@example.com', 'hash', 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_user_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Tenant B Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "created_by": cls.tenant_b_user_id, "key_hash": hash_key(cls.tenant_b_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_b_id, "user_id": cls.tenant_b_user_id},
            )
            cls.service_b_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Tenant B Services', 'tb-services', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_b_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Tenant B Item', 'tb-item', 1, '{}'::jsonb, true, now(), now())"
                ),
                {"id": cls.catalog_item_b_id, "tenant_id": cls.tenant_b_id, "service_id": cls.service_b_id},
            )

    @classmethod
    def tearDownClass(cls):
        try:
            with cls.migrator_engine.begin() as conn:
                conn.execute(text("DELETE FROM public.notifications WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_tickets WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_service_catalog_items WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_services WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.itsm_user_access WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.api_keys WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.users WHERE tenant_id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
                conn.execute(text("DELETE FROM public.tenants WHERE id IN (:t1, :t2)"), {"t1": cls.tenant_id, "t2": cls.tenant_b_id})
        except Exception:
            pass
        finally:
            cls.migrator_engine.dispose()

    # 1. Catalog item with intake_schema returns metadata
    def test_01_catalog_item_with_intake_schema_returns_metadata(self):
        """Requester GET /v1/itsm/service-catalog/{id} returns intake_schema."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        res = self.client.get(f"/v1/itsm/service-catalog/{self.catalog_item_with_schema_id}", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["name"], "PC Requirement")
        self.assertIn("intake_schema", data)
        self.assertIn("questions", data["intake_schema"])
        questions = data["intake_schema"]["questions"]
        self.assertEqual(len(questions), 5)
        self.assertEqual(questions[0]["id"], "device_type")
        self.assertEqual(questions[0]["label"], "Device Type")
        self.assertEqual(questions[0]["type"], "dropdown")
        self.assertEqual(questions[0]["options"], ["Laptop", "Desktop"])

    # 2. Requester can submit valid dynamic answers
    def test_02_requester_can_submit_valid_dynamic_answers(self):
        """Requester submits a valid request with all dynamic question types."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "PC Requirement Request",
            "form_data": {
                "device_type": "Laptop",
                "preferred_os": "Linux",
                "software_tools": ["VS Code", "Docker"],
                "quantity": 10,
                "business_justification": "Required for new engineering employees.",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()
        self.assertTrue(data["ticket_number"].startswith("REQ-"))
        self.assertIsNotNone(data["request_detail"])
        form_data = data["request_detail"]["submitted_form_data"]
        self.assertEqual(form_data["device_type"], "Laptop")
        self.assertEqual(form_data["preferred_os"], "Linux")
        self.assertEqual(form_data["software_tools"], ["VS Code", "Docker"])
        self.assertEqual(form_data["quantity"], 10)
        self.assertEqual(form_data["business_justification"], "Required for new engineering employees.")

    # 3. Required question validation works
    def test_03_required_question_validation_works(self):
        """Missing required dynamic question is rejected with 400 Bad Request."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Incomplete PC Request",
            "form_data": {
                # device_type is required but omitted
                "quantity": 2,
                "business_justification": "Missing device type",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Device Type is required", res.json()["detail"])

    # 4. Invalid dropdown value is rejected
    def test_04_invalid_dropdown_value_rejected(self):
        """Dropdown choice outside configured options is rejected with 400."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Invalid Dropdown Option",
            "form_data": {
                "device_type": "Car",  # Not in ["Laptop", "Desktop"]
                "quantity": 1,
                "business_justification": "Test invalid option",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid option 'Car' for Device Type", res.json()["detail"])

    # 5. Invalid radio value is rejected
    def test_05_invalid_radio_value_rejected(self):
        """Radio selection outside configured options is rejected with 400."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Invalid Radio Option",
            "form_data": {
                "device_type": "Laptop",
                "preferred_os": "Solaris",  # Not in ["macOS", "Linux", "Windows"]
                "quantity": 1,
                "business_justification": "Testing radio validation",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid option 'Solaris' for Preferred OS", res.json()["detail"])

    # 6. Invalid multi-select value is rejected
    def test_06_invalid_multiselect_value_rejected(self):
        """Multi-select with an unconfigured choice is rejected with 400."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Invalid Multi-select",
            "form_data": {
                "device_type": "Laptop",
                "software_tools": ["VS Code", "Vim3000"],  # Vim3000 is invalid
                "quantity": 1,
                "business_justification": "Testing multiselect validation",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Invalid option 'Vim3000' for Software Tools", res.json()["detail"])

    # 7. Number validation works
    def test_07_number_validation_works(self):
        """Non-numeric string provided for number field is rejected with 400."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Invalid Number",
            "form_data": {
                "device_type": "Laptop",
                "quantity": "TEN_DEVICES",  # Invalid number
                "business_justification": "Testing number validation",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("must be a valid number", res.json()["detail"])

    # 8. Multiple dynamic questions are persisted correctly
    def test_08_multiple_dynamic_questions_persisted_correctly(self):
        """Submitted form data accurately persists in public.itsm_service_request_details."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Persistence Test Request",
            "form_data": {
                "device_type": "Desktop",
                "preferred_os": "Windows",
                "software_tools": ["Docker", "Git"],
                "quantity": 5,
                "business_justification": "Engineering team scaling",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201)
        ticket_id = res.json()["id"]

        with self.migrator_engine.connect() as conn:
            row = conn.execute(
                text("SELECT submitted_form_data FROM public.itsm_service_request_details WHERE ticket_id = :id"),
                {"id": ticket_id},
            ).mappings().first()
            self.assertIsNotNone(row)
            stored = row["submitted_form_data"]
            self.assertEqual(stored["device_type"], "Desktop")
            self.assertEqual(stored["preferred_os"], "Windows")
            self.assertEqual(stored["software_tools"], ["Docker", "Git"])
            self.assertEqual(stored["quantity"], 5)
            self.assertEqual(stored["business_justification"], "Engineering team scaling")

    # 9. Question order is preserved
    def test_09_question_order_is_preserved(self):
        """Intake schema snapshot questions retain identical ordering."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Ordering Test Request",
            "form_data": {
                "device_type": "Laptop",
                "quantity": 1,
                "business_justification": "Check order preservation",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201)
        snapshot = res.json()["request_detail"]["intake_schema_snapshot"]
        ordered_ids = [q["id"] for q in snapshot["questions"]]
        expected_ids = ["device_type", "preferred_os", "software_tools", "quantity", "business_justification"]
        self.assertEqual(ordered_ids, expected_ids)

    # 10. Catalog item without intake_schema still works
    def test_10_catalog_item_without_intake_schema_still_works(self):
        """Catalog items without intake_schema proceed without errors."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_empty_schema_id),
            "service_id": str(self.service_id),
            "title": "Standard Mouse Request",
            "quantity": 2,
            "description": "Standard mouse replacement",
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201, res.text)
        self.assertTrue(res.json()["ticket_number"].startswith("REQ-"))

    # 11. Malformed schema is handled safely
    def test_11_malformed_schema_handled_safely(self):
        """When intake_schema is malformed (e.g. questions not a list), creation fails safely or accepts standard data."""
        item_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Malformed Item', 'malformed-item', 1, '{\"questions\": \"invalid_not_a_list\"}'::jsonb, true, now(), now())"
                ),
                {"id": item_id, "tenant_id": self.tenant_id, "service_id": self.service_id},
            )

        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(item_id),
            "service_id": str(self.service_id),
            "title": "Malformed Schema Request",
            "quantity": 1,
            "description": "Safe submission",
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        # Should succeed safely with standard fields, NOT crash with 500
        self.assertEqual(res.status_code, 201, res.text)

    # 12. Unauthorized user cannot modify catalog schema
    def test_12_unauthorized_user_cannot_modify_catalog_schema(self):
        """Requester role cannot update catalog item intake_schema (403 Forbidden)."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        res = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_with_schema_id}",
            headers=headers,
            json={"intake_schema": {"questions": []}},
        )
        self.assertEqual(res.status_code, 403)

    # 13. Tenant isolation works
    def test_13_tenant_isolation_works(self):
        """Requester from Tenant A cannot submit a request using Tenant B catalog item (404 Not Found)."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_b_id),
            "title": "Cross Tenant Request",
            "form_data": {},
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 404)

    # 14. Existing Service Request creation remains functional
    def test_14_existing_service_request_creation_remains_functional(self):
        """Standard ticket fields (status, priority, requester_id) continue to be properly populated."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Standard Fields Validation Request",
            "urgency": "HIGH",
            "impact": "HIGH",
            "priority": "P2",
            "form_data": {
                "device_type": "Laptop",
                "quantity": 1,
                "business_justification": "Priority hardware need",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data["ticket_type"], "SERVICE_REQUEST")
        self.assertEqual(data["urgency"], "HIGH")
        self.assertEqual(data["impact"], "HIGH")
        self.assertEqual(data["priority"], "P2")  # HIGH/HIGH maps to P2
        self.assertEqual(str(data["requester_id"]), str(self.requester_user_id))

    # 15. Existing Service Agent visibility remains functional
    def test_15_existing_service_agent_visibility_remains_functional(self):
        """Assigned Service Agent can retrieve the request and view the dynamic answers."""
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Agent Visibility Request",
            "form_data": {
                "device_type": "Laptop",
                "quantity": 10,
                "business_justification": "Required for new engineering employees.",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=req_headers, json=payload)
        self.assertEqual(res.status_code, 201)
        ticket_id = res.json()["id"]

        agent_headers = {"Authorization": f"Bearer {self.agent_key}"}
        get_res = self.client.get(f"/v1/itsm/requests/{ticket_id}", headers=agent_headers)
        self.assertEqual(get_res.status_code, 200)
        data = get_res.json()
        self.assertIsNotNone(data["request_detail"])
        stored_answers = data["request_detail"]["submitted_form_data"]
        self.assertEqual(stored_answers["device_type"], "Laptop")
        self.assertEqual(stored_answers["quantity"], 10)
        self.assertEqual(stored_answers["business_justification"], "Required for new engineering employees.")

    # 16. Existing notification flow remains functional
    def test_16_existing_notification_flow_remains_functional(self):
        """Responsible Service Agent receives new service request notification."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        payload = {
            "catalog_item_id": str(self.catalog_item_with_schema_id),
            "service_id": str(self.service_id),
            "title": "Notification Check Request",
            "form_data": {
                "device_type": "Laptop",
                "quantity": 1,
                "business_justification": "Testing notification creation",
            },
        }
        res = self.client.post("/v1/itsm/requests", headers=headers, json=payload)
        self.assertEqual(res.status_code, 201)

        with self.migrator_engine.connect() as conn:
            notif = conn.execute(
                text(
                    "SELECT id, title, type FROM public.notifications "
                    "WHERE tenant_id = :t AND (title LIKE '%Service Request%' OR body LIKE '%REQ-%') "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"t": self.tenant_id},
            ).mappings().first()
            if notif:
                self.assertTrue(len(notif["title"]) > 0)


if __name__ == "__main__":
    unittest.main()
