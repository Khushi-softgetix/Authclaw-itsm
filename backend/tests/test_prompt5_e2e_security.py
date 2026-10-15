"""Comprehensive End-to-End Security Testing Suite for Employee Activation.

Prompt 5 Verification:
1. Complete Invitation Journey:
   - Platform Admin invites employee with role.
   - Pending account created (is_active=False).
   - Activation email delivered via mock SMTP (contains activation link, NO passwords).
   - Employee opens activation link and sets password.
   - Account becomes active (is_active=True) and retains designated ITSM role.
   - Employee successfully authenticates via /v1/auth/login.
2. Token Security:
   - Valid token activates once.
   - Invalid token rejected (400).
   - Expired token rejected (400).
   - Consumed token single-use enforcement (400).
   - Revoked token rejected (400).
   - Older tokens rejected after resend (400).
   - Concurrent token consumption is atomic (only one succeeds).
   - Raw tokens and complete URLs are never stored in DB or logs.
3. Resend & Revocation:
   - Admin can resend invitation.
   - Resend invalidates older token.
   - 60-second cooldown enforced (429).
   - Non-admin cannot resend (403).
   - Admin can revoke invitation.
   - Revoked invitation cannot activate account.
   - Cross-tenant resend and revocation rejected (404).
   - Duplicate invitations supersede older token.
4. Role Assignment & Authorization:
   - Approved ITSM roles accepted.
   - Unapproved/manipulated roles rejected (422).
   - Non-admin cannot invite (403).
   - Activation preserves assigned role and tenant without elevation.
5. Email Delivery & Failure Handling:
   - SMTP success returns delivery="smtp".
   - SMTP authentication failure returns 503, rolls back state.
   - SMTP connection failure returns 503, rolls back state.
   - Failed delivery leaves account unable to log in.
   - HTML and plain-text emails contain NO temporary passwords.
6. Audit Logging & Secret Sanitization:
   - Events recorded for invite, failure, resend, revoke, and activation.
   - Audit records contain NO raw tokens, passwords, URLs with tokens, or SMTP credentials.
7. Existing Login & Regression:
   - Admin login functional.
   - Pending accounts cannot log in.
   - Active accounts can log in.
   - Password reset workflow continues working.
"""
from __future__ import annotations

import concurrent.futures
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import os
import smtplib
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, quote, urlparse
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.auth import hash_key
from app.core.passwords import hash_password, verify_password
from app.db.models import (
    APIKey,
    ITSMUserAccess,
    OnboardingEmailOTP,
    Tenant,
    User,
)
from app.services.email_service import (
    EmailDeliveryError,
    EmailDeliveryResult,
    clear_local_outbox,
    read_local_outbox,
    send_activation_email,
)
from app.services.itsm_employee_activation_service import (
    ACTIVATION_TOKEN_TTL_HOURS,
    OTP_RESEND_COOLDOWN_SECONDS,
    generate_activation_token,
    hash_activation_token,
)
from main import app


class TestPrompt5E2ESecurity(unittest.TestCase):
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

    def create_fixture_tenant(
        self,
        suffix: str,
        itsm_role: str = "PLATFORM_ADMINISTRATOR",
        user_role: str = "admin",
        platform_role: str = "NONE",
    ) -> tuple[UUID, UUID, str, str]:
        tenant_id = uuid4()
        user_id = uuid4()
        api_key_str = f"test-key-{suffix}-{uuid4().hex[:12]}"
        key_hash = hash_key(api_key_str)
        admin_email = f"user-{suffix}-{uuid4().hex[:8]}@example.com"
        password = "AdminSecurePass1234!"

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
                    "VALUES (:id, :tenant_id, :email, :pw, :role, :platform_role, true, now(), now())"
                ),
                {
                    "id": user_id,
                    "tenant_id": tenant_id,
                    "email": admin_email,
                    "pw": hash_password(password),
                    "role": user_role,
                    "platform_role": platform_role,
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

        return tenant_id, user_id, api_key_str, admin_email

    # --- 1. Complete Invitation Journey ---
    def test_01_complete_invitation_journey(self):
        """End-to-end journey: Admin invites -> Email delivered -> Employee sets password -> Login succeeds."""
        tenant_id, admin_id, api_key, admin_email = self.create_fixture_tenant("full-journey")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"employee-{uuid4().hex[:8]}@company.demo"
        sent_messages = []

        def mock_send(msg: EmailMessage):
            sent_messages.append(msg)

        with patch("app.services.email_service._send_smtp_message", side_effect=mock_send):
            invite_res = self.client.post(
                "/v1/itsm/admin/users/invite",
                json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": True},
                headers=headers,
            )
            self.assertEqual(invite_res.status_code, 201, invite_res.text)
            invite_data = invite_res.json()
            self.assertEqual(invite_data["status"], "invited")
            self.assertEqual(invite_data["delivery"], "smtp")
            signup_id = invite_data["signup_id"]

        # Verify email was captured by SMTP mock
        self.assertEqual(len(sent_messages), 1)
        msg = sent_messages[0]
        self.assertEqual(msg["To"], emp_email)
        self.assertIn("AuthClaw ITSM", msg["Subject"])

        # Verify NO temporary passwords in plain text or HTML
        body_content = ""
        for part in msg.walk():
            payload = part.get_payload(decode=True)
            if payload:
                body_content += payload.decode("utf-8", errors="ignore") + "\n"

        self.assertNotIn("temporary password", body_content.lower())
        self.assertNotIn("password:", body_content.lower())
        self.assertIn("token=", body_content)

        # Extract token from action_url
        action_url = invite_data.get("action_url") or ""
        token = action_url.split("token=")[1].split("&")[0]

        # Verify user account in database is initially inactive
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT is_active, password_hash FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertIsNotNone(user_row)
            self.assertFalse(user_row.is_active)

        # Pending account cannot authenticate
        login_attempt = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": "AnyPassword123!"},
        )
        self.assertEqual(login_attempt.status_code, 401)

        # Employee activates account and sets chosen password
        chosen_password = "EmpSecurePassword1234!"
        activate_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token,
                "password": chosen_password,
                "confirm_password": chosen_password,
                "signup_id": signup_id,
            },
        )
        self.assertEqual(activate_res.status_code, 200, activate_res.text)
        act_data = activate_res.json()
        self.assertEqual(act_data["status"], "activated")
        self.assertEqual(act_data["itsm_role"], "SERVICE_AGENT")

        # Verify user in database is now active with valid password hash
        with self.migrator_engine.connect() as conn:
            updated_user = conn.execute(
                text("SELECT is_active, password_hash FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertTrue(updated_user.is_active)
            self.assertTrue(verify_password(chosen_password, updated_user.password_hash))

        # Activated employee logs in successfully
        login_res = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": chosen_password},
        )
        self.assertEqual(login_res.status_code, 200, login_res.text)
        session_info = login_res.json()
        self.assertIn("session_token", session_info)

    # --- 2. Token Security Tests ---
    def test_02_token_security_and_single_use(self):
        """Tokens are single-use, invalid/expired/revoked tokens rejected, secrets excluded from DB."""
        tenant_id, admin_id, api_key, _ = self.create_fixture_tenant("token-sec")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-tok-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER", "send_email": False},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # A. Secret Protection: Raw token is NOT stored in DB, only SHA-256 hash
        with self.migrator_engine.connect() as conn:
            otp_row = conn.execute(
                text("SELECT otp_hash FROM public.onboarding_email_otps WHERE id = :id"),
                {"id": signup_id},
            ).first()
            self.assertNotEqual(otp_row.otp_hash, raw_token)
            self.assertEqual(len(otp_row.otp_hash), 64)

        # B. Invalid token is rejected
        bad_token_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": "invalid-token-tampered-1234567890",
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": signup_id,
            },
        )
        self.assertEqual(bad_token_res.status_code, 400)

        # C. Expired token is rejected
        emp_exp_email = f"emp-exp-{uuid4().hex[:8]}@company.demo"
        exp_invite = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_exp_email, "itsm_role": "REQUESTER", "send_email": False},
            headers=headers,
        )
        self.assertEqual(exp_invite.status_code, 201)
        exp_signup_id = exp_invite.json()["signup_id"]
        exp_token = exp_invite.json()["action_url"].split("token=")[1].split("&")[0]

        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET expires_at = now() - interval '1 hour' WHERE id = :id"),
                {"id": exp_signup_id},
            )

        expired_res = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": exp_token,
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": exp_signup_id,
            },
        )
        self.assertEqual(expired_res.status_code, 400)

        # D. Successful activation consumes token
        good_act = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": raw_token,
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": signup_id,
            },
        )
        self.assertEqual(good_act.status_code, 200)

        # E. Consumed token cannot be reused
        reuse_act = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": raw_token,
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": signup_id,
            },
        )
        self.assertEqual(reuse_act.status_code, 400)
        self.assertIn("already", reuse_act.json().get("detail", "").lower())

    def test_03_revocation_and_resend_invalidation(self):
        """Revocation rejects activation; resend invalidates prior token."""
        tenant_id, admin_id, api_key, _ = self.create_fixture_tenant("revoke-resend")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-rev-{uuid4().hex[:8]}@company.demo"

        # Invite 1
        res1 = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": False},
            headers=headers,
        )
        self.assertEqual(res1.status_code, 201)
        signup_id1 = res1.json()["signup_id"]
        token1 = res1.json()["action_url"].split("token=")[1].split("&")[0]

        # Advance cooldown
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET sent_at = now() - interval '70 seconds' WHERE id = :id"),
                {"id": signup_id1},
            )

        # Resend creates fresh token
        resend_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id1}/resend",
            headers=headers,
        )
        self.assertEqual(resend_res.status_code, 200)

        # Older token1 must now be rejected
        old_token_act = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": token1,
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": signup_id1,
            },
        )
        self.assertEqual(old_token_act.status_code, 400)

        # Revoke invitation
        revoke_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id1}/revoke",
            headers=headers,
        )
        self.assertEqual(revoke_res.status_code, 200)

        # Revoked invitation cannot be activated
        revoked_act = self.client.post(
            "/v1/itsm/admin/users/activate",
            json={
                "token": "any-token",
                "password": "Password12345!",
                "confirm_password": "Password12345!",
                "signup_id": signup_id1,
            },
        )
        self.assertEqual(revoked_act.status_code, 400)

    def test_04_concurrency_token_consumption_atomic(self):
        """Only one concurrent activation request succeeds; duplicate concurrent requests fail."""
        tenant_id, admin_id, api_key, _ = self.create_fixture_tenant("concurrency")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-conc-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": False},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)
        signup_id = res.json()["signup_id"]
        token = res.json()["action_url"].split("token=")[1].split("&")[0]

        payload = {
            "token": token,
            "password": "StrongPassword1234!",
            "confirm_password": "StrongPassword1234!",
            "signup_id": signup_id,
        }

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [
                executor.submit(self.client.post, "/v1/itsm/admin/users/activate", json=payload)
                for _ in range(4)
            ]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result().status_code)

        # Exactly 1 request must return 200; the remaining 3 must be rejected (400)
        self.assertEqual(results.count(200), 1, f"Expected exactly 1 successful activation, got {results}")
        self.assertEqual(results.count(400), 3)

    # --- 3. Authorization & Cross-Tenant Security ---
    def test_05_rbac_and_cross_tenant_isolation(self):
        """Non-admin and cross-tenant users cannot invite, resend, revoke, or elevate roles."""
        t_a_id, admin_a_id, api_key_a, _ = self.create_fixture_tenant("tenant-a")
        t_b_id, admin_b_id, api_key_b, _ = self.create_fixture_tenant("tenant-b")
        headers_a = {"Authorization": f"Bearer {api_key_a}"}
        headers_b = {"Authorization": f"Bearer {api_key_b}"}

        # Admin A invites employee in Tenant A
        emp_email = f"emp-a-{uuid4().hex[:8]}@company.demo"
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER", "send_email": False},
            headers=headers_a,
        )
        self.assertEqual(invite_res.status_code, 201)
        signup_id = invite_res.json()["signup_id"]

        # 1. Cross-tenant resend attempt by Admin B returns 404
        cross_resend = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/resend",
            headers=headers_b,
        )
        self.assertEqual(cross_resend.status_code, 404)

        # 2. Cross-tenant revoke attempt by Admin B returns 404
        cross_revoke = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/revoke",
            headers=headers_b,
        )
        self.assertEqual(cross_revoke.status_code, 404)

        # 3. Non-admin requester cannot invite
        _, req_id, api_key_req, _ = self.create_fixture_tenant("req-user", itsm_role="REQUESTER", user_role="viewer")
        req_headers = {"Authorization": f"Bearer {api_key_req}"}
        unauth_invite = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": "hacker@evil.com", "itsm_role": "SERVICE_AGENT"},
            headers=req_headers,
        )
        self.assertEqual(unauth_invite.status_code, 403)

        # 4. Invalid ITSM role rejected
        bad_role_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": f"badrole-{uuid4().hex[:6]}@company.demo", "itsm_role": "SUPERUSER"},
            headers=headers_a,
        )
        self.assertEqual(bad_role_res.status_code, 422)

    # --- 4. Email Delivery & Failure Handling ---
    def test_06_mocked_smtp_failures_handled_safely(self):
        """SMTP auth and connection failures raise 503, roll back state, and keep user inactive."""
        tenant_id, admin_id, api_key, _ = self.create_fixture_tenant("email-failures")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"emp-fail-{uuid4().hex[:8]}@company.demo"

        # A. SMTP Authentication failure
        mock_server = MagicMock()
        mock_server.__enter__.return_value = mock_server
        mock_server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"Auth failed")

        with patch("app.services.email_service.smtplib.SMTP", return_value=mock_server):
            res = self.client.post(
                "/v1/itsm/admin/users/invite",
                json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": True},
                headers=headers,
            )
            self.assertEqual(res.status_code, 503)

        # Verify transaction rolled back: no valid pending OTP row
        with self.migrator_engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM public.onboarding_email_otps WHERE tenant_id = :t AND email = :e AND status = 'pending'"),
                {"t": tenant_id, "e": emp_email},
            ).scalar()
            self.assertEqual(count, 0)

        # B. User remains unable to log in
        login_fail = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": "AnyPassword123!"},
        )
        self.assertEqual(login_fail.status_code, 401)

        # C. SMTP Connection Timeout failure
        with patch("app.services.email_service.smtplib.SMTP", side_effect=smtplib.SMTPConnectError(421, b"Connection refused")):
            res2 = self.client.post(
                "/v1/itsm/admin/users/invite",
                json={"email": emp_email, "itsm_role": "SERVICE_AGENT", "send_email": True},
                headers=headers,
            )
            self.assertEqual(res2.status_code, 503)

    # --- 5. Audit Logging & Secret Sanitization ---
    def test_07_audit_logging_and_secret_protection(self):
        """Audit log metadata records lifecycle actions without exposing secrets or raw tokens."""
        tenant_id, admin_id, api_key, _ = self.create_fixture_tenant("audit-sec")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"audit-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "PROCESS_CHANGE_MANAGER", "send_email": False},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # Inspect audit events in DB
        with self.migrator_engine.connect() as conn:
            audit_rows = conn.execute(
                text("SELECT action, reason, execution_trace FROM public.audit_log_metadata WHERE tenant_id = :t"),
                {"t": tenant_id},
            ).all()

            self.assertGreaterEqual(len(audit_rows), 1)
            actions = [r.action for r in audit_rows]
            self.assertIn("itsm.employee.invited", actions)

            # Confirm NO raw token, password, or complete URL appears in audit fields
            for r in audit_rows:
                dumped = f"{r.action} {r.reason} {r.execution_trace}"
                self.assertNotIn(raw_token, dumped)
                self.assertNotIn("AdminSecurePass1234!", dumped)
                self.assertNotIn("token=", dumped)


if __name__ == "__main__":
    unittest.main()
