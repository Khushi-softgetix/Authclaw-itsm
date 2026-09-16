"""Add incident CI classification and Major Incident affected scope.

Revision ID: 056
Revises: 055
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        "idx_itsm_tickets_tenant_ci",
        "itsm_tickets",
        ["tenant_id", "configuration_item_id"],
    )
    for column_name in ("affected_service_ids", "affected_configuration_item_ids"):
        op.add_column(
            "itsm_major_incidents",
            sa.Column(
                column_name,
                postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
                nullable=False,
                server_default=sa.text("'{}'::uuid[]"),
            ),
        )


def downgrade() -> None:
    for column_name in ("affected_configuration_item_ids", "affected_service_ids"):
        op.drop_column("itsm_major_incidents", column_name)
    op.drop_index("idx_itsm_tickets_tenant_ci", table_name="itsm_tickets")
    op.drop_column("itsm_tickets", "configuration_item_id")
