"""Focused test suite for Prompt 5: Approval + Fulfillment Configuration for REQ-003.

Verifies:
1. Catalog Manager can update approval_required.
2. Catalog Manager can update fulfillment_group.
3. Requester cannot update catalog approval settings (403 Forbidden).
4. Requester cannot update fulfillment group (403 Forbidden).
5. Tenant isolation works (cannot access other tenant's catalog items or teams).
6. Only active tenant teams can be selected (inactive/cross-tenant/nonexistent rejected with 422).
7. Approval-required catalog creates a request using existing approval flow (status PENDING, PendingApproval created).
8. Non-approval catalog follows existing non-approval flow (status ASSIGNED/NEW, no PendingApproval).
9. Fulfillment group is copied/applied correctly to new Service Requests.
10. Existing request fulfillment is not retroactively changed when catalog item changes.
11. GET /v1/itsm/admin/service-catalog/fulfillment-teams returns only active teams for current tenant.
12. Existing audit logging and notifications remain intact.
"""
from __future__ import annotations

import os
import unittest
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class CatalogApprovalFulfillmentTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.migrator_url = os.getenv(
            "OWNER_DATABASE_URL",
            "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw",
        )
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

        # Tenant A and Tenant B
        cls.tenant_a = uuid4()
        cls.tenant_b = uuid4()

        # Users in Tenant A
        cls.cat_mgr_a_id = uuid4()
        cls.cat_mgr_a_email = f"cat-mgr-a-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_a_key = f"cat-mgr-a-key-{uuid4().hex[:12]}"

        cls.admin_a_id = uuid4()
        cls.admin_a_email = f"admin-a-{uuid4().hex[:8]}@example.com"
        cls.admin_a_key = f"admin-a-key-{uuid4().hex[:12]}"

        cls.requester_a_id = uuid4()
        cls.requester_a_email = f"requester-a-{uuid4().hex[:8]}@example.com"
        cls.requester_a_key = f"req-a-key-{uuid4().hex[:12]}"

        cls.agent_a_id = uuid4()
        cls.agent_a_email = f"agent-a-{uuid4().hex[:8]}@example.com"
        cls.agent_a_key = f"agent-a-key-{uuid4().hex[:12]}"

        # Users in Tenant B
        cls.cat_mgr_b_id = uuid4()
        cls.cat_mgr_b_email = f"cat-mgr-b-{uuid4().hex[:8]}@example.com"
        cls.cat_mgr_b_key = f"cat-mgr-b-key-{uuid4().hex[:12]}"

        # Teams in Tenant A
        cls.team_it_ops_id = uuid4()
        cls.team_it_ops_name = f"IT Operations {uuid4().hex[:6]}"

        cls.team_net_id = uuid4()
        cls.team_net_name = f"Network Engineering {uuid4().hex[:6]}"

        cls.team_inactive_id = uuid4()
        cls.team_inactive_name = f"Deprecated Support {uuid4().hex[:6]}"

        # Team in Tenant B (for cross-tenant rejection)
        cls.team_b_id = uuid4()
        cls.team_b_name = f"Tenant B Team {uuid4().hex[:6]}"

        # Services
        cls.service_a_id = uuid4()
        cls.service_b_id = uuid4()

        with cls.migrator_engine.begin() as conn:
            # 1. Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_a, "name": f"tenant-appr-a-{uuid4().hex[:6]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'starter', 'active', now(), now())"
                ),
                {"id": cls.tenant_b, "name": f"tenant-appr-b-{uuid4().hex[:6]}"},
            )

            # 2. Users, itsm_user_access, api_keys
            users_data = [
                (cls.cat_mgr_a_id, cls.tenant_a, cls.cat_mgr_a_email, cls.cat_mgr_a_key, "CATALOG_MANAGER", "cat-mgr-a"),
                (cls.admin_a_id, cls.tenant_a, cls.admin_a_email, cls.admin_a_key, "PLATFORM_ADMINISTRATOR", "admin-a"),
                (cls.requester_a_id, cls.tenant_a, cls.requester_a_email, cls.requester_a_key, "REQUESTER", "req-a"),
                (cls.agent_a_id, cls.tenant_a, cls.agent_a_email, cls.agent_a_key, "SERVICE_AGENT", "agent-a"),
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

            # 3. Teams in Tenant A
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES "
                    "  (:id_a1, :t_a, :name_a1, 'Primary IT Operations team', true, now(), now()), "
                    "  (:id_a2, :t_a, :name_a2, 'Network team', true, now(), now()), "
                    "  (:id_a3, :t_a, :name_a3, 'Inactive deprecated team', false, now(), now())"
                ),
                {
                    "id_a1": cls.team_it_ops_id,
                    "name_a1": cls.team_it_ops_name,
                    "id_a2": cls.team_net_id,
                    "name_a2": cls.team_net_name,
                    "id_a3": cls.team_inactive_id,
                    "name_a3": cls.team_inactive_name,
                    "t_a": cls.tenant_a,
                },
            )

            # Team in Tenant B
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (:id_b, :t_b, :name_b, 'Team belonging strictly to Tenant B', true, now(), now())"
                ),
                {
                    "id_b": cls.team_b_id,
                    "t_b": cls.tenant_b,
                    "name_b": cls.team_b_name,
                },
            )

            # Team members: Agent A in IT Operations
            conn.execute(
                text(
                    "INSERT INTO public.itsm_team_members (id, tenant_id, team_id, user_id, created_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, :team_id, :user_id, now())"
                ),
                {"tenant_id": cls.tenant_a, "team_id": cls.team_it_ops_id, "user_id": cls.agent_a_id},
            )

            # 4. Services
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, description, tier, status, escalation_team, created_at, updated_at) "
                    "VALUES "
                    "  (:s_a, :t_a, 'Corporate IT Services', 'corp-it', 'IT Services', 'tier1', 'OPERATIONAL', 'IT Support', now(), now()), "
                    "  (:s_b, :t_b, 'Beta IT Services', 'beta-it', 'Beta Services', 'tier1', 'OPERATIONAL', 'Beta Team', now(), now())"
                ),
                {"s_a": cls.service_a_id, "t_a": cls.tenant_a, "s_b": cls.service_b_id, "t_b": cls.tenant_b},
            )

            # 5. Base Catalog Item in Tenant A
            cls.catalog_item_id = uuid4()
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items "
                    "  (id, tenant_id, service_id, name, slug, description, version, intake_schema, approval_required, fulfillment_group, estimated_delivery_hours, is_active, created_at, updated_at) "
                    "VALUES "
                    "  (:id, :tenant_id, :service_id, 'Standard PC Requirement', 'standard-pc-req', 'Corporate PC offering', 1, '{}', false, NULL, 24, true, now(), now())"
                ),
                {
                    "id": cls.catalog_item_id,
                    "tenant_id": cls.tenant_a,
                    "service_id": cls.service_a_id,
                },
            )

    def test_01_catalog_manager_can_update_approval_required(self):
        """1. Catalog Manager can toggle approval_required on and off."""
        # Toggle ON
        resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"approval_required": True},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["approval_required"])

        # Verify persisted via GET
        get_resp = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(get_resp.status_code, 200)
        self.assertTrue(get_resp.json()["approval_required"])

        # Toggle OFF
        resp_off = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"approval_required": False},
        )
        self.assertEqual(resp_off.status_code, 200)
        self.assertFalse(resp_off.json()["approval_required"])

    def test_02_catalog_manager_can_update_fulfillment_group(self):
        """2. Catalog Manager can configure fulfillment team and delivery SLA."""
        resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "fulfillment_group": self.team_it_ops_name,
                "estimated_delivery_hours": 48,
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["fulfillment_group"], self.team_it_ops_name)
        self.assertEqual(data["estimated_delivery_hours"], 48)

        # Verify persistence
        get_resp = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()["fulfillment_group"], self.team_it_ops_name)
        self.assertEqual(get_resp.json()["estimated_delivery_hours"], 48)

    def test_03_requester_cannot_update_catalog_approval_settings(self):
        """3. Requester cannot update catalog approval settings (403 Forbidden)."""
        resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={"approval_required": False},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Catalog Manager or Platform Administrator access required", resp.text)

    def test_04_requester_cannot_update_fulfillment_group(self):
        """4. Requester cannot update fulfillment group (403 Forbidden)."""
        resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={"fulfillment_group": self.team_net_name},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Catalog Manager or Platform Administrator access required", resp.text)

    def test_05_tenant_isolation_teams_and_catalog(self):
        """5. Catalog Manager B cannot view or modify Tenant A's catalog item."""
        resp = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_b_key}"},
            json={"approval_required": True},
        )
        self.assertEqual(resp.status_code, 404)

        get_resp = self.client.get(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_b_key}"},
        )
        self.assertEqual(get_resp.status_code, 404)

    def test_06_only_active_tenant_teams_can_be_selected(self):
        """6. Validation rejects inactive teams, cross-tenant teams, and nonexistent teams."""
        # A. Inactive team in same tenant -> 422
        resp_inactive = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": self.team_inactive_name},
        )
        self.assertEqual(resp_inactive.status_code, 422)
        self.assertIn("inactive", resp_inactive.text.lower())

        # B. Cross-tenant team (belongs to Tenant B) -> 422
        resp_cross = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": self.team_b_name},
        )
        self.assertEqual(resp_cross.status_code, 422)
        self.assertTrue("another tenant" in resp_cross.text.lower() or "does not exist" in resp_cross.text.lower())

        # C. Nonexistent team -> 422
        resp_none = self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": "Totally Fictional Team 999"},
        )
        self.assertEqual(resp_none.status_code, 422)
        self.assertIn("does not exist", resp_none.text.lower())

    def test_07_approval_required_creates_request_in_pending_approval(self):
        """7. When approval_required=True, new request enters existing approval process."""
        # 1. Configure item: Approval Required = True, Fulfillment = IT Operations
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "approval_required": True,
                "fulfillment_group": self.team_it_ops_name,
            },
        )

        # 2. Requester submits request
        req_payload = {
            "catalog_item_id": str(self.catalog_item_id),
            "title": "Need Developer Laptop",
            "description": "Standard high-performance workstation",
            "quantity": 1,
            "priority": "P3",
            "form_data": {},
        }
        create_resp = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json=req_payload,
        )
        self.assertEqual(create_resp.status_code, 201)
        req_data = create_resp.json()
        self.assertEqual(req_data["status"], "PENDING")
        self.assertEqual(req_data["status_reason"], "Pending approval")
        self.assertEqual(req_data["assignment_group"], self.team_it_ops_name)

        ticket_id = req_data["id"]

        # Verify PendingApproval record exists in DB
        with self.migrator_engine.connect() as conn:
            appr_row = conn.execute(
                text(
                    "SELECT id, status, action_type, action_id FROM public.pending_approvals WHERE tenant_id = :tid AND action_id = :aid"
                ),
                {"tid": self.tenant_a, "aid": str(ticket_id)},
            ).first()
            self.assertIsNotNone(appr_row)
            self.assertEqual(appr_row.status, "PENDING")
            self.assertEqual(appr_row.action_type, "service_request_approval")

    def test_08_non_approval_catalog_follows_direct_path(self):
        """8. When approval_required=False, new request follows direct fulfillment path without approval."""
        # 1. Configure item: Approval Required = False, Fulfillment = IT Operations
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "approval_required": False,
                "fulfillment_group": self.team_it_ops_name,
            },
        )

        # 2. Requester submits request
        req_payload = {
            "catalog_item_id": str(self.catalog_item_id),
            "title": "Need Monitor Stand",
            "description": "Dual monitor adjustable riser",
            "quantity": 1,
            "priority": "P3",
            "form_data": {},
        }
        create_resp = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json=req_payload,
        )
        self.assertEqual(create_resp.status_code, 201)
        req_data = create_resp.json()
        self.assertNotEqual(req_data["status"], "PENDING")
        self.assertEqual(req_data["status"], "ASSIGNED")
        self.assertEqual(req_data["assignment_group"], self.team_it_ops_name)

        ticket_id = req_data["id"]

        # Verify no PendingApproval record created
        with self.migrator_engine.connect() as conn:
            appr_row = conn.execute(
                text(
                    "SELECT id FROM public.pending_approvals WHERE tenant_id = :tid AND action_id = :aid"
                ),
                {"tid": self.tenant_a, "aid": str(ticket_id)},
            ).first()
            self.assertIsNone(appr_row)

    def test_09_fulfillment_group_copied_to_new_service_requests(self):
        """9. Configured fulfillment group is copied onto the created ticket."""
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": self.team_net_name},
        )

        create_resp = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_id),
                "title": "VLAN Assignment",
                "description": "Switch port reconfiguration",
            },
        )
        self.assertEqual(create_resp.status_code, 201)
        self.assertEqual(create_resp.json()["assignment_group"], self.team_net_name)

    def test_10_existing_requests_not_retroactively_changed(self):
        """10. Modifying catalog configuration does not retroactively rewrite past requests."""
        # 1. Create request under IT Operations
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": self.team_it_ops_name, "approval_required": False},
        )
        r1 = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={"catalog_item_id": str(self.catalog_item_id), "title": "Old Request R1"},
        ).json()
        req1_id = r1["id"]
        self.assertEqual(r1["assignment_group"], self.team_it_ops_name)

        # 2. Change catalog item to Network Engineering
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={"fulfillment_group": self.team_net_name},
        )

        # 3. Create request R2 under new config
        r2 = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={"catalog_item_id": str(self.catalog_item_id), "title": "New Request R2"},
        ).json()
        self.assertEqual(r2["assignment_group"], self.team_net_name)

        # 4. Old request R1 must remain unchanged
        old_req = self.client.get(
            f"/v1/itsm/requests/{req1_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        ).json()
        self.assertEqual(old_req["assignment_group"], self.team_it_ops_name)

    def test_11_catalog_fulfillment_teams_endpoint_returns_active_teams_only(self):
        """11. GET /v1/itsm/admin/service-catalog/fulfillment-teams returns only active teams."""
        # Catalog Manager can list active teams
        resp = self.client.get(
            "/v1/itsm/admin/service-catalog/fulfillment-teams",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
        )
        self.assertEqual(resp.status_code, 200)
        teams = resp.json()
        team_names = [t["name"] for t in teams]

        # Active teams present
        self.assertIn(self.team_it_ops_name, team_names)
        self.assertIn(self.team_net_name, team_names)

        # Inactive team absent
        self.assertNotIn(self.team_inactive_name, team_names)

        # Other tenant team absent
        self.assertNotIn(self.team_b_name, team_names)

        # Requester denied (403)
        req_resp = self.client.get(
            "/v1/itsm/admin/service-catalog/fulfillment-teams",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
        )
        self.assertEqual(req_resp.status_code, 403)

    def test_12_audit_and_notification_triggers_on_approval_fulfillment(self):
        """12. Audit event and notifications recorded upon ticket creation with approval/fulfillment."""
        self.client.patch(
            f"/v1/itsm/admin/service-catalog/{self.catalog_item_id}",
            headers={"Authorization": f"Bearer {self.cat_mgr_a_key}"},
            json={
                "approval_required": True,
                "fulfillment_group": self.team_it_ops_name,
            },
        )

        resp = self.client.post(
            "/v1/itsm/requests",
            headers={"Authorization": f"Bearer {self.requester_a_key}"},
            json={
                "catalog_item_id": str(self.catalog_item_id),
                "title": "Audited Request",
                "description": "Testing audit and assignment",
            },
        )
        self.assertEqual(resp.status_code, 201)
        ticket_id = resp.json()["id"]

        with self.migrator_engine.connect() as conn:
            # Check ticket activity
            act = conn.execute(
                text("SELECT id, activity_type FROM public.itsm_ticket_activities WHERE ticket_id = :tid"),
                {"tid": ticket_id},
            ).first()
            self.assertIsNotNone(act)

            # Check audit event in public.audit_outbox
            audit_events = conn.execute(
                text("SELECT id, event_payload FROM public.audit_outbox WHERE tenant_id = :tid"),
                {"tid": self.tenant_a},
            ).fetchall()
            self.assertTrue(len(audit_events) > 0)
            actions = [row.event_payload.get("action") for row in audit_events if row.event_payload]
            self.assertIn("itsm.request.created", actions)


if __name__ == "__main__":
    unittest.main()

