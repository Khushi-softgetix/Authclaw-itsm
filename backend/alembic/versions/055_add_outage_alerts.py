"""Add a standalone, tenant-safe Outage & Alerts foundation.

Alert publications, lifecycle history, links, and delivery attempts are
append-only evidence.  This migration intentionally creates no audience
configuration or delivery provider: both remain product-policy decisions.

Revision ID: 059
Revises: 058
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


_TABLES = (
    "itsm_outage_alerts",
    "itsm_outage_alert_services",
    "itsm_outage_alert_publications",
    "itsm_outage_alert_state_history",
    "itsm_outage_alert_links",
    "itsm_outage_alert_deliveries",
    "itsm_outage_alert_delivery_attempts",
)

_IMMUTABLE_TABLES = (
    "itsm_outage_alert_publications",
    "itsm_outage_alert_state_history",
    "itsm_outage_alert_links",
    "itsm_outage_alert_delivery_attempts",
)


def _enable_tenant_rls(table_name: str, write_grant: str = "SELECT, INSERT, UPDATE, DELETE") -> None:
    op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{table_name} FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id())
        """
    )
    op.execute(f"GRANT {write_grant} ON public.{table_name} TO authclaw_app")


def upgrade() -> None:
    op.create_table(
        "itsm_outage_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("draft_message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("audience_policy_ref", sa.String(255), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recovered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('DRAFT', 'ACTIVE', 'RECOVERED')", name="ck_itsm_outage_alert_status"),
    )
    op.create_index("idx_itsm_outage_alert_tenant_status", "itsm_outage_alerts", ["tenant_id", "status", "created_at"])
    op.create_index("idx_itsm_outage_alert_tenant_created", "itsm_outage_alerts", ["tenant_id", "created_at"])

    op.create_table(
        "itsm_outage_alert_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "alert_id", "service_id", name="uq_itsm_outage_alert_service"),
    )
    op.create_index("idx_itsm_outage_alert_service_alert", "itsm_outage_alert_services", ["tenant_id", "alert_id"])
    op.create_index("idx_itsm_outage_alert_service_service", "itsm_outage_alert_services", ["tenant_id", "service_id"])

    op.create_table(
        "itsm_outage_alert_publications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("publication_type", sa.String(32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("audience_policy_ref", sa.String(255), nullable=True),
        sa.Column("published_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("publication_type IN ('INITIAL', 'UPDATE', 'RECOVERY')", name="ck_itsm_outage_publication_type"),
        sa.UniqueConstraint("tenant_id", "alert_id", "sequence_number", name="uq_itsm_outage_publication_sequence"),
    )
    op.create_index("idx_itsm_outage_publication_alert", "itsm_outage_alert_publications", ["tenant_id", "alert_id", "sequence_number"])
    op.create_index("idx_itsm_outage_publication_correlation", "itsm_outage_alert_publications", ["tenant_id", "correlation_id"])

    op.create_table(
        "itsm_outage_alert_state_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_state", sa.String(32), nullable=True),
        sa.Column("to_state", sa.String(32), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_outage_history_alert", "itsm_outage_alert_state_history", ["tenant_id", "alert_id", "occurred_at"])
    op.create_index("idx_itsm_outage_history_correlation", "itsm_outage_alert_state_history", ["tenant_id", "correlation_id"])

    op.create_table(
        "itsm_outage_alert_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("major_incident_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_major_incidents.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("linked_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("num_nonnulls(incident_id, major_incident_id) = 1", name="ck_itsm_outage_link_target"),
        sa.UniqueConstraint("tenant_id", "alert_id", "incident_id", name="uq_itsm_outage_link_incident"),
        sa.UniqueConstraint("tenant_id", "alert_id", "major_incident_id", name="uq_itsm_outage_link_major_incident"),
    )
    op.create_index("idx_itsm_outage_link_incident", "itsm_outage_alert_links", ["tenant_id", "incident_id"])
    op.create_index("idx_itsm_outage_link_major", "itsm_outage_alert_links", ["tenant_id", "major_incident_id"])

    op.create_table(
        "itsm_outage_alert_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("publication_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alert_publications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_ref", sa.String(100), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_CONFIGURATION"),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("status IN ('PENDING_CONFIGURATION', 'QUEUED', 'SENT', 'FAILED')", name="ck_itsm_outage_delivery_status"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_itsm_outage_delivery_idempotency"),
    )
    op.create_index("idx_itsm_outage_delivery_publication", "itsm_outage_alert_deliveries", ["tenant_id", "publication_id"])
    op.create_index("idx_itsm_outage_delivery_status", "itsm_outage_alert_deliveries", ["tenant_id", "status", "created_at"])

    op.create_table(
        "itsm_outage_alert_delivery_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("delivery_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alert_deliveries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("provider_reference", sa.String(255), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "delivery_id", "attempt_number", name="uq_itsm_outage_delivery_attempt_number"),
    )
    op.create_index("idx_itsm_outage_delivery_attempt", "itsm_outage_alert_delivery_attempts", ["tenant_id", "delivery_id", "attempted_at"])

    for table_name in _TABLES:
        _enable_tenant_rls(
            table_name,
            "SELECT, INSERT" if table_name in _IMMUTABLE_TABLES else "SELECT, INSERT, UPDATE, DELETE",
        )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.reject_outage_alert_immutable_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'outage alert evidence is immutable';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    for table_name in _IMMUTABLE_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_immutable
            BEFORE UPDATE OR DELETE ON public.{table_name}
            FOR EACH ROW EXECUTE FUNCTION public.reject_outage_alert_immutable_mutation();
            """
        )


def downgrade() -> None:
    for table_name in _IMMUTABLE_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table_name}_immutable ON public.{table_name}")
    op.execute("DROP FUNCTION IF EXISTS public.reject_outage_alert_immutable_mutation()")
    for table_name in reversed(_TABLES):
        op.drop_table(table_name)
