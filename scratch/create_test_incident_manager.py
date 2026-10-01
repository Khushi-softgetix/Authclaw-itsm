"""Create temporary test user: incidentmanager123@gmail.com / incident@123 with INCIDENT_MANAGER role."""
import os
import sys
import uuid
from pathlib import Path

# Add /app or parent dir to sys.path
sys.path.insert(0, "/app")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.core.passwords import hash_password
from sqlalchemy import create_engine, text

# Use superuser/owner authclaw credentials to bypass app-level RLS during seeding
DATABASE_URL = "postgresql+psycopg://authclaw:authclaw@postgres:5432/authclaw"

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

TENANT_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
USER_ID = uuid.UUID("22222222-2222-4222-8222-222222222238")
EMAIL = "incidentmanager123@gmail.com"
RAW_PASSWORD = "incident@123"

hashed_pw = hash_password(RAW_PASSWORD)

with engine.begin() as conn:
    conn.execute(text("SET LOCAL row_security = off;"))

    # 1. Insert or update in users table
    conn.execute(
        text("""
        INSERT INTO users (id, tenant_id, email, password_hash, role, platform_role, mfa_enabled, is_active)
        VALUES (:id, :tenant_id, :email, :password_hash, 'viewer', 'NONE', false, true)
        ON CONFLICT (tenant_id, email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            is_active = true,
            updated_at = NOW();
        """),
        {
            "id": USER_ID,
            "tenant_id": TENANT_ID,
            "email": EMAIL,
            "password_hash": hashed_pw,
        }
    )

    # Fetch actual user_id in case it existed
    actual_user_id = conn.execute(
        text("SELECT id FROM users WHERE tenant_id = :tenant_id AND email = :email"),
        {"tenant_id": TENANT_ID, "email": EMAIL}
    ).scalar_one()

    # 2. Insert or update in itsm_user_access
    conn.execute(
        text("""
        INSERT INTO itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, has_governance_access)
        VALUES (gen_random_uuid(), :tenant_id, :user_id, 'INCIDENT_MANAGER', true, false)
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
            itsm_role = 'INCIDENT_MANAGER',
            has_itsm_access = true,
            has_governance_access = false,
            updated_at = NOW();
        """),
        {
            "tenant_id": TENANT_ID,
            "user_id": actual_user_id,
        }
    )

    print(f"SUCCESS: User {EMAIL} configured with ITSM_ACCESS=True, GOVERNANCE_ACCESS=False, ROLE=INCIDENT_MANAGER (user_id={actual_user_id})")
