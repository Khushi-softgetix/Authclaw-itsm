"""Add an explicit requester-resolution rule to ITSM services.

Revision ID: 058
Revises: 057
"""

from alembic import op
import sqlalchemy as sa


revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preserve the existing least-privilege behavior for every service. A
    # service becomes company-wide only after an authorized administrator
    # explicitly changes this value.
    op.add_column(
        "itsm_services",
        sa.Column(
            "alert_recipient_scope",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'SERVICE_ENTITLEMENTS'"),
        ),
    )
    op.create_check_constraint(
        "ck_itsm_service_alert_recipient_scope",
        "itsm_services",
        "alert_recipient_scope IN ('SERVICE_ENTITLEMENTS','ALL_REQUESTERS')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_itsm_service_alert_recipient_scope",
        "itsm_services",
        type_="check",
    )
    op.drop_column("itsm_services", "alert_recipient_scope")
