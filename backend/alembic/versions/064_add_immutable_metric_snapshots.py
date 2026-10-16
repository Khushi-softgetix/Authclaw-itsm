"""Add immutable ANA-004 historical metric snapshots.

Revision ID: 064
Revises: 063
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "itsm_metric_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric_key", sa.String(64), nullable=False),
        sa.Column("period_grain", sa.String(16), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dimensions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("dimensions_hash", sa.String(64), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("definition_version", sa.String(64), nullable=False),
        sa.Column("source_events", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("period_grain IN ('DAILY','WEEKLY','MONTHLY')", name="ck_itsm_metric_snapshot_grain"),
        sa.CheckConstraint("period_end > period_start", name="ck_itsm_metric_snapshot_period"),
        sa.UniqueConstraint(
            "tenant_id",
            "metric_key",
            "period_grain",
            "period_start",
            "period_end",
            "definition_version",
            "dimensions_hash",
            name="uq_itsm_metric_snapshot_identity",
        ),
    )
    op.create_index(
        "idx_itsm_metric_snapshot_history",
        "itsm_metric_snapshots",
        ["tenant_id", "metric_key", "period_grain", "period_start"],
    )

    op.execute("ALTER TABLE public.itsm_metric_snapshots ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_metric_snapshots FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON public.itsm_metric_snapshots FOR ALL "
        "USING (tenant_id = authn.current_tenant_id()) "
        "WITH CHECK (tenant_id = authn.current_tenant_id())"
    )
    op.execute("GRANT SELECT, INSERT ON public.itsm_metric_snapshots TO authclaw_app")
    op.execute("GRANT SELECT ON public.itsm_metric_snapshots TO authclaw_agent_runtime")

    op.execute(
        """
        CREATE FUNCTION public.protect_itsm_metric_snapshot() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'ITSM metric snapshots are immutable: % is not permitted', TG_OP
                USING ERRCODE = '55000';
        END;
        $$;
        CREATE TRIGGER trg_protect_itsm_metric_snapshot
        BEFORE UPDATE OR DELETE ON public.itsm_metric_snapshots
        FOR EACH ROW EXECUTE FUNCTION public.protect_itsm_metric_snapshot();
        """
    )

    op.execute(
        """
        CREATE FUNCTION worker_maintenance.metric_snapshot_candidate_tenants()
        RETURNS TABLE(tenant_id uuid)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = pg_catalog, public, pg_temp
        AS $$
            SELECT tenant.id
            FROM public.tenants AS tenant
            WHERE lower(tenant.status) = 'active'
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION worker_maintenance.metric_snapshot_candidate_tenants() FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA worker_maintenance TO authclaw_app")
    op.execute("GRANT EXECUTE ON FUNCTION worker_maintenance.metric_snapshot_candidate_tenants() TO authclaw_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS worker_maintenance.metric_snapshot_candidate_tenants()")
    op.execute("DROP TRIGGER IF EXISTS trg_protect_itsm_metric_snapshot ON public.itsm_metric_snapshots")
    op.execute("DROP FUNCTION IF EXISTS public.protect_itsm_metric_snapshot()")
    op.drop_index("idx_itsm_metric_snapshot_history", table_name="itsm_metric_snapshots")
    op.drop_table("itsm_metric_snapshots")
