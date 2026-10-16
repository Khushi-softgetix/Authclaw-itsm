"""Persist supported Major Incident command records.

Revision ID: 063
Revises: 062
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


JSON_LIST_COLUMNS = (
    "affected_service_ids",
    "affected_configuration_item_ids",
    "restoration_checkpoints",
    "command_decisions",
    "command_tasks",
    "stakeholders",
    "command_communications",
)


def upgrade() -> None:
    # Both tables are protected with FORCE RLS. PostgreSQL validates a new
    # foreign key by reading both tables, which fails for the migration owner
    # when no tenant context is present. Follow the established migration
    # pattern used by revisions 057/060: relax RLS only inside this
    # transactional migration and restore it before completion.
    op.execute("ALTER TABLE public.itsm_major_incidents NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_major_incidents DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.users DISABLE ROW LEVEL SECURITY")

    op.add_column(
        "itsm_major_incidents",
        sa.Column(
            "communication_lead_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_itsm_major_incidents_communication_lead",
        "itsm_major_incidents",
        "users",
        ["communication_lead_id"],
        ["id"],
        ondelete="SET NULL",
    )
    for column_name in JSON_LIST_COLUMNS:
        op.add_column(
            "itsm_major_incidents",
            sa.Column(
                column_name,
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
    op.create_index(
        "idx_itsm_major_inc_communication_lead",
        "itsm_major_incidents",
        ["tenant_id", "communication_lead_id"],
    )

    op.execute("ALTER TABLE public.users ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.users FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_major_incidents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_major_incidents FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index(
        "idx_itsm_major_inc_communication_lead",
        table_name="itsm_major_incidents",
    )
    for column_name in reversed(JSON_LIST_COLUMNS):
        op.drop_column("itsm_major_incidents", column_name)
    op.drop_constraint(
        "fk_itsm_major_incidents_communication_lead",
        "itsm_major_incidents",
        type_="foreignkey",
    )
    op.drop_column("itsm_major_incidents", "communication_lead_id")
