"""Comprehensive tests for ITSM incident notifications.

Covers:
1. Event 1: Requester creates incident -> Incident Manager receives notification; Service Agents do not.
2. Event 2: Incident assigned to a Team -> Members of assigned team receive notification; other teams do not.
3. Event 3: Incident assigned directly to an Agent -> Assigned agent receives notification; unrelated agents do not.
4. Event 4 & Duplicate Prevention: Incident assigned to Team + Agent simultaneously -> Agent receives 1 direct notification, team peers receive team notification, no duplicate for agent.
5. Reassignment: Reassignment to new team/agent notifies new assignees and does not notify old or unrelated users; repeated assignment with no changes emits 0 notifications.
6. Tenant Isolation: Users from another tenant receive zero notifications.
7. Notification read / unread / mark-all-read behavior.
8. Security: Backend calculates recipients; cross-tenant or unauthorized access prevented.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class TestITSMIncidentNotifications(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.engine = create_engine(db_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        cls.tenant_a_id = uuid4()
        cls.tenant_b_id = uuid4()

        cls.im_user_id = uuid4()
        cls.im_key = f"ak_live_im_{uuid4().hex[:12]}"

        cls.requester_user_id = uuid4()
        cls.requester_key = f"ak_live_req_{uuid4().hex[:12]}"

        # Team A agents
        cls.agent_a1_user_id = uuid4()  # Rahul (Team A)
        cls.agent_a1_key = f"ak_live_a1_{uuid4().hex[:12]}"

        cls.agent_a2_user_id = uuid4()  # Amit (Team A)
        cls.agent_a2_key = f"ak_live_a2_{uuid4().hex[:12]}"

        # Team B agents
        cls.agent_b1_user_id = uuid4()  # Neha (Team B)
        cls.agent_b1_key = f"ak_live_b1_{uuid4().hex[:12]}"

        cls.agent_b2_user_id = uuid4()  # Raj (Team B)
        cls.agent_b2_key = f"ak_live_b2_{uuid4().hex[:12]}"

        # Tenant B agent
        cls.tenant_b_agent_id = uuid4()
        cls.tenant_b_agent_key = f"ak_live_tb_{uuid4().hex[:12]}"

        cls.team_a_id = uuid4()
        cls.team_b_id = uuid4()
        cls.tenant_b_team_id = uuid4()

        with cls.engine.begin() as conn:
            # Create Tenant A & Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a_id, "name": f"notify-tenant-a-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"notify-tenant-b-{uuid4().hex[:8]}"},
            )

            # Helper to create user + itsm_user_access + api_key
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

            create_user(cls.im_user_id, cls.tenant_a_id, f"im-{uuid4().hex[:8]}@example.com", "admin", "INCIDENT_MANAGER", cls.im_key)
            create_user(cls.requester_user_id, cls.tenant_a_id, f"req-{uuid4().hex[:8]}@example.com", "admin", "REQUESTER", cls.requester_key)
            create_user(cls.agent_a1_user_id, cls.tenant_a_id, f"rahul-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.agent_a1_key)
            create_user(cls.agent_a2_user_id, cls.tenant_a_id, f"amit-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.agent_a2_key)
            create_user(cls.agent_b1_user_id, cls.tenant_a_id, f"neha-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.agent_b1_key)
            create_user(cls.agent_b2_user_id, cls.tenant_a_id, f"raj-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.agent_b2_key)
            create_user(cls.tenant_b_agent_id, cls.tenant_b_id, f"tb-agent-{uuid4().hex[:8]}@example.com", "admin", "SERVICE_AGENT", cls.tenant_b_agent_key)

            # Create Teams in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'IT Support', 'Tier 1 & 2 support team', true, now(), now())"
                ),
                {"id": cls.team_a_id, "tenant_id": cls.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'DevOps Team', 'Infrastructure and cloud operations', true, now(), now())"
                ),
                {"id": cls.team_b_id, "tenant_id": cls.tenant_a_id},
            )

            # Create Team with same name 'IT Support' in Tenant B to test isolation
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'IT Support', 'Tenant B IT team', true, now(), now())"
                ),
                {"id": cls.tenant_b_team_id, "tenant_id": cls.tenant_b_id},
            )

            # Memberships in Tenant A
            # Team A: agent_a1 (Rahul), agent_a2 (Amit)
            for uid in [cls.agent_a1_user_id, cls.agent_a2_user_id]:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                    ),
                    {"tenant_id": cls.tenant_a_id, "team_id": cls.team_a_id, "user_id": uid},
                )

            # Team B: agent_b1 (Neha), agent_b2 (Raj)
            for uid in [cls.agent_b1_user_id, cls.agent_b2_user_id]:
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                    ),
                    {"tenant_id": cls.tenant_a_id, "team_id": cls.team_b_id, "user_id": uid},
                )

            # Tenant B Membership: tenant_b_agent in Tenant B IT Support
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_b_id, "team_id": cls.tenant_b_team_id, "user_id": cls.tenant_b_agent_id},
            )

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    @staticmethod
    def mutation_headers(headers, incident):
        return {**headers, "If-Match": str(incident["version"])}

    def _get_notifications(self, api_key: str) -> list[dict]:
        res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json().get("items", [])

    def test_01_event_1_new_incident_notifies_incident_manager(self):
        """Event 1: Requester creates a new incident.
        -> Incident Manager receives notification ('New incident {number} has been created').
        -> Service Agents do NOT receive notification.
        -> Requester receives confirmation notification.
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "VPN is not connecting",
                "description": "Cannot connect to company VPN from remote office",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        ticket_data = create_res.json()
        ticket_id = ticket_data["id"]
        ticket_number = ticket_data["ticket_number"]

        # Check Incident Manager notifications
        im_notifications = self._get_notifications(self.im_key)
        im_new_notif = next(
            (n for n in im_notifications if n["link"] == f"/itsm/incidents/{ticket_id}"),
            None,
        )
        self.assertIsNotNone(im_new_notif, "Incident Manager must receive notification for new incident")
        self.assertEqual(im_new_notif["title"], f"New incident {ticket_number} has been created")
        self.assertEqual(im_new_notif["body"], "VPN is not connecting")
        self.assertEqual(im_new_notif["link"], f"/itsm/incidents/{ticket_id}")
        self.assertEqual(im_new_notif["type"], "itsm.incident.created")

        # Service Agents must NOT receive notifications on new incident creation
        for agent_key, name in [
            (self.agent_a1_key, "Rahul"),
            (self.agent_a2_key, "Amit"),
            (self.agent_b1_key, "Neha"),
            (self.agent_b2_key, "Raj"),
        ]:
            agent_notifs = self._get_notifications(agent_key)
            leak = [n for n in agent_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
            self.assertEqual(
                len(leak),
                0,
                f"Service Agent {name} must NOT receive notification on new incident creation",
            )

        # Requester receives their ticket creation notification
        req_notifs = self._get_notifications(self.requester_key)
        req_notif = next(
            (n for n in req_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"),
            None,
        )
        self.assertIsNotNone(req_notif, "Requester must receive confirmation notification")
        self.assertIn(ticket_number, req_notif["title"])

    def test_02_event_2_team_assignment_notifies_team_members_only(self):
        """Event 2: Incident Manager assigns incident to Team A ('IT Support').
        -> Team A members (Rahul, Amit) receive notification.
        -> Team B members (Neha, Raj) do NOT receive notification.
        """
        # Create incident
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Printer offline in Floor 2",
                "description": "Needs hardware/network check",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]
        ticket_number = incident["ticket_number"]

        # Assign to Team A ('IT Support')
        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assign_res = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignment_group": "IT Support"},
        )
        self.assertEqual(assign_res.status_code, 200, assign_res.text)

        # Team A members must receive notification
        for agent_key, name in [(self.agent_a1_key, "Rahul"), (self.agent_a2_key, "Amit")]:
            agent_notifs = self._get_notifications(agent_key)
            found = next((n for n in agent_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"), None)
            self.assertIsNotNone(found, f"Team A member {name} must receive team assignment notification")
            self.assertEqual(found["title"], f"Incident {ticket_number} assigned to your team IT Support")
            self.assertEqual(found["body"], "Printer offline in Floor 2")

        # Team B members must NOT receive notification
        for agent_key, name in [(self.agent_b1_key, "Neha"), (self.agent_b2_key, "Raj")]:
            agent_notifs = self._get_notifications(agent_key)
            leak = [n for n in agent_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
            self.assertEqual(len(leak), 0, f"Unrelated team member {name} must NOT receive notification")

    def test_03_event_3_direct_agent_assignment_notifies_agent_only(self):
        """Event 3: Incident Manager assigns incident directly to a specific agent (Rahul).
        -> Rahul receives direct assignment notification.
        -> Other agents do NOT receive notification.
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Laptop keyboard broken",
                "description": "Specific agent repair needed",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]
        ticket_number = incident["ticket_number"]

        # Assign directly to Rahul (no team change)
        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assign_res = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignee_id": str(self.agent_a1_user_id)},
        )
        self.assertEqual(assign_res.status_code, 200, assign_res.text)

        # Rahul receives notification
        rahul_notifs = self._get_notifications(self.agent_a1_key)
        rahul_notif = next((n for n in rahul_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"), None)
        self.assertIsNotNone(rahul_notif, "Assigned agent Rahul must receive notification")
        self.assertEqual(rahul_notif["title"], f"Incident {ticket_number} has been assigned to you")
        self.assertEqual(rahul_notif["body"], "Laptop keyboard broken")

        # Other agents (Amit, Neha, Raj) must NOT receive notification
        for agent_key, name in [
            (self.agent_a2_key, "Amit"),
            (self.agent_b1_key, "Neha"),
            (self.agent_b2_key, "Raj"),
        ]:
            agent_notifs = self._get_notifications(agent_key)
            leak = [n for n in agent_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
            self.assertEqual(len(leak), 0, f"Unassigned agent {name} must NOT receive notification")

    def test_04_duplicate_prevention_team_and_agent_assigned_together(self):
        """Duplicate Protection:
        Assign Team = 'IT Support' AND Agent = Rahul (who is a member of IT Support).
        -> Rahul receives EXACTLY ONE notification ('Incident ... has been assigned to you').
        -> Rahul does NOT receive a duplicate team notification.
        -> Amit (other member of IT Support) receives team notification ('Incident ... assigned to your team IT Support').
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Email server sync failure",
                "description": "Both team and lead assigned",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]
        ticket_number = incident["ticket_number"]

        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assign_res = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignment_group": "IT Support", "assignee_id": str(self.agent_a1_user_id)},
        )
        self.assertEqual(assign_res.status_code, 200, assign_res.text)

        # Rahul must receive EXACTLY ONE notification for this incident
        rahul_notifs = self._get_notifications(self.agent_a1_key)
        rahul_matches = [n for n in rahul_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(
            len(rahul_matches),
            1,
            f"Rahul must receive exactly 1 notification, but got {len(rahul_matches)}: {rahul_matches}",
        )
        self.assertEqual(rahul_matches[0]["title"], f"Incident {ticket_number} has been assigned to you")

        # Amit (team peer) must receive team notification
        amit_notifs = self._get_notifications(self.agent_a2_key)
        amit_matches = [n for n in amit_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(len(amit_matches), 1, "Amit must receive team notification")
        self.assertEqual(amit_matches[0]["title"], f"Incident {ticket_number} assigned to your team IT Support")

    def test_05_event_4_reassignment_notifies_new_assignees_only(self):
        """Event 4: Reassignment:
        Incident originally assigned to Team A (IT Support) and Rahul.
        Reassign to Team B (DevOps Team) and Neha (agent_b1).
        -> Neha receives direct assignment notification.
        -> Raj (team peer in Team B) receives team assignment notification.
        -> Rahul and Amit (Team A) do NOT receive any new notifications.
        -> Calling assign again with the exact same values emits ZERO notifications.
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Cloud database latency spike",
                "description": "Database latency issue",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]
        ticket_number = incident["ticket_number"]

        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        # Initial assignment: Team A + Rahul
        initial_assignment = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignment_group": "IT Support", "assignee_id": str(self.agent_a1_user_id)},
        )
        self.assertEqual(initial_assignment.status_code, 200, initial_assignment.text)

        # Baseline notification counts for Team A
        rahul_before = len([n for n in self._get_notifications(self.agent_a1_key) if n["link"] == f"/itsm/incidents/{ticket_id}"])
        amit_before = len([n for n in self._get_notifications(self.agent_a2_key) if n["link"] == f"/itsm/incidents/{ticket_id}"])

        # Reassign to Team B ('DevOps Team') and Neha
        reassign_res = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, initial_assignment.json()),
            json={"assignment_group": "DevOps Team", "assignee_id": str(self.agent_b1_user_id)},
        )
        self.assertEqual(reassign_res.status_code, 200, reassign_res.text)

        # Neha receives direct assignment notification
        neha_notifs = [n for n in self._get_notifications(self.agent_b1_key) if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(len(neha_notifs), 1)
        self.assertEqual(neha_notifs[0]["title"], f"Incident {ticket_number} has been assigned to you")

        # Raj (Team B peer) receives team assignment notification
        raj_notifs = [n for n in self._get_notifications(self.agent_b2_key) if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(len(raj_notifs), 1)
        self.assertEqual(raj_notifs[0]["title"], f"Incident {ticket_number} assigned to your team DevOps Team")

        # Rahul and Amit receive NO additional notifications
        rahul_after = len([n for n in self._get_notifications(self.agent_a1_key) if n["link"] == f"/itsm/incidents/{ticket_id}"])
        amit_after = len([n for n in self._get_notifications(self.agent_a2_key) if n["link"] == f"/itsm/incidents/{ticket_id}"])
        self.assertEqual(rahul_before, rahul_after, "Old assignee Rahul must not receive new assignment notification")
        self.assertEqual(amit_before, amit_after, "Old team member Amit must not receive new assignment notification")

        # Repeated assignment with identical values must emit NO new notifications
        neha_count_before = len(self._get_notifications(self.agent_b1_key))
        raj_count_before = len(self._get_notifications(self.agent_b2_key))

        repeat_res = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, reassign_res.json()),
            json={"assignment_group": "DevOps Team", "assignee_id": str(self.agent_b1_user_id)},
        )
        self.assertEqual(repeat_res.status_code, 200)

        neha_count_after = len(self._get_notifications(self.agent_b1_key))
        raj_count_after = len(self._get_notifications(self.agent_b2_key))
        self.assertEqual(neha_count_before, neha_count_after, "No duplicate notification when assignment is unchanged")
        self.assertEqual(raj_count_before, raj_count_after, "No duplicate notification when assignment is unchanged")

    def test_06_tenant_isolation_no_cross_tenant_notifications(self):
        """Tenant Isolation:
        When an incident is created and assigned in Tenant A,
        users in Tenant B must receive ZERO notifications.
        """
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Confidential Security Patching",
                "description": "Tenant A only issue",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]

        # Assign to 'IT Support' (which exists in both Tenant A and Tenant B)
        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assigned = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignment_group": "IT Support"},
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)

        # Tenant B agent queries their notifications -> MUST be completely empty of Tenant A items
        tb_notifs = self._get_notifications(self.tenant_b_agent_key)
        leak = [n for n in tb_notifs if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(len(leak), 0, "Tenant B agent must NEVER see notifications for Tenant A incidents")

    def test_07_notification_read_and_unread_flow(self):
        """Notification read flow:
        - List notifications shows correct unread_count
        - POST /{id}/read marks item as read and unread_count decrements
        - POST /read-all marks all unread as read
        """
        # Trigger notification for agent_a1 (Rahul)
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "VPN drops on WiFi",
                "description": "WiFi issue",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]

        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assigned = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignee_id": str(self.agent_a1_user_id)},
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)

        rahul_headers = {"Authorization": f"Bearer {self.agent_a1_key}"}
        res_list = self.client.get("/v1/notifications", headers=rahul_headers)
        self.assertEqual(res_list.status_code, 200)
        data = res_list.json()
        self.assertGreater(data["unread_count"], 0)

        target_notif = next(n for n in data["items"] if n["link"] == f"/itsm/incidents/{ticket_id}")
        notif_id = target_notif["id"]
        self.assertIsNone(target_notif["read_at"])

        # Mark single notification as read
        res_read = self.client.post(f"/v1/notifications/{notif_id}/read", headers=rahul_headers)
        self.assertEqual(res_read.status_code, 200)
        self.assertIsNotNone(res_read.json()["read_at"])

        # Verify unread count decreased
        res_list2 = self.client.get("/v1/notifications", headers=rahul_headers)
        self.assertEqual(res_list2.json()["unread_count"], data["unread_count"] - 1)

        # Mark all read
        res_all = self.client.post("/v1/notifications/read-all", headers=rahul_headers)
        self.assertEqual(res_all.status_code, 200)
        self.assertEqual(res_all.json()["unread_count"], 0)

    def test_08_security_unauthorized_user_cannot_access_others_notifications(self):
        """Security:
        A user cannot access another user's notifications or read another user's notification.
        """
        # Create notification for Rahul
        req_headers = {"Authorization": f"Bearer {self.requester_key}"}
        create_res = self.client.post(
            "/v1/itsm/incidents",
            headers=req_headers,
            json={
                "title": "Private Security Incident",
                "description": "Sensitive investigation",
                "urgency": "MEDIUM",
                "impact": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        incident = create_res.json()
        ticket_id = incident["id"]

        im_headers = {"Authorization": f"Bearer {self.im_key}"}
        assigned = self.client.post(
            f"/v1/itsm/incidents/{ticket_id}/assign",
            headers=self.mutation_headers(im_headers, incident),
            json={"assignee_id": str(self.agent_a1_user_id)},
        )
        self.assertEqual(assigned.status_code, 200, assigned.text)

        rahul_notifs = [n for n in self._get_notifications(self.agent_a1_key) if n["link"] == f"/itsm/incidents/{ticket_id}"]
        self.assertEqual(len(rahul_notifs), 1)
        notif_id = rahul_notifs[0]["id"]

        # Neha (different agent) attempts to mark Rahul's notification as read
        neha_headers = {"Authorization": f"Bearer {self.agent_b1_key}"}
        res_hack = self.client.post(f"/v1/notifications/{notif_id}/read", headers=neha_headers)
        # Should return 404 Not Found due to user isolation in _visible_notifications
        self.assertEqual(res_hack.status_code, 404)


if __name__ == "__main__":
    unittest.main()
