"""Complete safe alert audiences and tenant-bound reference integrity.

Revision ID: 057
Revises: 056
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


REFERENCE_TABLES = (
    "itsm_service_consumers",
    "itsm_service_support_teams",
    "itsm_outage_alert_grants",
    "itsm_outage_alerts",
    "itsm_outage_alert_services",
    "itsm_outage_alert_cis",
    "itsm_outage_alert_links",
    "itsm_outage_alert_audiences",
    "itsm_outage_alert_publications",
    "itsm_outage_alert_recipients",
)


def upgrade() -> None:
    op.add_column(
        "itsm_outage_alert_audiences",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # The migrator owns these tables, but FORCE RLS would make PostgreSQL's
    # foreign-key validation query call tenant context during a global schema
    # migration. Temporarily lift FORCE exactly as the existing 054 migration
    # does for itsm_user_access, then restore it in the same transaction.
    op.execute("ALTER TABLE public.users NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_outage_alert_audiences NO FORCE ROW LEVEL SECURITY")
    op.create_foreign_key(
        "fk_outage_alert_audience_user",
        "itsm_outage_alert_audiences",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute("ALTER TABLE public.users FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_outage_alert_audiences FORCE ROW LEVEL SECURITY")
    op.create_index(
        "idx_itsm_outage_alert_audience_user",
        "itsm_outage_alert_audiences",
        ["tenant_id", "user_id"],
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
    op.create_check_constraint(
        "ck_outage_alert_audience_scope_shape",
        "itsm_outage_alert_audiences",
        "(audience_type = 'SELECTED_TEAM' AND team_id IS NOT NULL AND user_id IS NULL) OR "
        "(audience_type = 'SPECIFIC_USER' AND user_id IS NOT NULL AND team_id IS NULL) OR "
        "(audience_type NOT IN ('SELECTED_TEAM','SPECIFIC_USER') AND team_id IS NULL AND user_id IS NULL)",
    )
    op.add_column(
        "itsm_outage_alert_recipients",
        sa.Column(
            "audience_memberships",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.protect_outage_alert_recipient_snapshot()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'outage alert recipient evidence cannot be deleted' USING ERRCODE = '55000';
            END IF;
            IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
               OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.audience_type IS DISTINCT FROM OLD.audience_type
               OR NEW.projection_type IS DISTINCT FROM OLD.projection_type
               OR NEW.inclusion_reason IS DISTINCT FROM OLD.inclusion_reason
               OR NEW.audience_memberships IS DISTINCT FROM OLD.audience_memberships
               OR NEW.allowed_actions IS DISTINCT FROM OLD.allowed_actions
               OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'outage alert recipient snapshot is immutable' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )

    # Existing single-column foreign keys guarantee that a referenced record
    # exists, but do not guarantee that it belongs to the row's tenant. Keep
    # those FKs and add one reusable guard for every Alert-domain reference.
    op.execute(
        """
        CREATE FUNCTION public.enforce_outage_alert_reference_tenant()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            payload jsonb := to_jsonb(NEW);
            ref_id uuid;
            ref_key text;
        BEGIN
            FOREACH ref_key IN ARRAY ARRAY['user_id','created_by_id','updated_by_id','published_by_id']
            LOOP
                ref_id := NULLIF(payload ->> ref_key, '')::uuid;
                IF ref_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM public.users
                    WHERE id = ref_id AND tenant_id = NEW.tenant_id
                ) THEN
                    RAISE EXCEPTION 'outage alert user reference must belong to the same tenant'
                        USING ERRCODE = '23503';
                END IF;
            END LOOP;

            ref_id := NULLIF(payload ->> 'service_id', '')::uuid;
            IF ref_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.itsm_services
                WHERE id = ref_id AND tenant_id = NEW.tenant_id
            ) THEN
                RAISE EXCEPTION 'outage alert service reference must belong to the same tenant'
                    USING ERRCODE = '23503';
            END IF;

            ref_id := NULLIF(payload ->> 'team_id', '')::uuid;
            IF ref_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.itsm_teams
                WHERE id = ref_id AND tenant_id = NEW.tenant_id
            ) THEN
                RAISE EXCEPTION 'outage alert team reference must belong to the same tenant'
                    USING ERRCODE = '23503';
            END IF;

            ref_id := NULLIF(payload ->> 'ci_id', '')::uuid;
            IF ref_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.itsm_configuration_items
                WHERE id = ref_id AND tenant_id = NEW.tenant_id
            ) THEN
                RAISE EXCEPTION 'outage alert CI reference must belong to the same tenant'
                    USING ERRCODE = '23503';
            END IF;

            ref_id := NULLIF(payload ->> 'notification_id', '')::uuid;
            IF ref_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.notifications
                WHERE id = ref_id AND tenant_id = NEW.tenant_id
            ) THEN
                RAISE EXCEPTION 'outage alert notification must belong to the same tenant'
                    USING ERRCODE = '23503';
            END IF;

            IF TG_TABLE_NAME = 'itsm_outage_alert_links' THEN
                ref_id := NULLIF(payload ->> 'target_id', '')::uuid;
                IF (payload ->> 'target_type') IN ('INCIDENT','PROBLEM')
                   AND NOT EXISTS (
                       SELECT 1 FROM public.itsm_tickets
                       WHERE id = ref_id AND tenant_id = NEW.tenant_id
                         AND ticket_type = payload ->> 'target_type'
                   ) THEN
                    RAISE EXCEPTION 'linked ticket must belong to the same tenant'
                        USING ERRCODE = '23503';
                ELSIF payload ->> 'target_type' = 'MAJOR_INCIDENT'
                   AND NOT EXISTS (
                       SELECT 1 FROM public.itsm_major_incidents
                       WHERE id = ref_id AND tenant_id = NEW.tenant_id
                   ) THEN
                    RAISE EXCEPTION 'linked major incident must belong to the same tenant'
                        USING ERRCODE = '23503';
                ELSIF payload ->> 'target_type' = 'CHANGE'
                   AND NOT EXISTS (
                       SELECT 1 FROM public.itsm_change_requests
                       WHERE id = ref_id AND tenant_id = NEW.tenant_id
                   ) THEN
                    RAISE EXCEPTION 'linked change must belong to the same tenant'
                        USING ERRCODE = '23503';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    for table_name in REFERENCE_TABLES:
        op.execute(
            f"CREATE TRIGGER trg_{table_name}_reference_tenant "
            f"BEFORE INSERT OR UPDATE ON public.{table_name} "
            "FOR EACH ROW EXECUTE FUNCTION public.enforce_outage_alert_reference_tenant()"
        )


def downgrade() -> None:
    # A downgrade cannot preserve the meaning of the new targeting rows or
    # multi-audience delivery evidence. Refuse instead of silently widening,
    # deleting, or corrupting immutable history.
    op.execute("ALTER TABLE public.itsm_outage_alert_audiences NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_outage_alert_recipients NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM public.itsm_outage_alert_audiences
                WHERE audience_type IN ('PROBLEM_MANAGERS','CHANGE_MANAGERS','SPECIFIC_USER')
            ) OR EXISTS (
                SELECT 1 FROM public.itsm_outage_alert_recipients
                WHERE audience_memberships <> '[]'::jsonb
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade outage-alert audience support while new audience evidence exists';
            END IF;
        END
        $$;
        """
    )
    for table_name in reversed(REFERENCE_TABLES):
        op.execute(
            f"DROP TRIGGER IF EXISTS trg_{table_name}_reference_tenant "
            f"ON public.{table_name}"
        )
    op.execute("DROP FUNCTION IF EXISTS public.enforce_outage_alert_reference_tenant()")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.protect_outage_alert_recipient_snapshot()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'outage alert recipient evidence cannot be deleted' USING ERRCODE = '55000';
            END IF;
            IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
               OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.audience_type IS DISTINCT FROM OLD.audience_type
               OR NEW.projection_type IS DISTINCT FROM OLD.projection_type
               OR NEW.inclusion_reason IS DISTINCT FROM OLD.inclusion_reason
               OR NEW.allowed_actions IS DISTINCT FROM OLD.allowed_actions
               OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'outage alert recipient snapshot is immutable' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    op.drop_column("itsm_outage_alert_recipients", "audience_memberships")
    op.drop_constraint(
        "ck_outage_alert_audience_scope_shape",
        "itsm_outage_alert_audiences",
        type_="check",
    )
    op.drop_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        type_="check",
    )
    op.create_check_constraint(
        "ck_outage_alert_audience_type",
        "itsm_outage_alert_audiences",
        "audience_type IN ('SERVICE_USERS','SERVICE_AGENTS','SELECTED_TEAM','SERVICE_OWNERS')",
    )
    op.drop_index(
        "idx_itsm_outage_alert_audience_user",
        table_name="itsm_outage_alert_audiences",
    )
    op.drop_constraint(
        "fk_outage_alert_audience_user",
        "itsm_outage_alert_audiences",
        type_="foreignkey",
    )
    op.drop_column("itsm_outage_alert_audiences", "user_id")
    op.execute("ALTER TABLE public.itsm_outage_alert_audiences FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_outage_alert_recipients FORCE ROW LEVEL SECURITY")
