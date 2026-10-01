"""Add evidence-based major incident communication records.

Revision ID: 055
Revises: 054
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("itsm_major_incidents", schema="public")}
    if "command_communications" in columns:
        return

    op.add_column(
        "itsm_major_incidents",
        sa.Column(
            "command_communications",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("itsm_major_incidents", schema="public")}
    if "command_communications" in columns:
        op.drop_column("itsm_major_incidents", "command_communications")
