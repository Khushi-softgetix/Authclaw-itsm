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


def finalize(conn, migrator, runtime, metric_runtime):
    if not conn.execute(
        text("SELECT to_regclass('worker_maintenance.control')")
    ).scalar():
        return
    quote = conn.dialect.identifier_preparer.quote
    app = quote(runtime)
    metric_app = quote(metric_runtime)
    for role in (app, quote(migrator)):
        conn.execute(text(f"REVOKE {OWNER} FROM {role}"))
    conn.execute(text(f"GRANT USAGE ON SCHEMA public, worker_maintenance TO {OWNER}"))
    conn.execute(
        text(
            f"GRANT SELECT(id, tenant_id, connector, workflow_id, status, expires_at), UPDATE(status) ON public.ephemeral_worker_tokens TO {OWNER}"
        )
    )
    conn.execute(text(f"GRANT SELECT, INSERT ON public.audit_log_metadata TO {OWNER}"))
    conn.execute(text(f"GRANT INSERT ON public.audit_outbox TO {OWNER}"))
    conn.execute(text(f"GRANT USAGE ON SEQUENCE public.audit_outbox_id_seq TO {OWNER}"))
    conn.execute(
        text(
            f"GRANT SELECT(tenant_id, status, sla_response_due_at, sla_resolution_due_at, "
            f"sla_warning_escalated_at, sla_breach_escalated_at) ON public.itsm_tickets TO {OWNER}"
        )
    )
    conn.execute(text(f"GRANT SELECT(id, status) ON public.tenants TO {OWNER}"))
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
    conn.execute(text("DROP POLICY IF EXISTS worker_maintenance_access ON public.itsm_tickets"))
    conn.execute(
        text(
            f"CREATE POLICY worker_maintenance_access ON public.itsm_tickets TO {OWNER} USING (true)"
        )
    )
    conn.execute(text("DROP POLICY IF EXISTS worker_maintenance_access ON public.tenants"))
    conn.execute(
        text(
            f"CREATE POLICY worker_maintenance_access ON public.tenants TO {OWNER} USING (true)"
        )
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
    conn.execute(
        text(
            f"GRANT EXECUTE ON FUNCTION worker_maintenance.expire_tokens(integer), worker_maintenance.cleanup_health(), worker_maintenance.issuance_ready(), worker_maintenance.sla_candidate_tenants() TO {app}"
        )
    )
    if conn.execute(text("SELECT to_regclass('public.itsm_metric_snapshot_jobs')")).scalar():
        conn.execute(text(f"REVOKE INSERT, UPDATE, DELETE ON public.itsm_metric_snapshots FROM {app}"))
        conn.execute(text(f"REVOKE ALL ON public.itsm_metric_snapshot_jobs FROM {app}"))
        conn.execute(text(f"REVOKE UPDATE, DELETE ON public.itsm_metric_source_events FROM {app}"))
        conn.execute(text(f"GRANT USAGE ON SCHEMA public, worker_maintenance TO {metric_app}"))
        # Every worker RLS policy evaluates this signed-context accessor.  The
        # role can establish context only through the guarded binder below; it
        # still needs execute permission to have PostgreSQL evaluate the policy.
        conn.execute(text(f"GRANT USAGE ON SCHEMA authn TO {metric_app}"))
        conn.execute(
            text(
                "GRANT EXECUTE ON FUNCTION authn.current_tenant_id() "
                f"TO {metric_app}"
            )
        )
        conn.execute(
            text(
                f"GRANT SELECT ON public.tenants, public.itsm_tickets, "
                f"public.itsm_ticket_activities, public.itsm_change_requests, "
                f"public.itsm_knowledge_articles, public.itsm_business_calendars, "
                f"public.itsm_metric_source_events TO {metric_app}"
            )
        )
        conn.execute(text(f"GRANT SELECT, INSERT ON public.itsm_metric_snapshots TO {metric_app}"))
        conn.execute(text(f"GRANT SELECT, INSERT, UPDATE ON public.itsm_metric_snapshot_jobs TO {metric_app}"))
        for table in (
            "tenants",
            "itsm_tickets",
            "itsm_ticket_activities",
            "itsm_change_requests",
            "itsm_knowledge_articles",
            "itsm_business_calendars",
            "itsm_metric_source_events",
            "itsm_metric_snapshots",
            "itsm_metric_snapshot_jobs",
        ):
            conn.execute(text(f"DROP POLICY IF EXISTS metric_snapshot_worker_access ON public.{table}"))
            tenant_column = "id" if table == "tenants" else "tenant_id"
            write_check = (
                f" WITH CHECK ({tenant_column} = authn.current_tenant_id())"
                if table in {"itsm_metric_snapshots", "itsm_metric_snapshot_jobs"}
                else ""
            )
            conn.execute(
                text(
                    f"CREATE POLICY metric_snapshot_worker_access ON public.{table} TO {metric_app} "
                    f"USING ({tenant_column} = authn.current_tenant_id()){write_check}"
                )
            )
        conn.execute(text(f"GRANT USAGE ON SCHEMA worker_maintenance TO {metric_app}"))
        conn.execute(
            text(
                "GRANT EXECUTE ON FUNCTION worker_maintenance.metric_snapshot_candidate_tenants() "
                f"TO {metric_app}"
            )
        )
        metric_login = metric_runtime.replace("'", "''")
        conn.execute(
            text(
                f"""
                CREATE OR REPLACE FUNCTION worker_maintenance.bind_metric_snapshot_context(p_tenant_id uuid)
                RETURNS void
                LANGUAGE plpgsql SECURITY DEFINER
                SET search_path = pg_catalog, authn, public, worker_maintenance
                AS $function$
                BEGIN
                    IF session_user <> '{metric_login}' THEN
                        RAISE EXCEPTION 'metric snapshot worker identity required'
                            USING ERRCODE = '42501';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM public.tenants
                        WHERE id = p_tenant_id AND lower(status) = 'active'
                    ) THEN
                        RAISE EXCEPTION 'active tenant not found'
                            USING ERRCODE = '42501';
                    END IF;
                    PERFORM authn.set_context(p_tenant_id, p_tenant_id, p_tenant_id);
                END;
                $function$;
                """
            )
        )
        conn.execute(
            text(
                "ALTER FUNCTION worker_maintenance.bind_metric_snapshot_context(uuid) "
                f"OWNER TO {OWNER}"
            )
        )
        conn.execute(
            text(
                "REVOKE ALL ON FUNCTION worker_maintenance.bind_metric_snapshot_context(uuid) FROM PUBLIC"
            )
        )
        conn.execute(
            text(
                "GRANT EXECUTE ON FUNCTION worker_maintenance.bind_metric_snapshot_context(uuid) "
                f"TO {metric_app}"
            )
        )
