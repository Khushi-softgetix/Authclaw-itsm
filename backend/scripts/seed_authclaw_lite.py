"""Seed AuthClaw Lite demo tenant, admin, key, route, and starter policy."""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.crypto import encrypt_secret
from app.core.auth import hash_key
from app.core.passwords import hash_password


load_dotenv("../.env.local")
load_dotenv(".env.local")

TENANT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
SECONDARY_TENANT_ID = uuid.UUID("11111111-1111-4111-8111-111111111112")
ADMIN_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
PLATFORM_ADMIN_ID = uuid.UUID("77777777-7777-4777-8777-777777777777")
ROLE_USERS = (
    (uuid.UUID("22222222-2222-4222-8222-222222222223"), "admin-role@authclaw-lite.demo", "admin"),
    (uuid.UUID("22222222-2222-4222-8222-222222222224"), "operator@authclaw-lite.demo", "operator"),
    (uuid.UUID("22222222-2222-4222-8222-222222222225"), "viewer@authclaw-lite.demo", "viewer"),
)
ITSM_AGENT_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222226")
ITSM_AGENT_EMAIL = "itsm-agent@test.com"
ITSM_REQUESTER_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222227")
ITSM_REQUESTER_EMAIL = "requester123@gmail.com"
RAW_REQUESTER_PASSWORD = os.getenv("AUTHCLAW_ITSM_REQUESTER_PASSWORD", "Requester@123")
ITSM_INCIDENT_MANAGER_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222228")
ITSM_INCIDENT_MANAGER_EMAIL = "incidentmanager@authclaw-lite.demo"
RAW_INCIDENT_MANAGER_PASSWORD = os.getenv("AUTHCLAW_ITSM_INCIDENT_MANAGER_PASSWORD", "AuthClawDemo!234")
ITSM_AGENT_LITE_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222229")
ITSM_REQUESTER_LITE_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222230")
ITSM_PROCESS_CHANGE_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222231")
ITSM_AUDITOR_USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222232")
API_KEY_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
GATEWAY_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
POLICY_ID = uuid.UUID("55555555-5555-4555-8555-555555555555")
PROVIDER_CREDENTIAL_ID = uuid.UUID("66666666-6666-4666-8666-666666666666")
RAW_API_KEY = os.getenv("AUTHCLAW_LITE_DEMO_KEY", "acl_lite_demo_key")
RAW_ADMIN_PASSWORD = os.getenv("AUTHCLAW_LITE_DEMO_PASSWORD", "AuthClawDemo!234")
RAW_PLATFORM_ADMIN_EMAIL = os.getenv("AUTHCLAW_PLATFORM_ADMIN_EMAIL", "developer@authclaw.local").strip().lower()
RAW_PLATFORM_ADMIN_PASSWORD = os.getenv("AUTHCLAW_PLATFORM_ADMIN_PASSWORD", "AuthClawDeveloper!234")
RAW_ADMIN_TOTP_SECRET = os.getenv("AUTHCLAW_LITE_DEMO_TOTP_SECRET", "").strip() or None
RAW_PROVIDER_KEY = os.getenv("AUTHCLAW_LITE_PROVIDER_KEY", "ci-mock-provider-key")
PROVIDER_ENDPOINT = os.getenv("AUTHCLAW_LITE_PROVIDER_ENDPOINT", "")
POLICY_REQUESTS_PER_MINUTE = max(0, int(os.getenv("AUTHCLAW_LITE_POLICY_REQUESTS_PER_MINUTE", "60")))

STARTER_POLICY = rf'''regex_rules:
  - name: customer_email
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{{2,}}\\b"
    reason: "Email addresses are redacted before model egress."
    severity: medium
    action: redact

  - name: patient_health_data
    pattern: "(?i)\\b(patient|diagnosis|prescription|medical record)\\b"
    reason: "Health context requires human approval before model egress."
    severity: high
    action: require_approval
    hitl_timeout_seconds: 1800

  - name: ssn_block
    pattern: "\\b\\d{{3}}-\\d{{2}}-\\d{{4}}\\b"
    reason: "SSNs are blocked in the Lite demo policy."
    severity: critical
    action: block

model_rules:
  whitelist:
    - gpt-4o-mini
    - gemini-2.5-flash-lite
  blacklist: []

topic_rules: []

rate_limits:
  requests_per_minute: {POLICY_REQUESTS_PER_MINUTE}
'''


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> None:
    if os.getenv("AUTHCLAW_ENV", "local").strip().lower() in {"production", "prod"}:
        raise RuntimeError("Demo seeding is forbidden in production")
    raw_database_url = os.getenv("DEMO_SEED_DATABASE_URL") or os.getenv("BOOTSTRAP_DATABASE_URL")
    if not raw_database_url:
        raise RuntimeError("DEMO_SEED_DATABASE_URL is required; runtime DATABASE_URL is never accepted")
    database_url = normalize_database_url(raw_database_url)
    engine = create_engine(database_url, pool_pre_ping=True)
    key_hash = hash_key(RAW_API_KEY)

    with engine.begin() as conn:
        conn.execute(
            text("""
            INSERT INTO authn.platform_admins (id, email, password_hash, display_name, role, is_active)
            VALUES (:id, :email, :password_hash, 'AuthClaw Developer', 'ADMIN', true)
            ON CONFLICT (email) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                role = 'ADMIN',
                updated_at = NOW()
            """),
            {
                "id": PLATFORM_ADMIN_ID,
                "email": RAW_PLATFORM_ADMIN_EMAIL,
                "password_hash": hash_password(RAW_PLATFORM_ADMIN_PASSWORD),
            },
        )

        conn.execute(
            text("""
            INSERT INTO tenants (id, name, tier, status)
            VALUES (:id, 'AuthClaw Lite Demo', 'starter', 'active')
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                tier = EXCLUDED.tier,
                status = EXCLUDED.status,
                updated_at = NOW()
            """),
            {"id": TENANT_ID},
        )
        conn.execute(
            text("""
            INSERT INTO tenants (id, name, tier, status)
            VALUES (:id, 'AuthClaw Role Fixture', 'starter', 'active')
            ON CONFLICT (id) DO UPDATE SET status = 'active', updated_at = NOW()
            """),
            {"id": SECONDARY_TENANT_ID},
        )
        conn.execute(
            text("""
            INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, mfa_secret, is_active)
            VALUES (:id, :tenant_id, 'admin@authclaw-lite.demo', :password_hash, 'owner', 'NONE', :mfa_enabled, :mfa_secret, true)
            ON CONFLICT (tenant_id, email) DO UPDATE SET
                password_hash = users.password_hash,
                role = EXCLUDED.role,
                mfa_enabled = users.mfa_enabled,
                mfa_secret = users.mfa_secret,
                is_active = true,
                updated_at = NOW()
            """),
            {
                "id": ADMIN_USER_ID,
                "tenant_id": TENANT_ID,
                "password_hash": hash_password(RAW_ADMIN_PASSWORD),
                "mfa_enabled": RAW_ADMIN_TOTP_SECRET is not None,
                "mfa_secret": (
                    encrypt_secret(RAW_ADMIN_TOTP_SECRET)
                    if RAW_ADMIN_TOTP_SECRET
                    else None
                ),
            },
        )

        for user_id, email, role in ROLE_USERS:
            conn.execute(
                text("""
                INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
                VALUES (:id, :tenant_id, :email, :password_hash, :role, 'NONE', false, true)
                ON CONFLICT (tenant_id, email) DO UPDATE SET
                    password_hash = users.password_hash,
                    role = EXCLUDED.role,
                    is_active = true,
                    updated_at = NOW()
                """),
                {
                    "id": user_id,
                    "tenant_id": TENANT_ID,
                    "email": email,
                    "password_hash": hash_password(RAW_ADMIN_PASSWORD),
                    "role": role,
                },
            )
            conn.execute(
                text("""
                INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
                VALUES (:id, :tenant_id, :email, :password_hash, :role, 'NONE', false, true)
                ON CONFLICT (tenant_id, email) DO UPDATE SET
                    password_hash = users.password_hash,
                    role = EXCLUDED.role,
                    is_active = true,
                    updated_at = NOW()
                """),
                {
                    "id": uuid.uuid5(SECONDARY_TENANT_ID, email),
                    "tenant_id": SECONDARY_TENANT_ID,
                    "email": email,
                    "password_hash": hash_password(RAW_ADMIN_PASSWORD),
                    "role": role,
                },
            )

        # Seed ITSM Test User (itsm-agent@test.com)
        conn.execute(
            text("""
            INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
            VALUES (:id, :tenant_id, :email, :password_hash, 'operator', 'NONE', false, true)
            ON CONFLICT (tenant_id, email) DO UPDATE SET
                password_hash = users.password_hash,
                role = 'operator',
                is_active = true,
                updated_at = NOW()
            """),
            {
                "id": ITSM_AGENT_USER_ID,
                "tenant_id": TENANT_ID,
                "email": ITSM_AGENT_EMAIL,
                "password_hash": hash_password(RAW_ADMIN_PASSWORD),
            },
        )

        # Seed ITSM Test Requester (requester123@gmail.com)
        conn.execute(
            text("""
            INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
            VALUES (:id, :tenant_id, :email, :password_hash, 'viewer', 'NONE', false, true)
            ON CONFLICT (tenant_id, email) DO UPDATE SET
                password_hash = users.password_hash,
                role = 'viewer',
                is_active = true,
                updated_at = NOW()
            """),
            {
                "id": ITSM_REQUESTER_USER_ID,
                "tenant_id": TENANT_ID,
                "email": ITSM_REQUESTER_EMAIL,
                "password_hash": hash_password(RAW_REQUESTER_PASSWORD),
            },
        )

        conn.execute(
            text("""
            INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
            VALUES (:id, :tenant_id, :email, :password_hash, 'viewer', 'NONE', false, true)
            ON CONFLICT (tenant_id, email) DO UPDATE SET
                password_hash = users.password_hash,
                role = 'viewer',
                is_active = true,
                updated_at = NOW()
            """),
            {
                "id": ITSM_INCIDENT_MANAGER_USER_ID,
                "tenant_id": TENANT_ID,
                "email": ITSM_INCIDENT_MANAGER_EMAIL,
                "password_hash": hash_password(RAW_INCIDENT_MANAGER_PASSWORD),
            },
        )

        # Seed additional standard test accounts
        additional_test_users = [
            (ITSM_AGENT_LITE_USER_ID, "agent@authclaw-lite.demo", "SERVICE_AGENT", True, False),
            (ITSM_REQUESTER_LITE_USER_ID, "requester@authclaw-lite.demo", "REQUESTER", True, False),
            (ITSM_PROCESS_CHANGE_USER_ID, "processchange@authclaw-lite.demo", "PROCESS_CHANGE_MANAGER", True, False),
            (ITSM_AUDITOR_USER_ID, "auditor@authclaw-lite.demo", "AUDITOR", True, False),
        ]
        for u_id, u_email, u_role, u_itsm, u_gov in additional_test_users:
            conn.execute(
                text("""
                INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
                VALUES (:id, :tenant_id, :email, :password_hash, 'viewer', 'NONE', false, true)
                ON CONFLICT (tenant_id, email) DO UPDATE SET
                    password_hash = users.password_hash,
                    role = 'viewer',
                    is_active = true,
                    updated_at = NOW()
                """),
                {
                    "id": u_id,
                    "tenant_id": TENANT_ID,
                    "email": u_email,
                    "password_hash": hash_password(RAW_ADMIN_PASSWORD),
                },
            )

        # Seed ITSM Product Access & Business Roles
        conn.execute(
            text("""
            INSERT INTO itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access)
            VALUES
                (gen_random_uuid(), :tenant_id, :admin_id, 'PLATFORM_ADMINISTRATOR', true, true),
                (gen_random_uuid(), :tenant_id, :agent_id, 'SERVICE_AGENT', true, false),
                (gen_random_uuid(), :tenant_id, :agent_lite_id, 'SERVICE_AGENT', true, false),
                (gen_random_uuid(), :tenant_id, :operator_id, 'INCIDENT_MANAGER', true, true),
                (gen_random_uuid(), :tenant_id, :incident_manager_id, 'INCIDENT_MANAGER', true, false),
                (gen_random_uuid(), :tenant_id, :requester_id, 'REQUESTER', true, false),
                (gen_random_uuid(), :tenant_id, :requester_lite_id, 'REQUESTER', true, false),
                (gen_random_uuid(), :tenant_id, :pcm_id, 'PROCESS_CHANGE_MANAGER', true, false),
                (gen_random_uuid(), :tenant_id, :auditor_id, 'AUDITOR', true, false),
                (gen_random_uuid(), :tenant_id, :viewer_id, 'REQUESTER', false, true)
            ON CONFLICT (tenant_id, user_id) DO UPDATE SET
                itsm_role = EXCLUDED.itsm_role,
                has_itsm_access = EXCLUDED.has_itsm_access,
                has_governance_access = EXCLUDED.has_governance_access,
                updated_at = NOW()
            """),
            {
                "tenant_id": TENANT_ID,
                "admin_id": ADMIN_USER_ID,
                "agent_id": ITSM_AGENT_USER_ID,
                "agent_lite_id": ITSM_AGENT_LITE_USER_ID,
                "operator_id": uuid.UUID("22222222-2222-4222-8222-222222222224"),
                "incident_manager_id": ITSM_INCIDENT_MANAGER_USER_ID,
                "requester_id": ITSM_REQUESTER_USER_ID,
                "requester_lite_id": ITSM_REQUESTER_LITE_USER_ID,
                "pcm_id": ITSM_PROCESS_CHANGE_USER_ID,
                "auditor_id": ITSM_AUDITOR_USER_ID,
                "viewer_id": uuid.UUID("22222222-2222-4222-8222-222222222225"),
            },
        )
        conn.execute(
            text("""
            INSERT INTO api_keys (id, tenant_id, key_hash, name, description, scopes, is_active, expires_at, created_by)
            VALUES (
                :id, :tenant_id, :key_hash, 'AuthClaw Lite Demo Key',
                'Seeded key for local/AWS Lite demo',
                ARRAY['admin','read','write'], true, NOW() + INTERVAL '90 days', :created_by
            )
            ON CONFLICT (id) DO NOTHING
            """),
            {"id": API_KEY_ID, "tenant_id": TENANT_ID, "key_hash": key_hash, "created_by": ADMIN_USER_ID},
        )

        conn.execute(
            text("""
            INSERT INTO gateway_configs (
                id, tenant_id, name, provider, endpoint, model_whitelist, redaction_strategy, redaction_token_retention_days, is_active
            )
            VALUES (
                :id, :tenant_id, 'Demo Gemini Route', 'gemini',
                'https://generativelanguage.googleapis.com',
                ARRAY['gemini-2.5-flash-lite'], 'mask', 90, true
            )
            ON CONFLICT (id) DO UPDATE SET
                endpoint = EXCLUDED.endpoint,
                model_whitelist = EXCLUDED.model_whitelist,
                redaction_strategy = EXCLUDED.redaction_strategy,
                redaction_token_retention_days = EXCLUDED.redaction_token_retention_days,
                is_active = true,
                updated_at = NOW()
            """),
            {"id": GATEWAY_ID, "tenant_id": TENANT_ID},
        )

        conn.execute(
            text("""
            INSERT INTO provider_credentials (
                id, tenant_id, provider, display_name, endpoint, encrypted_secret,
                auth_scheme, status, created_by, version, revoked_at
            )
            VALUES (
                :id, :tenant_id, 'gemini', 'Demo Gemini Credential', :endpoint, :encrypted_secret,
                'api_key', 'active', :created_by, 1, NULL
            )
            ON CONFLICT (id) DO UPDATE SET
                endpoint = EXCLUDED.endpoint,
                encrypted_secret = EXCLUDED.encrypted_secret,
                status = 'active',
                revoked_at = NULL,
                rotated_at = NOW(),
                version = provider_credentials.version + 1
            """),
            {
                "id": PROVIDER_CREDENTIAL_ID,
                "tenant_id": TENANT_ID,
                "endpoint": PROVIDER_ENDPOINT or None,
                "encrypted_secret": encrypt_secret(RAW_PROVIDER_KEY),
                "created_by": ADMIN_USER_ID,
            },
        )

        conn.execute(text("UPDATE policies SET is_active = false WHERE tenant_id = :tenant_id"), {"tenant_id": TENANT_ID})
        conn.execute(
            text("""
            INSERT INTO policies (
                id, tenant_id, name, description, policy_yaml, version, is_active, created_by
            )
            VALUES (
                :id, :tenant_id, 'AuthClaw Lite Starter Policy',
                'Starter demo policy with redact, HITL, and block actions.',
                :policy_yaml, 1, true, :created_by
            )
            ON CONFLICT (id) DO UPDATE SET
                policy_yaml = EXCLUDED.policy_yaml,
                is_active = true,
                updated_at = NOW()
            """),
            {
                "id": POLICY_ID,
                "tenant_id": TENANT_ID,
                "policy_yaml": STARTER_POLICY,
                "created_by": ADMIN_USER_ID,
            },
        )

        # Seed standard ITSM Knowledge Articles
        seed_kb_articles = [
            (
                uuid.UUID("66666666-6666-4666-8666-666666666671"),
                "connecting-to-corporate-wireguard-vpn",
                "Connecting to Corporate WireGuard VPN",
                "Networking",
                "Step-by-step setup for WireGuard VPN client across macOS, Windows, and Linux workstations.",
                "### Connecting to Corporate WireGuard VPN\n\nAuthClaw corporate network access requires an encrypted WireGuard VPN tunnel for remote connectivity. Ensure you have your tenant client configuration file before starting.\n\n#### Prerequisites\n1. Active AuthClaw SSO credentials.\n2. Workstation enrolled in corporate device management.\n\n#### Setup Steps\n1. Download and install the official WireGuard client from wireguard.com.\n2. Open WireGuard and select **Add Tunnel** -> **Import Tunnel from File**.\n3. Select your `.conf` certificate downloaded from the Service Catalog.\n4. Toggle the tunnel active and verify connection status via `ping 10.0.0.1`.",
                ["vpn", "wireguard", "remote", "network"],
            ),
            (
                uuid.UUID("66666666-6666-4666-8666-666666666672"),
                "vpn-connection-setup",
                "VPN Connection Setup",
                "Networking",
                "Detailed walkthrough for configuring client certificates, DNS routing, and split-tunneling.",
                "### VPN Connection Setup\n\nConfigure your secure remote access profile with correct DNS servers and routing domains.\n\n#### Instructions\n1. Open your enterprise connection profile settings.\n2. Verify the gateway endpoint is set to `vpn.authclaw-corp.internal`.\n3. Enable DNS suffix search list for internal hostnames.\n4. Connect and test intranet reachability.",
                ["vpn", "setup", "networking", "connection"],
            ),
            (
                uuid.UUID("66666666-6666-4666-8666-666666666673"),
                "vpn-common-errors",
                "VPN Common Errors & Troubleshooting",
                "Troubleshooting",
                "Resolving handshake timeouts, MTU fragmentation, and routing conflicts in VPN sessions.",
                "### VPN Common Errors & Troubleshooting\n\nCommon diagnostic procedures when experiencing VPN dropped packets or handshake failures.\n\n#### Troubleshooting Matrix\n- **Error 101 (Handshake Timeout)**: Check firewall UDP port 51820 egress.\n- **Error 204 (MTU Packet Drop)**: Clamp tunnel MTU to 1360 in `.conf` interface section.\n- **Error 305 (Split-Tunnel Collision)**: Ensure local subnet does not overlap with 10.0.0.0/16.",
                ["vpn", "troubleshooting", "errors", "timeout"],
            ),
            (
                uuid.UUID("66666666-6666-4666-8666-666666666674"),
                "troubleshooting-okta-sso-sessions",
                "Troubleshooting Okta Single Sign-On (SSO) Sessions",
                "Authentication",
                "Resolving session cookie timeouts, MFA loop prompts, and browser cache conflicts.",
                "### Troubleshooting Okta Single Sign-On (SSO) Sessions\n\nIf you experience redirect loops or session cookie expiration during sign-in, follow these remediation steps.\n\n#### Resolution Steps\n1. Clear browser cookies and cache for `*.authclaw.com` and your identity provider.\n2. Disable third-party tracking blocker extensions temporarily.\n3. Ensure workstation clock is synchronized with UTC network time.\n4. Attempt logging in using a private or incognito window.",
                ["okta", "sso", "authentication", "login"],
            ),
            (
                uuid.UUID("66666666-6666-4666-8666-666666666675"),
                "setting-up-hardware-security-keys",
                "Setting Up Hardware Security Keys (YubiKey)",
                "Security",
                "Registering FIDO2 / WebAuthn YubiKey devices for phishing-resistant MFA.",
                "### Setting Up Hardware Security Keys (YubiKey)\n\nHardware security keys protect accounts against phishing and credential theft through cryptographic origin binding.\n\n#### Registration Steps\n1. Plug your YubiKey into a USB-A or USB-C port on your workstation.\n2. Go to **Account Settings** -> **Security & MFA** -> **Add Hardware Key**.\n3. Touch the gold contact point on your key when prompted by the browser.\n4. Save your one-time backup recovery codes in a secure secret manager.",
                ["yubikey", "security", "fido2", "mfa", "hardware"],
            ),
        ]

        for kb_id, kb_slug, kb_title, kb_category, kb_summary, kb_content, kb_keywords in seed_kb_articles:
            conn.execute(
                text("""
                INSERT INTO itsm_knowledge_articles (
                    id, tenant_id, title, slug, category, status, current_published_version,
                    view_count, helpful_count, author_id, published_at, created_at, updated_at
                )
                VALUES (
                    :id, :tenant_id, :title, :slug, :category, 'PUBLISHED', 1,
                    42, 12, :author_id, NOW(), NOW(), NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    slug = EXCLUDED.slug,
                    category = EXCLUDED.category,
                    status = EXCLUDED.status,
                    current_published_version = 1,
                    updated_at = NOW()
                """),
                {
                    "id": kb_id,
                    "tenant_id": TENANT_ID,
                    "title": kb_title,
                    "slug": kb_slug,
                    "category": kb_category,
                    "author_id": ADMIN_USER_ID,
                },
            )
            conn.execute(
                text("""
                INSERT INTO itsm_knowledge_article_versions (
                    id, tenant_id, article_id, version_number, title, content_markdown,
                    summary, keywords, change_summary, created_by, created_at
                )
                VALUES (
                    gen_random_uuid(), :tenant_id, :article_id, 1, :title, :content,
                    :summary, :keywords, 'Initial published version', :created_by, NOW()
                )
                ON CONFLICT (tenant_id, article_id, version_number) DO UPDATE SET
                    title = EXCLUDED.title,
                    content_markdown = EXCLUDED.content_markdown,
                    summary = EXCLUDED.summary,
                    keywords = EXCLUDED.keywords
                """),
                {
                    "tenant_id": TENANT_ID,
                    "article_id": kb_id,
                    "title": kb_title,
                    "content": kb_content,
                    "summary": kb_summary,
                    "keywords": kb_keywords,
                    "created_by": ADMIN_USER_ID,
                },
            )

        # Seed standard ITSM Service Requests (Step 6)
        service_id = uuid.UUID("77777777-7777-4777-8777-777777777790")
        catalog_laptop_id = uuid.UUID("77777777-7777-4777-8777-777777777791")
        catalog_cloud_id = uuid.UUID("77777777-7777-4777-8777-777777777792")
        catalog_yubikey_id = uuid.UUID("77777777-7777-4777-8777-777777777793")

        services_seed = [
            (service_id, "Workplace Technology", "workplace-technology", "End-user hardware, cloud sandboxes, and identity devices.", "OPERATIONAL", "TIER_2", "IT Support Team"),
            (uuid.UUID("77777777-7777-4777-8777-777777777794"), "Corporate Network & VPN", "network-vpn", "WireGuard enterprise remote access gateway and office WiFi infrastructure.", "OPERATIONAL", "TIER_1", "Network Engineering"),
            (uuid.UUID("77777777-7777-4777-8777-777777777795"), "Identity & Access Management", "identity-sso", "Okta Single Sign-On, MFA token orchestration, and directory federation.", "OPERATIONAL", "TIER_1", "SecOps Identity"),
            (uuid.UUID("77777777-7777-4777-8777-777777777796"), "Payments Platform API", "payments-api", "Core transaction processing pipeline, ledger sync, and billing gateways.", "DEGRADED", "TIER_1", "Payments Core"),
        ]

        for s_id, s_name, s_slug, s_desc, s_stat, s_tier, s_team in services_seed:
            conn.execute(
                text("""
                INSERT INTO itsm_services (id, tenant_id, name, slug, description, status, tier, escalation_team, owner_user_id, created_at, updated_at)
                VALUES (:id, :tenant_id, :name, :slug, :description, :status, :tier, :escalation_team, :owner_id, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, description = EXCLUDED.description, tier = EXCLUDED.tier, escalation_team = EXCLUDED.escalation_team
                """),
                {
                    "id": s_id,
                    "tenant_id": TENANT_ID,
                    "name": s_name,
                    "slug": s_slug,
                    "description": s_desc,
                    "status": s_stat,
                    "tier": s_tier,
                    "escalation_team": s_team,
                    "owner_id": ADMIN_USER_ID,
                },
            )

        # Seed Configuration Items (CIs)
        ci_seeds = [
            (uuid.UUID("77777777-7777-4777-8777-7777777777a1"), "vpn-gw-prod-uswest", "NETWORK", uuid.UUID("77777777-7777-4777-8777-777777777794"), "PRODUCTION", "ACTIVE", '{"ip": "198.51.100.1", "version": "WireGuard 1.0.2"}'::jsonb),
            (uuid.UUID("77777777-7777-4777-8777-7777777777a2"), "okta-auth-bridge-01", "APPLICATION", uuid.UUID("77777777-7777-4777-8777-777777777795"), "PRODUCTION", "ACTIVE", '{"protocol": "SAML 2.0 / OIDC", "cluster": "us-west-2a"}'::jsonb),
            (uuid.UUID("77777777-7777-4777-8777-7777777777a3"), "macbook-fleet-mdm", "HARDWARE", service_id, "PRODUCTION", "ACTIVE", '{"enrolled_devices": 184, "agent": "Jamf Pro"}'::jsonb),
            (uuid.UUID("77777777-7777-4777-8777-7777777777a4"), "payments-postgres-primary", "DATABASE", uuid.UUID("77777777-7777-4777-8777-777777777796"), "PRODUCTION", "DEGRADED", '{"engine": "PostgreSQL 17.2", "region": "us-east-1"}'::jsonb),
        ]

        for ci_id, ci_name, ci_type, ci_svc_id, ci_env, ci_stat, ci_attrs in ci_seeds:
            conn.execute(
                text("""
                INSERT INTO itsm_configuration_items (id, tenant_id, service_id, name, ci_type, environment, status, attributes, created_at, updated_at)
                VALUES (:id, :tenant_id, :service_id, :name, :ci_type, :environment, :status, :attributes, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, service_id = EXCLUDED.service_id
                """),
                {
                    "id": ci_id,
                    "tenant_id": TENANT_ID,
                    "service_id": ci_svc_id,
                    "name": ci_name,
                    "ci_type": ci_type,
                    "environment": ci_env,
                    "status": ci_stat,
                    "attributes": ci_attrs,
                },
            )

        catalog_items = [
            (catalog_laptop_id, "Developer Workstation Laptop", "dev-laptop", "Standard high-performance engineer laptop."),
            (catalog_cloud_id, "Cloud Sandbox Access", "cloud-sandbox-access", "Temporary IAM roles and cloud sandboxes."),
            (catalog_yubikey_id, "Hardware Security Key Replacement", "yubikey-replacement", "FIDO2 security key issuance."),
        ]
        for c_id, c_name, c_slug, c_desc in catalog_items:
            conn.execute(
                text("""
                INSERT INTO itsm_service_catalog_items (
                    id, tenant_id, service_id, name, slug, description, version,
                    intake_schema, approval_required, fulfillment_group, is_active, created_at, updated_at
                )
                VALUES (
                    :id, :tenant_id, :service_id, :name, :slug, :description, 1,
                    '{"type": "object"}'::jsonb, false, 'IT Support Team', true, NOW(), NOW()
                )
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true
                """),
                {"id": c_id, "tenant_id": TENANT_ID, "service_id": service_id, "name": c_name, "slug": c_slug, "description": c_desc},
            )

        sr_tickets = [
            (
                uuid.UUID("77777777-7777-4777-8777-777777777781"),
                "REQ-000001",
                "Developer Workstation Laptop Provisioning",
                "Requesting new 16-inch M3 Max MacBook Pro for new engineering hire in Platform Engineering.",
                "P3",
                "IN_PROGRESS",
                ITSM_AGENT_USER_ID,
                "IT Support Team",
                None,
                None,
                catalog_laptop_id,
                {"laptop_model": "MacBook Pro 16-inch M3 Max", "ram_gb": 64, "storage_tb": 2, "department": "Platform Engineering", "cost_center": "ENG-4021"},
            ),
            (
                uuid.UUID("77777777-7777-4777-8777-777777777782"),
                "REQ-000002",
                "Cloud Sandbox IAM Permissions",
                "Need temporary elevated IAM role in dev-sandbox AWS account for load testing.",
                "P2",
                "NEW",
                None,
                "Cloud Operations",
                None,
                None,
                catalog_cloud_id,
                {"aws_account": "dev-sandbox-9921", "role_requested": "PowerUserAccess", "duration_days": 14, "justification": "Performance and load testing for AuthClaw Align MVP"},
            ),
            (
                uuid.UUID("77777777-7777-4777-8777-777777777783"),
                "REQ-000003",
                "Hardware Security Key Replacement (YubiKey 5C)",
                "Lost primary security key during travel. Requesting replacement YubiKey 5C NFC.",
                "P3",
                "RESOLVED",
                ITSM_AGENT_USER_ID,
                "IT Support Team",
                "FULFILLED",
                "Hardware security key provisioned, registered, and issued via desk pickup.",
                catalog_yubikey_id,
                {"key_type": "YubiKey 5C NFC", "office_location": "San Francisco HQ", "lost_key_revoked": True},
            ),
        ]

        for sr_id, sr_number, sr_title, sr_desc, sr_prio, sr_status, sr_assignee, sr_group, sr_code, sr_summary, cat_id, form_data in sr_tickets:
            resolved_time = "NOW()" if sr_status == "RESOLVED" else "NULL"
            conn.execute(
                text(f"""
                INSERT INTO itsm_tickets (
                    id, tenant_id, ticket_number, ticket_type, title, description, impact, urgency, priority,
                    status, source_channel, requester_id, assignee_id, assignment_group, service_id,
                    resolution_code, resolution_summary, resolved_at, sla_status, created_at, updated_at
                )
                VALUES (
                    :id, :tenant_id, :ticket_number, 'SERVICE_REQUEST', :title, :description, 'MEDIUM', 'MEDIUM', :priority,
                    :status, 'PORTAL', :requester_id, :assignee_id, :assignment_group, :service_id,
                    :resolution_code, :resolution_summary, {resolved_time},
                    'WITHIN_SLA', NOW() - INTERVAL '2 hours', NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    status = EXCLUDED.status,
                    priority = EXCLUDED.priority,
                    assignee_id = EXCLUDED.assignee_id,
                    assignment_group = EXCLUDED.assignment_group,
                    resolution_code = EXCLUDED.resolution_code,
                    resolution_summary = EXCLUDED.resolution_summary,
                    updated_at = NOW()
                """),
                {
                    "id": sr_id,
                    "tenant_id": TENANT_ID,
                    "ticket_number": sr_number,
                    "title": sr_title,
                    "description": sr_desc,
                    "priority": sr_prio,
                    "status": sr_status,
                    "requester_id": ITSM_REQUESTER_USER_ID,
                    "assignee_id": sr_assignee,
                    "assignment_group": sr_group,
                    "service_id": service_id,
                    "resolution_code": sr_code,
                    "resolution_summary": sr_summary,
                },
            )

            conn.execute(
                text("""
                INSERT INTO itsm_service_request_details (
                    id, tenant_id, ticket_id, catalog_item_id, catalog_item_version,
                    intake_schema_snapshot, submitted_form_data, created_at
                )
                VALUES (
                    gen_random_uuid(), :tenant_id, :ticket_id, :catalog_item_id, 1,
                    CAST('{"type": "object"}' AS JSONB), CAST(:form_data AS JSONB), NOW()
                )
                ON CONFLICT (tenant_id, ticket_id) DO UPDATE SET
                    submitted_form_data = EXCLUDED.submitted_form_data
                """),
                {
                    "tenant_id": TENANT_ID,
                    "ticket_id": sr_id,
                    "catalog_item_id": cat_id,
                    "form_data": __import__("json").dumps(form_data),
                },
            )

            conn.execute(
                text("""
                INSERT INTO itsm_ticket_activities (
                    id, tenant_id, ticket_id, activity_type, actor_id, actor_type, content, metadata, created_at
                )
                VALUES (
                    gen_random_uuid(), :tenant_id, :ticket_id, 'CREATION', :actor_id, 'USER',
                    'Service request submitted via catalog portal', CAST('{"actor_email": "requester123@gmail.com"}' AS JSONB), NOW() - INTERVAL '2 hours'
                )
                ON CONFLICT DO NOTHING
                """),
                {
                    "tenant_id": TENANT_ID,
                    "ticket_id": sr_id,
                    "actor_id": ITSM_REQUESTER_USER_ID,
                },
            )

    print("AuthClaw Lite demo seed complete.")
    print("Login email: admin@authclaw-lite.demo")
    print(f"Platform admin email: {RAW_PLATFORM_ADMIN_EMAIL}")
    print("Login password is configured via AUTHCLAW_LITE_DEMO_PASSWORD (not displayed).")
    print("Platform admin password is configured via AUTHCLAW_PLATFORM_ADMIN_PASSWORD (not displayed).")
    print(f"Gateway API key fingerprint (hmac-sha3-256): {key_hash[:12]}...")


if __name__ == "__main__":
    main()
