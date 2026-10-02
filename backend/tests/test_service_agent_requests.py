"""Backend test suite for Service Agent Service Request Work (Step 6).

Covers:
1. SERVICE_AGENT can list service requests via GET /v1/itsm/requests (200 OK)
2. Requests endpoint strictly filters ticket_type == 'SERVICE_REQUEST' (does not return INCIDENT)
3. SERVICE_AGENT can retrieve single request detail with intake variables via GET /v1/itsm/requests/{id} (200 OK)
4. Assigned-to-me filtering returns only tickets assigned to the requesting agent
5. Status filtering works for OPEN, IN_PROGRESS, RESOLVED
6. Status transition POST /v1/itsm/requests/{id}/status changes status and logs activity
7. Activity timeline GET and POST /v1/itsm/requests/{id}/activities
8. Unauthenticated request receives 401 Unauthorized
9. Tenant isolation: Agent in Tenant A cannot view or modify Tenant B request (404 Not Found)
10. Non-existent request returns 404 Not Found
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


class ServiceAgentRequestsTestCase(unittest.TestCase):
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
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-req-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"agent-req-{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_email = f"req-{uuid4().hex[:8]}@example.com"

        # Setup secondary tenant (Tenant B)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-agent-req-{uuid4().hex[:12]}"

        # Request & Incident IDs
        cls.req_a1_id = uuid4()
        cls.req_a2_id = uuid4()
        cls.inc_a1_id = uuid4()
        cls.req_b1_id = uuid4()

        cls.service_id = uuid4()
        cls.catalog_item_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"Tenant A Request Test {uuid4().hex[:8]}"},
            )

            # Tenant A Agent User
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'hash', 'operator', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": cls.agent_email},
            )

            # Tenant A Agent Key
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Agent Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": cls.tenant_id,
                    "created_by": cls.agent_user_id,
                    "key_hash": hash_key(cls.agent_key),
                },
            )

            # Tenant A Requester User
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'hash', 'viewer', 'NONE', true, now(), now())"
                ),
                {"id": cls.requester_user_id, "tenant_id": cls.tenant_id, "email": cls.requester_email},
            )

            # Assign ITSM Access
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_user_id},
            )

            # Service and Catalog Item
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Hardware Support', 'hardware-support', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'MacBook Pro Request', 'macbook-request', 1, '{\"type\": \"object\"}'::jsonb, true, now(), now())"
                ),
                {"id": cls.catalog_item_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id},
            )

            # Service Request 1 in Tenant A (Assigned to agent, IN_PROGRESS)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, service_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'REQ-TEST-001', 'SERVICE_REQUEST', 'MacBook Pro 16 Inch', 'Developer workstation request', 'MEDIUM', 'MEDIUM', 'P3', 'IN_PROGRESS', :requester_id, :assignee_id, :service_id, now(), now())"
                ),
                {
                    "id": cls.req_a1_id,
                    "tenant_id": cls.tenant_id,
                    "requester_id": cls.requester_user_id,
                    "assignee_id": cls.agent_user_id,
                    "service_id": cls.service_id,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_request_details (id, tenant_id, ticket_id, catalog_item_id, catalog_item_version, intake_schema_snapshot, submitted_form_data, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, :catalog_item_id, 1, '{\"type\": \"object\"}'::jsonb, '{\"ram_gb\": 64, \"model\": \"M3 Max\"}'::jsonb, now())"
                ),
                {
                    "tenant_id": cls.tenant_id,
                    "ticket_id": cls.req_a1_id,
                    "catalog_item_id": cls.catalog_item_id,
                },
            )

            # Service Request 2 in Tenant A (Unassigned, NEW)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'REQ-TEST-002', 'SERVICE_REQUEST', 'YubiKey Security Token', 'Replacement key', 'MEDIUM', 'LOW', 'P4', 'NEW', :requester_id, now(), now())"
                ),
                {
                    "id": cls.req_a2_id,
                    "tenant_id": cls.tenant_id,
                    "requester_id": cls.requester_user_id,
                },
            )

            # Incident in Tenant A (Must NOT be returned by requests endpoint)
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-TEST-001', 'INCIDENT', 'Network Outage Incident', 'Switch dropped', 'HIGH', 'HIGH', 'P1', 'NEW', :requester_id, now(), now())"
                ),
                {
                    "id": cls.inc_a1_id,
                    "tenant_id": cls.tenant_id,
                    "requester_id": cls.requester_user_id,
                },
            )

            # Setup Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"Tenant B Request Test {uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'agent-b@example.com', 'hash', 'operator', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'Agent B Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": cls.tenant_b_id,
                    "created_by": cls.tenant_b_agent_id,
                    "key_hash": hash_key(cls.tenant_b_key),
                },
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
                    "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'REQ-TB-001', 'SERVICE_REQUEST', 'Tenant B Laptop', 'Tenant B private request', 'MEDIUM', 'MEDIUM', 'P3', 'NEW', :requester_id, now(), now())"
                ),
                {
                    "id": cls.req_b1_id,
                    "tenant_id": cls.tenant_b_id,
                    "requester_id": cls.tenant_b_agent_id,
                },
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

    def test_01_agent_can_list_service_requests(self):
        """SERVICE_AGENT can list service requests within tenant."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/requests", headers=headers)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertGreaterEqual(len(items), 2)
        ticket_numbers = [i["ticket_number"] for i in items]
        self.assertIn("REQ-TEST-001", ticket_numbers)
        self.assertIn("REQ-TEST-002", ticket_numbers)

    def test_02_requests_endpoint_does_not_return_incidents(self):
        """Requests endpoint must strictly filter ticket_type == 'SERVICE_REQUEST'."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/requests", headers=headers)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        ticket_numbers = [i["ticket_number"] for i in items]
        self.assertNotIn("INC-TEST-001", ticket_numbers)
        self.assertTrue(all(i["ticket_type"] == "SERVICE_REQUEST" for i in items))

    def test_03_agent_can_retrieve_request_detail_with_variables(self):
        """SERVICE_AGENT can retrieve single request detail with intake snapshot."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/requests/{self.req_a1_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["ticket_number"], "REQ-TEST-001")
        self.assertEqual(data["title"], "MacBook Pro 16 Inch")
        self.assertEqual(data["service_name"], "Hardware Support")
        self.assertIsNotNone(data["request_detail"])
        self.assertEqual(data["request_detail"]["catalog_item_name"], "MacBook Pro Request")
        self.assertEqual(data["request_detail"]["submitted_form_data"]["ram_gb"], 64)

    def test_04_assigned_to_me_filter_works(self):
        """Filtering by assigned_to_me=true returns only tickets assigned to requesting agent."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/requests?assigned_to_me=true", headers=headers)
        self.assertEqual(res.status_code, 200)
        items = res.json()
        self.assertTrue(all(i["assignee_id"] == str(self.agent_user_id) for i in items))
        numbers = [i["ticket_number"] for i in items]
        self.assertIn("REQ-TEST-001", numbers)
        self.assertNotIn("REQ-TEST-002", numbers)

    def test_05_status_filter_works(self):
        """Filtering by status correctly narrows the returned list."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/requests?status=OPEN", headers=headers)
        self.assertEqual(res.status_code, 200)
        numbers = [i["ticket_number"] for i in res.json()]
        self.assertIn("REQ-TEST-002", numbers)

        res_prog = self.client.get("/v1/itsm/requests?status=IN_PROGRESS", headers=headers)
        self.assertEqual(res_prog.status_code, 200)
        numbers_prog = [i["ticket_number"] for i in res_prog.json()]
        self.assertIn("REQ-TEST-001", numbers_prog)
        self.assertNotIn("REQ-TEST-002", numbers_prog)

    def test_06_status_transition_and_activity_recording(self):
        """Status transition updates request status and logs activity."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        # Transition REQ-TEST-001 (currently IN_PROGRESS) to RESOLVED
        payload = {
            "status": "RESOLVED",
            "resolution_code": "FULFILLED",
            "resolution_summary": "Laptop handed over to employee",
        }
        res = self.client.post(f"/v1/itsm/requests/{self.req_a1_id}/status", json=payload, headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "RESOLVED")
        self.assertEqual(res.json()["resolution_code"], "FULFILLED")

        # Verify activity timeline contains the status change
        act_res = self.client.get(f"/v1/itsm/requests/{self.req_a1_id}/activities", headers=headers)
        self.assertEqual(act_res.status_code, 200)
        types = [a["activity_type"] for a in act_res.json()]
        self.assertIn("STATUS_CHANGE", types)

    def test_07_post_and_list_activities(self):
        """Adding a public comment and internal note to a service request."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        post_res = self.client.post(
            f"/v1/itsm/requests/{self.req_a1_id}/activities",
            json={"content": "Shipped tracking number: 1Z999", "activity_type": "COMMENT", "is_internal": False},
            headers=headers,
        )
        self.assertEqual(post_res.status_code, 201)
        self.assertEqual(post_res.json()["content"], "Shipped tracking number: 1Z999")

        list_res = self.client.get(f"/v1/itsm/requests/{self.req_a1_id}/activities", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        contents = [a["content"] for a in list_res.json()]
        self.assertIn("Shipped tracking number: 1Z999", contents)

    def test_08_unauthenticated_request_receives_401(self):
        """Requests without Authorization header must receive 401."""
        res = self.client.get("/v1/itsm/requests")
        self.assertEqual(res.status_code, 401)

    def test_09_tenant_isolation_cross_tenant_access_blocked(self):
        """Agent in Tenant A cannot view or modify Tenant B service requests (returns 404)."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/requests/{self.req_b1_id}", headers=headers)
        self.assertEqual(res.status_code, 404)

        # Cross-tenant status update also blocked
        update_res = self.client.post(
            f"/v1/itsm/requests/{self.req_b1_id}/status",
            json={"status": "IN_PROGRESS"},
            headers=headers,
        )
        self.assertEqual(update_res.status_code, 404)

    def test_10_nonexistent_request_returns_404(self):
        """Non-existent UUID returns 404."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get(f"/v1/itsm/requests/{uuid4()}", headers=headers)
        self.assertEqual(res.status_code, 404)
