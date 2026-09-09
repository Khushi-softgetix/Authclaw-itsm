"""Add ITSM teams and team members schema.

Revision ID: 048
Revises: 047
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None

_TEAMS_TABLE = "itsm_teams"
_MEMBERS_TABLE = "itsm_team_members"


def upgrade() -> None:
    # 1. itsm_teams
    op.create_table(
        _TEAMS_TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_itsm_teams_tenant_name"),
    )
    op.create_index("idx_itsm_teams_tenant", _TEAMS_TABLE, ["tenant_id"])
    op.create_index("idx_itsm_teams_tenant_status", _TEAMS_TABLE, ["tenant_id", "is_active"])

    # 2. itsm_team_members
    op.create_table(
        _MEMBERS_TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("team_id", "user_id", name="uq_itsm_team_members_team_user"),
    )
    op.create_index("idx_itsm_team_members_lookup", _MEMBERS_TABLE, ["tenant_id", "team_id"])
    op.create_index("idx_itsm_team_members_user", _MEMBERS_TABLE, ["tenant_id", "user_id"])

    # Enforce Row Level Security and grants
    op.execute(f"ALTER TABLE public.{_TEAMS_TABLE} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE public.{_TEAMS_TABLE} FORCE ROW LEVEL SECURITY;")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{_TEAMS_TABLE} FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id());
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{_TEAMS_TABLE} TO authclaw_app;")
    op.execute(f"GRANT SELECT ON public.{_TEAMS_TABLE} TO authclaw_agent_runtime;")

    op.execute(f"ALTER TABLE public.{_MEMBERS_TABLE} ENABLE ROW LEVEL SECURITY;")
    op.execute(f"ALTER TABLE public.{_MEMBERS_TABLE} FORCE ROW LEVEL SECURITY;")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON public.{_MEMBERS_TABLE} FOR ALL
            USING (tenant_id = authn.current_tenant_id())
            WITH CHECK (tenant_id = authn.current_tenant_id());
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{_MEMBERS_TABLE} TO authclaw_app;")
    op.execute(f"GRANT SELECT ON public.{_MEMBERS_TABLE} TO authclaw_agent_runtime;")


def downgrade() -> None:
    op.drop_table(_MEMBERS_TABLE)
    op.drop_table(_TEAMS_TABLE)
