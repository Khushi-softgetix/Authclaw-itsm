"""Add the standalone Outage & Alerts domain.

Revision ID: 053
Revises: 052
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None

TABLES = (
    "itsm_service_consumers", "itsm_service_support_teams", "itsm_outage_alerts",
    "itsm_outage_alert_services", "itsm_outage_alert_cis", "itsm_outage_alert_links",
    "itsm_outage_alert_audiences", "itsm_outage_alert_publications", "itsm_outage_alert_recipients",
)


def _tenant_columns():
    return (
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "itsm_service_consumers", *_tenant_columns(),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("source", sa.String(50), nullable=False, server_default="ADMIN"),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("effective_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "service_id", "user_id", name="uq_itsm_service_consumer"),
    )
    op.create_index("idx_itsm_service_consumers_scope", "itsm_service_consumers", ["tenant_id", "service_id", "is_active"])
    op.create_table(
        "itsm_service_support_teams", *_tenant_columns(),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "service_id", "team_id", name="uq_itsm_service_support_team"),
    )
    op.create_index("idx_itsm_service_support_scope", "itsm_service_support_teams", ["tenant_id", "service_id"])
    op.create_table(
        "itsm_outage_alerts", *_tenant_columns(),
        sa.Column("alert_number", sa.String(32), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("alert_type", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("intent", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("public_summary", sa.Text(), nullable=False),
        sa.Column("impact_summary", sa.Text(), nullable=False),
        sa.Column("recommended_action", sa.Text(), nullable=True),
        sa.Column("service_agent_guidance", sa.Text(), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("service_agent_handling", sa.String(20), nullable=False, server_default="ALERT_ONLY"),
        sa.Column("outage_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_update_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recovered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_publication_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "alert_number", name="uq_itsm_outage_alert_number"),
        sa.CheckConstraint("alert_type IN ('OUTAGE','DEGRADATION','MAINTENANCE','INFORMATION')", name="ck_outage_alert_type"),
        sa.CheckConstraint("severity IN ('CRITICAL','HIGH','MEDIUM','LOW')", name="ck_outage_alert_severity"),
        sa.CheckConstraint("intent IN ('INFORM','ACTION_REQUIRED','INVESTIGATE','RESOLVE')", name="ck_outage_alert_intent"),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','RECOVERED','EXPIRED','CANCELLED')", name="ck_outage_alert_status"),
        sa.CheckConstraint("service_agent_handling IN ('ALERT_ONLY','SOLVE')", name="ck_outage_alert_agent_handling"),
    )
    op.create_index("idx_itsm_outage_alert_status", "itsm_outage_alerts", ["tenant_id", "status", "updated_at"])
    op.create_index("idx_itsm_outage_alert_creator", "itsm_outage_alerts", ["tenant_id", "created_by_id"])
    op.create_table(
        "itsm_outage_alert_services", *_tenant_columns(),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="RESTRICT"), nullable=False),
        sa.UniqueConstraint("tenant_id", "alert_id", "service_id", name="uq_itsm_outage_alert_service"),
    )
    op.create_index("idx_itsm_outage_alert_services", "itsm_outage_alert_services", ["tenant_id", "service_id", "alert_id"])
    op.create_table(
        "itsm_outage_alert_cis", *_tenant_columns(),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ci_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_configuration_items.id", ondelete="RESTRICT"), nullable=False),
        sa.UniqueConstraint("tenant_id", "alert_id", "ci_id", name="uq_itsm_outage_alert_ci"),
    )
    op.create_table(
        "itsm_outage_alert_links", *_tenant_columns(),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "alert_id", "target_type", "target_id", name="uq_itsm_outage_alert_link"),
        sa.CheckConstraint("target_type IN ('INCIDENT','MAJOR_INCIDENT','PROBLEM','CHANGE')", name="ck_outage_alert_link_type"),
    )
    op.create_index("idx_itsm_outage_alert_link_target", "itsm_outage_alert_links", ["tenant_id", "target_type", "target_id"])
    op.create_table(
        "itsm_outage_alert_audiences", *_tenant_columns(),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("audience_type", sa.String(32), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_teams.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("audience_type IN ('SERVICE_USERS','SERVICE_AGENTS','SELECTED_TEAM','SERVICE_OWNERS')", name="ck_outage_alert_audience_type"),
    )
    op.create_index("idx_itsm_outage_alert_audience", "itsm_outage_alert_audiences", ["tenant_id", "alert_id", "audience_type"])
    op.create_table(
        "itsm_outage_alert_publications", *_tenant_columns(),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("publication_type", sa.String(20), nullable=False),
        sa.Column("content_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("audience_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("published_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "alert_id", "version", name="uq_itsm_outage_alert_publication_version"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_itsm_outage_alert_publication_idempotency"),
        sa.CheckConstraint("publication_type IN ('INITIAL','UPDATE','RECOVERY','EXPIRY')", name="ck_outage_alert_publication_type"),
    )
    op.create_index("idx_itsm_outage_alert_publications", "itsm_outage_alert_publications", ["tenant_id", "alert_id", "version"])
    op.create_table(
        "itsm_outage_alert_recipients", *_tenant_columns(),
        sa.Column("publication_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_outage_alert_publications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("audience_type", sa.String(32), nullable=False),
        sa.Column("projection_type", sa.String(32), nullable=False),
        sa.Column("inclusion_reason", sa.String(255), nullable=False),
        sa.Column("allowed_actions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("content_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("notification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True),
        sa.Column("delivery_status", sa.String(20), nullable=False, server_default="QUEUED"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "publication_id", "user_id", name="uq_itsm_outage_alert_recipient"),
        sa.CheckConstraint("delivery_status IN ('QUEUED','AVAILABLE','FAILED','RETRYING','PERMANENTLY_FAILED')", name="ck_outage_alert_delivery_status"),
    )
    op.create_index("idx_itsm_outage_alert_recipient_user", "itsm_outage_alert_recipients", ["tenant_id", "user_id", "created_at"])
    op.create_foreign_key("fk_itsm_outage_alert_current_publication", "itsm_outage_alerts", "itsm_outage_alert_publications", ["current_publication_id"], ["id"], ondelete="SET NULL")
    for table_name in TABLES:
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY;")
        op.execute(f"CREATE POLICY tenant_isolation ON public.{table_name} FOR ALL USING (tenant_id = authn.current_tenant_id()) WITH CHECK (tenant_id = authn.current_tenant_id());")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table_name} TO authclaw_app;")
        op.execute(f"GRANT SELECT ON public.{table_name} TO authclaw_agent_runtime;")


def downgrade() -> None:
    op.drop_constraint("fk_itsm_outage_alert_current_publication", "itsm_outage_alerts", type_="foreignkey")
    for table_name in reversed(TABLES):
        op.drop_table(table_name)
