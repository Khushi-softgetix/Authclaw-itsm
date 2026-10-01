"""Add tenant-scoped Incident Manager saved queue views.

Revision ID: 057
Revises: 056
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("itsm_incident_saved_views", schema="public"):
        op.create_table(
            "itsm_incident_saved_views",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("tenant_id", "user_id", "name", name="uq_itsm_saved_view_user_name"),
        )

    op.execute("CREATE INDEX IF NOT EXISTS idx_itsm_saved_views_user ON public.itsm_incident_saved_views (tenant_id, user_id)")
    op.execute("ALTER TABLE public.itsm_incident_saved_views ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_incident_saved_views FORCE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'itsm_incident_saved_views'
                  AND policyname = 'tenant_isolation'
            ) THEN
                CREATE POLICY tenant_isolation ON public.itsm_incident_saved_views FOR ALL
                    USING (tenant_id = authn.current_tenant_id())
                    WITH CHECK (tenant_id = authn.current_tenant_id());
            END IF;
        END
        $$;
    """)
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.itsm_incident_saved_views TO authclaw_app")


def downgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("itsm_incident_saved_views", schema="public"):
        op.drop_table("itsm_incident_saved_views")
