"""Add ITSM MVP foundation schema.

Revision ID: 043
Revises: 042
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


_MVP_TABLES = [
    "itsm_business_calendars",
    "itsm_services",
    "itsm_ticket_categories",
    "itsm_sla_policies",
    "itsm_ticket_counters",
    "itsm_tickets",
    "itsm_ticket_activities",
    "itsm_service_catalog_items",
    "itsm_service_request_details",
    "itsm_knowledge_articles",
    "itsm_knowledge_article_versions",
    "itsm_configuration_items",
]


def upgrade() -> None:
    # 1. itsm_business_calendars
    op.create_table(
        "itsm_business_calendars",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="UTC"),
        sa.Column("weekly_hours", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{\"monday\":{\"start\":\"09:00\",\"end\":\"17:00\"},\"tuesday\":{\"start\":\"09:00\",\"end\":\"17:00\"},\"wednesday\":{\"start\":\"09:00\",\"end\":\"17:00\"},\"thursday\":{\"start\":\"09:00\",\"end\":\"17:00\"},\"friday\":{\"start\":\"09:00\",\"end\":\"17:00\"}}'::jsonb")),
        sa.Column("holidays", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_itsm_calendar_tenant_name"),
    )
    op.create_index("idx_itsm_calendar_tenant", "itsm_business_calendars", ["tenant_id"])

    # 2. itsm_services
    op.create_table(
        "itsm_services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tier", sa.String(20), nullable=False, server_default="TIER_2"),
        sa.Column("status", sa.String(32), nullable=False, server_default="OPERATIONAL"),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("escalation_team", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_itsm_services_tenant_slug"),
    )
    op.create_index("idx_itsm_services_tenant", "itsm_services", ["tenant_id"])
    op.create_index("idx_itsm_services_tenant_tier", "itsm_services", ["tenant_id", "tier"])
    op.create_index("idx_itsm_services_tenant_status", "itsm_services", ["tenant_id", "status"])

    # 3. itsm_ticket_categories
    op.create_table(
        "itsm_ticket_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("parent_category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_ticket_categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "code", name="uq_itsm_category_tenant_code"),
    )
    op.create_index("idx_itsm_category_tenant", "itsm_ticket_categories", ["tenant_id"])
    op.create_index("idx_itsm_category_parent", "itsm_ticket_categories", ["tenant_id", "parent_category_id"])

    # 4. itsm_sla_policies
    op.create_table(
        "itsm_sla_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("calendar_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_business_calendars.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ticket_type", sa.String(32), nullable=False, server_default="INCIDENT"),
        sa.Column("priority", sa.String(20), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=True),
        sa.Column("response_target_minutes", sa.Integer(), nullable=False),
        sa.Column("resolution_target_minutes", sa.Integer(), nullable=False),
        sa.Column("warning_threshold_percent", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("escalation_rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("pause_conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[\"PENDING_CUSTOMER\",\"PENDING_VENDOR\",\"PENDING_CHANGE\"]'::jsonb")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_sla_lookup", "itsm_sla_policies", ["tenant_id", "ticket_type", "priority", "service_id"])

    # 5. itsm_ticket_counters
    op.create_table(
        "itsm_ticket_counters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_type", sa.String(32), nullable=False),
        sa.Column("prefix", sa.String(10), nullable=False),
        sa.Column("last_number", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "ticket_type", name="uq_itsm_counter_tenant_type"),
    )

    # 6. itsm_tickets
    op.create_table(
        "itsm_tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_number", sa.String(32), nullable=False),
        sa.Column("ticket_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("impact", sa.String(20), nullable=False, server_default="MEDIUM"),
        sa.Column("urgency", sa.String(20), nullable=False, server_default="MEDIUM"),
        sa.Column("priority", sa.String(20), nullable=False, server_default="P3"),
        sa.Column("status", sa.String(32), nullable=False, server_default="NEW"),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column("source_channel", sa.String(50), nullable=False, server_default="PORTAL"),
        sa.Column("requester_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assignee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignment_group", sa.String(100), nullable=True),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_ticket_categories.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(100), nullable=False, server_default="GENERAL"),
        sa.Column("subcategory", sa.String(100), nullable=True),
        sa.Column("is_major_incident", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("linked_problem_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("linked_finding_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("findings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sla_policy_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_sla_policies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sla_response_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_response_met_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_resolution_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_resolution_met_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_status", sa.String(20), nullable=False, server_default="WITHIN_SLA"),
        sa.Column("sla_paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sla_accumulated_pause_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("resolution_code", sa.String(50), nullable=True),
        sa.Column("resolution_summary", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ai_triaged", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ai_suggested_priority", sa.String(20), nullable=True),
        sa.Column("ai_confidence_score", sa.Float(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "ticket_number", name="uq_itsm_tickets_tenant_number"),
    )
    op.create_index("idx_itsm_tickets_tenant_status", "itsm_tickets", ["tenant_id", "status"])
    op.create_index("idx_itsm_tickets_tenant_assignee", "itsm_tickets", ["tenant_id", "assignee_id"])
    op.create_index("idx_itsm_tickets_tenant_priority", "itsm_tickets", ["tenant_id", "priority"])
    op.create_index("idx_itsm_tickets_tenant_created", "itsm_tickets", ["tenant_id", sa.text("created_at DESC")])
    op.create_index("idx_itsm_tickets_sla_breach", "itsm_tickets", ["tenant_id", "sla_status", "sla_resolution_due_at"], postgresql_where=sa.text("status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED')"))
    op.create_index("idx_itsm_tickets_finding", "itsm_tickets", ["tenant_id", "linked_finding_id"], postgresql_where=sa.text("linked_finding_id IS NOT NULL"))

    # 7. itsm_ticket_activities
    op.create_table(
        "itsm_ticket_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_type", sa.String(50), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_type", sa.String(32), nullable=False, server_default="USER"),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_activity_ticket_created", "itsm_ticket_activities", ["tenant_id", "ticket_id", sa.text("created_at ASC")])

    # 8. itsm_service_catalog_items
    op.create_table(
        "itsm_service_catalog_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("intake_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{\"type\":\"object\",\"properties\":{}}'::jsonb")),
        sa.Column("approval_required", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("fulfillment_group", sa.String(100), nullable=True),
        sa.Column("estimated_delivery_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_itsm_catalog_tenant_slug"),
    )
    op.create_index("idx_itsm_catalog_tenant_service", "itsm_service_catalog_items", ["tenant_id", "service_id", "is_active"])

    # 9. itsm_service_request_details
    op.create_table(
        "itsm_service_request_details",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("catalog_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_service_catalog_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("catalog_item_version", sa.Integer(), nullable=False),
        sa.Column("intake_schema_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("submitted_form_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "ticket_id", name="uq_itsm_request_details_ticket"),
    )
    op.create_index("idx_itsm_request_details_catalog", "itsm_service_request_details", ["tenant_id", "catalog_item_id"])

    # 10. itsm_knowledge_articles
    op.create_table(
        "itsm_knowledge_articles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("category", sa.String(100), nullable=False, server_default="TROUBLESHOOTING"),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("current_published_version", sa.Integer(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("helpful_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_itsm_kb_tenant_slug"),
    )
    op.create_index("idx_itsm_kb_tenant_status", "itsm_knowledge_articles", ["tenant_id", "status"])
    op.create_index("idx_itsm_kb_service", "itsm_knowledge_articles", ["tenant_id", "service_id"])

    # 11. itsm_knowledge_article_versions
    op.create_table(
        "itsm_knowledge_article_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("article_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_knowledge_articles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("content_markdown", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("keywords", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("ARRAY[]::text[]")),
        sa.Column("change_summary", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "article_id", "version_number", name="uq_itsm_kb_version_number"),
    )
    op.create_index("idx_itsm_kb_version_article", "itsm_knowledge_article_versions", ["tenant_id", "article_id"])

    # 12. itsm_configuration_items
    op.create_table(
        "itsm_configuration_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("ci_type", sa.String(50), nullable=False),
        sa.Column("environment", sa.String(20), nullable=False, server_default="PRODUCTION"),
        sa.Column("cloud_connector_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cloud_connectors.id", ondelete="SET NULL"), nullable=True),
        sa.Column("external_resource_id", sa.String(512), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("attributes", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_itsm_ci_tenant_service", "itsm_configuration_items", ["tenant_id", "service_id"])
    op.create_index("idx_itsm_ci_type", "itsm_configuration_items", ["tenant_id", "ci_type"])
    op.create_index("idx_itsm_ci_cloud_connector", "itsm_configuration_items", ["tenant_id", "cloud_connector_id"])

    # Enforce RLS and grants for all MVP tables
    for table_name in _MVP_TABLES:
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

    # Least privilege writes for agent runtime
    op.execute("GRANT INSERT ON public.itsm_ticket_activities TO authclaw_agent_runtime;")
    op.execute("GRANT UPDATE (ai_triaged, ai_suggested_priority, ai_confidence_score, ai_summary, updated_at) ON public.itsm_tickets TO authclaw_agent_runtime;")


def downgrade() -> None:
    for table_name in reversed(_MVP_TABLES):
        op.execute(f"DROP TABLE IF EXISTS public.{table_name} CASCADE;")
