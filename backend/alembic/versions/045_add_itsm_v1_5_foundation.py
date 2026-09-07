"""Add ITSM V1.5 foundation schema.

Revision ID: 045
Revises: 044
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None

_V1_5_TABLES = [
    "itsm_major_incidents",
    "itsm_oncall_schedules",
    "itsm_oncall_rotations",
    "itsm_oncall_overrides",
    "itsm_agent_sessions",
    "itsm_workflows",
    "itsm_workflow_versions",
    "itsm_workflow_executions",
]


def upgrade() -> None:
    # 1. itsm_major_incidents
    op.create_table(
        "itsm_major_incidents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("incident_commander_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bridge_url", sa.String(1024), nullable=True),
        sa.Column("communication_channel", sa.String(255), nullable=True),
        sa.Column("declared_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("declared_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("postmortem_status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("postmortem_url", sa.String(1024), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executive_summary", sa.Text(), nullable=True),
        sa.Column("impacted_business_units", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("ARRAY[]::text[]")),
        sa.Column("customer_impact_description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_major_incident_ticket"),
    )
    op.create_index("idx_itsm_major_inc_commander", "itsm_major_incidents", ["tenant_id", "incident_commander_id"])

    # 2. itsm_oncall_schedules
    op.create_table(
        "itsm_oncall_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="UTC"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("calendar_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_business_calendars.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_itsm_oncall_sched_name"),
    )
    op.create_index("idx_itsm_oncall_service", "itsm_oncall_schedules", ["tenant_id", "service_id"])

    # 3. itsm_oncall_rotations
    op.create_table(
        "itsm_oncall_rotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_oncall_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tier_level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("user_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), nullable=False, server_default=sa.text("ARRAY[]::uuid[]")),
        sa.Column("rotation_type", sa.String(20), nullable=False, server_default="WEEKLY"),
        sa.Column("rotation_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("handoff_time", sa.String(10), nullable=False, server_default="09:00"),
        sa.Column("escalation_delay_minutes", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "schedule_id", "tier_level", name="uq_itsm_oncall_tier"),
    )
    op.create_index("idx_itsm_oncall_rot_sched", "itsm_oncall_rotations", ["tenant_id", "schedule_id"])

    # 4. itsm_oncall_overrides
    op.create_table(
        "itsm_oncall_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_oncall_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tier_level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("original_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("override_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_override_time", "itsm_oncall_overrides", ["tenant_id", "schedule_id", "start_at", "end_at"])

    # 5. itsm_agent_sessions (Safe Decision Summaries, NO Raw CoT)
    op.create_table(
        "itsm_agent_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("session_type", sa.String(32), nullable=False, server_default="TRIAGE"),
        sa.Column("decision_summary", sa.Text(), nullable=False),
        sa.Column("evidence_artifacts", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("actions_proposed", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("actions_executed", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("confidence_score", sa.Numeric(4, 3), nullable=True),
        sa.Column("guardrail_flags", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("ARRAY[]::text[]")),
        sa.Column("requires_human_approval", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("pending_approval_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_agent_ticket", "itsm_agent_sessions", ["tenant_id", "ticket_id"])
    op.create_index("idx_itsm_agent_run", "itsm_agent_sessions", ["tenant_id", "agent_run_id"])
    op.create_index("idx_itsm_agent_approval", "itsm_agent_sessions", ["tenant_id", "pending_approval_id"])

    # 6. itsm_workflows
    op.create_table(
        "itsm_workflows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("trigger_type", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("current_published_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_itsm_workflow_slug"),
    )
    op.create_index("idx_itsm_workflow_trigger", "itsm_workflows", ["tenant_id", "trigger_type", "is_active"])

    # 7. itsm_workflow_versions
    op.create_table(
        "itsm_workflow_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_workflows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("definition", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("changelog", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "workflow_id", "version_number", name="uq_itsm_wf_version_number"),
    )
    op.create_index("idx_itsm_wf_version_wf", "itsm_workflow_versions", ["tenant_id", "workflow_id"])

    # 8. itsm_workflow_executions
    op.create_table(
        "itsm_workflow_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_workflows.id", ondelete="CASCADE"), nullable=False),
        sa.Column("workflow_version", sa.Integer(), nullable=False),
        sa.Column("trigger_event", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(32), nullable=False, server_default="RUNNING"),
        sa.Column("current_step_id", sa.String(64), nullable=True),
        sa.Column("execution_context", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("pending_approval_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_itsm_wf_exec_status", "itsm_workflow_executions", ["tenant_id", "status"])
    op.create_index("idx_itsm_wf_exec_approval", "itsm_workflow_executions", ["tenant_id", "pending_approval_id"])

    # Enforce RLS and grants for all V1.5 tables
    for table_name in _V1_5_TABLES:
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON public.{table_name} FOR ALL
                USING (tenant_id = authn.current_tenant_id())
                WITH CHECK (tenant_id = authn.current_tenant_id());
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table_name} TO authclaw_app;")
        op.execute(f"GRANT SELECT ON public.{table_name} TO authclaw_agent_runtime;")

    # Agent runtime can create and update agent session records
    op.execute("GRANT INSERT, UPDATE ON public.itsm_agent_sessions TO authclaw_agent_runtime;")


def downgrade() -> None:
    for table_name in reversed(_V1_5_TABLES):
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")
