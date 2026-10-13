"""Persist incident reliability state and idempotent operation records.

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
    op.add_column(
        "itsm_tickets",
        sa.Column("sla_warning_escalated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "itsm_tickets",
        sa.Column("sla_breach_escalated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "itsm_tickets",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )

    # Only backfill from durable, ticket-bound activity evidence. Missing or
    # ambiguous historical evidence remains NULL so no timestamp is invented.
    op.execute(
        """
        UPDATE public.itsm_tickets AS ticket
        SET sla_warning_escalated_at = evidence.escalated_at
        FROM (
            SELECT tenant_id, ticket_id, min(created_at) AS escalated_at
            FROM public.itsm_ticket_activities
            WHERE activity_type = 'SLA_WARNING_ESCALATION'
            GROUP BY tenant_id, ticket_id
        ) AS evidence
        WHERE ticket.tenant_id = evidence.tenant_id
          AND ticket.id = evidence.ticket_id
          AND ticket.sla_warning_escalated_at IS NULL
        """
    )
    op.execute(
        """
        UPDATE public.itsm_tickets AS ticket
        SET sla_breach_escalated_at = evidence.escalated_at
        FROM (
            SELECT tenant_id, ticket_id, min(created_at) AS escalated_at
            FROM public.itsm_ticket_activities
            WHERE activity_type = 'SLA_BREACH_ESCALATION'
            GROUP BY tenant_id, ticket_id
        ) AS evidence
        WHERE ticket.tenant_id = evidence.tenant_id
          AND ticket.id = evidence.ticket_id
          AND ticket.sla_breach_escalated_at IS NULL
        """
    )

    op.create_index(
        "idx_itsm_tickets_sla_escalation_pending",
        "itsm_tickets",
        ["tenant_id", "status", "sla_warning_escalated_at", "sla_breach_escalated_at"],
        postgresql_where=sa.text(
            "status NOT IN ('RESOLVED','CLOSED','CANCELLED') "
            "AND (sla_response_due_at IS NOT NULL OR sla_resolution_due_at IS NOT NULL)"
        ),
    )

    op.create_table(
        "itsm_incident_operations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("idempotency_key", sa.String(255), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("incident_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_itsm_incident_operation_key"),
    )
    op.create_index(
        "idx_itsm_incident_operation_incident",
        "itsm_incident_operations",
        ["tenant_id", "incident_id", "created_at"],
    )
    op.execute("ALTER TABLE public.itsm_incident_operations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_incident_operations FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON public.itsm_incident_operations FOR ALL "
        "USING (tenant_id = authn.current_tenant_id()) "
        "WITH CHECK (tenant_id = authn.current_tenant_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE ON public.itsm_incident_operations TO authclaw_app")
    op.execute("GRANT SELECT ON public.itsm_incident_operations TO authclaw_agent_runtime")

    # The worker needs only tenant identifiers that currently have eligible
    # tickets. Ticket reads and writes still occur under each tenant's RLS
    # context; this function does not expose ticket content.
    op.execute(
        """
        CREATE FUNCTION worker_maintenance.sla_candidate_tenants()
        RETURNS TABLE(tenant_id uuid)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = pg_catalog, public, pg_temp
        AS $$
            SELECT DISTINCT ticket.tenant_id
            FROM public.itsm_tickets AS ticket
            WHERE ticket.status NOT IN ('RESOLVED','CLOSED','CANCELLED')
              AND (ticket.sla_response_due_at IS NOT NULL OR ticket.sla_resolution_due_at IS NOT NULL)
              AND (ticket.sla_warning_escalated_at IS NULL OR ticket.sla_breach_escalated_at IS NULL)
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION worker_maintenance.sla_candidate_tenants() FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA worker_maintenance TO authclaw_app")
    op.execute("GRANT EXECUTE ON FUNCTION worker_maintenance.sla_candidate_tenants() TO authclaw_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS worker_maintenance.sla_candidate_tenants()")
    op.drop_index("idx_itsm_incident_operation_incident", table_name="itsm_incident_operations")
    op.drop_table("itsm_incident_operations")
    op.drop_index("idx_itsm_tickets_sla_escalation_pending", table_name="itsm_tickets")
    op.drop_column("itsm_tickets", "version")
    op.drop_column("itsm_tickets", "sla_breach_escalated_at")
    op.drop_column("itsm_tickets", "sla_warning_escalated_at")
