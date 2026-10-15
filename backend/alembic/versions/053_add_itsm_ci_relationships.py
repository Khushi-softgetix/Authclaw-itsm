"""Add typed Configuration Item relationships schema (CMDB-002).

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

_CI_RELATIONSHIPS_TABLE = "itsm_ci_relationships"


def upgrade() -> None:
    # 1. itsm_ci_relationships (Service graph edge between CIs)
    op.create_table(
        _CI_RELATIONSHIPS_TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_ci_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_configuration_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_ci_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_configuration_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(50), nullable=False, server_default="DEPENDS_ON"),
        sa.Column("source", sa.String(100), nullable=False, server_default="MANUAL"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "parent_ci_id", "child_ci_id", "relationship_type", name="uq_itsm_ci_rel"),
        sa.CheckConstraint("parent_ci_id != child_ci_id", name="ck_itsm_ci_rel_no_self_ref"),
    )
    op.create_index("idx_itsm_ci_rel_parent", _CI_RELATIONSHIPS_TABLE, ["tenant_id", "parent_ci_id"])
    op.create_index("idx_itsm_ci_rel_child", _CI_RELATIONSHIPS_TABLE, ["tenant_id", "child_ci_id"])
    op.create_index("idx_itsm_ci_rel_type", _CI_RELATIONSHIPS_TABLE, ["tenant_id", "relationship_type"])

    # Enforce tenant isolation via Row Level Security
    op.execute(f"ALTER TABLE public.{_CI_RELATIONSHIPS_TABLE} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE public.{_CI_RELATIONSHIPS_TABLE} FORCE ROW LEVEL SECURITY;")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{_CI_RELATIONSHIPS_TABLE} FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id());
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{_CI_RELATIONSHIPS_TABLE} TO authclaw_app;")
    op.execute(f"GRANT SELECT ON public.{_CI_RELATIONSHIPS_TABLE} TO authclaw_agent_runtime;")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS public.{_CI_RELATIONSHIPS_TABLE} CASCADE;")
