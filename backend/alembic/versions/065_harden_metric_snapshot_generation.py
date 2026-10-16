"""Harden ANA-004 generation, recovery, and historical source evidence.

Revision ID: 065
Revises: 064
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def _tenant_policy(table: str) -> None:
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY tenant_isolation ON public.{table} FOR ALL "
        "USING (tenant_id = authn.current_tenant_id()) "
        "WITH CHECK (tenant_id = authn.current_tenant_id())"
    )


def upgrade() -> None:
    op.create_table(
        "itsm_metric_snapshot_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_grain", sa.String(16), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("definition_version", sa.String(64), nullable=False),
        sa.Column("dimensions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("dimensions_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_owner", sa.String(128), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_error_code", sa.String(128), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("period_grain IN ('DAILY','WEEKLY','MONTHLY')", name="ck_itsm_metric_snapshot_job_grain"),
        sa.CheckConstraint("period_end > period_start", name="ck_itsm_metric_snapshot_job_period"),
        sa.CheckConstraint("status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')", name="ck_itsm_metric_snapshot_job_status"),
        sa.UniqueConstraint(
            "tenant_id", "period_grain", "period_start", "period_end",
            "definition_version", "dimensions_hash",
            name="uq_itsm_metric_snapshot_job_identity",
        ),
    )
    op.create_index(
        "idx_itsm_metric_snapshot_job_claim",
        "itsm_metric_snapshot_jobs",
        ["tenant_id", "status", "next_attempt_at", "period_end"],
    )
    _tenant_policy("itsm_metric_snapshot_jobs")

    op.create_table(
        "itsm_metric_source_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("source_type", sa.String(64), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_key", sa.String(255), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "event_key", name="uq_itsm_metric_source_event_key"),
    )
    op.create_index(
        "idx_itsm_metric_source_event_window",
        "itsm_metric_source_events",
        ["tenant_id", "event_type", "occurred_at"],
    )
    _tenant_policy("itsm_metric_source_events")

    op.execute("GRANT SELECT, INSERT ON public.itsm_metric_source_events TO authclaw_app")
    op.execute(
        """
        CREATE FUNCTION public.protect_itsm_metric_source_event() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'ITSM metric source events are immutable: % is not permitted', TG_OP
                USING ERRCODE = '55000';
        END;
        $$;
        CREATE TRIGGER trg_protect_itsm_metric_source_event
        BEFORE UPDATE OR DELETE ON public.itsm_metric_source_events
        FOR EACH ROW EXECUTE FUNCTION public.protect_itsm_metric_source_event();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_protect_itsm_metric_source_event ON public.itsm_metric_source_events")
    op.execute("DROP FUNCTION IF EXISTS public.protect_itsm_metric_source_event()")
    op.drop_index("idx_itsm_metric_source_event_window", table_name="itsm_metric_source_events")
    op.drop_table("itsm_metric_source_events")
    op.drop_index("idx_itsm_metric_snapshot_job_claim", table_name="itsm_metric_snapshot_jobs")
    op.drop_table("itsm_metric_snapshot_jobs")
