"""Add ITSM V1 foundation schema.

Revision ID: 044
Revises: 043
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None

_V1_TABLES = [
    "itsm_change_requests",
    "itsm_change_request_cis",
    "itsm_service_relationships",
    "itsm_attachments",
    "itsm_problem_details",
]


def upgrade() -> None:
    # 1. itsm_change_requests
    op.create_table(
        "itsm_change_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("change_number", sa.String(32), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("change_type", sa.String(20), nullable=False, server_default="STANDARD"),
        sa.Column("risk_level", sa.String(20), nullable=False, server_default="LOW"),
        sa.Column("impact_level", sa.String(20), nullable=False, server_default="LOW"),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("lead_time_hours", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outage_expected", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("implementation_plan", sa.Text(), nullable=False, server_default=""),
        sa.Column("backout_plan", sa.Text(), nullable=False, server_default=""),
        sa.Column("test_plan", sa.Text(), nullable=False, server_default=""),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assigned_to_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_team", sa.String(100), nullable=True),
        sa.Column("pending_approval_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("pending_approvals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("earliest_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("latest_finish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_finish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "change_number", name="uq_itsm_change_tenant_number"),
    )
    op.create_index("idx_itsm_change_tenant_status", "itsm_change_requests", ["tenant_id", "status"])
    op.create_index("idx_itsm_change_service", "itsm_change_requests", ["tenant_id", "service_id"])
    op.create_index("idx_itsm_change_approval", "itsm_change_requests", ["tenant_id", "pending_approval_id"])

    # 2. itsm_change_request_cis (Normalized Change <-> CI relationship)
    op.create_table(
        "itsm_change_request_cis",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("change_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_change_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ci_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_configuration_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("impact_type", sa.String(32), nullable=False, server_default="AFFECTED"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "change_id", "ci_id", name="uq_itsm_change_ci_unique"),
    )
    op.create_index("idx_itsm_change_ci_change", "itsm_change_request_cis", ["tenant_id", "change_id"])
    op.create_index("idx_itsm_change_ci_ci", "itsm_change_request_cis", ["tenant_id", "ci_id"])

    # 3. itsm_service_relationships (Service Graph topology)
    op.create_table(
        "itsm_service_relationships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(50), nullable=False, server_default="DEPENDS_ON"),
        sa.Column("criticality", sa.String(20), nullable=False, server_default="MEDIUM"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "parent_service_id", "child_service_id", name="uq_itsm_service_rel"),
        sa.CheckConstraint("parent_service_id != child_service_id", name="ck_itsm_service_rel_no_self_ref"),
    )
    op.create_index("idx_itsm_serv_rel_parent", "itsm_service_relationships", ["tenant_id", "parent_service_id"])
    op.create_index("idx_itsm_serv_rel_child", "itsm_service_relationships", ["tenant_id", "child_service_id"])

    # 4. itsm_attachments
    op.create_table(
        "itsm_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("mime_type", sa.String(127), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("storage_backend", sa.String(32), nullable=False, server_default="S3"),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("is_quarantined", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("quarantine_reason", sa.String(255), nullable=True),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_attach_target", "itsm_attachments", ["tenant_id", "target_type", "target_id"])

    # 5. itsm_problem_details (V1 Problem details attached to itsm_tickets)
    op.create_table(
        "itsm_problem_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("known_error", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("root_cause_summary", sa.Text(), nullable=True),
        sa.Column("workaround_summary", sa.Text(), nullable=True),
        sa.Column("permanent_solution", sa.Text(), nullable=True),
        sa.Column("rca_document_url", sa.String(1024), nullable=True),
        sa.Column("assigned_investigator_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("identified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_problem_details_ticket"),
    )
    op.create_index("idx_itsm_problem_investigator", "itsm_problem_details", ["tenant_id", "assigned_investigator_id"])

    # Enforce RLS and grants for all V1 tables
    for table_name in _V1_TABLES:
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


def downgrade() -> None:
    for table_name in reversed(_V1_TABLES):
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")
