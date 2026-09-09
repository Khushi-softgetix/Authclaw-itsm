"""Add ITSM product access and business roles schema.

Revision ID: 047
Revises: 046
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None

_TABLE_NAME = "itsm_user_access"


def upgrade() -> None:
    op.create_table(
        _TABLE_NAME,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("itsm_role", sa.String(50), nullable=False, server_default="REQUESTER"),
        sa.Column("has_itsm_access", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("has_governance_access", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_itsm_user_access_tenant_user"),
    )
    op.create_index("idx_itsm_user_access_lookup", _TABLE_NAME, ["tenant_id", "user_id"])
    op.create_index("idx_itsm_user_access_role", _TABLE_NAME, ["tenant_id", "itsm_role"])

    # Enforce RLS and grants
    op.execute(f"ALTER TABLE public.{_TABLE_NAME} ENABLE ROW LEVEL SECURITY;")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{_TABLE_NAME} FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id());
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{_TABLE_NAME} TO authclaw_app;")
    op.execute(f"GRANT SELECT ON public.{_TABLE_NAME} TO authclaw_agent_runtime;")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION authn.lookup_itsm_user_access(
            p_tenant_id uuid, p_user_id uuid
        ) RETURNS TABLE (
            itsm_role text,
            has_itsm_access boolean,
            has_governance_access boolean
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, authn, public
        AS $$
            SELECT itsm_role::text, has_itsm_access, has_governance_access
            FROM public.itsm_user_access
            WHERE tenant_id = p_tenant_id AND user_id = p_user_id
            LIMIT 1;
        $$;
        GRANT EXECUTE ON FUNCTION authn.lookup_itsm_user_access(uuid, uuid) TO authclaw_app;
        GRANT EXECUTE ON FUNCTION authn.lookup_itsm_user_access(uuid, uuid) TO authclaw_agent_runtime;
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS authn.lookup_itsm_user_access(uuid, uuid);")
    op.execute(f"DROP TABLE IF EXISTS public.{_TABLE_NAME} CASCADE;")

