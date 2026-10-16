"""Add the controlled tenant-wide portal audience.

Revision ID: 062
Revises: 061
"""

from alembic import op


revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


AUDIENCE_TYPES = (
    "'ALL_PORTAL_USERS','SERVICE_USERS','SERVICE_AGENTS','PROBLEM_MANAGERS',"
    "'CHANGE_MANAGERS','SELECTED_TEAM','SERVICE_OWNERS','SPECIFIC_USER'"
)


def upgrade() -> None:
    op.drop_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        type_="check",
    )
    op.create_check_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        f"audience_type IN ({AUDIENCE_TYPES})",
    )


def downgrade() -> None:
    # Published audience and recipient snapshots are evidence. Refuse to erase
    # their meaning during rollback.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM public.itsm_outage_alert_audiences
                WHERE audience_type = 'ALL_PORTAL_USERS'
            ) OR EXISTS (
                SELECT 1 FROM public.itsm_outage_alert_recipients
                WHERE audience_type = 'ALL_PORTAL_USERS'
                   OR audience_memberships @> '[{"audience_type":"ALL_PORTAL_USERS"}]'::jsonb
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade tenant-wide portal audiences while alert evidence exists';
            END IF;
        END
        $$;
        """
    )
    op.drop_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        type_="check",
    )
    op.create_check_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        "audience_type IN ('SERVICE_USERS','SERVICE_AGENTS','PROBLEM_MANAGERS',"
        "'CHANGE_MANAGERS','SELECTED_TEAM','SERVICE_OWNERS','SPECIFIC_USER')",
    )
