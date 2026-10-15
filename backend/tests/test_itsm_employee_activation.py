"""Comprehensive automated test suite for Secure Backend Account Activation and Token Lifecycle.

Covers Prompt 2 requirements:
- Cryptographically secure token generation & SHA-256 storage
- Exclusion of secrets from logs and database
- Inactive user state preventing login before activation
- Account activation with password setting and verification
- Token single-use enforcement
- Expiry and revocation enforcement
- Resend invalidation of previous tokens
- Cooldown and rate limiting
- Cross-tenant isolation and role-based access control
- Concurrency and transaction safety
- Verification that no temporary passwords are sent by email
"""
from __future__ import annotations

import concurrent.futures
from datetime import datetime, timedelta, timezone
import json
import os
import unittest
from unittest.mock import patch
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
)
from app.services.itsm_employee_activation_service import (
    generate_activation_token,
    hash_activation_token,
    ACTIVATION_TOKEN_TTL_HOURS,
    OTP_RESEND_COOLDOWN_SECONDS,
)
from main import app


class ITSMEmployeeActivationTestCase(unittest.TestCase):
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

    def create_fixture_tenant(self, suffix: str, itsm_role: str = "PLATFORM_ADMINISTRATOR"):
        tenant_id = uuid4()
        user_id = uuid4()
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
                    "email": f"admin-{suffix}-{uuid4().hex[:8]}@example.com",
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

    # --- 1. Token Generation Entropy, Hash Storage, and Secret Protection ---
    def test_01_token_generation_entropy_and_hash_storage(self):
        """Tokens have >= 256 bits of entropy and only SHA-256 hashes are persisted."""
        token1 = generate_activation_token()
        token2 = generate_activation_token()
        self.assertNotEqual(token1, token2)
        self.assertGreaterEqual(len(token1), 40)

        digest1 = hash_activation_token(token1)
        self.assertEqual(len(digest1), 64)

        tenant_id, user_id, api_key = self.create_fixture_tenant("sec-tokens")
        headers = {"Authorization": f"Bearer {api_key}"}

        emp_email = f"emp-{uuid4().hex[:8]}@company.demo"
        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()
        signup_id = data["signup_id"]

        with self.migrator_engine.connect() as conn:
            otp_row = conn.execute(
                text("SELECT otp_hash, status, purpose FROM public.onboarding_email_otps WHERE id = :id"),
                {"id": signup_id},
            ).first()
            self.assertIsNotNone(otp_row)
            self.assertEqual(len(otp_row.otp_hash), 64)
            self.assertEqual(otp_row.status, "pending")
            self.assertEqual(otp_row.purpose, "invite")

            # Verify the raw token is NOT stored anywhere in the DB record
            if data.get("action_url"):
                raw_token = data["action_url"].split("token=")[1].split("&")[0]
                self.assertNotEqual(otp_row.otp_hash, raw_token)
                self.assertEqual(otp_row.otp_hash, hash_activation_token(emp_email, raw_token))

    # --- 2. Inactive State Prevents Authentication Prior to Activation ---
    def test_02_pending_account_cannot_login_prior_to_activation(self):
        """Pending accounts have is_active=False and cannot authenticate at /v1/auth/login."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("pending-auth")
        headers = {"Authorization": f"Bearer {api_key}"}

        emp_email = f"pending-{uuid4().hex[:8]}@company.demo"
        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)

        # Check DB user is_active = False
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT id, is_active FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertIsNotNone(user_row)
            self.assertFalse(user_row.is_active)

        # Attempt login before activation
        login_res = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": "AnyPassword123!"},
        )
        self.assertEqual(login_res.status_code, 401)
        self.assertEqual(login_res.json()["detail"], "Invalid email or password")

    # --- 3. Successful Activation and Post-Activation Login ---
    def test_03_successful_activation_and_login(self):
        """Valid activation sets password hash, activates user, and enables normal login."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("activate-ok")
        headers = {"Authorization": f"Bearer {api_key}"}

        emp_email = f"activate-{uuid4().hex[:8]}@company.demo"
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201)
        data = invite_res.json()
        signup_id = data["signup_id"]
        action_url = data["action_url"]
        raw_token = action_url.split("token=")[1].split("&")[0]

        # Call activation endpoint
        chosen_password = "ValidPassword123!@#"
        act_res = self.client.post(
            "/v1/auth/activate",
            json={
                "signup_id": signup_id,
                "token": raw_token,
                "password": chosen_password,
            },
        )
        self.assertEqual(act_res.status_code, 200, act_res.text)
        act_data = act_res.json()
        self.assertEqual(act_data["status"], "activated")
        self.assertEqual(act_data["email"], emp_email)
        self.assertEqual(act_data["itsm_role"], "SERVICE_AGENT")

        # Verify DB state
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT id, is_active, password_hash FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertIsNotNone(user_row)
            self.assertTrue(user_row.is_active)
            self.assertTrue(verify_password(chosen_password, user_row.password_hash))

            otp_row = conn.execute(
                text("SELECT status, verified_at FROM public.onboarding_email_otps WHERE id = :id"),
                {"id": signup_id},
            ).first()
            self.assertEqual(otp_row.status, "verified")
            self.assertIsNotNone(otp_row.verified_at)

        # Successfully log in now that account is activated
        login_res = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": chosen_password},
        )
        self.assertEqual(login_res.status_code, 200, login_res.text)
        login_data = login_res.json()
        self.assertEqual(login_data["email"], emp_email)
        self.assertIsNotNone(login_data["session_token"])

    # --- 4. Single-Use Token Enforcement ---
    def test_04_token_cannot_be_reused_after_activation(self):
        """Tokens are strictly single-use and cannot activate an account a second time."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("single-use")
        headers = {"Authorization": f"Bearer {api_key}"}

        emp_email = f"single-{uuid4().hex[:8]}@company.demo"
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # First activation succeeds
        first_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "SecurePassword123!"},
        )
        self.assertEqual(first_res.status_code, 200)

        # Second activation fails
        second_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "AnotherPassword123!"},
        )
        self.assertEqual(second_res.status_code, 400)
        self.assertIn("already been used", second_res.json()["detail"])

    # --- 5. Expired and Invalid Tokens Rejected ---
    def test_05_invalid_and_expired_tokens_rejected(self):
        """Invalid tokens and expired tokens are rejected by the backend."""
        # Non-existent token
        res_bogus = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": str(uuid4()), "token": "completely-invalid-token-404", "password": "Password123!"},
        )
        self.assertEqual(res_bogus.status_code, 400)
        self.assertIn("Invalid or unknown", res_bogus.json()["detail"])

        # Expired token
        tenant_id, admin_id, api_key = self.create_fixture_tenant("expired-tok")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"exp-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # Set expires_at in the past
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET expires_at = now() - interval '2 hours' WHERE id = :id"),
                {"id": signup_id},
            )

        res_expired = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "Password123!"},
        )
        self.assertEqual(res_expired.status_code, 400)
        self.assertIn("expired", res_expired.json()["detail"].lower())

    # --- 6. Revocation Prevents Activation ---
    def test_06_revocation_prevents_activation(self):
        """Revoked invitations cannot activate the account."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("revoke-flow")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"rev-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "AUDITOR"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # Admin revokes the invitation
        revoke_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/revoke",
            headers=headers,
        )
        self.assertEqual(revoke_res.status_code, 200)
        self.assertEqual(revoke_res.json()["status"], "revoked")

        # Employee tries to activate using the revoked token
        act_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "SecurePassword123!"},
        )
        self.assertEqual(act_res.status_code, 400)
        self.assertIn("revoked", act_res.json()["detail"].lower())

        # Account remains inactive
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT is_active FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertFalse(user_row.is_active)

    # --- 7. Resend Invalidates Prior Tokens ---
    def test_07_resend_invalidates_prior_tokens_and_issues_fresh_token(self):
        """Resend invalidates previous tokens and issues a fresh 24h token that works."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("resend-flow")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"resend-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        data1 = invite_res.json()
        signup_id = data1["signup_id"]
        token1 = data1["action_url"].split("token=")[1].split("&")[0]

        # Bypass the 60s cooldown in the database
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET sent_at = now() - interval '70 seconds' WHERE id = :id"),
                {"id": signup_id},
            )

        # Admin requests resend
        resend_res = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/resend",
            headers=headers,
        )
        self.assertEqual(resend_res.status_code, 200, resend_res.text)
        self.assertEqual(resend_res.json()["status"], "resent")

        # Old token1 is now invalid
        old_act_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": token1, "password": "SecurePassword123!"},
        )
        self.assertEqual(old_act_res.status_code, 400)

        # Check outbox for newly delivered token2
        outbox = read_local_outbox()
        self.assertGreaterEqual(len(outbox), 2)
        latest_email = outbox[-1]
        self.assertEqual(latest_email["to"], emp_email)
        email_content = latest_email.get("html") or latest_email.get("body", "")
        self.assertIn("token=", email_content)
        token2 = email_content.split("token=")[1].split("&")[0].split('"')[0].split()[0]
        self.assertNotEqual(token1, token2)

        # Token 2 successfully activates
        new_act_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": token2, "password": "SecurePassword123!"},
        )
        self.assertEqual(new_act_res.status_code, 200)
        self.assertEqual(new_act_res.json()["status"], "activated")

    # --- 8. Password Complexity Validation Enforced ---
    def test_08_password_complexity_validation_enforced(self):
        """Weak passwords (< 12 chars) are rejected during activation without altering state."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("pwd-val")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"pwdval-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "REQUESTER"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        # Password too short (< 12 characters)
        short_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "Short1!"},
        )
        self.assertEqual(short_res.status_code, 400)
        self.assertIn("at least 12 characters", short_res.json()["detail"].lower())

        # Account remains inactive
        with self.migrator_engine.connect() as conn:
            user_row = conn.execute(
                text("SELECT is_active FROM public.users WHERE tenant_id = :t AND email = :e"),
                {"t": tenant_id, "e": emp_email},
            ).first()
            self.assertFalse(user_row.is_active)

    # --- 9. Manual Creation Workflow Sends No Temporary Passwords ---
    def test_09_manual_creation_sends_no_passwords_and_requires_activation(self):
        """Manual creation never emails temporary passwords and sets account pending activation."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("no-temp-pwd")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"manual-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/create",
            json={
                "email": emp_email,
                "itsm_role": "INCIDENT_MANAGER",
                "email_credentials": True,
            },
            headers=headers,
        )
        self.assertEqual(res.status_code, 201, res.text)
        data = res.json()
        self.assertEqual(data["status"], "created")
        self.assertEqual(data["itsm_role"], "INCIDENT_MANAGER")

        # Crucial check: inspect all sent emails in outbox
        outbox = read_local_outbox()
        self.assertGreaterEqual(len(outbox), 1)
        found_manual_email = False
        for msg in outbox:
            if msg.get("to") == emp_email:
                found_manual_email = True
                # Assert NO password labels or credentials appear in text or HTML
                body_txt = msg.get("body", "")
                html_txt = msg.get("html", "")
                self.assertNotIn("Temporary Password", body_txt)
                self.assertNotIn("Temporary Password", html_txt)
                self.assertNotIn("Login Email:", body_txt)
                # Assert it contains the secure activation link
                self.assertIn("activation link", body_txt.lower())
                self.assertIn("token=", body_txt)

        self.assertTrue(found_manual_email, "Activation email was not found in outbox")

    # --- 10. Cross-Tenant Isolation & Role Authorization ---
    def test_10_cross_tenant_isolation_and_unauthorized_resend_revocation(self):
        """Non-admin and cross-tenant administrators cannot revoke or resend invitations."""
        tenant_a, admin_a, key_a = self.create_fixture_tenant("tenant-a")
        tenant_b, admin_b, key_b = self.create_fixture_tenant("tenant-b")
        headers_a = {"Authorization": f"Bearer {key_a}"}
        headers_b = {"Authorization": f"Bearer {key_b}"}

        # Tenant A creates an invitation
        res_a = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": "alice@tenant-a.demo", "itsm_role": "SERVICE_AGENT"},
            headers=headers_a,
        )
        signup_id = res_a.json()["signup_id"]

        # Tenant B tries to revoke Tenant A's invitation
        res_b_revoke = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/revoke",
            headers=headers_b,
        )
        self.assertEqual(res_b_revoke.status_code, 404)

        # Tenant B tries to resend Tenant A's invitation
        res_b_resend = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/resend",
            headers=headers_b,
        )
        self.assertEqual(res_b_resend.status_code, 404)

    # --- 11. Concurrency Control on Token Consumption ---
    def test_11_concurrent_token_consumption_is_atomic(self):
        """Two concurrent activation requests cannot consume the same token twice."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("race-token")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"race-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        def try_activate():
            c = TestClient(app)
            return c.post(
                "/v1/auth/activate",
                json={"signup_id": signup_id, "token": raw_token, "password": "SecurePassword123!"},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future1 = executor.submit(try_activate)
            future2 = executor.submit(try_activate)
            res1 = future1.result()
            res2 = future2.result()

        status_codes = sorted([res1.status_code, res2.status_code])
        self.assertEqual(status_codes, [200, 400], f"Expected exactly one 200 and one 400, got: {status_codes}")

    # --- 12. Audit Logging Never Captures Raw Tokens or Passwords ---
    def test_12_audit_logging_excludes_secrets(self):
        """Audit log metadata never captures raw activation tokens, complete URLs, or passwords."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("audit-sec")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"audit-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "PROCESS_CHANGE_MANAGER"},
            headers=headers,
        )
        data = invite_res.json()
        signup_id = data["signup_id"]
        action_url = data["action_url"]
        raw_token = action_url.split("token=")[1].split("&")[0]

        self.client.post(
            "/v1/auth/activate",
            json={"signup_id": signup_id, "token": raw_token, "password": "SuperSecretPass123!"},
        )

        with self.migrator_engine.connect() as conn:
            audit_events = conn.execute(
                text("SELECT action, provider, reason FROM public.audit_log_metadata WHERE tenant_id = :t"),
                {"t": tenant_id},
            ).all()

            for ev in audit_events:
                ev_str = f"{ev.action} {ev.provider} {ev.reason}"
                self.assertNotIn(raw_token, ev_str)
                self.assertNotIn(action_url, ev_str)
                self.assertNotIn("SuperSecretPass123!", ev_str)

    # --- 13. Plain-Text Invitation Emails Contain Activation Link and No Passwords ---
    def test_13_plaintext_invitation_email_contains_link_and_no_passwords(self):
        """Plain-text activation emails contain required link, expiry, notice, and zero passwords."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("plain-tpl")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"plain-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)

        outbox = read_local_outbox()
        self.assertGreaterEqual(len(outbox), 1)
        msg = outbox[-1]
        self.assertEqual(msg["to"], emp_email)

        # Subject verification
        subject = msg.get("subject", "")
        self.assertIn("Activate Your AuthClaw ITSM Account", subject)

        body = msg.get("body", "")
        # Required elements in plain-text
        self.assertIn("An administrator has invited you to AuthClaw ITSM", body)
        self.assertIn(f"Account Email: {emp_email}", body)
        self.assertIn("Activation Link:\n", body)
        self.assertIn("token=", body)
        self.assertIn("expire in 24 hours", body)
        self.assertIn("Security Notice:", body)
        self.assertIn("single-use, strictly confidential, and should not be shared", body)

        # Absolute prohibition of passwords or credential delivery
        self.assertNotIn("Temporary Password", body)
        self.assertNotIn("temporary password", body.lower())
        self.assertNotIn("Generated Password", body)
        self.assertNotIn("generated password", body.lower())
        self.assertNotIn("Login Password", body)
        self.assertNotIn("&password=", body)
        self.assertNotIn("?password=", body)

    # --- 14. HTML Invitation Emails Contain Clickable Activation Link and No Passwords ---
    def test_14_html_invitation_email_contains_clickable_link_and_no_passwords(self):
        """HTML activation emails contain clickable CTA link, security notice, and zero passwords."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("html-tpl")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"html-{uuid4().hex[:8]}@company.demo"

        res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "INCIDENT_MANAGER"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 201)

        outbox = read_local_outbox()
        self.assertGreaterEqual(len(outbox), 1)
        msg = outbox[-1]

        html = msg.get("html", "")
        self.assertIsNotNone(html)
        self.assertIn("<a href=", html)
        self.assertIn("token=", html)
        self.assertIn("Activate Account &amp; Set Password", html.replace("&", "&amp;"))
        self.assertIn("Activate Your AuthClaw ITSM Account", html)
        self.assertIn(f"<strong>Account Email:</strong> {emp_email}", html)
        self.assertIn("Security Notice:", html)
        self.assertIn("single-use, strictly confidential, and should not be shared", html)
        self.assertIn("24 hours", html)

        # Absolute prohibition of passwords in HTML
        self.assertNotIn("Temporary Password", html)
        self.assertNotIn("temporary password", html.lower())
        self.assertNotIn("Generated Password", html)
        self.assertNotIn("generated password", html.lower())
        self.assertNotIn("password=", html)

    # --- 15. Both Employee Creation and Invitation Flows Use Activation Email Service ---
    def test_15_both_creation_and_invitation_use_activation_email_service(self):
        """Both /users/invite and /users/create route through the secure activation email service."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("dual-flow")
        headers = {"Authorization": f"Bearer {api_key}"}

        # 1. Invitation Flow
        invite_email = f"invite-flow-{uuid4().hex[:8]}@company.demo"
        res_invite = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": invite_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(res_invite.status_code, 201)
        invite_data = res_invite.json()
        self.assertEqual(invite_data["status"], "invited")

        # 2. Manual Creation Flow (with email_credentials=True)
        manual_email = f"manual-flow-{uuid4().hex[:8]}@company.demo"
        res_manual = self.client.post(
            "/v1/itsm/admin/users/create",
            json={
                "email": manual_email,
                "itsm_role": "REQUESTER",
                "email_credentials": True,
            },
            headers=headers,
        )
        self.assertEqual(res_manual.status_code, 201)
        manual_data = res_manual.json()
        self.assertEqual(manual_data["status"], "created")

        # Verify database state for both: accounts are pending activation with NO password set
        with self.migrator_engine.connect() as conn:
            for email in (invite_email, manual_email):
                u = conn.execute(
                    text("SELECT is_active, password_hash FROM public.users WHERE tenant_id = :t AND email = :e"),
                    {"t": tenant_id, "e": email},
                ).first()
                self.assertIsNotNone(u)
                self.assertFalse(u.is_active)
                self.assertIsNone(u.password_hash)

        # Verify outbox received activation emails for both
        outbox = read_local_outbox()
        sent_emails = {m["to"] for m in outbox}
        self.assertIn(invite_email, sent_emails)
        self.assertIn(manual_email, sent_emails)

        # Verify the manual creation user can activate with their chosen password
        manual_email_msg = [m for m in outbox if m["to"] == manual_email][0]
        token_str = manual_email_msg["body"].split("token=")[1].split("&")[0].split()[0]
        signup_id = manual_data["signup_id"]

        act_res = self.client.post(
            "/v1/auth/activate",
            json={
                "signup_id": signup_id,
                "token": token_str,
                "password": "ManualUserNewPass123!@",
            },
        )
        self.assertEqual(act_res.status_code, 200)

        # Activated manual user can now sign in
        login_res = self.client.post(
            "/v1/auth/login",
            json={"email": manual_email, "password": "ManualUserNewPass123!@"},
        )
        self.assertEqual(login_res.status_code, 200)

    # --- 16. Email Delivery Failure Handling and Safe Audit ---
    def test_16_email_delivery_failure_safe_handling_and_audit(self):
        """Failed email delivery rolls back state, emits failure audit without secrets, and allows retry."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("fail-handling")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"fail-flow-{uuid4().hex[:8]}@company.demo"

        # 1. Delivery failure during invite
        with patch("app.api.v1.endpoints.itsm_admin.send_activation_email", side_effect=EmailDeliveryError("SMTP timeout")), \
             patch("app.services.itsm_employee_activation_service.send_activation_email", side_effect=EmailDeliveryError("SMTP timeout")):
            res = self.client.post(
                "/v1/itsm/admin/users/invite",
                json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
                headers=headers,
            )
            self.assertEqual(res.status_code, 503)
            self.assertEqual(res.json()["detail"], "Internal server error")

        # Verify rollback: no valid pending invite row committed
        with self.migrator_engine.connect() as conn:
            count = conn.execute(
                text("SELECT count(*) FROM public.onboarding_email_otps WHERE tenant_id = :t AND email = :e AND status = 'pending'"),
                {"t": tenant_id, "e": emp_email},
            ).scalar()
            self.assertEqual(count, 0)

            # Failure audit event recorded safely
            audit_events = conn.execute(
                text("SELECT action, reason FROM public.audit_log_metadata WHERE tenant_id = :t AND action = 'itsm.employee.invite_delivery_failed'"),
                {"t": tenant_id},
            ).all()
            self.assertGreaterEqual(len(audit_events), 1)
            self.assertEqual(audit_events[0].reason, "delivery_failed")

        # 2. Retry succeeds once email service is restored
        retry_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(retry_res.status_code, 201)
        signup_id = retry_res.json()["signup_id"]

        # 3. Delivery failure during resend
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET sent_at = now() - interval '70 seconds' WHERE id = :id"),
                {"id": signup_id},
            )

        with patch("app.api.v1.endpoints.itsm_admin.send_activation_email", side_effect=EmailDeliveryError("SMTP unavailable")), \
             patch("app.services.itsm_employee_activation_service.send_activation_email", side_effect=EmailDeliveryError("SMTP unavailable")):
            resend_fail_res = self.client.post(
                f"/v1/itsm/admin/users/invites/{signup_id}/resend",
                headers=headers,
            )
            self.assertEqual(resend_fail_res.status_code, 503)

        with self.migrator_engine.connect() as conn:
            resend_audits = conn.execute(
                text("SELECT action, reason FROM public.audit_log_metadata WHERE tenant_id = :t AND action = 'itsm.employee.resend_delivery_failed'"),
                {"t": tenant_id},
            ).all()
            self.assertGreaterEqual(len(resend_audits), 1)

    # --- 17. Resend Rate Limiting and Cooldown Enforcement ---
    def test_17_resend_cooldown_rate_limiting(self):
        """Repeated resend attempts within cooldown window return HTTP 429."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("cooldown")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"cool-{uuid4().hex[:8]}@company.demo"

        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        self.assertEqual(invite_res.status_code, 201)
        signup_id = invite_res.json()["signup_id"]

        # Immediate resend rejected by 60-second cooldown
        resend_res1 = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/resend",
            headers=headers,
        )
        self.assertEqual(resend_res1.status_code, 429)
        self.assertIn("60 seconds", resend_res1.json()["detail"])

        # Advance sent_at in database past cooldown
        with self.migrator_engine.begin() as conn:
            conn.execute(
                text("UPDATE public.onboarding_email_otps SET sent_at = now() - interval '65 seconds' WHERE id = :id"),
                {"id": signup_id},
            )

        # Resend succeeds after cooldown
        resend_res2 = self.client.post(
            f"/v1/itsm/admin/users/invites/{signup_id}/resend",
            headers=headers,
        )
        self.assertEqual(resend_res2.status_code, 200)
        self.assertEqual(resend_res2.json()["status"], "resent")

    # --- 18. Existing Password Reset and Normal Login Workflows Continue Working ---
    def test_18_existing_password_reset_and_login_workflows_continue_working(self):
        """Existing password reset and standard login flows remain fully functional."""
        tenant_id, admin_id, api_key = self.create_fixture_tenant("pwd-reset")
        headers = {"Authorization": f"Bearer {api_key}"}
        emp_email = f"reset-{uuid4().hex[:8]}@company.demo"

        # 1. Invite and activate employee
        invite_res = self.client.post(
            "/v1/itsm/admin/users/invite",
            json={"email": emp_email, "itsm_role": "SERVICE_AGENT"},
            headers=headers,
        )
        data = invite_res.json()
        raw_token = data["action_url"].split("token=")[1].split("&")[0]

        act_res = self.client.post(
            "/v1/auth/activate",
            json={"signup_id": data["signup_id"], "token": raw_token, "password": "OriginalPassword123!"},
        )
        self.assertEqual(act_res.status_code, 200)

        # 2. Login works with activated password
        login1 = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": "OriginalPassword123!"},
        )
        self.assertEqual(login1.status_code, 200)
        self.assertIsNotNone(login1.json()["session_token"])

        # 3. Request password reset with deterministic OTP mock
        expected_otp = "852963"
        with patch("app.api.v1.endpoints.auth._generate_otp", return_value=expected_otp):
            reset_req = self.client.post(
                "/v1/auth/password-reset/request",
                json={"email": emp_email},
            )
            self.assertEqual(reset_req.status_code, 202)
            reset_data = reset_req.json()
            reset_signup_id = reset_data["signup_id"]

        # 4. Confirm password reset with new password using expected OTP
        confirm_res = self.client.post(
            "/v1/auth/password-reset/confirm",
            json={
                "signup_id": reset_signup_id,
                "otp": expected_otp,
                "password": "NewlyResetPassword123!@#",
            },
        )
        self.assertEqual(confirm_res.status_code, 200)

        # 5. Sign in with newly reset password succeeds
        login2 = self.client.post(
            "/v1/auth/login",
            json={"email": emp_email, "password": "NewlyResetPassword123!@#"},
        )
        self.assertEqual(login2.status_code, 200)
        self.assertEqual(login2.json()["email"], emp_email)

