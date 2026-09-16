"""Add essential major incident command structure.

Revision ID: 054
Revises: 053
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "itsm_major_incidents",
        sa.Column(
            "communication_lead_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    for column_name in (
        "restoration_checkpoints",
        "command_decisions",
        "command_tasks",
        "stakeholders",
    ):
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
        "idx_itsm_major_inc_comms_lead",
        "itsm_major_incidents",
        ["tenant_id", "communication_lead_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_itsm_major_inc_comms_lead", table_name="itsm_major_incidents")
    for column_name in (
        "stakeholders",
        "command_tasks",
        "command_decisions",
        "restoration_checkpoints",
        "communication_lead_id",
    ):
        op.drop_column("itsm_major_incidents", column_name)
