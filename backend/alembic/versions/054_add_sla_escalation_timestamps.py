"""Add persisted SLA escalation timestamps and indexes to itsm_tickets.

Revision ID: 054
Revises: 053
"""

from alembic import op
import sqlalchemy as sa


revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None

_TABLE = "itsm_tickets"
_IDX_WARNING = "idx_itsm_tickets_tenant_sla_warning"
_IDX_BREACH = "idx_itsm_tickets_tenant_sla_breach_esc"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_cols = {col["name"] for col in insp.get_columns(_TABLE)}

    # 1. Add persisted escalation timestamp columns if not already present
    if "sla_warning_escalated_at" not in existing_cols:
        op.add_column(
            _TABLE,
            sa.Column("sla_warning_escalated_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "sla_breach_escalated_at" not in existing_cols:
        op.add_column(
            _TABLE,
            sa.Column("sla_breach_escalated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 2. Create optimized indexes for tenant escalation polling and queries
    existing_indexes = {idx["name"] for idx in insp.get_indexes(_TABLE)}
    if _IDX_WARNING not in existing_indexes:
        op.create_index(
            _IDX_WARNING,
            _TABLE,
            ["tenant_id", "sla_warning_escalated_at"],
        )
    if _IDX_BREACH not in existing_indexes:
        op.create_index(
            _IDX_BREACH,
            _TABLE,
            ["tenant_id", "sla_breach_escalated_at"],
        )

    # 3. Safe backfill: recover previous escalation timestamps from recorded ticket activities if present
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE public.itsm_tickets NO FORCE ROW LEVEL SECURITY;")
        op.execute("ALTER TABLE public.itsm_ticket_activities NO FORCE ROW LEVEL SECURITY;")
        try:
            op.execute(
                """
                UPDATE public.itsm_tickets t
                SET sla_warning_escalated_at = sub.earliest_warning
                FROM (
                    SELECT ticket_id, MIN(created_at) AS earliest_warning
                    FROM public.itsm_ticket_activities
                    WHERE activity_type = 'SLA_WARNING_ESCALATION'
                    GROUP BY ticket_id
                ) sub
                WHERE t.id = sub.ticket_id AND t.sla_warning_escalated_at IS NULL;
                """
            )
            op.execute(
                """
                UPDATE public.itsm_tickets t
                SET sla_breach_escalated_at = sub.earliest_breach
                FROM (
                    SELECT ticket_id, MIN(created_at) AS earliest_breach
                    FROM public.itsm_ticket_activities
                    WHERE activity_type = 'SLA_BREACH_ESCALATION'
                    GROUP BY ticket_id
                ) sub
                WHERE t.id = sub.ticket_id AND t.sla_breach_escalated_at IS NULL;
                """
            )
        finally:
            op.execute("ALTER TABLE public.itsm_ticket_activities FORCE ROW LEVEL SECURITY;")
            op.execute("ALTER TABLE public.itsm_tickets FORCE ROW LEVEL SECURITY;")
    else:
        op.execute(
            """
            UPDATE itsm_tickets
            SET sla_warning_escalated_at = (
                SELECT MIN(created_at)
                FROM itsm_ticket_activities
                WHERE itsm_ticket_activities.ticket_id = itsm_tickets.id
                  AND itsm_ticket_activities.activity_type = 'SLA_WARNING_ESCALATION'
            )
            WHERE sla_warning_escalated_at IS NULL
              AND EXISTS (
                SELECT 1
                FROM itsm_ticket_activities
                WHERE itsm_ticket_activities.ticket_id = itsm_tickets.id
                  AND itsm_ticket_activities.activity_type = 'SLA_WARNING_ESCALATION'
            );
            """
        )
        op.execute(
            """
            UPDATE itsm_tickets
            SET sla_breach_escalated_at = (
                SELECT MIN(created_at)
                FROM itsm_ticket_activities
                WHERE itsm_ticket_activities.ticket_id = itsm_tickets.id
                  AND itsm_ticket_activities.activity_type = 'SLA_BREACH_ESCALATION'
            )
            WHERE sla_breach_escalated_at IS NULL
              AND EXISTS (
                SELECT 1
                FROM itsm_ticket_activities
                WHERE itsm_ticket_activities.ticket_id = itsm_tickets.id
                  AND itsm_ticket_activities.activity_type = 'SLA_BREACH_ESCALATION'
            );
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_indexes = {idx["name"] for idx in insp.get_indexes(_TABLE)}
    existing_cols = {col["name"] for col in insp.get_columns(_TABLE)}

    if _IDX_BREACH in existing_indexes:
        op.drop_index(_IDX_BREACH, table_name=_TABLE)
    if _IDX_WARNING in existing_indexes:
        op.drop_index(_IDX_WARNING, table_name=_TABLE)
    if "sla_breach_escalated_at" in existing_cols:
        op.drop_column(_TABLE, "sla_breach_escalated_at")
    if "sla_warning_escalated_at" in existing_cols:
        op.drop_column(_TABLE, "sla_warning_escalated_at")
