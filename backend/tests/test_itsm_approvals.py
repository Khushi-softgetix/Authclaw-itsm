"""Backend test suite for ITSM Approvals Security & Segregation of Duties (Phase 1).

Covers:
1. Self-approval rejection with HTTP 403 (Segregation of Duties).
2. Self-rejection rejection with HTTP 403 (Segregation of Duties).
3. Unauthorized roles rejected with HTTP 403:
   - REQUESTER attempting to approve/reject another user's request (403 Forbidden).
   - SERVICE_AGENT attempting to approve/reject another user's request (403 Forbidden).
   - AUDITOR attempting to approve/reject (403 Forbidden, mutation denied).
4. Valid authorized decisions:
   - Authorized manager (INCIDENT_MANAGER) approves pending request -> 200 OK, transitions ticket to IN_PROGRESS.
   - Authorized manager (PROCESS_CHANGE_MANAGER) rejects pending request -> 200 OK, transitions ticket to CANCELLED.
   - PLATFORM_ADMINISTRATOR approves request -> 200 OK.
5. Approver assignment enforcement:
   - Specifically assigned approval rejects unauthorized manager (403 Forbidden).
   - Platform administrator can override assigned approval (200 OK).
6. Tenant isolation:
   - Manager in Tenant B cannot approve/reject Tenant A's approval request (404 Not Found).
"""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from main import app


class ITSMApprovalsSecurityTestCase(unittest.TestCase):
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

        # Users in Tenant A
        # 1. Requester 1 (creates requests)
        cls.requester_user_id = uuid4()
        cls.requester_email = f"req1-{uuid4().hex[:8]}@example.com"
        cls.requester_key = f"key-req1-{uuid4().hex[:12]}"

        # 2. Requester 2 (another end-user, tries to approve req1's request)
        cls.requester2_user_id = uuid4()
        cls.requester2_email = f"req2-{uuid4().hex[:8]}@example.com"
        cls.requester2_key = f"key-req2-{uuid4().hex[:12]}"

        # 3. Service Agent (fulfiller, cannot approve)
        cls.agent_user_id = uuid4()
        cls.agent_email = f"agent-{uuid4().hex[:8]}@example.com"
        cls.agent_key = f"key-agent-{uuid4().hex[:12]}"

        # 4. Incident Manager (authorized approver)
        cls.manager_user_id = uuid4()
        cls.manager_email = f"mgr-{uuid4().hex[:8]}@example.com"
        cls.manager_key = f"key-mgr-{uuid4().hex[:12]}"

        # 5. Process Change Manager (authorized approver)
        cls.pcm_user_id = uuid4()
        cls.pcm_email = f"pcm-{uuid4().hex[:8]}@example.com"
        cls.pcm_key = f"key-pcm-{uuid4().hex[:12]}"

        # 6. Platform Administrator
        cls.admin_user_id = uuid4()
        cls.admin_email = f"admin-{uuid4().hex[:8]}@example.com"
        cls.admin_key = f"key-admin-{uuid4().hex[:12]}"

        # 7. Auditor (read-only)
        cls.auditor_user_id = uuid4()
        cls.auditor_email = f"auditor-{uuid4().hex[:8]}@example.com"
        cls.auditor_key = f"key-auditor-{uuid4().hex[:12]}"

        # Setup Tenant B (for tenant isolation check)
        cls.tenant_b_id = uuid4()
        cls.tenant_b_manager_id = uuid4()
        cls.tenant_b_manager_email = f"mgr-b-{uuid4().hex[:8]}@example.com"
        cls.tenant_b_manager_key = f"key-mgr-b-{uuid4().hex[:12]}"

        # Service and Catalog item
        cls.service_id = uuid4()
        cls.catalog_item_id = uuid4()

        # Dedicated test approval & ticket IDs for isolated execution
        cls.approval_self_app = uuid4()
        cls.ticket_self_app = uuid4()

        cls.approval_self_rej = uuid4()
        cls.ticket_self_rej = uuid4()

        cls.approval_agent = uuid4()
        cls.ticket_agent = uuid4()

        cls.approval_requester2 = uuid4()
        cls.ticket_requester2 = uuid4()

        cls.approval_auditor = uuid4()
        cls.ticket_auditor = uuid4()

        cls.approval_mgr_app = uuid4()
        cls.ticket_mgr_app = uuid4()

        cls.approval_pcm_rej = uuid4()
        cls.ticket_pcm_rej = uuid4()

        cls.approval_assigned = uuid4()
        cls.ticket_assigned = uuid4()

        cls.approval_admin_override = uuid4()
        cls.ticket_admin_override = uuid4()

        cls.approval_guard = uuid4()
        cls.ticket_guard = uuid4()

        cls.approval_flow = uuid4()
        cls.ticket_flow = uuid4()

        cls.approval_reject_flow = uuid4()
        cls.ticket_reject_flow = uuid4()

        now = datetime.now(timezone.utc)

        with cls.migrator_engine.begin() as conn:
            # 1. Tenants
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_id, "name": f"Tenant Approvals Test A {uuid4().hex[:8]}"},
            )
            conn.execute(
                text(
                    "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                    "VALUES (:id, :name, 'ENTERPRISE', 'active', now(), now())"
                ),
                {"id": cls.tenant_b_id, "name": f"Tenant Approvals Test B {uuid4().hex[:8]}"},
            )

            # Helper to create user & api key & itsm_user_access
            def create_test_user(u_id, t_id, email, key, role, platform_role, itsm_role):
                conn.execute(
                    text(
                        "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :email, 'hash', :role, :platform_role, true, now(), now())"
                    ),
                    {"id": u_id, "tenant_id": t_id, "email": email, "role": role, "platform_role": platform_role},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.api_keys (id, tenant_id, key_hash, name, scopes, is_active, created_by, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :key_hash, 'Key', ARRAY['read', 'write', 'admin'], true, :created_by, now(), now())"
                    ),
                    {"id": uuid4(), "tenant_id": t_id, "key_hash": hash_key(key), "created_by": u_id},
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                    ),
                    {"tenant_id": t_id, "user_id": u_id, "itsm_role": itsm_role},
                )

            create_test_user(cls.requester_user_id, cls.tenant_id, cls.requester_email, cls.requester_key, "viewer", "NONE", "REQUESTER")
            create_test_user(cls.requester2_user_id, cls.tenant_id, cls.requester2_email, cls.requester2_key, "viewer", "NONE", "REQUESTER")
            create_test_user(cls.agent_user_id, cls.tenant_id, cls.agent_email, cls.agent_key, "operator", "NONE", "SERVICE_AGENT")
            create_test_user(cls.manager_user_id, cls.tenant_id, cls.manager_email, cls.manager_key, "operator", "NONE", "INCIDENT_MANAGER")
            create_test_user(cls.pcm_user_id, cls.tenant_id, cls.pcm_email, cls.pcm_key, "operator", "NONE", "PROCESS_CHANGE_MANAGER")
            create_test_user(cls.admin_user_id, cls.tenant_id, cls.admin_email, cls.admin_key, "admin", "ADMIN", "PLATFORM_ADMINISTRATOR")
            create_test_user(cls.auditor_user_id, cls.tenant_id, cls.auditor_email, cls.auditor_key, "viewer", "NONE", "AUDITOR")

            # Tenant B manager
            create_test_user(cls.tenant_b_manager_id, cls.tenant_b_id, cls.tenant_b_manager_email, cls.tenant_b_manager_key, "operator", "NONE", "INCIDENT_MANAGER")

            # Service & Catalog Item
            conn.execute(
                text(
                    "INSERT INTO public.itsm_services (id, tenant_id, name, slug, status, tier, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'Cloud Provisioning', 'cloud-provisioning', 'ACTIVE', 'TIER_1', now(), now())"
                ),
                {"id": cls.service_id, "tenant_id": cls.tenant_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_service_catalog_items (id, tenant_id, service_id, name, slug, description, approval_required, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :service_id, 'Developer Sandbox AWS', 'dev-sandbox-aws', 'AWS account', true, true, now(), now())"
                ),
                {"id": cls.catalog_item_id, "tenant_id": cls.tenant_id, "service_id": cls.service_id},
            )
            conn.execute(
                text(
                    "INSERT INTO public.itsm_teams (id, tenant_id, name, description, is_active, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tenant_id, 'Platform Support', 'Platform Support Team', true, now(), now())"
                ),
                {"tenant_id": cls.tenant_id},
            )

            # Helper to create ticket + pending_approval pair
            def create_approval_pair(app_id, tkt_id, tkt_num, title, assigned_approver_id=None):
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_tickets (id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, requester_id, service_id, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :ticket_number, :title, 'Request Description', 'SERVICE_REQUEST', 'PENDING', 'P3', 'MEDIUM', 'MEDIUM', :requester_id, :service_id, now(), now())"
                    ),
                    {
                        "id": tkt_id,
                        "tenant_id": cls.tenant_id,
                        "ticket_number": tkt_num,
                        "title": title,
                        "requester_id": cls.requester_user_id,
                        "service_id": cls.service_id,
                    },
                )
                conn.execute(
                    text(
                        "INSERT INTO public.itsm_service_request_details (id, tenant_id, ticket_id, catalog_item_id, catalog_item_version, intake_schema_snapshot, submitted_form_data, created_at) "
                        "VALUES (gen_random_uuid(), :tenant_id, :ticket_id, :catalog_item_id, 1, '{}', '{}', now())"
                    ),
                    {
                        "tenant_id": cls.tenant_id,
                        "ticket_id": tkt_id,
                        "catalog_item_id": cls.catalog_item_id,
                    },
                )
                conn.execute(
                    text(
                        "INSERT INTO public.pending_approvals (id, tenant_id, action_type, action_description, action_id, action_payload, status, requester_id, approver_id, expires_at, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, 'service_request_approval', :title, :action_id, :payload, 'PENDING', :requester_id, :approver_id, :expires_at, now(), now())"
                    ),
                    {
                        "id": app_id,
                        "tenant_id": cls.tenant_id,
                        "title": title,
                        "action_id": str(tkt_id),
                        "payload": json.dumps({"ticket_id": str(tkt_id), "requester_id": str(cls.requester_user_id), "requester_email": cls.requester_email}),
                        "requester_id": cls.requester_user_id,
                        "approver_id": assigned_approver_id,
                        "expires_at": now + timedelta(days=7),
                    },
                )

            create_approval_pair(cls.approval_self_app, cls.ticket_self_app, "REQ-SELF-APP", "Self Approval Test")
            create_approval_pair(cls.approval_self_rej, cls.ticket_self_rej, "REQ-SELF-REJ", "Self Rejection Test")
            create_approval_pair(cls.approval_agent, cls.ticket_agent, "REQ-AGENT", "Agent Approval Test")
            create_approval_pair(cls.approval_requester2, cls.ticket_requester2, "REQ-REQ2", "Requester2 Approval Test")
            create_approval_pair(cls.approval_auditor, cls.ticket_auditor, "REQ-AUDITOR", "Auditor Approval Test")
            create_approval_pair(cls.approval_mgr_app, cls.ticket_mgr_app, "REQ-MGR-APP", "Manager Approval Test")
            create_approval_pair(cls.approval_pcm_rej, cls.ticket_pcm_rej, "REQ-PCM-REJ", "PCM Rejection Test")
            create_approval_pair(cls.approval_assigned, cls.ticket_assigned, "REQ-ASSIGNED", "Assigned Approval Test", assigned_approver_id=cls.manager_user_id)
            create_approval_pair(cls.approval_admin_override, cls.ticket_admin_override, "REQ-ADMIN-OVR", "Admin Override Test", assigned_approver_id=cls.manager_user_id)
            create_approval_pair(cls.approval_guard, cls.ticket_guard, "REQ-GUARD", "Guard & Assignment Test")
            create_approval_pair(cls.approval_flow, cls.ticket_flow, "REQ-FLOW", "Approved Fulfillment Test")
            create_approval_pair(cls.approval_reject_flow, cls.ticket_reject_flow, "REQ-REJ-FLOW", "Reject Fulfillment Test")

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    # --- 1. Self-Approval Rejection ---
    def test_self_approval_rejected_with_403(self):
        """Requester attempting to approve their own request MUST be rejected with HTTP 403 (SoD)."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_self_app}/approve",
            headers={"Authorization": f"Bearer {self.requester_key}"},
            json={"reason": "Self-approving my own request"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Segregation of duties violation", response.json()["detail"])

    # --- 2. Self-Rejection Rejection ---
    def test_self_rejection_rejected_with_403(self):
        """Requester attempting to reject their own request MUST be rejected with HTTP 403 (SoD)."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_self_rej}/reject",
            headers={"Authorization": f"Bearer {self.requester_key}"},
            json={"reason": "Self-rejecting my own request"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Segregation of duties violation", response.json()["detail"])

    # --- 3. Unauthorized Roles ---
    def test_unauthorized_requester_role_rejected_with_403(self):
        """REQUESTER role attempting to approve another user's request MUST receive HTTP 403 Forbidden."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_requester2}/approve",
            headers={"Authorization": f"Bearer {self.requester2_key}"},
            json={"reason": "Requester approving peer request"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("not authorized to approve or reject service requests", response.json()["detail"])

    def test_unauthorized_service_agent_rejected_with_403(self):
        """SERVICE_AGENT attempting to approve request MUST receive HTTP 403 Forbidden."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_agent}/approve",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"reason": "Agent approving"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("not authorized to approve or reject service requests", response.json()["detail"])

    def test_unauthorized_auditor_rejected_with_403(self):
        """AUDITOR attempting to approve/reject MUST receive HTTP 403 Forbidden (read-only)."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_auditor}/approve",
            headers={"Authorization": f"Bearer {self.auditor_key}"},
            json={"reason": "Auditor approving"},
        )
        self.assertEqual(response.status_code, 403)

    # --- 4. Assigned Approver Enforcement ---
    def test_assigned_approver_enforcement(self):
        """A request explicitly assigned to Manager A cannot be approved by Manager B (PCM)."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_assigned}/approve",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"reason": "PCM trying to approve assigned request"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("assigned to a different approver", response.json()["detail"])

    # --- 5. Valid Authorized Decisions ---
    def test_authorized_manager_approval_succeeds(self):
        """Authorized Incident Manager approving request succeeds (200 OK) and updates ticket."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_mgr_app}/approve",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"reason": "Approved by engineering manager"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "APPROVED")
        self.assertEqual(data["ticket_status"], "IN_PROGRESS")
        self.assertEqual(data["resolution_reason"], "Approved by engineering manager")

        # Verify underlying ticket status in database
        with self.migrator_engine.connect() as conn:
            ticket_row = conn.execute(
                text("SELECT status, status_reason FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.ticket_mgr_app},
            ).first()
            self.assertIsNotNone(ticket_row)
            self.assertEqual(ticket_row.status, "IN_PROGRESS")
            self.assertEqual(ticket_row.status_reason, "Approved by manager")

            # Verify audit trail
            audit_row = conn.execute(
                text("SELECT action, actor_id FROM public.approval_audit WHERE approval_id = :id"),
                {"id": self.approval_mgr_app},
            ).first()
            self.assertIsNotNone(audit_row)
            self.assertEqual(audit_row.action, "APPROVED")
            self.assertEqual(audit_row.actor_id, self.manager_user_id)

    def test_authorized_manager_rejection_succeeds(self):
        """Authorized Process Change Manager rejecting request succeeds (200 OK) and cancels ticket."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_pcm_rej}/reject",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"reason": "Resource budget exceeded"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "REJECTED")
        self.assertEqual(data["ticket_status"], "CANCELLED")
        self.assertEqual(data["resolution_reason"], "Resource budget exceeded")

        # Verify underlying ticket status in database
        with self.migrator_engine.connect() as conn:
            ticket_row = conn.execute(
                text("SELECT status, status_reason FROM public.itsm_tickets WHERE id = :id"),
                {"id": self.ticket_pcm_rej},
            ).first()
            self.assertIsNotNone(ticket_row)
            self.assertEqual(ticket_row.status, "CANCELLED")
            self.assertEqual(ticket_row.status_reason, "Resource budget exceeded")

    def test_platform_administrator_can_override_assigned_request(self):
        """PLATFORM_ADMINISTRATOR has administrative override to approve assigned request."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_admin_override}/approve",
            headers={"Authorization": f"Bearer {self.admin_key}"},
            json={"reason": "Platform admin approval override"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "APPROVED")
        self.assertEqual(data["ticket_status"], "IN_PROGRESS")

    # --- 6. Tenant Isolation ---
    def test_tenant_isolation_enforced(self):
        """Manager in Tenant B cannot approve request belonging to Tenant A (404 Not Found)."""
        response = self.client.post(
            f"/v1/itsm/approvals/{self.approval_mgr_app}/approve",
            headers={"Authorization": f"Bearer {self.tenant_b_manager_key}"},
            json={"reason": "Cross-tenant intrusion attempt"},
        )
        self.assertEqual(response.status_code, 404)

    # --- 7. Phase 1 Guardrails & Workflow Tests ---
    def test_fulfillment_blocked_with_409_while_approval_pending(self):
        """Service agent attempting to start fulfillment (IN_PROGRESS) or resolve (RESOLVED) while approval is pending MUST receive HTTP 409 Conflict."""
        # 1. Try IN_PROGRESS
        res_progress = self.client.post(
            f"/v1/itsm/requests/{self.ticket_guard}/status",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"status": "IN_PROGRESS"},
        )
        self.assertEqual(res_progress.status_code, 409)
        self.assertIn("while approval is pending", res_progress.json()["detail"])

        # 2. Try RESOLVED
        res_resolve = self.client.post(
            f"/v1/itsm/requests/{self.ticket_guard}/status",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"status": "RESOLVED", "resolution_code": "FULFILLED", "resolution_summary": "Premature attempt"},
        )
        self.assertEqual(res_resolve.status_code, 409)
        self.assertIn("while approval is pending", res_resolve.json()["detail"])

    def test_team_assignment_remains_possible_while_approval_pending(self):
        """Incident Manager or Agent can assign/reassign a supporting team while approval is pending."""
        res_assign = self.client.post(
            f"/v1/itsm/requests/{self.ticket_guard}/assign",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"assignment_group": "Platform Support", "assignee_id": str(self.agent_user_id)},
        )
        self.assertEqual(res_assign.status_code, 200)
        data = res_assign.json()
        self.assertEqual(data["assignment_group"], "Platform Support")
        self.assertEqual(data["assignee_id"], str(self.agent_user_id))
        self.assertEqual(data["status"], "PENDING")

    def test_fulfillment_allowed_after_approval(self):
        """Once approved by an authorized manager, the ticket moves to IN_PROGRESS and agent can resolve it."""
        # Manager approves
        res_app = self.client.post(
            f"/v1/itsm/approvals/{self.approval_flow}/approve",
            headers={"Authorization": f"Bearer {self.manager_key}"},
            json={"reason": "Approved for fulfillment"},
        )
        self.assertEqual(res_app.status_code, 200)
        self.assertEqual(res_app.json()["status"], "APPROVED")
        self.assertEqual(res_app.json()["ticket_status"], "IN_PROGRESS")

        # Now Agent resolves
        res_resolve = self.client.post(
            f"/v1/itsm/requests/{self.ticket_flow}/status",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"status": "RESOLVED", "resolution_code": "FULFILLED", "resolution_summary": "Sandbox created"},
        )
        self.assertEqual(res_resolve.status_code, 200)
        self.assertEqual(res_resolve.json()["status"], "RESOLVED")

    def test_rejection_blocks_fulfillment(self):
        """Rejected request moves to CANCELLED and cannot be transitioned to IN_PROGRESS or RESOLVED."""
        res_rej = self.client.post(
            f"/v1/itsm/approvals/{self.approval_reject_flow}/reject",
            headers={"Authorization": f"Bearer {self.pcm_key}"},
            json={"reason": "Project cancelled"},
        )
        self.assertEqual(res_rej.status_code, 200)
        self.assertEqual(res_rej.json()["status"], "REJECTED")
        self.assertEqual(res_rej.json()["ticket_status"], "CANCELLED")

        # Attempt to fulfill cancelled ticket returns 409
        res_progress = self.client.post(
            f"/v1/itsm/requests/{self.ticket_reject_flow}/status",
            headers={"Authorization": f"Bearer {self.agent_key}"},
            json={"status": "IN_PROGRESS"},
        )
        self.assertEqual(res_progress.status_code, 409)

    def test_requester_receives_approval_and_rejection_notifications(self):
        """Approving or rejecting a request dispatches an in-app notification to the requester."""
        with self.migrator_engine.connect() as conn:
            # Check approval notification for requester
            app_notif = conn.execute(
                text(
                    "SELECT type, severity, title, body, link FROM public.notifications "
                    "WHERE tenant_id = :tenant_id AND user_id = :user_id AND type = 'itsm.request.approval'"
                ),
                {"tenant_id": self.tenant_id, "user_id": self.requester_user_id},
            ).first()
            self.assertIsNotNone(app_notif, "Requester should have received an approval notification")
            self.assertEqual(app_notif.type, "itsm.request.approval")
            self.assertEqual(app_notif.severity, "info")
            self.assertIn("Approved", app_notif.title)

            # Check rejection notification for requester
            rej_notif = conn.execute(
                text(
                    "SELECT type, severity, title, body, link FROM public.notifications "
                    "WHERE tenant_id = :tenant_id AND user_id = :user_id AND type = 'itsm.request.rejection'"
                ),
                {"tenant_id": self.tenant_id, "user_id": self.requester_user_id},
            ).first()
            self.assertIsNotNone(rej_notif, "Requester should have received a rejection notification")
            self.assertEqual(rej_notif.type, "itsm.request.rejection")
            self.assertEqual(rej_notif.severity, "warning")
            self.assertIn("Rejected", rej_notif.title)


if __name__ == "__main__":
    unittest.main()
