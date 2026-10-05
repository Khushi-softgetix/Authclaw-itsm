"""Unit and integration tests for Requester Notifications on Agent Public Comments.

Covers:
1. Requester creates Service Request; Service Agent posts Public Comment:
   - Requester receives exactly one in-app notification.
   - Title matches: "New reply on {ticket_number}".
   - Message matches: "Agent has replied to your service request '{title}'."
   - Link matches: "/itsm/requests/{request_id}".
2. Service Agent posts Internal Note on Service Request:
   - Requester receives ZERO notifications.
3. Requester posts comment on their own Service Request:
   - Requester does NOT receive a self-notification.
4. Requester creates Incident; Service Agent posts Public Comment:
   - Requester receives exactly one in-app notification.
   - Title matches: "New reply on {ticket_number}".
   - Message matches: "Agent has replied to your incident '{title}'."
   - Link matches: "/itsm/incidents/{incident_id}".
5. Service Agent posts Internal Note on Incident:
   - Requester receives ZERO notifications.
6. Requester posts comment on their own Incident:
   - Requester does NOT receive a self-notification.
7. Notification read/unread lifecycle:
   - Unread count increases upon new public comment notification.
   - Marking notification as read updates read_at and decreases unread_count.
8. Duplicate Prevention:
   - Rapid / retry submissions of the same comment create only one notification.
9. Security & User Isolation:
   - Other users in the same tenant cannot see or mark as read the requester's notification.
10. Cross-Tenant Isolation:
   - Users in another tenant receive ZERO notifications for activities in this tenant.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class TestITSMCommentNotifications(unittest.TestCase):
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

        cls.requester_a_id = uuid4()
        cls.requester_a_key = f"ak_live_req_a_{uuid4().hex[:12]}"

        cls.agent_a_id = uuid4()
        cls.agent_a_key = f"ak_live_agt_a_{uuid4().hex[:12]}"

        cls.other_agent_a_id = uuid4()
        cls.other_agent_a_key = f"ak_live_oagt_a_{uuid4().hex[:12]}"

        cls.requester_b_id = uuid4()
        cls.requester_b_key = f"ak_live_req_b_{uuid4().hex[:12]}"

        cls.agent_b_id = uuid4()
        cls.agent_b_key = f"ak_live_agt_b_{uuid4().hex[:12]}"

        cls.team_a_id = uuid4()
        cls.team_b_id = uuid4()
        cls.service_a_id = uuid4()
        cls.catalog_item_a_id = uuid4()

        with cls.engine.begin() as conn:
            # 1. Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a_id, "name": f"comment-test-a-{uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"comment-test-b-{uuid4().hex[:8]}"},
            )

            # Helper for user creation
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
                        "VALUES (:id, :tenant_id, :key_hash, :name, ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"
                    ),
                    {
                        "id": uuid4(),
                        "tenant_id": tenant_id,
                        "key_hash": hash_key(key),
                        "name": f"key-{user_id}",
                        "user_id": user_id,
                    },
                )

            # Tenant A users
            create_user(cls.requester_a_id, cls.tenant_a_id, f"req_a_{uuid4().hex[:6]}@example.com", "admin", "REQUESTER", cls.requester_a_key)
            create_user(cls.agent_a_id, cls.tenant_a_id, f"agt_a_{uuid4().hex[:6]}@example.com", "admin", "SERVICE_AGENT", cls.agent_a_key)
            create_user(cls.other_agent_a_id, cls.tenant_a_id, f"oagt_a_{uuid4().hex[:6]}@example.com", "admin", "SERVICE_AGENT", cls.other_agent_a_key)

            # Tenant B users
            create_user(cls.requester_b_id, cls.tenant_b_id, f"req_b_{uuid4().hex[:6]}@example.com", "admin", "REQUESTER", cls.requester_b_key)
            create_user(cls.agent_b_id, cls.tenant_b_id, f"agt_b_{uuid4().hex[:6]}@example.com", "admin", "SERVICE_AGENT", cls.agent_b_key)

            # Teams
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'IT Support', true, now(), now())"
                ),
                {"id": cls.team_a_id, "tenant_id": cls.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'IT Support', true, now(), now())"
                ),
                {"id": cls.team_b_id, "tenant_id": cls.tenant_b_id},
            )

            # Team memberships
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_a_id, "team_id": cls.team_a_id, "user_id": cls.agent_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_a_id, "team_id": cls.team_a_id, "user_id": cls.other_agent_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_b_id, "team_id": cls.team_b_id, "user_id": cls.agent_b_id},
            )

            # Services & Catalog Items
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Hardware Support', 'hw-support', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_a_id, "tenant_id": cls.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'PC requirement', 'pc-requirement', 1, '{\"type\": \"object\"}'::jsonb, true, now(), now())"
                ),
                {"id": cls.catalog_item_a_id, "tenant_id": cls.tenant_a_id, "service_id": cls.service_a_id},
            )

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def _get_notifications(self, api_key: str) -> list[dict]:
        res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {api_key}"})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json().get("items", [])

    def test_01_service_request_agent_public_comment_notifies_requester(self):
        """1. Requester creates Service Request; Service Agent posts Public Comment.
        Requester receives exactly 1 notification with correct title, body, and link.
        """
        # Requester creates request
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Need new laptop for developer onboarding",
                "impact": "MEDIUM",
                "urgency": "MEDIUM",
                "form_data": {"device": "Laptop"},
            },
        )
        self.assertEqual(req_res.status_code, 201, req_res.text)
        request_data = req_res.json()
        request_id = request_data["id"]
        ticket_number = request_data["ticket_number"]

        # Initial notification count for requester for this request
        initial_notifs = [
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ]
        initial_count = len(initial_notifs)

        # Service Agent posts Public Comment
        comment_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Hello, we have processed your PC requirement request.",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201, comment_res.text)

        # Requester notifications
        requester_notifs = self._get_notifications(self.requester_a_key)
        relevant_notifs = [
            n for n in requester_notifs
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]

        # Verify exactly one new notification
        self.assertEqual(len(relevant_notifs), initial_count + 1)
        new_notif = relevant_notifs[0]
        self.assertEqual(new_notif["title"], f"New reply on {ticket_number}")
        self.assertEqual(new_notif["body"], "Agent has replied to your service request 'PC requirement'.")
        self.assertEqual(new_notif["link"], f"/itsm/requests/{request_id}")
        self.assertEqual(new_notif["type"], "itsm.request.comment")
        self.assertEqual(new_notif["severity"], "info")
        self.assertIsNone(new_notif["read_at"])

    def test_02_service_request_agent_internal_note_does_not_notify_requester(self):
        """2. Service Agent posts Internal Note on Service Request.
        Requester must receive ZERO notifications.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Monitor Stand Request",
                "description": "Ergonomic equipment",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201, req_res.text)
        request_id = req_res.json()["id"]

        count_before = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        # Agent posts INTERNAL NOTE (is_internal=True)
        note_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "NOTE",
                "content": "Check warehouse inventory first before ordering.",
                "is_internal": True,
            },
        )
        self.assertEqual(note_res.status_code, 201, note_res.text)

        count_after = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])
        self.assertEqual(count_after, count_before, "Internal note must NOT notify requester")

    def test_03_service_request_requester_self_comment_does_not_self_notify(self):
        """3. Requester posts a comment on their own Service Request.
        Requester must NOT receive a notification for their own comment.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Keyboard Replacement",
                "description": "Sticky spacebar",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201, req_res.text)
        request_id = req_res.json()["id"]

        count_before = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        # Requester comments on their own ticket
        comment_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Any updates on this?",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201, comment_res.text)

        count_after = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])
        self.assertEqual(count_after, count_before, "Requester must NOT receive notification for their own comment")

    def test_04_incident_agent_public_comment_notifies_requester(self):
        """4. Requester creates Incident; Service Agent posts Public Comment.
        Requester receives exactly 1 notification with correct title, body, and link.
        """
        # Requester creates incident
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Email access error",
                "description": "Cannot connect to exchange server",
                "impact": "MEDIUM",
                "urgency": "MEDIUM",
            },
        )
        self.assertEqual(inc_res.status_code, 201, inc_res.text)
        inc_data = inc_res.json()
        incident_id = inc_data["id"]
        ticket_number = inc_data["ticket_number"]

        # Assign to IT Support team so agent has access to comment
        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignment_group = 'IT Support' WHERE id = :id"),
                {"id": incident_id},
            )

        # Initial comment notifications
        initial_notifs = [
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ]
        initial_count = len(initial_notifs)

        # Service Agent posts Public Comment
        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "We have investigated the exchange server issue and applied a fix.",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201, comment_res.text)

        # Requester notifications
        requester_notifs = self._get_notifications(self.requester_a_key)
        relevant_notifs = [
            n for n in requester_notifs
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ]

        self.assertEqual(len(relevant_notifs), initial_count + 1)
        new_notif = relevant_notifs[0]
        self.assertEqual(new_notif["title"], f"New reply on {ticket_number}")
        self.assertEqual(new_notif["body"], "Agent has replied to your incident 'Email access error'.")
        self.assertEqual(new_notif["link"], f"/itsm/incidents/{incident_id}")
        self.assertEqual(new_notif["type"], "itsm.incident.comment")
        self.assertEqual(new_notif["severity"], "info")

    def test_05_incident_agent_internal_note_does_not_notify_requester(self):
        """5. Service Agent posts Internal Note on Incident.
        Requester must receive ZERO notifications.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "VPN gateway timeout",
                "description": "Gateway 10.0.1.1 is unresponsive",
                "impact": "HIGH",
                "urgency": "HIGH",
            },
        )
        self.assertEqual(inc_res.status_code, 201, inc_res.text)
        incident_id = inc_res.json()["id"]

        # Assign to IT Support team so agent has access to post note
        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignment_group = 'IT Support' WHERE id = :id"),
                {"id": incident_id},
            )

        count_before = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ])

        # Agent posts Internal Note
        note_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "NOTE",
                "content": "Routing table may need flush on core router.",
                "is_internal": True,
            },
        )
        self.assertEqual(note_res.status_code, 201, note_res.text)

        count_after = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ])
        self.assertEqual(count_after, count_before, "Internal note on incident must NOT notify requester")

    def test_06_incident_requester_self_comment_does_not_self_notify(self):
        """6. Requester posts a comment on their own Incident.
        Requester must NOT receive a notification for their own comment.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Printer jam in lobby",
                "description": "Paper tray 2 is jammed",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(inc_res.status_code, 201, inc_res.text)
        incident_id = inc_res.json()["id"]

        count_before = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ])

        # Requester posts comment
        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "I tried restarting the printer but it still jams.",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201, comment_res.text)

        count_after = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ])
        self.assertEqual(count_after, count_before, "Requester must NOT receive notification for self-comment on incident")

    def test_07_notification_read_unread_count_lifecycle(self):
        """7. Notification read/unread flow:
        - Unread count increases on public comment.
        - Calling POST /v1/notifications/{id}/read marks it read and decrements unread_count.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Headset Request",
                "description": "Noise cancelling headset",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # Check initial unread count
        initial_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.requester_a_key}"})
        self.assertEqual(initial_res.status_code, 200)
        initial_unread = initial_res.json()["unread_count"]

        # Agent posts comment
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Your headset has been dispatched.",
                "is_internal": False,
            },
        )

        # Check unread count increased
        updated_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.requester_a_key}"})
        self.assertEqual(updated_res.status_code, 200)
        updated_data = updated_res.json()
        self.assertEqual(updated_data["unread_count"], initial_unread + 1)

        # Find the notification
        target_notif = next(
            n for n in updated_data["items"]
            if n["link"] == f"/itsm/requests/{request_id}" and n["read_at"] is None
        )
        notif_id = target_notif["id"]

        # Mark notification as read
        read_res = self.client.post(
            f"/v1/notifications/{notif_id}/read",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(read_res.status_code, 200)
        self.assertIsNotNone(read_res.json()["read_at"])

        # Check unread count decreased back
        final_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.requester_a_key}"})
        self.assertEqual(final_res.status_code, 200)
        self.assertEqual(final_res.json()["unread_count"], initial_unread)

    def test_08_duplicate_prevention_on_rapid_comment_retries(self):
        """8. Duplicate prevention:
        If an agent's public comment is retried within 5 seconds,
        only exactly ONE notification is created for the requester.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Software License Request",
                "description": "Figma license",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # Post first comment
        res1 = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "License has been requested from procurement.",
                "is_internal": False,
            },
        )
        self.assertEqual(res1.status_code, 201)

        # Immediate retry with same content (simulating rapid network retry or button double-click)
        res2 = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "License has been requested from procurement.",
                "is_internal": False,
            },
        )
        self.assertEqual(res2.status_code, 201)

        # Count notifications for this request
        requester_notifs = [
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]
        self.assertEqual(
            len(requester_notifs),
            1,
            f"Expected exactly 1 notification due to deduplication, but got {len(requester_notifs)}",
        )

    def test_09_security_another_user_cannot_access_requester_notification(self):
        """9. Security & User Isolation:
        Another agent or user in the same tenant cannot see or read the requester's notification.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Confidential Hardware Request",
                "description": "Executive laptop",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # Agent posts comment
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Your executive laptop is configured.",
                "is_internal": False,
            },
        )

        requester_notifs = [
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ]
        self.assertEqual(len(requester_notifs), 1)
        notif_id = requester_notifs[0]["id"]

        # Other agent in same tenant queries notifications
        other_agent_notifs = self._get_notifications(self.other_agent_a_key)
        leak = [n for n in other_agent_notifs if n["id"] == notif_id]
        self.assertEqual(len(leak), 0, "Other user must NOT see requester notification")

        # Other agent attempts to mark requester's notification as read
        hack_res = self.client.post(
            f"/v1/notifications/{notif_id}/read",
            headers={"Authorization": f"Bearer {self.other_agent_a_key}"},
        )
        self.assertEqual(hack_res.status_code, 404, "Other user must not be able to mark requester notification as read")

    def test_10_cross_tenant_isolation_enforced(self):
        """10. Cross-Tenant Isolation:
        Users in Tenant B must receive ZERO notifications when comments are posted in Tenant A.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Tenant A Secret Workstation",
                "description": "Restricted lab machine",
                "impact": "HIGH",
                "urgency": "HIGH",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # Agent A posts comment
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Secret workstation ready.",
                "is_internal": False,
            },
        )

        # Tenant B Requester checks notifications
        tb_req_notifs = self._get_notifications(self.requester_b_key)
        leak_req = [n for n in tb_req_notifs if n["link"] == f"/itsm/requests/{request_id}"]
        self.assertEqual(len(leak_req), 0, "Tenant B requester must receive 0 notifications for Tenant A")

        # Tenant B Agent checks notifications
        tb_agent_notifs = self._get_notifications(self.agent_b_key)
        leak_agt = [n for n in tb_agent_notifs if n["link"] == f"/itsm/requests/{request_id}"]
        self.assertEqual(len(leak_agt), 0, "Tenant B agent must receive 0 notifications for Tenant A")

    def test_11_service_request_requester_public_comment_notifies_assigned_agent(self):
        """11. Requester posts Public Comment on assigned Service Request.
        Assigned Service Agent receives exactly one notification with:
        - Title: "New message on request: {ticket_number}"
        - Message: "Requester has sent a new message on your service request."
        - Link: "/itsm/requests/{request_id}"
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Dual Monitor Setup",
                "description": "Need second monitor for code review",
                "impact": "MEDIUM",
                "urgency": "MEDIUM",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        req_data = req_res.json()
        request_id = req_data["id"]
        ticket_number = req_data["ticket_number"]

        # Assign ticket to Agent A
        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id, status = 'ASSIGNED' WHERE id = :id"),
                {"agent_id": self.agent_a_id, "id": request_id},
            )

        # Baseline count of Agent A notifications for this request
        initial_notifs = [
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]
        initial_count = len(initial_notifs)

        # Requester posts Public Comment
        comment_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Can I get a 27-inch model if available?",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201)

        # Assigned Agent checks notifications
        agent_notifs = self._get_notifications(self.agent_a_key)
        relevant_notifs = [
            n for n in agent_notifs
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]

        self.assertEqual(len(relevant_notifs), initial_count + 1)
        new_notif = relevant_notifs[0]
        self.assertEqual(new_notif["title"], f"New message on request: {ticket_number}")
        self.assertEqual(new_notif["body"], "Requester has sent a new message on your service request.")
        self.assertEqual(new_notif["link"], f"/itsm/requests/{request_id}")
        self.assertEqual(new_notif["type"], "itsm.request.comment")
        self.assertEqual(new_notif["severity"], "info")
        self.assertIsNone(new_notif["read_at"])

    def test_12_service_request_requester_comment_unassigned_does_not_notify(self):
        """12. Unassigned Service Request:
        When requester comments on an unassigned ticket, no notification is created.
        No recipient is invented.
        """
        unassigned_svc_id = uuid4()
        unassigned_cat_id = uuid4()

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Unassigned Null Svc', 'unassigned-null-svc', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": unassigned_svc_id, "tenant_id": self.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Orphan Item', 'orphan-item', 1, '{\"type\": \"object\"}'::jsonb, true, now(), now())"
                ),
                {"id": unassigned_cat_id, "tenant_id": self.tenant_a_id, "service_id": unassigned_svc_id},
            )

        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(unassigned_cat_id),
                "title": "Orphan Item",
                "description": "No one assigned yet",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        agent_notifs_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])
        other_agent_notifs_before = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        # Requester posts comment on unassigned request
        comment_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Is anyone reviewing this?",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201)

        agent_notifs_after = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])
        other_agent_notifs_after = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        self.assertEqual(agent_notifs_after, agent_notifs_before, "No agent notification for unassigned request")
        self.assertEqual(other_agent_notifs_after, other_agent_notifs_before, "No other agent notification")

    def test_13_incident_requester_public_comment_notifies_assigned_agent(self):
        """13. Requester posts Public Comment on assigned Incident.
        Assigned Service Agent receives exactly one notification with:
        - Title: "New reply on {ticket_number}"
        - Message: "Requester has replied to your incident."
        - Link: "/itsm/incidents/{incident_id}"
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Database connection drop",
                "description": "App loses db connection every hour",
                "impact": "HIGH",
                "urgency": "HIGH",
            },
        )
        self.assertEqual(inc_res.status_code, 201)
        inc_data = inc_res.json()
        incident_id = inc_data["id"]
        ticket_number = inc_data["ticket_number"]

        # Assign to Agent A and IT Support team
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE public.itsm_tickets "
                    "SET assignee_id = :agent_id, assignment_group = 'IT Support', status = 'ASSIGNED' "
                    "WHERE id = :id"
                ),
                {"agent_id": self.agent_a_id, "id": incident_id},
            )

        initial_notifs = [
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ]
        initial_count = len(initial_notifs)

        # Requester posts Public Comment
        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Happened again at 3:15 PM, attached logs show timeout.",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201)

        # Assigned Agent checks notifications
        agent_notifs = self._get_notifications(self.agent_a_key)
        relevant_notifs = [
            n for n in agent_notifs
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["type"] == "itsm.incident.comment"
        ]

        self.assertEqual(len(relevant_notifs), initial_count + 1)
        new_notif = relevant_notifs[0]
        self.assertEqual(new_notif["title"], f"New reply on {ticket_number}")
        self.assertEqual(new_notif["body"], "Requester has replied to your incident.")
        self.assertEqual(new_notif["link"], f"/itsm/incidents/{incident_id}")
        self.assertEqual(new_notif["type"], "itsm.incident.comment")
        self.assertEqual(new_notif["severity"], "info")
        self.assertIsNone(new_notif["read_at"])

    def test_14_incident_requester_comment_unassigned_does_not_notify(self):
        """14. Unassigned Incident:
        When requester comments on an unassigned incident, no notification is created.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Unassigned Incident Test",
                "description": "Pending triage",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(inc_res.status_code, 201)
        incident_id = inc_res.json()["id"]

        agent_notifs_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])

        comment_res = self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Any updates on triage?",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201)

        agent_notifs_after = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])
        self.assertEqual(agent_notifs_after, agent_notifs_before, "No agent notification on unassigned incident")

    def test_15_team_and_agent_assignment_only_notifies_assigned_individual_agent(self):
        """15. Ticket is assigned to support team AND individual agent:
        Only the assigned individual Service Agent is notified.
        Other Service Agents in the team / tenant do NOT receive the notification.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Team assignment notification scope test",
                "description": "Verifying individual agent notification exclusivity",
                "impact": "MEDIUM",
                "urgency": "MEDIUM",
            },
        )
        self.assertEqual(inc_res.status_code, 201)
        incident_id = inc_res.json()["id"]

        # Assign to IT Support team and Agent A
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE public.itsm_tickets "
                    "SET assignee_id = :agent_id, assignment_group = 'IT Support', status = 'ASSIGNED' "
                    "WHERE id = :id"
                ),
                {"agent_id": self.agent_a_id, "id": incident_id},
            )

        agent_a_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])
        other_agent_before = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])

        # Requester posts comment
        self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Update for the assigned engineer only.",
                "is_internal": False,
            },
        )

        agent_a_after = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])
        other_agent_after = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/incidents/{incident_id}"
        ])

        self.assertEqual(agent_a_after, agent_a_before + 1, "Assigned individual agent MUST be notified")
        self.assertEqual(other_agent_after, other_agent_before, "Unassigned team member must NOT be notified")

    def test_16_agent_comment_does_not_self_notify_assigned_agent(self):
        """16. Assigned Agent comments on ticket:
        Agent does NOT receive a self-notification.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "VPN Token Request",
                "description": "Hardware token",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id, status = 'ASSIGNED' WHERE id = :id"),
                {"agent_id": self.agent_a_id, "id": request_id},
            )

        agent_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        # Agent comments on the ticket
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Token is being provisioned.",
                "is_internal": False,
            },
        )

        agent_after = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])
        self.assertEqual(agent_after, agent_before, "Agent must not receive self-notification")

    def test_17_duplicate_prevention_on_rapid_requester_comment_retries(self):
        """17. Duplicate prevention on rapid Requester comments:
        If a requester public comment is submitted twice rapidly (within 5s),
        assigned agent receives exactly ONE notification.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "Ergonomic Chair",
                "description": "Chair request",
                "impact": "LOW",
                "urgency": "LOW",
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id, status = 'ASSIGNED' WHERE id = :id"),
                {"agent_id": self.agent_a_id, "id": request_id},
            )

        # Requester sends first comment
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Please deliver to 3rd floor.",
                "is_internal": False,
            },
        )

        # Immediate rapid retry
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Please deliver to 3rd floor.",
                "is_internal": False,
            },
        )

        agent_notifs = [
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]
        self.assertEqual(len(agent_notifs), 1, "Expected exactly 1 notification due to deduplication")

    def test_18_agent_notification_read_unread_lifecycle(self):
        """18. Agent notification lifecycle:
        - Unread count increments when requester replies.
        - Calling read endpoint marks notification read and decrements unread count.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Firewall block on port 443",
                "description": "SSL handshake blocked",
                "impact": "HIGH",
                "urgency": "HIGH",
            },
        )
        self.assertEqual(inc_res.status_code, 201)
        incident_id = inc_res.json()["id"]

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE public.itsm_tickets "
                    "SET assignee_id = :agent_id, assignment_group = 'IT Support', status = 'ASSIGNED' "
                    "WHERE id = :id"
                ),
                {"agent_id": self.agent_a_id, "id": incident_id},
            )

        # Get initial unread count for Agent A
        init_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(init_res.status_code, 200)
        initial_unread = init_res.json()["unread_count"]

        # Requester replies
        self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Destination IP is 198.51.100.2.",
                "is_internal": False,
            },
        )

        # Check unread count incremented
        updated_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(updated_res.status_code, 200)
        self.assertEqual(updated_res.json()["unread_count"], initial_unread + 1)

        # Mark as read
        notif = next(
            n for n in updated_res.json()["items"]
            if n["link"] == f"/itsm/incidents/{incident_id}" and n["read_at"] is None
        )
        read_res = self.client.post(
            f"/v1/notifications/{notif['id']}/read",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
        )
        self.assertEqual(read_res.status_code, 200)
        self.assertIsNotNone(read_res.json()["read_at"])

        # Check unread count decremented back
        final_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(final_res.status_code, 200)
        self.assertEqual(final_res.json()["unread_count"], initial_unread)

    def test_19_cross_tenant_isolation_requester_comment(self):
        """19. Cross-Tenant Isolation:
        Requester in Tenant A comments on an assigned incident.
        Agent in Tenant B receives ZERO notifications.
        """
        inc_res = self.client.post(
            "/v1/itsm/incidents",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "title": "Tenant A Secret Incident",
                "description": "Confidential",
                "impact": "HIGH",
                "urgency": "HIGH",
            },
        )
        self.assertEqual(inc_res.status_code, 201)
        incident_id = inc_res.json()["id"]

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE public.itsm_tickets "
                    "SET assignee_id = :agent_id, assignment_group = 'IT Support', status = 'ASSIGNED' "
                    "WHERE id = :id"
                ),
                {"agent_id": self.agent_a_id, "id": incident_id},
            )

        # Requester A comments
        self.client.post(
            f"/v1/itsm/incidents/{incident_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Critical secret incident update.",
                "is_internal": False,
            },
        )

        # Tenant B Agent checks notifications
        tb_agent_notifs = self._get_notifications(self.agent_b_key)
        leak = [n for n in tb_agent_notifs if n["link"] == f"/itsm/incidents/{incident_id}"]
        self.assertEqual(len(leak), 0, "Tenant B Agent must receive ZERO notifications for Tenant A")

    def test_20_service_catalog_request_notifies_responsible_agent(self):
        """20. Requester creates Service Catalog request for 'PC requirement' (Quantity: 10).
        Responsible Service Agent receives in-app notification with:
        - Title: 'New service request: REQ-xxxxxx'
        - Message: "Requester has submitted a new service request for 'PC requirement' (Quantity: 10)."
        - Link: '/itsm/requests/{request_id}'
        - Unread count increases by 1.
        - Clicking / marking as read decrements unread count.
        """
        init_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(init_res.status_code, 200)
        initial_unread = init_res.json()["unread_count"]

        # Requester submits request
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Requesting 10 new developer workstations",
                "quantity": 10,
                "impact": "MEDIUM",
                "urgency": "MEDIUM",
            },
        )
        self.assertEqual(create_res.status_code, 201, create_res.text)
        created_data = create_res.json()
        request_id = created_data["id"]
        ticket_number = created_data["ticket_number"]

        # Check Agent A notifications
        agent_notifs = self._get_notifications(self.agent_a_key)
        relevant = [
            n for n in agent_notifs
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.created"
        ]
        self.assertEqual(len(relevant), 1, "Agent A must receive exactly 1 service request creation notification")
        notif = relevant[0]
        self.assertEqual(notif["title"], f"New service request: {ticket_number}")
        self.assertEqual(
            notif["body"],
            "Requester has submitted a new service request for 'PC requirement' (Quantity: 10).",
        )
        self.assertEqual(notif["link"], f"/itsm/requests/{request_id}")
        self.assertEqual(notif["severity"], "info")
        self.assertIsNone(notif["read_at"])

        # Check unread count incremented
        updated_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(updated_res.json()["unread_count"], initial_unread + 1)

        # Mark notification as read
        read_res = self.client.post(
            f"/v1/notifications/{notif['id']}/read",
            headers={"Authorization": f"Bearer {self.agent_a_key}"},
        )
        self.assertEqual(read_res.status_code, 200)
        self.assertIsNotNone(read_res.json()["read_at"])

        # Check unread count decremented back
        final_res = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(final_res.json()["unread_count"], initial_unread)

    def test_21_service_catalog_request_does_not_notify_unrelated_agent_or_requester(self):
        """21. Requester creates Service Catalog request.
        - Requester does NOT receive self-notification.
        - Unrelated agent (in different team / not responsible) does NOT receive notification.
        """
        # Create an unrelated team and an unrelated agent in Tenant A
        unrelated_agent_id = uuid4()
        unrelated_team_id = uuid4()
        unrelated_key = f"ak_live_unrel_{uuid4().hex[:12]}"

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": unrelated_agent_id, "tenant_id": self.tenant_a_id, "email": f"unrelated_{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'AGENT', true, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": unrelated_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :key_hash, 'unrelated-key', ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": unrelated_agent_id, "key_hash": hash_key(unrelated_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Facilities Team', true, now(), now())"
                ),
                {"id": unrelated_team_id, "tenant_id": self.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": self.tenant_a_id, "team_id": unrelated_team_id, "user_id": unrelated_agent_id},
            )

        # Create request for PC requirement
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Workstation request",
                "quantity": 2,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # Requester must receive 0 notifications for their own creation
        req_notifs = [n for n in self._get_notifications(self.requester_a_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(req_notifs), 0, "Requester must not receive self-notification")

        # Unrelated agent must receive 0 notifications
        unrel_notifs = [n for n in self._get_notifications(unrelated_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(unrel_notifs), 0, "Unrelated agent must not receive service request notification")

    def test_22_service_catalog_request_direct_agent_assignment_notifies_assigned_agent_only(self):
        """22. When an individual agent is configured on the service/ticket,
        ONLY that individual agent is notified (not the entire tenant or other team members).
        """
        dedicated_agent_id = uuid4()
        dedicated_key = f"ak_live_ded_{uuid4().hex[:12]}"
        dedicated_service_id = uuid4()
        dedicated_catalog_id = uuid4()

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": dedicated_agent_id, "tenant_id": self.tenant_a_id, "email": f"dedicated_{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": dedicated_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :key_hash, 'ded-key', ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": dedicated_agent_id, "key_hash": hash_key(dedicated_key)},
            )
            # Service owned by dedicated agent with escalation team 'IT Support'
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, owner_user_id, escalation_team, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Dedicated VIP Service', 'vip-svc', 'ACTIVE', 'TIER_1', :owner_id, 'IT Support', now(), now())"
                ),
                {"id": dedicated_service_id, "tenant_id": self.tenant_a_id, "owner_id": dedicated_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'VIP Laptop', 'vip-laptop', 1, '{\"type\": \"object\"}'::jsonb, true, now(), now())"
                ),
                {"id": dedicated_catalog_id, "tenant_id": self.tenant_a_id, "service_id": dedicated_service_id},
            )

        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(dedicated_catalog_id),
                "title": "VIP Laptop",
                "description": "Executive request",
                "quantity": 1,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # Dedicated agent must receive notification
        ded_notifs = [n for n in self._get_notifications(dedicated_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(ded_notifs), 1, "Dedicated agent must receive exactly 1 notification")

        # Other team members must NOT be notified when individual agent is configured
        other_team_notifs = [n for n in self._get_notifications(self.other_agent_a_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(other_team_notifs), 0, "Team members must not be notified when individual agent is assigned")

    def test_23_service_catalog_request_unassigned_item_does_not_invent_recipient(self):
        """23. If catalog item has NO team or agent configured and no matching team in tenant,
        0 notifications are created (no invented recipient).
        """
        unassigned_svc_id = uuid4()
        unassigned_cat_id = uuid4()

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Unmanaged XYZ Service', 'unmanaged-xyz', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": unassigned_svc_id, "tenant_id": self.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, version, intake_schema, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Mystery Item', 'mystery-item', 1, '{\"type\": \"object\"}'::jsonb, true, now(), now())"
                ),
                {"id": unassigned_cat_id, "tenant_id": self.tenant_a_id, "service_id": unassigned_svc_id},
            )

        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(unassigned_cat_id),
                "title": "Mystery Item",
                "description": "Testing unassigned item",
                "quantity": 1,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # No agent in tenant A should receive notification for this
        agent_notifs = [n for n in self._get_notifications(self.agent_a_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(agent_notifs), 0, "No notification should be invented for unassigned catalog item")

    def test_24_service_catalog_request_duplicate_prevention(self):
        """24. Duplicate Prevention:
        One submitted Service Catalog request must create exactly one corresponding assignment notification.
        Repeated or retried dispatch with the same request creates no duplicates.
        """
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Laptop request for duplicate test",
                "quantity": 5,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        agent_notifs = [n for n in self._get_notifications(self.agent_a_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(agent_notifs), 1, "Exactly 1 notification should exist after creation")

        # Simulate repeated server-side trigger with same ticket
        from app.db.session import SessionLocal
        from app.services.itsm_request_service import RequestService
        from app.db.models import ITSMTicket, ITSMServiceCatalogItem
        db = SessionLocal()
        try:
            db.execute(
                text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": str(self.tenant_a_id)},
            )
            ticket = db.query(ITSMTicket).filter(ITSMTicket.id == UUID(req_id)).first()
            cat = db.query(ITSMServiceCatalogItem).filter(ITSMServiceCatalogItem.id == self.catalog_item_a_id).first()
            # Retry call
            RequestService.notify_catalog_service_request_created(
                db=db,
                tenant_id=self.tenant_a_id,
                ticket=ticket,
                catalog_item=cat,
                quantity=5,
            )
        finally:
            db.close()

        # Check that still only 1 notification exists
        agent_notifs_after = [n for n in self._get_notifications(self.agent_a_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(agent_notifs_after), 1, "Duplicate notification must be prevented")

    def test_25_service_catalog_request_cross_tenant_isolation(self):
        """25. Cross-Tenant Isolation:
        Requester in Tenant A submits 'PC requirement' (Quantity: 10).
        Service Agent in Tenant B receives ZERO notifications.
        """
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Tenant A Secret PC Order",
                "quantity": 10,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # Tenant B Agent checks notifications
        tb_notifs = [n for n in self._get_notifications(self.agent_b_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(tb_notifs), 0, "Agent in Tenant B must receive ZERO notifications for Tenant A requests")


    def test_26_requester_public_comment_notifies_responsible_agent_unread_and_no_self_notification(self):
        """26. Requester sends a new public message/comment on a Service Request:
        - Responsible Agent receives unread notification:
          - Title: 'New message on request: REQ-XXXXXX'
          - Body: 'Requester has sent a new message on your service request.'
          - Link: '/itsm/requests/{request_id}'
          - read_at = NULL initially.
        - Existing notification bell / unread count increments.
        - Requester does NOT receive self-notification.
        """
        init_agent = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertEqual(init_agent.status_code, 200)
        agent_unread_before = init_agent.json()["unread_count"]

        # 1. Requester submits service catalog request
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Developer setup request",
                "quantity": 1,
            },
        )
        self.assertEqual(req_res.status_code, 201)
        req_data = req_res.json()
        request_id = req_data["id"]
        ticket_number = req_data["ticket_number"]

        # Note agent notification count before comment
        agent_notifs_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])
        requester_notifs_before = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}"
        ])

        # 2. Requester posts a public comment/message on the request
        comment_res = self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Please include an extra USB-C cable with the PC setup.",
                "is_internal": False,
            },
        )
        self.assertEqual(comment_res.status_code, 201)

        # 3. Agent receives exactly 1 new comment notification
        agent_notifs_after = [
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]
        self.assertEqual(len(agent_notifs_after), agent_notifs_before + 1, "Agent must receive exactly 1 new comment notification")
        new_notif = agent_notifs_after[0]

        # Verify title, body, link, unread state
        self.assertEqual(new_notif["title"], f"New message on request: {ticket_number}")
        self.assertEqual(new_notif["body"], "Requester has sent a new message on your service request.")
        self.assertEqual(new_notif["link"], f"/itsm/requests/{request_id}")
        self.assertEqual(new_notif["type"], "itsm.request.comment")
        self.assertEqual(new_notif["severity"], "info")
        self.assertIsNone(new_notif["read_at"], "Notification must be unread (read_at is None)")

        # Verify unread count incremented
        updated_agent = self.client.get("/v1/notifications", headers={"Authorization": f"Bearer {self.agent_a_key}"})
        self.assertGreaterEqual(updated_agent.json()["unread_count"], agent_unread_before + 1)

        # 4. Requester does NOT get self-notification
        requester_notifs_after = len([
            n for n in self._get_notifications(self.requester_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])
        self.assertEqual(requester_notifs_after, 0, "Requester must not receive self-notification")

    def test_27_requester_public_comment_duplicate_prevention(self):
        """27. Duplicate prevention on rapid Requester comments:
        Rapid retries or repeated posts within 5s produce only 1 notification for responsible agent.
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Dedup test",
                "quantity": 1,
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # First comment
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Rapid comment 1",
                "is_internal": False,
            },
        )

        # Rapid second comment (retry within 5 seconds)
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Rapid comment 1",
                "is_internal": False,
            },
        )

        agent_notifs = [
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ]
        self.assertEqual(len(agent_notifs), 1, "Duplicate comment notification must be suppressed")

    def test_28_requester_public_comment_unrelated_agent_isolation(self):
        """28. Unrelated agents do NOT receive notification for requester comment."""
        # Create an unrelated agent in a different team
        unrelated_agent_id = uuid4()
        unrelated_team_id = uuid4()
        unrelated_key = f"ak_live_unrel_cmt_{uuid4().hex[:12]}"

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, 'admin', 'NONE', true, now(), now())"
                ),
                {"id": unrelated_agent_id, "tenant_id": self.tenant_a_id, "email": f"unrel_cmt_{uuid4().hex[:6]}@example.com"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :user_id, 'SERVICE_AGENT', true, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": unrelated_agent_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :key_hash, 'unrel-cmt-key', ARRAY['read', 'write', 'admin'], true, :user_id, now(), now())"
                ),
                {"tenant_id": self.tenant_a_id, "user_id": unrelated_agent_id, "key_hash": hash_key(unrelated_key)},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Accounting Software Team', true, now(), now())"
                ),
                {"id": unrelated_team_id, "tenant_id": self.tenant_a_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": self.tenant_a_id, "team_id": unrelated_team_id, "user_id": unrelated_agent_id},
            )

        # Create request for PC requirement
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Hardware request",
                "quantity": 1,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # Requester comments
        self.client.post(
            f"/v1/itsm/requests/{req_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Checking on hardware order status",
                "is_internal": False,
            },
        )

        # Unrelated agent must receive 0 notifications
        unrel_notifs = [n for n in self._get_notifications(unrelated_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(unrel_notifs), 0, "Unrelated agent must receive 0 notifications")

    def test_29_requester_public_comment_cross_tenant_isolation(self):
        """29. Cross-Tenant Isolation:
        Requester in Tenant A comments on a Service Request.
        Agent in Tenant B receives ZERO notifications.
        """
        create_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Tenant A Order",
                "quantity": 1,
            },
        )
        self.assertEqual(create_res.status_code, 201)
        req_id = create_res.json()["id"]

        # Requester in Tenant A comments
        self.client.post(
            f"/v1/itsm/requests/{req_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Secret note for Tenant A team",
                "is_internal": False,
            },
        )

        # Tenant B Agent checks notifications
        tb_notifs = [n for n in self._get_notifications(self.agent_b_key) if n["link"] == f"/itsm/requests/{req_id}"]
        self.assertEqual(len(tb_notifs), 0, "Tenant B Agent must receive ZERO notifications for Tenant A comment")

    def test_30_requester_comment_direct_assignee_notified_and_not_other_team_peers(self):
        """30. When an individual agent is assigned to the request,
        ONLY that assigned agent is notified of the requester comment (not other team peers).
        """
        req_res = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_a_id),
                "title": "PC requirement",
                "description": "Assigned to individual test",
                "quantity": 1,
            },
        )
        self.assertEqual(req_res.status_code, 201)
        request_id = req_res.json()["id"]

        # Assign directly to Agent A
        with self.engine.begin() as conn:
            conn.execute(
                text("UPDATE public.itsm_tickets SET assignee_id = :agent_id, status = 'ASSIGNED' WHERE id = :id"),
                {"agent_id": self.agent_a_id, "id": request_id},
            )

        agent_a_before = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])
        other_agent_before = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])

        # Requester comments
        self.client.post(
            f"/v1/itsm/requests/{request_id}/activities",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "activity_type": "COMMENT",
                "content": "Direct question for assigned agent",
                "is_internal": False,
            },
        )

        agent_a_after = len([
            n for n in self._get_notifications(self.agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])
        other_agent_after = len([
            n for n in self._get_notifications(self.other_agent_a_key)
            if n["link"] == f"/itsm/requests/{request_id}" and n["type"] == "itsm.request.comment"
        ])

        self.assertEqual(agent_a_after, agent_a_before + 1, "Assigned agent must receive the comment notification")
        self.assertEqual(other_agent_after, other_agent_before, "Other team peers must NOT receive notification when individual agent is assigned")


if __name__ == "__main__":
    unittest.main()
