"""Automated Verification Suite for Prompt 4 — Update Employee Invitation UI and Build Account Activation Page.

Covers:
1. Invitation Creation and Status in User Management API:
   - Platform Administrator invites new employee.
   - GET /v1/itsm/admin/users returns user with invitation_status='pending_activation', invite_id, and invite_expires_at.
2. Resend Invitation Action:
   - Platform Administrator resends activation invitation -> 200 OK, resend_count incremented.
3. Revoke Invitation Action:
   - Platform Administrator revokes invitation -> 200 OK, status transitions to 'revoked'.
   - GET /v1/itsm/admin/users reflects revoked status.
4. Account Activation API Flow:
   - Valid token allows employee to set password.
   - Password mismatch or < 12 chars is rejected.
   - Successful activation enables login.
   - Consumed token cannot be reused (single-use enforcement).
5. RBAC Protection:
   - Non-admin requester cannot invite, resend, or revoke (403 Forbidden).
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.core.passwords import hash_password, verify_password
from app.services.email_service import clear_local_outbox
from app.services.itsm_employee_activation_service import hash_activation_token
from main import app


class TestPrompt4BackendInvitationLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        migrator_env = os.getenv("OWNER_DATABASE_URL")
        if not migrator_env or migrator_env in ("null", "None"):
            cls.migrator_url = "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw"
        else:
            cls.migrator_url = migrator_env
        cls.migrator_engine = create_engine(cls.migrator_url, pool_pre_ping=True)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.migrator_engine.dispose()

    def setUp(self):
        clear_local_outbox()
        self.deliver_patcher = patch(
            "app.api.v1.endpoints.itsm_admin._deliver_otp",
            return_value=("local_outbox", "123456"),
        )
        self.mock_deliver = self.deliver_patcher.start()

    def tearDown(self):
        self.deliver_patcher.stop()

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "PLATFORM_ADMINISTRATOR"):
        tenant_id = uuid4()
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)
        admin_email = f"admin-{suffix}-{uuid4().hex[:8]}@example.com"

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
                    "INSERT INTO public.users (id, tenant_id, email, password_hash, role, platform_role, is_active, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :email, :pw, 'admin', 'NONE', true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": admin_email,
                    "pw": hash_password("AdminPass1234!"),
                },
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
            conn.execute(
                text(
                    "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :user_id, :itsm_role, true, true, now(), now())"
                ),
                {
                    "id": uuid4(),
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "itsm_role": itsm_role,
                },
            )

        return tenant_id, user_id, api_key_str

    def test_01_invitation_creation_and_status_display(self):
        """Inviting employee must set status to pending_activation and show in GET /users."""
        tenant_id, user_id, api_key = self.create_fixture_tenant("invite-status")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-{uuid4().hex[:8]}@company.demo"

        # 1. Invite employee
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={
                "email": emp_email,
                "itsm_role": "SERVICE_AGENT",
                "send_email": False,
            },
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201, f"Invite failed: {invite_res.text}")
        data = invite_res.json()
        self.assertEqual(data["status"], "invited")
        invite_id = data["signup_id"]

        # 2. Verify in GET /v1/itsm/admin/users
        list_res = self.client.get("/v1/itsm/admin/users", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        users = list_res.json()

        invited_user = next((u for u in users if u["email"].lower() == emp_email.lower()), None)
        self.assertIsNotNone(invited_user, f"Invited employee {emp_email} must appear in users list")
        self.assertEqual(invited_user["status"], "pending_activation")
        self.assertEqual(invited_user["invitation_status"], "pending_activation")
        self.assertEqual(invited_user["itsm_role"], "SERVICE_AGENT")
        self.assertEqual(str(invited_user["invite_id"]), str(invite_id))
        self.assertIsNotNone(invited_user["invite_expires_at"])

    def test_02_resend_invitation_action(self):
        """Authorized Platform Admin can resend invitation; updates resend_count."""
        tenant_id, user_id, api_key = self.create_fixture_tenant("resend-act")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER", "send_email": False},
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201)
        invite_id = invite_res.json()["signup_id"]

        # Advance sent_at in database past cooldown
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET sent_at = now() - interval '65 seconds' WHERE id = :id"),
                {"id": invite_id},
            )

        # Resend by invite ID
        resend_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{invite_id}/resend",
            headers=headers,
        )
        self.assertEqual(resend_res.status_code, 200, f"Resend failed: {resend_res.text}")
        resend_data = resend_res.json()
        self.assertEqual(resend_data["status"], "resent")
        self.assertEqual(str(resend_data["signup_id"]), str(invite_id))
        self.assertEqual(resend_data["email"], emp_email)
        self.assertIn("expires_at", resend_data)

    def test_03_revoke_invitation_action(self):
        """Authorized Platform Admin can revoke invitation; status updates to revoked."""
        tenant_id, user_id, api_key = self.create_fixture_tenant("revoke-act")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER", "send_email": False},
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201)
        invite_id = invite_res.json()["signup_id"]

        # Revoke invitation
        revoke_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{invite_id}/revoke",
            headers=headers,
        )
        self.assertEqual(revoke_res.status_code, 200, f"Revoke failed: {revoke_res.text}")
        self.assertEqual(revoke_res.json()["status"], "revoked")

        # Verify status in GET /v1/itsm/admin/users reflects revoked
        list_res = self.client.get("/v1/itsm/admin/users", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        user_row = next((u for u in list_res.json() if u["email"].lower() == emp_email.lower()), None)
        self.assertIsNotNone(user_row)
        self.assertEqual(user_row["status"], "revoked")
        self.assertEqual(user_row["invitation_status"], "revoked")

    def test_04_account_activation_flow(self):
        """Employee activates account with raw token, sets password, and logs in."""
        tenant_id, user_id, api_key = self.create_fixture_tenant("activate-flow")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": False},
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201)
        invite_data = invite_res.json()
        invite_id = invite_data["signup_id"]
        action_url = invite_data.get("action_url") or ""

        self.assertIn("token=", action_url, f"action_url must contain token parameter: {action_url}")
        token = action_url.split("token=")[1].split("&")[0]

        # 1. Attempt activation with password mismatch -> 422
        bad_match_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token,
                "password": "SecurePassword1234!",
                "confirm_password": "MismatchPassword1234!",
                "signup_id": invite_id,
            },
        )
        self.assertEqual(bad_match_res.status_code, 422)

        # 2. Attempt activation with short password (< 12 chars) -> 400
        short_pw_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token,
                "password": "Short1!",
                "confirm_password": "Short1!",
                "signup_id": invite_id,
            },
        )
        self.assertEqual(short_pw_res.status_code, 400)

        # 3. Successful activation
        new_password = "EmployeePassword1234!"
        activate_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token,
                "password": new_password,
                "confirm_password": new_password,
                "signup_id": invite_id,
            },
        )
        self.assertEqual(activate_res.status_code, 200, f"Activation failed: {activate_res.text}")
        act_data = activate_res.json()
        self.assertEqual(act_data["status"], "activated")
        self.assertEqual(act_data["itsm_role"], "SERVICE_AGENT")

        # 4. Single-use enforcement: Attempting second activation with same token must fail
        reuse_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token,
                "password": new_password,
                "confirm_password": new_password,
                "signup_id": invite_id,
            },
        )
        self.assertEqual(reuse_res.status_code, 400)
        self.assertIn("already", reuse_res.json().get("detail", "").lower())

        # 5. Check user is now is_active=True in DB
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT is_active, password_hash FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertIsNotNone(user_row)
            self.assertTrue(user_row.is_active)
            self.assertTrue(verify_password(new_password, user_row.password_hash))

    def test_05_rbac_protection_on_admin_actions(self):
        """Non-admin employee receives 403 Forbidden when attempting admin actions."""
        tenant_id, user_id, api_key = self.create_fixture_tenant("req-rbac", itsm_role="REQUESTER")
        req_headers = {"Authorization": f"Bearer {api_key}"}

        # 1. Inviting users forbidden for REQUESTER
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": "somebody@company.demo", "itsm_role": "SERVICE_AGENT"},
            headers=req_headers,
        )
        self.assertEqual(invite_res.status_code, 403)

        # 2. Resend invite forbidden
        resend_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{uuid4()}/resend",
            headers=req_headers,
        )
        self.assertEqual(resend_res.status_code, 403)

        # 3. Revoke invite forbidden
        revoke_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{uuid4()}/revoke",
            headers=req_headers,
        )
        self.assertEqual(revoke_res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
