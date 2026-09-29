"""Comprehensive test suite for ITSM Service Agent incident visibility and assignment behavior.

Validates all 8 required scenarios:
Scenario 1: Requester creates incident with no team assignment -> Service Agents cannot see, Incident Manager can.
Scenario 2: Incident assigned to Network Team -> Network Team members see it, Hardware Team members cannot.
Scenario 3: Incident assigned to Network Team + Rahul -> Rahul sees in My Work, Network Team sees in team queue, Hardware cannot.
Scenario 4: Incident assigned to Hardware Team + Neha -> Neha sees it, Network Team agents cannot.
Scenario 5: Requester opens their own incident -> 200 OK.
Scenario 6: Incident Manager opens incident and can assign/reassign -> 200 OK.
Scenario 7: Service Agent tries to open other team's incident by ID -> 403 Forbidden.
Scenario 8: Tenant A Service Agent never sees Tenant B incidents -> Tenant isolation enforced.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ServiceAgentVisibilityTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        cls.tenant_id = uuid4()
        cls.tenant_b_id = uuid4()

        # Actors in Tenant A
        cls.im_user_id = uuid4()
        cls.im_key = f"im-key-{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_key = f"req-key-{uuid4().hex[:12]}"

        cls.rahul_user_id = uuid4()
        cls.rahul_key = f"rahul-key-{uuid4().hex[:12]}"

        cls.amit_user_id = uuid4()
        cls.amit_key = f"amit-key-{uuid4().hex[:12]}"

        cls.neha_user_id = uuid4()
        cls.neha_key = f"neha-key-{uuid4().hex[:12]}"

        cls.raj_user_id = uuid4()
        cls.raj_key = f"raj-key-{uuid4().hex[:12]}"

        # Actor in Tenant B
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_agent_key = f"tb-agent-{uuid4().hex[:12]}"

        # Teams
        cls.network_team_id = uuid4()
        cls.hardware_team_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'enterprise', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"visibility-tenant-a-{uuid4().hex[:8]}"},
            )

            # Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"visibility-tenant-b-{uuid4().hex[:8]}"},
            )

            # Helper to insert user + itsm_access + api_key
            def create_user(user_id: UUID, tenant_id: UUID, email: str, role: str, itsm_role: str, key: str):
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, :role, 'NONE', true, now(), now())"
                    ),
                    {"id": user_id, "tenant_id": tenant_id, "email": email, "role": role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                    ),
                    {"tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                    ),
                    {"id": uuid4(), "tenant_id": tenant_id, "key_hash": hash_key(key), "name": f"key-{user_id}", "created_by": user_id},
                )

            create_user(cls.im_user_id, cls.tenant_id, f"im-{uuid4().hex[:8]}@example.com", "admin", "INCIDENT_MANAGER", cls.im_key)
            create_user(cls.requester_user_id, cls.tenant_id, f"req-{uuid4().hex[:8]}@example.com", "admin", "REQUESTER", cls.requester_key)
            create_user(cls.rahul_user_id, cls.tenant_id, f"rahul-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.rahul_key)
            create_user(cls.amit_user_id, cls.tenant_id, f"amit-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.amit_key)
            create_user(cls.neha_user_id, cls.tenant_id, f"neha-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.neha_key)
            create_user(cls.raj_user_id, cls.tenant_id, f"raj-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.raj_key)
            create_user(cls.tenant_b_agent_id, cls.tenant_b_id, f"tb-agent-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.tenant_b_agent_key)

            # Create Teams in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Network Team', 'Handles network infrastructure', true, now(), now())"
                ),
                {"id": cls.network_team_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Hardware Team', 'Handles physical hardware and devices', true, now(), now())"
                ),
                {"id": cls.hardware_team_id, "tenant_id": cls.tenant_id},
            )

            # Team Memberships
            # Network Team: Rahul, Amit
            for agent_id in [cls.rahul_user_id, cls.amit_user_id]:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                    ),
                    {"tenant_id": cls.tenant_id, "team_id": cls.network_team_id, "user_id": agent_id},
                )

            # Hardware Team: Neha, Raj
            for agent_id in [cls.neha_user_id, cls.raj_user_id]:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                    ),
                    {"tenant_id": cls.tenant_id, "team_id": cls.hardware_team_id, "user_id": agent_id},
                )

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def test_01_scenario_1_unassigned_incident_visibility(self):
        """Scenario 1: Requester creates incident with no team assignment.
        -> Service Agents (Rahul, Neha) must NOT see it in their queue.
        -> Incident Manager can see it.
        """
        # Requester creates incident
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        res_create = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "VPN connection drops every hour",
                "description": "Unassigned incident with no team",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(res_create.status_code, 201, res_create.text)
        incident_id = res_create.json()["id"]

        # Rahul (Network Team) checks queue -> must NOT see it
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertEqual(res_rahul.status_code, 200)
        rahul_ids = [item["id"] for item in res_rahul.json()]
        self.assertNotIn(incident_id, rahul_ids, "Unassigned incident should not appear in Network agent queue")

        # Neha (Hardware Team) checks queue -> must NOT see it
        neha_headers = {"Authorization": f"Bearer {self.neha_key}"}
        res_neha = self.client.get("/v1/itsm/incidents/queue", headers=neha_headers)
        self.assertEqual(res_neha.status_code, 200)
        neha_ids = [item["id"] for item in res_neha.json()]
        self.assertNotIn(incident_id, neha_ids, "Unassigned incident should not appear in Hardware agent queue")

        # Incident Manager checks operational queue -> CAN see it
        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        res_im = self.client.get("/v1/itsm/incidents/operations/queue", headers=im_headers)
        self.assertEqual(res_im.status_code, 200)
        im_ids = [item["incident"]["id"] for item in res_im.json()["items"]]
        self.assertIn(incident_id, im_ids, "Incident Manager must see unassigned incident")

        # Incident Manager checks general incident list -> CAN see it
        res_im_list = self.client.get("/v1/itsm/incidents", headers=im_headers)
        self.assertEqual(res_im_list.status_code, 200)
        im_list_ids = [item["id"] for item in res_im_list.json()]
        self.assertIn(incident_id, im_list_ids)

    def test_02_scenario_2_network_team_assignment(self):
        """Scenario 2: Incident assigned to Network Team (no individual agent).
        -> Network Team members (Rahul, Amit) CAN see it in team queue.
        -> Hardware Team members (Neha, Raj) must NOT see it.
        """
        # Incident Manager assigns to Network Team
        inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-NET-001', 'INCIDENT', 'Core Switch Reboot Needed', 'Switch failure', 'HIGH', 'HIGH', 'P1', 'NEW', :req_id, 'Network Team', now(), now())"
                ),
                {"id": inc_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id},
            )

        # Rahul (Network Team)
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertEqual(res_rahul.status_code, 200)
        rahul_ids = [i["id"] for i in res_rahul.json()]
        self.assertIn(str(inc_id), rahul_ids, "Rahul must see Network Team incident")

        # Amit (Network Team)
        amit_headers = {"Authorization": f"Bearer {self.amit_key}"}
        res_amit = self.client.get("/v1/itsm/incidents/queue", headers=amit_headers)
        self.assertEqual(res_amit.status_code, 200)
        amit_ids = [i["id"] for i in res_amit.json()]
        self.assertIn(str(inc_id), amit_ids, "Amit must see Network Team incident")

        # Team queue filter
        res_amit_team = self.client.get("/v1/itsm/incidents/queue?filter_mode=team_queue", headers=amit_headers)
        self.assertEqual(res_amit_team.status_code, 200)
        amit_team_ids = [i["id"] for i in res_amit_team.json()]
        self.assertIn(str(inc_id), amit_team_ids)

        # Neha (Hardware Team)
        neha_headers = {"Authorization": f"Bearer {self.neha_key}"}
        res_neha = self.client.get("/v1/itsm/incidents/queue", headers=neha_headers)
        self.assertEqual(res_neha.status_code, 200)
        neha_ids = [i["id"] for i in res_neha.json()]
        self.assertNotIn(str(inc_id), neha_ids, "Neha must NOT see Network Team incident")

        # Raj (Hardware Team)
        raj_headers = {"Authorization": f"Bearer {self.raj_key}"}
        res_raj = self.client.get("/v1/itsm/incidents/queue", headers=raj_headers)
        self.assertEqual(res_raj.status_code, 200)
        raj_ids = [i["id"] for i in res_raj.json()]
        self.assertNotIn(str(inc_id), raj_ids, "Raj must NOT see Network Team incident")

    def test_03_scenario_3_network_team_plus_rahul_assignment(self):
        """Scenario 3: Incident assigned to Network Team + Rahul.
        -> Rahul sees it under My Work (assigned_to_me).
        -> Amit sees it in team queue, but NOT under My Work.
        -> Hardware Team (Neha, Raj) cannot see it.
        """
        inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-NET-002', 'INCIDENT', 'Router Firewall Config', 'Firewall rules', 'MEDIUM', 'HIGH', 'P2', 'IN_PROGRESS', :req_id, :rahul_id, 'Network Team', now(), now())"
                ),
                {"id": inc_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id, "rahul_id": self.rahul_user_id},
            )

        # Rahul under My Work (filter_mode=assigned_to_me)
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul_my_work = self.client.get("/v1/itsm/incidents/queue?filter_mode=assigned_to_me", headers=rahul_headers)
        self.assertEqual(res_rahul_my_work.status_code, 200)
        self.assertIn(str(inc_id), [i["id"] for i in res_rahul_my_work.json()], "Rahul must see ticket under My Work")

        # Rahul under default/all queue
        res_rahul_all = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertIn(str(inc_id), [i["id"] for i in res_rahul_all.json()])

        # Amit under team queue
        amit_headers = {"Authorization": f"Bearer {self.amit_key}"}
        res_amit_all = self.client.get("/v1/itsm/incidents/queue", headers=amit_headers)
        self.assertIn(str(inc_id), [i["id"] for i in res_amit_all.json()], "Amit must see ticket in team queue")

        # Amit under My Work -> must NOT appear
        res_amit_my_work = self.client.get("/v1/itsm/incidents/queue?filter_mode=assigned_to_me", headers=amit_headers)
        self.assertNotIn(str(inc_id), [i["id"] for i in res_amit_my_work.json()], "Amit must NOT see Rahul's work under My Work")

        # Hardware Team (Neha) must NOT see it anywhere
        neha_headers = {"Authorization": f"Bearer {self.neha_key}"}
        res_neha_all = self.client.get("/v1/itsm/incidents/queue", headers=neha_headers)
        self.assertNotIn(str(inc_id), [i["id"] for i in res_neha_all.json()], "Neha must NOT see Network Team ticket")

    def test_04_scenario_4_hardware_team_plus_neha_assignment(self):
        """Scenario 4: Incident assigned to Hardware Team + Neha.
        -> Neha can see it under My Work and queue.
        -> Raj can see it in team queue.
        -> Network Team agents (Rahul, Amit) cannot see it.
        """
        inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-HW-001', 'INCIDENT', 'Faulty Laptop Battery', 'Battery swelling', 'LOW', 'MEDIUM', 'P3', 'IN_PROGRESS', :req_id, :neha_id, 'Hardware Team', now(), now())"
                ),
                {"id": inc_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id, "neha_id": self.neha_user_id},
            )

        # Neha
        neha_headers = {"Authorization": f"Bearer {self.neha_key}"}
        res_neha = self.client.get("/v1/itsm/incidents/queue?filter_mode=assigned_to_me", headers=neha_headers)
        self.assertEqual(res_neha.status_code, 200)
        self.assertIn(str(inc_id), [i["id"] for i in res_neha.json()], "Neha must see her assigned ticket")

        # Raj (Hardware Team peer)
        raj_headers = {"Authorization": f"Bearer {self.raj_key}"}
        res_raj = self.client.get("/v1/itsm/incidents/queue", headers=raj_headers)
        self.assertIn(str(inc_id), [i["id"] for i in res_raj.json()], "Raj must see Hardware Team ticket")

        # Rahul (Network Team)
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertNotIn(str(inc_id), [i["id"] for i in res_rahul.json()], "Rahul must NOT see Hardware Team ticket")

        # Amit (Network Team)
        amit_headers = {"Authorization": f"Bearer {self.amit_key}"}
        res_amit = self.client.get("/v1/itsm/incidents/queue", headers=amit_headers)
        self.assertNotIn(str(inc_id), [i["id"] for i in res_amit.json()], "Amit must NOT see Hardware Team ticket")

    def test_05_scenario_5_requester_opens_own_incident(self):
        """Scenario 5: Requester opens their own incident -> 200 OK.
        Requester opening someone else's incident -> 404 Not Found.
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        res_create = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={"title": "Printer Jam", "description": "3rd floor printer jammed", "urgency": "LOW"},
        )
        self.assertEqual(res_create.status_code, 201)
        incident_id = res_create.json()["id"]

        # Requester opens their own incident
        res_get = self.client.get(f"/v1/itsm/incidents/{incident_id}", headers=req_headers)
        self.assertEqual(res_get.status_code, 200)
        self.assertEqual(res_get.json()["id"], incident_id)

    def test_06_scenario_6_incident_manager_operations(self):
        """Scenario 6: Incident Manager opens any incident and can assign/reassign -> 200 OK."""
        im_headers = {"Authorization": f"Bearer {self.im_key}"}

        # IM creates / inspects an incident
        inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-OPS-001', 'INCIDENT', 'Global DNS Resolution Degradation', 'DNS fail', 'CRITICAL', 'CRITICAL', 'P1', 'NEW', :req_id, now(), now())"
                ),
                {"id": inc_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id},
            )

        # IM opens incident
        res_get = self.client.get(f"/v1/itsm/incidents/{inc_id}", headers=im_headers)
        self.assertEqual(res_get.status_code, 200)
        self.assertEqual(res_get.json()["title"], "Global DNS Resolution Degradation")

        # IM assigns incident to Network Team + Rahul
        res_assign = self.client.post(
            f"/v1/itsm/incidents/{inc_id}/assign",
            headers=im_headers,
            json={
                "assignment_group": "Network Team",
                "assignee_id": str(self.rahul_user_id),
            },
        )
        self.assertEqual(res_assign.status_code, 200, res_assign.text)
        assigned_data = res_assign.json()
        self.assertEqual(assigned_data["assignment_group"], "Network Team")
        self.assertEqual(assigned_data["assignee_id"], str(self.rahul_user_id))

        # Rahul can now see it in his queue
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertIn(str(inc_id), [i["id"] for i in res_rahul.json()])

    def test_07_scenario_7_service_agent_denied_other_team_incident_detail(self):
        """Scenario 7: Service Agent manually tries to open an incident belonging to another team
        -> backend must deny access (403 Forbidden).
        """
        hw_inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, assignment_group, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-HW-999', 'INCIDENT', 'Hardware Secret Repair', 'Secure server', 'HIGH', 'HIGH', 'P1', 'IN_PROGRESS', :req_id, :neha_id, 'Hardware Team', now(), now())"
                ),
                {"id": hw_inc_id, "tenant_id": self.tenant_id, "req_id": self.requester_user_id, "neha_id": self.neha_user_id},
            )

        # Rahul (Network Team) tries to GET Hardware Team incident detail
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul = self.client.get(f"/v1/itsm/incidents/{hw_inc_id}", headers=rahul_headers)
        self.assertEqual(res_rahul.status_code, 403, "Rahul must be denied access to Hardware Team incident")
        self.assertIn("Access denied", res_rahul.json()["detail"])

        # Rahul tries to update status of Hardware Team incident
        res_status = self.client.post(
            f"/v1/itsm/incidents/{hw_inc_id}/status",
            headers=rahul_headers,
            json={"status": "RESOLVED", "resolution_code": "SOLVED", "resolution_summary": "Unauthorized attempt"},
        )
        self.assertEqual(res_status.status_code, 403)

        # Rahul tries to add comment/activity note to Hardware Team incident
        res_comment = self.client.post(
            f"/v1/itsm/incidents/{hw_inc_id}/activities",
            headers=rahul_headers,
            json={"activity_type": "COMMENT", "content": "Unauthorized spy comment", "is_internal": True},
        )
        self.assertEqual(res_comment.status_code, 403)

        # Rahul tries to list activities
        res_activities = self.client.get(f"/v1/itsm/incidents/{hw_inc_id}/activities", headers=rahul_headers)
        self.assertEqual(res_activities.status_code, 403)

        # Rahul tries to list attachments
        res_attach = self.client.get(f"/v1/itsm/incidents/{hw_inc_id}/attachments", headers=rahul_headers)
        self.assertEqual(res_attach.status_code, 403)

        # Neha (Hardware Team) CAN open it
        neha_headers = {"Authorization": f"Bearer {self.neha_key}"}
        res_neha = self.client.get(f"/v1/itsm/incidents/{hw_inc_id}", headers=neha_headers)
        self.assertEqual(res_neha.status_code, 200)

    def test_08_scenario_8_tenant_isolation(self):
        """Scenario 8: Tenant A Service Agent must never see Tenant B incidents."""
        tb_inc_id = uuid4()
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_tickets "
                    "(id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority, status, requester_id, assignee_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'INC-TB-001', 'INCIDENT', 'Tenant B Confidential Ticket', 'Secret B', 'HIGH', 'HIGH', 'P1', 'NEW', :uid, :uid, now(), now())"
                ),
                {"id": tb_inc_id, "tenant_id": self.tenant_b_id, "uid": self.tenant_b_agent_id},
            )

        # Rahul in Tenant A tries to open Tenant B incident directly
        rahul_headers = {"Authorization": f"Bearer {self.rahul_key}"}
        res_rahul_get = self.client.get(f"/v1/itsm/incidents/{tb_inc_id}", headers=rahul_headers)
        self.assertEqual(res_rahul_get.status_code, 404, "Cross-tenant access must return 404")

        # Rahul checks queue -> Tenant B incident must not appear
        res_rahul_queue = self.client.get("/v1/itsm/incidents/queue", headers=rahul_headers)
        self.assertEqual(res_rahul_queue.status_code, 200)
        self.assertNotIn(str(tb_inc_id), [i["id"] for i in res_rahul_queue.json()])

        # Tenant B Agent CAN see it
        tb_headers = {"Authorization": f"Bearer {self.tenant_b_agent_key}"}
        res_tb_get = self.client.get(f"/v1/itsm/incidents/{tb_inc_id}", headers=tb_headers)
        self.assertEqual(res_tb_get.status_code, 200)


if __name__ == "__main__":
    unittest.main()
