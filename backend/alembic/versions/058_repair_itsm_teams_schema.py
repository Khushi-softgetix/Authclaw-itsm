"""Repair missing ITSM teams schema on installations stamped past revision 048.

Revision ID: 058
Revises: 057
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("itsm_teams", schema="public"):
        op.create_table(
            "itsm_teams",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("tenant_id", "name", name="uq_itsm_teams_tenant_name"),
            schema="public",
        )

    inspector = sa.inspect(bind)
    if not inspector.has_table("itsm_team_members", schema="public"):
        op.create_table(
            "itsm_team_members",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_teams.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("team_id", "user_id", name="uq_itsm_team_members_team_user"),
            schema="public",
        )

    op.execute("CREATE INDEX IF NOT EXISTS idx_itsm_teams_tenant ON public.itsm_teams (tenant_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_itsm_teams_tenant_status ON public.itsm_teams (tenant_id, is_active)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_itsm_team_members_lookup ON public.itsm_team_members (tenant_id, team_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_itsm_team_members_user ON public.itsm_team_members (tenant_id, user_id)")

    for table in ("itsm_teams", "itsm_team_members"):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public'
                      AND tablename = '{table}'
                      AND policyname = 'tenant_isolation'
                ) THEN
                    CREATE POLICY tenant_isolation ON public.{table} FOR ALL
                        USING (tenant_id = authn.current_tenant_id())
                        WITH CHECK (tenant_id = authn.current_tenant_id());
                END IF;
            END
            $$;
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table} TO authclaw_app")
        op.execute(f"GRANT SELECT ON public.{table} TO authclaw_agent_runtime")


def downgrade() -> None:
    # This repair may have adopted tables created by revision 048. Never drop
    # shared operational data when rolling back only the repair marker.
    pass
