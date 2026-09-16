"""Add ITSM V2 foundation schema.

Revision ID: 046
Revises: 045
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None

_V2_TABLES = [
    "itsm_event_rules",
    "itsm_ingested_events",
    "itsm_integration_configs",
    "itsm_integration_sync_records",
    "itsm_proactive_remediations",
]


def upgrade() -> None:
    # 1. itsm_event_rules
    op.create_table(
        "itsm_event_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_pattern", sa.String(255), nullable=False),
        sa.Column("condition_expression", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("action_type", sa.String(50), nullable=False),
        sa.Column("target_service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_severity", sa.String(20), nullable=False, server_default="SEV_3"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("priority_order", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_event_rules_tenant", "itsm_event_rules", ["tenant_id", "is_active", "priority_order"])

    # 2. itsm_ingested_events (Fingerprint Deduplication for Alert Storm Control)
    op.create_table(
        "itsm_ingested_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("source", sa.String(100), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False, server_default="WARNING"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(32), nullable=False, server_default="NEW"),
        sa.Column("correlated_ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rule_matched_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_event_rules.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("tenant_id", "fingerprint", name="uq_itsm_event_tenant_fingerprint"),
    )
    op.create_index("idx_itsm_events_status", "itsm_ingested_events", ["tenant_id", "status"])
    op.create_index("idx_itsm_events_ticket", "itsm_ingested_events", ["tenant_id", "correlated_ticket_id"])

    # 3. itsm_integration_configs
    op.create_table(
        "itsm_integration_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("integration_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("config_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("encrypted_credentials", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sync_interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_itsm_integ_name"),
    )
    op.create_index("idx_itsm_integ_type", "itsm_integration_configs", ["tenant_id", "integration_type", "is_active"])

    # 4. itsm_integration_sync_records
    op.create_table(
        "itsm_integration_sync_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("integration_config_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_integration_configs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sync_type", sa.String(50), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("internal_entity_type", sa.String(50), nullable=False),
        sa.Column("internal_entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sync_status", sa.String(32), nullable=False, server_default="SUCCESS"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("error_details", sa.Text(), nullable=True),
        sa.Column("conflict_resolution", sa.String(32), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_sync_entity", "itsm_integration_sync_records", ["tenant_id", "internal_entity_type", "internal_entity_id"])
    op.create_index("idx_itsm_sync_status", "itsm_integration_sync_records", ["tenant_id", "sync_status"])

    # 5. itsm_proactive_remediations (Governed Remediation with Pre/Post Checks & Rollback)
    op.create_table(
        "itsm_proactive_remediations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_ingested_events.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_event_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("runbook_identifier", sa.String(255), nullable=False),
        sa.Column("governance_approval_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("pre_check_results", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("execution_results", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("post_check_results", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("rollback_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("rollback_executed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("rollback_results", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_APPROVAL"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_itsm_remed_status", "itsm_proactive_remediations", ["tenant_id", "status"])
    op.create_index("idx_itsm_remed_approval", "itsm_proactive_remediations", ["tenant_id", "governance_approval_id"])

    # Enforce RLS and grants for all V2 tables
    for table_name in _V2_TABLES:
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON public.{table_name} FOR ALL
                USING (tenant_id = authn.current_tenant_id())
                WITH CHECK (tenant_id = authn.current_tenant_id());
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table_name} TO authclaw_app;")
        op.execute(f"GRANT SELECT ON public.{table_name} TO authclaw_agent_runtime;")

    # Agent runtime writes for alert processing & governed remediations
    op.execute("GRANT INSERT, UPDATE ON public.itsm_ingested_events TO authclaw_agent_runtime;")
    op.execute("GRANT INSERT, UPDATE ON public.itsm_proactive_remediations TO authclaw_agent_runtime;")


def downgrade() -> None:
    for table_name in reversed(_V2_TABLES):
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")
