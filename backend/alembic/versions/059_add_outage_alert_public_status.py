"""Add explicit customer-facing Outage Alert status.

Revision ID: 059
Revises: 058
"""

from alembic import op
import sqlalchemy as sa


revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "itsm_outage_alerts",
        sa.Column(
            "public_status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'INVESTIGATING'"),
        ),
    )
    # The internal recovered lifecycle is reliable evidence for the only
    # non-default backfill. Historical publication snapshots remain untouched.
    op.execute(
        "UPDATE public.itsm_outage_alerts "
        "SET public_status = 'RECOVERED' WHERE status = 'RECOVERED'"
    )
    op.create_check_constraint(
        "ck_outage_alert_public_status",
        "itsm_outage_alerts",
        "public_status IN ('INVESTIGATING','IDENTIFIED','MONITORING','RECOVERED')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_outage_alert_public_status",
        "itsm_outage_alerts",
        type_="check",
    )
    op.drop_column("itsm_outage_alerts", "public_status")
