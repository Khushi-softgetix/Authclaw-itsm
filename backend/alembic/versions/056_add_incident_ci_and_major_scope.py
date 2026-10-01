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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    ticket_columns = {column["name"] for column in inspector.get_columns("itsm_tickets", schema="public")}
    if "configuration_item_id" not in ticket_columns:
        op.add_column(
            "itsm_tickets",
            sa.Column(
                "configuration_item_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("itsm_configuration_items.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )

    ticket_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("itsm_tickets", schema="public")}
    if "idx_itsm_tickets_tenant_ci" not in ticket_indexes:
        op.create_index(
            "idx_itsm_tickets_tenant_ci",
            "itsm_tickets",
            ["tenant_id", "configuration_item_id"],
        )

    major_columns = {column["name"] for column in sa.inspect(bind).get_columns("itsm_major_incidents", schema="public")}
    for column_name in ("affected_service_ids", "affected_configuration_item_ids"):
        if column_name in major_columns:
            continue
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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    major_columns = {column["name"] for column in inspector.get_columns("itsm_major_incidents", schema="public")}
    for column_name in ("affected_configuration_item_ids", "affected_service_ids"):
        if column_name in major_columns:
            op.drop_column("itsm_major_incidents", column_name)

    ticket_indexes = {index["name"] for index in inspector.get_indexes("itsm_tickets", schema="public")}
    if "idx_itsm_tickets_tenant_ci" in ticket_indexes:
        op.drop_index("idx_itsm_tickets_tenant_ci", table_name="itsm_tickets")

    ticket_columns = {column["name"] for column in inspector.get_columns("itsm_tickets", schema="public")}
    if "configuration_item_id" in ticket_columns:
        op.drop_column("itsm_tickets", "configuration_item_id")
