"""Real PostgreSQL integration tests proving SLA background worker tenant isolation.

Verifies:
1. Strict database safety enforcement targeting only *_test databases.
2. Both candidate tenants are discovered securely via worker_maintenance under RLS.
3. Overdue tickets for both tenants are processed and escalated.
4. Tenant isolation is strictly enforced: authclaw_app cannot read or write
   cross-tenant tickets or activities, and unauthenticated queries read nothing.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import os
from pathlib import Path
import subprocess
import sys
import uuid
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import (
    ITSMTicket,
    ITSMTicketActivity,
    ITSMUserAccess,
    Notification,
    Tenant,
    User,
)
from app.db.session import database_auth_context
from app.services.itsm_sla_worker import sweep
from tests.db_safety import destructive_test_urls


@pytest.fixture(scope="module")
def postgres_test_db():
    """Create isolated test database explicitly ending in _test, apply schema & security, and yield engines."""
    owner_url, app_url = destructive_test_urls()
    db_name = f"authclaw_sla_{uuid4().hex}_test"

    # Confirm name ends in _test
    assert db_name.endswith("_test"), f"Test database {db_name} must end in _test"

    admin_engine = create_engine(owner_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))

    owner_test_url = make_url(owner_url).set(database=db_name).render_as_string(hide_password=False)
    app_test_url = make_url(app_url).set(database=db_name).render_as_string(hide_password=False)

    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DATABASE_URL": owner_test_url,
        "BOOTSTRAP_DATABASE_URL": owner_test_url,
    }

    def run(*args):
        res = subprocess.run(
            [sys.executable, *args],
            cwd=backend_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert res.returncode == 0, f"Command failed: {res.stderr}\nOutput: {res.stdout}"

    try:
        # Run bootstrap prepare, migrations, and finalize
        run("scripts/bootstrap_database_security.py", "prepare")
        run("-m", "alembic", "upgrade", "head")
        run("scripts/bootstrap_database_security.py", "finalize-backend")

        owner_engine = create_engine(owner_test_url, echo=False)
        app_engine = create_engine(app_test_url, echo=False)

        yield owner_engine, app_engine, db_name
    finally:
        if "owner_engine" in locals():
            owner_engine.dispose()
        if "app_engine" in locals():
            app_engine.dispose()
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)'))
        admin_engine.dispose()


def test_sla_worker_multi_tenant_isolation_postgres(postgres_test_db):
    """Prove SLA background worker processes overdue tickets across multiple tenants under real RLS without cross-tenant leakage."""
    owner_engine, app_engine, db_name = postgres_test_db

    # 1. Verify app role has NOBYPASSRLS and RLS is forced
    with app_engine.connect() as conn:
        flags = conn.execute(
            text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).one()
        assert flags == (False, False), f"authclaw_app must not be superuser or have bypassrls: {flags}"

        # Verify that unauthenticated queries on itsm_tickets return 0 rows
        assert conn.execute(text("SELECT count(*) FROM public.itsm_tickets")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_ticket_activities")).scalar_one() == 0

    # 2. Seed Tenant A and Tenant B with overdue tickets using owner_engine
    tenant_a_id = uuid4()
    tenant_b_id = uuid4()
    ticket_a_id = uuid4()
    ticket_b_id = uuid4()
    user_a_id = uuid4()
    user_b_id = uuid4()
    session_hash_a = uuid4().hex + uuid4().hex
    session_hash_b = uuid4().hex + uuid4().hex

    now = datetime.now(timezone.utc)
    due_in_past = now - timedelta(hours=2)

    with owner_engine.begin() as conn:
        # Insert tenants
        conn.execute(
            text(
                "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                "VALUES (:id_a, 'Tenant Alpha', 'enterprise', 'active', now(), now()), "
                "       (:id_b, 'Tenant Beta', 'enterprise', 'active', now(), now())"
            ),
            {"id_a": tenant_a_id, "id_b": tenant_b_id},
        )

        # Insert users
        conn.execute(
            text(
                "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                "VALUES (:u_a, :t_a, 'admin-a@example.com', 'admin', 'NONE', true, now(), now()), "
                "       (:u_b, :t_b, 'admin-b@example.com', 'admin', 'NONE', true, now(), now())"
            ),
            {"u_a": user_a_id, "t_a": tenant_a_id, "u_b": user_b_id, "t_b": tenant_b_id},
        )

        # Create sessions for verification context
        conn.execute(
            text(
                "SELECT authn.create_session(:hash_a, :t_a, :u_a, 'test', now() + interval '1 hour', '{}'::jsonb)"
            ),
            {"hash_a": session_hash_a, "t_a": tenant_a_id, "u_a": user_a_id},
        )
        conn.execute(
            text(
                "SELECT authn.create_session(:hash_b, :t_b, :u_b, 'test', now() + interval '1 hour', '{}'::jsonb)"
            ),
            {"hash_b": session_hash_b, "t_b": tenant_b_id, "u_b": user_b_id},
        )

        # Create Incident Managers in itsm_user_access
        conn.execute(
            text(
                "INSERT INTO public.itsm_user_access (id, tenant_id, user_id, itsm_role, has_itsm_access, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :t_a, :u_a, 'INCIDENT_MANAGER', true, now(), now()), "
                "       (gen_random_uuid(), :t_b, :u_b, 'INCIDENT_MANAGER', true, now(), now())"
            ),
            {"t_a": tenant_a_id, "u_a": user_a_id, "t_b": tenant_b_id, "u_b": user_b_id},
        )

        # Insert overdue tickets for both tenants
        conn.execute(
            text(
                "INSERT INTO public.itsm_tickets "
                "(id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, "
                " requester_id, sla_resolution_due_at, sla_status, created_at, updated_at) "
                "VALUES "
                "(:id_a, :t_a, 'INC-ALPHA-01', 'Tenant A Overdue Outage', 'Issue on Alpha', 'INCIDENT', 'IN_PROGRESS', 'CRITICAL', 'HIGH', 'HIGH', "
                " :u_a, :due_at, 'WITHIN_SLA', now() - interval '4 hours', now() - interval '4 hours'), "
                "(:id_b, :t_b, 'INC-BETA-01', 'Tenant B Overdue Outage', 'Issue on Beta', 'INCIDENT', 'IN_PROGRESS', 'HIGH', 'HIGH', 'MEDIUM', "
                " :u_b, :due_at, 'WITHIN_SLA', now() - interval '4 hours', now() - interval '4 hours')"
            ),
            {
                "id_a": ticket_a_id,
                "t_a": tenant_a_id,
                "u_a": user_a_id,
                "id_b": ticket_b_id,
                "t_b": tenant_b_id,
                "u_b": user_b_id,
                "due_at": due_in_past,
            },
        )

    # 3. Execute SLA sweep using the application role engine (authclaw_app)
    sweep_result = sweep(app_engine, now=now)

    assert sweep_result["tenants_processed"] == 2, f"Expected 2 tenants processed, got: {sweep_result}"
    assert sweep_result["candidates_evaluated"] == 2, f"Expected 2 candidate tickets, got: {sweep_result}"
    assert sweep_result["breaches_escalated"] == 2, f"Expected 2 breaches escalated, got: {sweep_result}"
    assert sweep_result["failed_tickets"] == 0, f"Expected 0 failed tickets, got: {sweep_result}"

    # 4. Prove both tickets were escalated in the database
    with owner_engine.connect() as conn:
        row_a = conn.execute(
            text("SELECT sla_breach_escalated_at FROM public.itsm_tickets WHERE id = :id"),
            {"id": ticket_a_id},
        ).one()
        assert row_a[0] is not None, "Tenant A ticket must have sla_breach_escalated_at set"

        row_b = conn.execute(
            text("SELECT sla_breach_escalated_at FROM public.itsm_tickets WHERE id = :id"),
            {"id": ticket_b_id},
        ).one()
        assert row_b[0] is not None, "Tenant B ticket must have sla_breach_escalated_at set"

    # 5. Prove strict tenant isolation under authclaw_app sessions
    SessionMaker = sessionmaker(bind=app_engine, autocommit=False, autoflush=False)

    # Verification for Tenant A: can see Ticket A, CANNOT see Ticket B
    with database_auth_context("session", session_hash_a):
        db_a: Session = SessionMaker()
        try:
            tickets_a = db_a.query(ITSMTicket).all()
            ticket_ids_a = [t.id for t in tickets_a]
            assert ticket_a_id in ticket_ids_a, "Tenant A session must see Ticket A"
            assert ticket_b_id not in ticket_ids_a, "Tenant A session must NEVER see Ticket B"

            # Direct filter for Ticket B returns None
            assert db_a.query(ITSMTicket).filter(ITSMTicket.id == ticket_b_id).first() is None

            # Ticket activities for Tenant A only contain Ticket A
            activities_a = db_a.query(ITSMTicketActivity).all()
            for act in activities_a:
                assert act.tenant_id == tenant_a_id, "Activities in Tenant A must only belong to Tenant A"
                assert act.ticket_id == ticket_a_id, "Activities in Tenant A must not reference Ticket B"

            # Notifications in Tenant A only belong to Tenant A
            notifs_a = db_a.query(Notification).all()
            for notif in notifs_a:
                assert notif.tenant_id == tenant_a_id
        finally:
            db_a.close()

    # Verification for Tenant B: can see Ticket B, CANNOT see Ticket A
    with database_auth_context("session", session_hash_b):
        db_b: Session = SessionMaker()
        try:
            tickets_b = db_b.query(ITSMTicket).all()
            ticket_ids_b = [t.id for t in tickets_b]
            assert ticket_b_id in ticket_ids_b, "Tenant B session must see Ticket B"
            assert ticket_a_id not in ticket_ids_b, "Tenant B session must NEVER see Ticket A"

            # Direct filter for Ticket A returns None
            assert db_b.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is None

            # Ticket activities for Tenant B only contain Ticket B
            activities_b = db_b.query(ITSMTicketActivity).all()
            for act in activities_b:
                assert act.tenant_id == tenant_b_id, "Activities in Tenant B must only belong to Tenant B"
                assert act.ticket_id == ticket_b_id, "Activities in Tenant B must not reference Ticket A"

            # Notifications in Tenant B only belong to Tenant B
            notifs_b = db_b.query(Notification).all()
            for notif in notifs_b:
                assert notif.tenant_id == tenant_b_id
        finally:
            db_b.close()

    # 6. Prove unauthenticated query under authclaw_app reads 0 records
    with app_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM public.itsm_tickets")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.itsm_ticket_activities")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM public.notifications")).scalar_one() == 0


def test_worker_tenant_context_denies_cross_tenant_modifications_and_reads(postgres_test_db):
    """Prove worker_tenant_context strictly confines execution to the target tenant and denies cross-tenant access."""
    owner_engine, app_engine, db_name = postgres_test_db
    SessionMaker = sessionmaker(bind=app_engine, autocommit=False, autoflush=False)

    tenant_a_id = uuid4()
    tenant_b_id = uuid4()
    user_a_id = uuid4()
    user_b_id = uuid4()
    ticket_a_id = uuid4()
    ticket_b_id = uuid4()

    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO public.tenants (id, name, tier, status, created_at, updated_at) "
                "VALUES (:id_a, 'Tenant Alpha 2', 'starter', 'active', now(), now()), "
                "       (:id_b, 'Tenant Beta 2', 'starter', 'active', now(), now())"
            ),
            {"id_a": tenant_a_id, "id_b": tenant_b_id},
        )
        conn.execute(
            text(
                "INSERT INTO public.users (id, tenant_id, email, role, platform_role, is_active, created_at, updated_at) "
                "VALUES (:u_a, :t_a, 'user-a2@alpha.test', 'admin', 'NONE', true, now(), now()), "
                "       (:u_b, :t_b, 'user-b2@beta.test', 'admin', 'NONE', true, now(), now())"
            ),
            {"u_a": user_a_id, "t_a": tenant_a_id, "u_b": user_b_id, "t_b": tenant_b_id},
        )
        conn.execute(
            text(
                "INSERT INTO public.itsm_tickets "
                "(id, tenant_id, ticket_number, title, description, ticket_type, status, priority, urgency, impact, "
                " requester_id, sla_resolution_due_at, sla_status, created_at, updated_at) "
                "VALUES "
                "(:id_a, :t_a, 'INC-ALPHA-99', 'Ticket A', 'Desc A', 'INCIDENT', 'IN_PROGRESS', 'HIGH', 'HIGH', 'HIGH', "
                " :u_a, now() - interval '1 hour', 'WITHIN_SLA', now(), now()), "
                "(:id_b, :t_b, 'INC-BETA-99', 'Ticket B', 'Desc B', 'INCIDENT', 'IN_PROGRESS', 'HIGH', 'HIGH', 'HIGH', "
                " :u_b, now() - interval '1 hour', 'WITHIN_SLA', now(), now())"
            ),
            {
                "id_a": ticket_a_id,
                "t_a": tenant_a_id,
                "u_a": user_a_id,
                "id_b": ticket_b_id,
                "t_b": tenant_b_id,
                "u_b": user_b_id,
            },
        )

    db: Session = SessionMaker()
    try:
        from app.services.itsm_sla_worker import worker_tenant_context

        # 1. Under Tenant A worker context
        with worker_tenant_context(db, tenant_a_id):
            # Can read Ticket A
            assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is not None
            # CANNOT read Ticket B (returns None due to RLS)
            assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_b_id).first() is None

            # Attempting cross-tenant UPDATE on Ticket B affects 0 rows
            updated = (
                ITSMTicket.__table__.update()
                .where(ITSMTicket.id == ticket_b_id)
                .values(title="Cross Tenant Tampering")
            )
            res = db.execute(updated)
            assert res.rowcount == 0, "Cross-tenant update must affect 0 rows under RLS"

            # Attempting to insert an activity for Ticket B / Tenant B fails RLS check
            with pytest.raises(Exception):
                sp = db.begin_nested()
                try:
                    db.execute(
                        text(
                            "INSERT INTO public.itsm_ticket_activities "
                            "(id, tenant_id, ticket_id, activity_type, actor_type, content, metadata, created_at) "
                            "VALUES (gen_random_uuid(), :t_b, :tick_b, 'TAMPER', 'SYSTEM', 'Bad activity', '{}'::jsonb, now())"
                        ),
                        {"t_b": tenant_b_id, "tick_b": ticket_b_id},
                    )
                    sp.commit()
                except Exception:
                    sp.rollback()
                    raise

        # 2. Outside tenant context under authclaw_app: reads nothing and authn context is NULL
        assert db.execute(text("SELECT authn.current_tenant_id()")).scalar_one_or_none() is None
        assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is None
        assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_b_id).first() is None

        # 3. Context is cleaned up even if an unhandled exception occurs inside worker_tenant_context
        with pytest.raises(ZeroDivisionError):
            with worker_tenant_context(db, tenant_a_id):
                assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is not None
                _ = 1 / 0
        assert db.execute(text("SELECT authn.current_tenant_id()")).scalar_one_or_none() is None
        assert db.query(ITSMTicket).filter(ITSMTicket.id == ticket_a_id).first() is None

        # 4. Setting worker context for a non-existent tenant raises exception and cleans context
        with pytest.raises(Exception):
            with worker_tenant_context(db, uuid4()):
                pass
        db.rollback()
        assert db.execute(text("SELECT authn.current_tenant_id()")).scalar_one_or_none() is None

    finally:
        db.close()

