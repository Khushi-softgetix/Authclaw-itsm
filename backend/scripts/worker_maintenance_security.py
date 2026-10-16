"""Bootstrap-only ownership/ACL wiring. Never loaded by the API."""

from sqlalchemy import text

OWNER = "authclaw_worker_maintenance"


def prepare(conn, migrator):
    quote = conn.dialect.identifier_preparer.quote
    if not conn.execute(
        text("SELECT 1 FROM pg_roles WHERE rolname=:role"), {"role": OWNER}
    ).scalar():
        conn.execute(text(f"CREATE ROLE {OWNER} NOLOGIN"))
    conn.execute(
        text(
            f"ALTER ROLE {OWNER} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
        )
    )
    conn.execute(
        text(
            f"CREATE SCHEMA IF NOT EXISTS worker_maintenance AUTHORIZATION {quote(migrator)}"
        )
    )
    conn.execute(text("REVOKE ALL ON SCHEMA worker_maintenance FROM PUBLIC"))
    # The bootstrap identity, never runtime, owns catalog changes during upgrades.
    conn.execute(
        text(f"GRANT USAGE, CREATE ON SCHEMA worker_maintenance TO {quote(migrator)}")
    )


def finalize(conn, migrator, runtime):
    if not conn.execute(
        text("SELECT to_regclass('worker_maintenance.control')")
    ).scalar():
        return
    quote = conn.dialect.identifier_preparer.quote
    app = quote(runtime)
    for role in (app, quote(migrator)):
        conn.execute(text(f"REVOKE {OWNER} FROM {role}"))
    conn.execute(text(f"GRANT USAGE ON SCHEMA public, authn, worker_maintenance TO {OWNER}"))
    conn.execute(
        text(
            f"GRANT SELECT(id, tenant_id, connector, workflow_id, status, expires_at), UPDATE(status) ON public.ephemeral_worker_tokens TO {OWNER}"
        )
    )
    conn.execute(text(f"GRANT SELECT, INSERT ON public.audit_log_metadata TO {OWNER}"))
    conn.execute(text(f"GRANT INSERT ON public.audit_outbox TO {OWNER}"))
    conn.execute(text(f"GRANT USAGE ON SEQUENCE public.audit_outbox_id_seq TO {OWNER}"))
    # Canonical append reads the audit chain; the function caller never receives it.
    for table in ("ephemeral_worker_tokens", "audit_log_metadata", "audit_outbox"):
        conn.execute(
            text(f"DROP POLICY IF EXISTS worker_maintenance_access ON public.{table}")
        )
        conn.execute(
            text(
                f"CREATE POLICY worker_maintenance_access ON public.{table} TO {OWNER} USING (true) WITH CHECK (true)"
            )
        )
    if conn.execute(text("SELECT to_regclass('public.itsm_tickets')")).scalar():
        conn.execute(
            text(f"GRANT SELECT(id, status) ON public.tenants TO {OWNER}")
        )
        conn.execute(
            text(f"DROP POLICY IF EXISTS worker_maintenance_access ON public.tenants")
        )
        conn.execute(
            text(
                f"CREATE POLICY worker_maintenance_access ON public.tenants TO {OWNER} USING (true) WITH CHECK (true)"
            )
        )
        conn.execute(
            text(
                f"GRANT SELECT(id, tenant_id, ticket_number, status, priority, sla_response_due_at, sla_resolution_due_at, sla_warning_escalated_at, sla_breach_escalated_at) ON public.itsm_tickets TO {OWNER}"
            )
        )
        conn.execute(
            text(f"DROP POLICY IF EXISTS worker_maintenance_access ON public.itsm_tickets")
        )
        conn.execute(
            text(
                f"CREATE POLICY worker_maintenance_access ON public.itsm_tickets TO {OWNER} USING (true) WITH CHECK (true)"
            )
        )
        conn.execute(
            text(f"GRANT EXECUTE ON FUNCTION authn.set_context(uuid, uuid, uuid) TO {OWNER}")
        )
        conn.execute(
            text("""
                CREATE OR REPLACE FUNCTION worker_maintenance.discover_sla_candidate_tenants()
                RETURNS TABLE(tenant_id uuid)
                LANGUAGE plpgsql STABLE SECURITY DEFINER
                SET search_path = pg_catalog, public, pg_temp
                AS $$
                BEGIN
                  RETURN QUERY
                  SELECT DISTINCT t.tenant_id
                  FROM public.itsm_tickets t
                  WHERE t.status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED')
                    AND (t.sla_response_due_at IS NOT NULL OR t.sla_resolution_due_at IS NOT NULL)
                    AND (t.sla_warning_escalated_at IS NULL OR t.sla_breach_escalated_at IS NULL);
                END;
                $$;

                CREATE OR REPLACE FUNCTION worker_maintenance.bind_sla_worker_tenant_context(p_tenant_id uuid)
                RETURNS TABLE(tenant_id uuid)
                LANGUAGE plpgsql SECURITY DEFINER
                SET search_path = pg_catalog, authn, public, pg_temp
                AS $$
                BEGIN
                  IF p_tenant_id IS NULL THEN
                    PERFORM set_config('app.auth_context', '', true);
                    PERFORM set_config('app.current_tenant_id', '', true);
                    RETURN;
                  END IF;
                  IF NOT EXISTS (
                    SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND status = 'active'
                  ) THEN
                    RAISE EXCEPTION 'invalid tenant for worker context';
                  END IF;
                  PERFORM authn.set_context(p_tenant_id, p_tenant_id, p_tenant_id);
                  PERFORM set_config('app.current_tenant_id', p_tenant_id::text, true);
                  RETURN QUERY SELECT p_tenant_id;
                END;
                $$;
            """)
        )

    for signature in conn.execute(
        text(
            "SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('append_audit_event_v2','gen_random_uuid','digest')"
        )
    ).scalars():
        conn.execute(text(f"GRANT EXECUTE ON FUNCTION {signature} TO {OWNER}"))
    for table in ("control", "heartbeat"):
        conn.execute(text(f"ALTER TABLE worker_maintenance.{table} OWNER TO {OWNER}"))
    for signature in conn.execute(
        text(
            "SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='worker_maintenance'::regnamespace"
        )
    ).scalars():
        conn.execute(text(f"ALTER FUNCTION {signature} OWNER TO {OWNER}"))
    conn.execute(
        text(
            f"REVOKE ALL ON ALL TABLES IN SCHEMA worker_maintenance FROM PUBLIC, {app}"
        )
    )
    conn.execute(
        text(
            f"REVOKE ALL ON ALL FUNCTIONS IN SCHEMA worker_maintenance FROM PUBLIC, {app}"
        )
    )
    conn.execute(text(f"GRANT USAGE ON SCHEMA worker_maintenance TO {app}"))
    extra_worker_funcs = ""
    if conn.execute(
        text("SELECT to_regprocedure('worker_maintenance.discover_sla_candidate_tenants()')")
    ).scalar():
        extra_worker_funcs = (
            ", worker_maintenance.discover_sla_candidate_tenants(), "
            "worker_maintenance.bind_sla_worker_tenant_context(uuid)"
        )
    conn.execute(
        text(
            f"GRANT EXECUTE ON FUNCTION worker_maintenance.expire_tokens(integer), "
            f"worker_maintenance.cleanup_health(), "
            f"worker_maintenance.issuance_ready(){extra_worker_funcs} TO {app}"
        )
    )
