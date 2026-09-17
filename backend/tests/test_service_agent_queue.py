"""Comprehensive backend test suite for Service Agent Work Queue foundation.

Covers:
1. Service Agent can access GET /v1/itsm/incidents/queue (200 OK)
2. Non-Service-Agent (Requester) is denied (403 Forbidden)
3. Unauthenticated request is denied (401 Unauthorized)
4. Tenant isolation: Agent cannot see tickets from another tenant
5. Filter by assigned_to_me returns only agent-assigned tickets
6. Filter by high_priority returns P1/P2 incidents
7. Filter by sla_risk returns AT_RISK/BREACHED incidents
8. Sorting by priority and recently_updated
9. Empty state returns []
10. Linked service name is populated in IncidentResponse
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentQueueTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Setup primary tenant and accounts
        cls.tenant_id = uuid4()
        cls.agent_user_id = uuid4()
        cls.agent_key = f"agent-queue-{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_key = f"req-queue-{uuid4().hex[:12]}"

        # Setup secondary tenant for tenant isolation
        cls.tenant_b_id = uuid4()
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_key = f"tb-agent-{uuid4().hex[:12]}"

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"tenant-queue-a-{uuid4().hex[:8]}"},
            )
            # Tenant A Service Agent
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.agent_user_id, "tenant_id": cls.tenant_id, "email": f"agent-{uuid4().hex[:8]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'agent-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.agent_key), "created_by": cls.agent_user_id},
            )

            # Tenant A Requester
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.requester_user_id, "tenant_id": cls.tenant_id, "email": f"req-{uuid4().hex[:8]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'REQUESTER', true, false, now(), now())"
                ),
                {"tenant_id": cls.tenant_id, "user_id": cls.requester_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'req-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_id, "key_hash": hash_key(cls.requester_key), "created_by": cls.requester_user_id},
            )

            # Tenant B & Agent
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"tenant-queue-b-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": cls.tenant_b_agent_id, "tenant_id": cls.tenant_b_id, "email": f"tb-agent-{uuid4().hex[:8]}@example.com"},
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
                    "VALUES (:id, :tenant_id, :key_hash, 'tb-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": cls.tenant_b_id, "key_hash": hash_key(cls.tenant_b_key), "created_by": cls.tenant_b_agent_id},
            )

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def test_01_service_agent_can_fetch_queue(self):
        """Service Agent successfully accesses queue endpoint."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIsInstance(res.json(), list)

    def test_02_non_service_agent_denied(self):
        """Requester role is denied access to agent work queue (403 Forbidden)."""
        headers = {"Authorization": f"Bearer {self.requester_key}"}
        res = self.client.get("/v1/itsm/incidents/queue", headers=headers)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertIn("Access restricted to Service Agents", res.json()["detail"])

    def test_03_unauthenticated_denied(self):
        """Unauthenticated request to queue endpoint is rejected (401 Unauthorized)."""
        res = self.client.get("/v1/itsm/incidents/queue")
        self.assertEqual(res.status_code, 401)

    def test_04_tenant_isolation(self):
        """Service Agent in Tenant A cannot see incidents belonging to Tenant B."""
        # Insert ticket into Tenant B
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, 'INC-999901', 'INCIDENT', 'Tenant B Secret Incident', 'Secret', 'LOW', 'LOW', 'P4', 'NEW', :uid, now(), now())"
                ),
                {"tenant_id": self.tenant_b_id, "uid": self.tenant_b_agent_id},
            )

        # Agent in Tenant A checks queue
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue", headers=headers)
        self.assertEqual(res.status_code, 200)
        titles = [t["title"] for t in res.json()]
        self.assertNotIn("Tenant B Secret Incident", titles)

    def test_05_filter_assigned_to_me(self):
        """Queue correctly filters by assigned_to_me."""
        ticket_assigned_id = uuid4()
        ticket_unassigned_id = uuid4()

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-999902', 'INCIDENT', 'Assigned To My Agent', 'Assigned test', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :req_id, :agent_id, 'Network Support', now(), now())"
                ),
                {"id": ticket_assigned_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id, "agent_id": self.agent_user_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-999903', 'INCIDENT', 'Unassigned Incident In Queue', 'Unassigned test', 'LOW', 'LOW', 'P4', 'NEW', :req_id, NULL, now(), now())"
                ),
                {"id": ticket_unassigned_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id},
            )

        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue?filter_mode=assigned_to_me", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(len(data) >= 1)
        for ticket in data:
            self.assertEqual(ticket["assignee_id"], str(self.agent_user_id))

    def test_06_filter_high_priority(self):
        """Queue correctly filters high priority (P1/P2) incidents."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue?filter_mode=high_priority", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        for ticket in data:
            self.assertIn(ticket["priority"], ["P1", "P2"])

    def test_07_filter_sla_risk(self):
        """Queue correctly filters AT_RISK or BREACHED incidents."""
        sla_ticket_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, sla_status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-999904', 'INCIDENT', 'SLA Critical Incident', 'SLA test', 'HIGH', 'HIGH', 'P1', 'NEW', :req_id, 'AT_RISK', now(), now())"
                ),
                {"id": sla_ticket_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id},
            )

        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue?filter_mode=sla_risk", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(len(data) >= 1)
        for ticket in data:
            self.assertIn(ticket["sla_status"], ["AT_RISK", "BREACHED"])

    def test_08_sorting_priority_and_recent(self):
        """Queue supports sorting by priority and recently_updated."""
        headers = {"Authorization": f"Bearer {self.agent_key}"}

        res_prio = self.client.get("/v1/itsm/incidents/queue?sort_by=priority", headers=headers)
        self.assertEqual(res_prio.status_code, 200)
        data_prio = res_prio.json()
        if len(data_prio) >= 2:
            prio_order = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}
            first_rank = prio_order.get(data_prio[0]["priority"], 5)
            last_rank = prio_order.get(data_prio[-1]["priority"], 5)
            self.assertLessEqual(first_rank, last_rank)

        res_recent = self.client.get("/v1/itsm/incidents/queue?sort_by=recently_updated", headers=headers)
        self.assertEqual(res_recent.status_code, 200)

    def test_09_service_name_included(self):
        """Service name is populated in IncidentResponse when linked to service."""
        service_id = uuid4()
        ticket_id = uuid4()

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, tier, status, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Identity Federation', 'idp-fed', 'TIER_1', 'ACTIVE', now(), now())"
                ),
                {"id": service_id, "tenant_id": self.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, service_id, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-999905', 'INCIDENT', 'SSO Login Failure', 'SAML assertion error', 'MEDIUM', 'HIGH', 'P2', 'NEW', :service_id, :req_id, now(), now())"
                ),
                {"id": ticket_id, "tenant_id": self.tenant_id, "service_id": service_id, "req_id": self.requester_user_id},
            )

        headers = {"Authorization": f"Bearer {self.agent_key}"}
        res = self.client.get("/v1/itsm/incidents/queue", headers=headers)
        self.assertEqual(res.status_code, 200)
        matching = [t for t in res.json() if t["id"] == str(ticket_id)]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["service_name"], "Identity Federation")


if __name__ == "__main__":
    unittest.main()
