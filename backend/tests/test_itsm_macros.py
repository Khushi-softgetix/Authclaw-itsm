"""Comprehensive test suite for WKS-003 Productivity Macros & Response Templates."""

from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMProductivityMacrosTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "SERVICE_AGENT", user_id: UUID | None = None):
        tenant_id = uuid4()
        user_id = user_id or uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": tenant_id, "name": f"tenant-{suffix}-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": f"user-{suffix}-{uuid4().hex[:8]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access "
                    "(id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'test-key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "key_hash": key_hash,
                    "created_by": user_id,
                },
            )

        return tenant_id, user_id, api_key_str

    def add_user_to_tenant(self, tenant_id: UUID, suffix: str, itsm_role: str):
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'viewer', 'NONE', true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": f"user-{suffix}-{uuid4().hex[:8]}@example.com",
                },
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access "
                    "(id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                ),
                {"id": uuid4(), "tenant_id": tenant_id, "user_id": user_id, "itsm_role": itsm_role},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :key_hash, 'test-key', ARRAY['read', 'write'], true, :created_by, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "key_hash": key_hash,
                    "created_by": user_id,
                },
            )

        return user_id, api_key_str

    # 1. Agent sees available macros
    def test_01_agent_sees_available_macros(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("agent_macros", itsm_role="SERVICE_AGENT")
        headers = {"Authorization": f"Bearer {api_key}"}

        res = self.client.get("/v1/itsm/macros", headers=headers)
        self.assertEqual(res.status_code, 200)
        macros = res.json()
        self.assertGreaterEqual(len(macros), 1)

        names = [m["name"] for m in macros]
        self.assertIn("Laptop Troubleshooting", names)

        laptop_macro = next(m for m in macros if m["name"] == "Laptop Troubleshooting")
        self.assertEqual(laptop_macro["status_change"], "PENDING")
        self.assertEqual(laptop_macro["status_reason"], "Pending Requester")
        self.assertEqual(laptop_macro["follow_up_hours"], 24)
        self.assertIn("restart your laptop", laptop_macro["response_template"])
        self.assertTrue(laptop_macro["is_active"])

    # 2. Selecting a macro returns the correct predefined response
    def test_02_selecting_macro_response_template(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("macro_select", itsm_role="SERVICE_AGENT")
        headers = {"Authorization": f"Bearer {api_key}"}

        res = self.client.get("/v1/itsm/macros", headers=headers)
        self.assertEqual(res.status_code, 200)
        macros = res.json()
        laptop_macro = next(m for m in macros if m["name"] == "Laptop Troubleshooting")

        macro_res = self.client.get(f"/v1/itsm/macros/{laptop_macro['id']}", headers=headers)
        self.assertEqual(macro_res.status_code, 200)
        self.assertEqual(
            macro_res.json()["response_template"],
            "Please restart your laptop and clear your browser cache. If the issue continues, please reply to this request.",
        )

    # 3. Macro application updates ticket status and pauses SLA
    def test_03_macro_application_on_incident(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("macro_apply", itsm_role="SERVICE_AGENT")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Create incident
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Laptop running slowly", "description": "High CPU utilization"},
            headers=headers,
        )
        self.assertEqual(inc_res.status_code, 201)
        incident_id = inc_res.json()["id"]

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id WHERE id = :inc_id"),
                {"agent_id": user_id, "inc_id": incident_id},
            )

        # List macros
        m_list = self.client.get("/v1/itsm/macros?ticket_type=INCIDENT", headers=headers).json()
        laptop_macro = next(m for m in m_list if m["name"] == "Laptop Troubleshooting")

        # Apply macro
        apply_res = self.client.post(
            f"/v1/itsm/macros/{laptop_macro['id']}/apply",
            json={"ticket_id": incident_id, "ticket_type": "INCIDENT"},
            headers=headers,
        )
        self.assertEqual(apply_res.status_code, 200)
        apply_data = apply_res.json()
        self.assertTrue(apply_data["status_changed"])
        self.assertEqual(apply_data["new_status"], "PENDING")
        self.assertTrue(apply_data["reminder_created"])
        self.assertEqual(apply_data["follow_up_hours"], 24)

        # Verify incident status and reason in DB
        inc_check = self.client.get(f"/v1/itsm/incidents/{incident_id}", headers=headers).json()
        self.assertEqual(inc_check["status"], "PENDING")
        self.assertEqual(inc_check["status_reason"], "Pending Requester")

        # Verify activity note recorded on incident
        acts_res = self.client.get(f"/v1/itsm/incidents/{incident_id}/activities", headers=headers).json()
        macro_acts = [a for a in acts_res if "Laptop Troubleshooting" in (a.get("content") or "")]
        self.assertGreaterEqual(len(macro_acts), 1)

    # 4 & 5. Follow-up reminder is created and no duplicate is created
    def test_04_05_reminder_and_no_duplicates(self):
        tenant_id, user_id, api_key = self.create_fixture_tenant("macro_dups", itsm_role="SERVICE_AGENT")
        headers = {"Authorization": f"Bearer {api_key}"}

        # Create incident
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "Screen flicker", "description": "Flickering display"},
            headers=headers,
        )
        incident_id = inc_res.json()["id"]

        m_list = self.client.get("/v1/itsm/macros?ticket_type=INCIDENT", headers=headers).json()
        laptop_macro = next(m for m in m_list if m["name"] == "Laptop Troubleshooting")

        # First apply -> reminder created
        apply_1 = self.client.post(
            f"/v1/itsm/macros/{laptop_macro['id']}/apply",
            json={"ticket_id": incident_id, "ticket_type": "INCIDENT"},
            headers=headers,
        )
        self.assertEqual(apply_1.status_code, 200)
        self.assertTrue(apply_1.json()["reminder_created"])

        # Second apply -> duplicate prevented!
        apply_2 = self.client.post(
            f"/v1/itsm/macros/{laptop_macro['id']}/apply",
            json={"ticket_id": incident_id, "ticket_type": "INCIDENT"},
            headers=headers,
        )
        self.assertEqual(apply_2.status_code, 200)
        self.assertFalse(apply_2.json()["reminder_created"])

        # Check notifications endpoint
        notif_res = self.client.get("/v1/notifications", headers=headers).json()
        ticket_reminders = [
            n for n in notif_res["items"]
            if n["type"] == "macro_reminder" and incident_id in (n.get("link") or "")
        ]
        self.assertEqual(len(ticket_reminders), 1)
        self.assertIn("Follow-up Reminder", ticket_reminders[0]["title"])

    # 6. Macro works for Service Request
    def test_06_macro_works_for_service_request(self):
        tenant_id, agent_id, agent_key = self.create_fixture_tenant("req_macro", itsm_role="SERVICE_AGENT")
        requester_id, req_key = self.add_user_to_tenant(tenant_id, "req_usr", itsm_role="REQUESTER")

        # Requester creates service request
        req_res = self.client.post(
            "/v1/itsm/requests",
            json={"title": "Monitor arm request", "description": "Need dual monitor arm desk mount"},
            headers={"Authorization": f"Bearer {req_key}"},
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        agent_headers = {"Authorization": f"Bearer {agent_key}"}
        m_list = self.client.get("/v1/itsm/macros?ticket_type=SERVICE_REQUEST", headers=agent_headers).json()
        laptop_macro = next(m for m in m_list if m["name"] == "Laptop Troubleshooting")

        # Agent applies macro to Service Request
        apply_res = self.client.post(
            f"/v1/itsm/macros/{laptop_macro['id']}/apply",
            json={"ticket_id": request_id, "ticket_type": "SERVICE_REQUEST"},
            headers=agent_headers,
        )
        self.assertEqual(apply_res.status_code, 200)
        self.assertTrue(apply_res.json()["status_changed"])
        self.assertEqual(apply_res.json()["new_status"], "PENDING")

        # Verify request status in DB
        req_check = self.client.get(f"/v1/itsm/requests/{request_id}", headers=agent_headers).json()
        self.assertEqual(req_check["status"], "PENDING")

    # 7. Unauthorized users (Requester / Auditor) cannot access or execute macros
    def test_07_unauthorized_users_forbidden(self):
        tenant_id, agent_id, agent_key = self.create_fixture_tenant("unauth", itsm_role="SERVICE_AGENT")
        requester_id, req_key = self.add_user_to_tenant(tenant_id, "unauth_req", itsm_role="REQUESTER")
        auditor_id, aud_key = self.add_user_to_tenant(tenant_id, "unauth_aud", itsm_role="ITSM_AUDITOR")

        # 1. Requester cannot list macros
        res = self.client.get("/v1/itsm/macros", headers={"Authorization": f"Bearer {req_key}"})
        self.assertEqual(res.status_code, 403)

        # 2. Requester cannot apply macro
        m_list = self.client.get("/v1/itsm/macros", headers={"Authorization": f"Bearer {agent_key}"}).json()
        macro_id = m_list[0]["id"]
        res = self.client.post(
            f"/v1/itsm/macros/{macro_id}/apply",
            json={"ticket_id": str(uuid4()), "ticket_type": "INCIDENT"},
            headers={"Authorization": f"Bearer {req_key}"},
        )
        self.assertEqual(res.status_code, 403)

        # 3. Auditor cannot apply macro
        res = self.client.post(
            f"/v1/itsm/macros/{macro_id}/apply",
            json={"ticket_id": str(uuid4()), "ticket_type": "INCIDENT"},
            headers={"Authorization": f"Bearer {aud_key}"},
        )
        self.assertEqual(res.status_code, 403)

    # 8. Tenant isolation
    def test_08_tenant_isolation(self):
        tenant_a, user_a, key_a = self.create_fixture_tenant("ten_a", itsm_role="PLATFORM_ADMINISTRATOR")
        tenant_b, user_b, key_b = self.create_fixture_tenant("ten_b", itsm_role="SERVICE_AGENT")

        # Tenant A creates custom macro
        custom_res = self.client.post(
            "/v1/itsm/macros",
            json={
                "name": "Tenant A Secret Macro",
                "response_template": "Confidential procedure for Tenant A.",
                "applicable_ticket_type": "ALL",
                "status_change": "PENDING",
            },
            headers={"Authorization": f"Bearer {key_a}"},
        )
        self.assertEqual(custom_res.status_code, 201)
        macro_a_id = custom_res.json()["id"]

        # Tenant B lists macros: Tenant A custom macro must NOT be present
        res_b = self.client.get("/v1/itsm/macros", headers={"Authorization": f"Bearer {key_b}"})
        self.assertEqual(res_b.status_code, 200)
        macro_names_b = [m["name"] for m in res_b.json()]
        self.assertNotIn("Tenant A Secret Macro", macro_names_b)

        # Tenant B tries to get Tenant A macro directly -> 404
        direct_res = self.client.get(f"/v1/itsm/macros/{macro_a_id}", headers={"Authorization": f"Bearer {key_b}"})
        self.assertEqual(direct_res.status_code, 404)

    # 9. Platform Administrator CRUD and Deactivated Macro security
    def test_09_admin_crud_and_deactivated_macro(self):
        tenant_id, admin_id, admin_key = self.create_fixture_tenant("admin_crud", itsm_role="PLATFORM_ADMINISTRATOR")
        agent_id, agent_key = self.add_user_to_tenant(tenant_id, "agent_crud", itsm_role="SERVICE_AGENT")

        admin_headers = {"Authorization": f"Bearer {admin_key}"}
        agent_headers = {"Authorization": f"Bearer {agent_key}"}

        # 1. Admin creates custom macro
        create_res = self.client.post(
            "/v1/itsm/macros",
            json={
                "name": "Custom Cache Clearing",
                "description": "Clear DNS and proxy caches",
                "response_template": "Please run ipconfig /flushdns and restart.",
                "applicable_ticket_type": "INCIDENT",
                "status_change": "IN_PROGRESS",
                "follow_up_hours": 12,
                "is_active": True,
            },
            headers=admin_headers,
        )
        self.assertEqual(create_res.status_code, 201)
        macro_id = create_res.json()["id"]

        # 2. Agent can see active macro
        agent_m = self.client.get("/v1/itsm/macros?ticket_type=INCIDENT", headers=agent_headers).json()
        self.assertIn("Custom Cache Clearing", [m["name"] for m in agent_m])

        # 3. Admin deactivates macro
        deact_res = self.client.patch(
            f"/v1/itsm/macros/{macro_id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        self.assertEqual(deact_res.status_code, 200)
        self.assertFalse(deact_res.json()["is_active"])

        # 4. Deactivated macro must NOT be selectable by Service Agent
        agent_m2 = self.client.get("/v1/itsm/macros?ticket_type=INCIDENT", headers=agent_headers).json()
        self.assertNotIn("Custom Cache Clearing", [m["name"] for m in agent_m2])

        # 5. Service Agent cannot apply deactivated macro
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "DNS failure", "description": "Cannot resolve host"},
            headers=agent_headers,
        )
        incident_id = inc_res.json()["id"]
        apply_deact = self.client.post(
            f"/v1/itsm/macros/{macro_id}/apply",
            json={"ticket_id": incident_id, "ticket_type": "INCIDENT"},
            headers=agent_headers,
        )
        self.assertEqual(apply_deact.status_code, 400)
        self.assertIn("deactivated", apply_deact.json()["detail"].lower())

    # 10. Existing comment, notification, and ticket workflows still work normally
    def test_10_existing_comment_and_ticket_workflow(self):
        tenant_id, agent_id, agent_key = self.create_fixture_tenant("workflow", itsm_role="SERVICE_AGENT")
        requester_id, req_key = self.add_user_to_tenant(tenant_id, "wf_req", itsm_role="REQUESTER")

        agent_headers = {"Authorization": f"Bearer {agent_key}"}

        # Create incident
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            json={"title": "VPN disconnects", "description": "Drops every 10 mins"},
            headers=agent_headers,
        )
        incident_id = inc_res.json()["id"]

        # Simulate assignment of incident to the agent
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id WHERE id = :inc_id"),
                {"agent_id": agent_id, "inc_id": incident_id},
            )

        # Post standard public comment with edited text
        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            json={
                "content": "Please restart your laptop and try connecting to US-East gateway.",
                "activity_type": "COMMENT",
                "is_internal": False,
            },
            headers=agent_headers,
        )
        self.assertEqual(comment_res.status_code, 201)
        comment_data = comment_res.json()
        self.assertEqual(comment_data["activity_type"], "COMMENT")
        self.assertIn("US-East gateway", comment_data["content"])
        self.assertFalse(comment_data["is_internal"])
