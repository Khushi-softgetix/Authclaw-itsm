"""Persist the Incident configuration-item classification.

Revision ID: 060
Revises: 059
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Both tables use FORCE RLS and the migration role intentionally cannot
    # execute the runtime tenant-context function. Temporarily disable RLS
    # inside this transactional migration so PostgreSQL can validate the new
    # foreign key across all tenants, then restore the security boundary.
    op.execute("ALTER TABLE public.itsm_tickets NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_tickets DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_configuration_items NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_configuration_items DISABLE ROW LEVEL SECURITY")

    op.add_column(
        "itsm_tickets",
        sa.Column(
            "configuration_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("itsm_configuration_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_itsm_tickets_tenant_configuration_item",
        "itsm_tickets",
        ["tenant_id", "configuration_item_id"],
    )

    op.execute("ALTER TABLE public.itsm_configuration_items ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_configuration_items FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_tickets ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_tickets FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(
        "idx_itsm_tickets_tenant_configuration_item",
        table_name="itsm_tickets",
    )
    op.drop_column("itsm_tickets", "configuration_item_id")
