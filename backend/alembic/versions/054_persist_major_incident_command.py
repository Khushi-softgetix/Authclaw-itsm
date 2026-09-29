"""Persist the Major Incident command workspace fields.

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
            nullable=True,
        ),
    )
    # RLS is forced on the populated command table. NOT VALID avoids a table
    # scan through the tenant policy while still enforcing the FK for new data.
    op.execute(
        "ALTER TABLE public.itsm_major_incidents "
        "ADD CONSTRAINT fk_itsm_major_incidents_communication_lead "
        "FOREIGN KEY (communication_lead_id) REFERENCES public.users(id) "
        "ON DELETE SET NULL NOT VALID"
    )
    op.add_column(
        "itsm_major_incidents",
        sa.Column(
            "affected_service_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default=sa.text("ARRAY[]::uuid[]"),
        ),
    )
    op.add_column(
        "itsm_major_incidents",
        sa.Column(
            "affected_configuration_item_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default=sa.text("ARRAY[]::uuid[]"),
        ),
    )
    for column_name in (
        "restoration_checkpoints",
        "command_decisions",
        "command_tasks",
        "stakeholders",
        "command_communications",
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
        "command_communications",
        "stakeholders",
        "command_tasks",
        "command_decisions",
        "restoration_checkpoints",
        "affected_configuration_item_ids",
        "affected_service_ids",
        "communication_lead_id",
    ):
        op.drop_column("itsm_major_incidents", column_name)
