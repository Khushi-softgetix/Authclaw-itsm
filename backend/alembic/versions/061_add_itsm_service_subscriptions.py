"""Add ITSMServiceSubscription for role-based outage audience resolution.

Revision ID: 061
Revises: 060
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "itsm_service_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_unique_constraint("uq_itsm_service_subscription", "itsm_service_subscriptions", ["tenant_id", "service_id", "user_id"])
    op.create_index("idx_itsm_service_sub_user", "itsm_service_subscriptions", ["tenant_id", "user_id", "is_active"])
    op.create_index("idx_itsm_service_sub_service", "itsm_service_subscriptions", ["tenant_id", "service_id", "is_active"])

    op.execute("ALTER TABLE public.itsm_service_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_service_subscriptions FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON public.itsm_service_subscriptions FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id())
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.itsm_service_subscriptions TO authclaw_app")


def downgrade() -> None:
    op.drop_table("itsm_service_subscriptions")
