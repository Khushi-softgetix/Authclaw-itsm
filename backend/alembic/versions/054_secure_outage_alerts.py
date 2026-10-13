"""Secure Outage & Alerts permissions and immutable evidence.

Revision ID: 054
Revises: 053
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


PERMISSIONS = (
    "OUTAGE_ALERT:READ",
    "OUTAGE_ALERT:CREATE",
    "OUTAGE_ALERT:EDIT",
    "OUTAGE_ALERT:PREVIEW",
    "OUTAGE_ALERT:PUBLISH",
    "OUTAGE_ALERT:UPDATE",
    "OUTAGE_ALERT:RECOVER",
    "OUTAGE_ALERT:CANCEL",
    "OUTAGE_ALERT:LINK",
)


def upgrade() -> None:
    op.create_table(
        "itsm_outage_alert_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission", sa.String(64), nullable=False),
        sa.Column("service_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("itsm_services.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "permission IN (" + ",".join(f"'{item}'" for item in PERMISSIONS) + ")",
            name="ck_itsm_outage_alert_grant_permission",
        ),
    )
    op.create_index(
        "idx_itsm_outage_alert_grant_lookup",
        "itsm_outage_alert_grants",
        ["tenant_id", "user_id", "permission", "service_id"],
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_itsm_outage_alert_grant "
        "ON public.itsm_outage_alert_grants "
        "(tenant_id,user_id,permission,COALESCE(service_id,'00000000-0000-0000-0000-000000000000'::uuid))"
    )
    # Preserve existing Incident Manager operations with explicit tenant-wide
    # grants. Other roles, including Platform Administrator, receive no grant.
    # The migrator owns itsm_user_access; temporarily removing FORCE lets that
    # owner perform this one transactional backfill without a tenant session.
    op.execute("ALTER TABLE public.itsm_user_access NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        INSERT INTO public.itsm_outage_alert_grants (tenant_id, user_id, permission)
        SELECT access.tenant_id, access.user_id, permission
        FROM public.itsm_user_access AS access
        CROSS JOIN unnest(ARRAY[
            'OUTAGE_ALERT:READ','OUTAGE_ALERT:CREATE','OUTAGE_ALERT:EDIT',
            'OUTAGE_ALERT:PREVIEW','OUTAGE_ALERT:PUBLISH','OUTAGE_ALERT:UPDATE',
            'OUTAGE_ALERT:RECOVER','OUTAGE_ALERT:CANCEL','OUTAGE_ALERT:LINK'
        ]) AS permission
        WHERE access.has_itsm_access = true AND access.itsm_role = 'INCIDENT_MANAGER'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute("ALTER TABLE public.itsm_user_access FORCE ROW LEVEL SECURITY")

    op.execute("ALTER TABLE public.itsm_outage_alert_grants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.itsm_outage_alert_grants FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON public.itsm_outage_alert_grants FOR ALL "
        "USING (tenant_id = authn.current_tenant_id()) "
        "WITH CHECK (tenant_id = authn.current_tenant_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON public.itsm_outage_alert_grants TO authclaw_app")
    op.execute("GRANT SELECT ON public.itsm_outage_alert_grants TO authclaw_agent_runtime")

    # Role provisioning remains centralized in itsm_user_access. The trigger
    # materializes explicit grants for new Incident Managers and revokes them
    # immediately when ITSM access or the role is removed.
    op.execute(
        """
        CREATE FUNCTION public.sync_incident_manager_outage_alert_grants() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.has_itsm_access = true AND NEW.itsm_role = 'INCIDENT_MANAGER' THEN
                IF TG_OP = 'INSERT' THEN
                    INSERT INTO public.itsm_outage_alert_grants (tenant_id, user_id, permission)
                    SELECT NEW.tenant_id, NEW.user_id, permission
                    FROM unnest(ARRAY[
                        'OUTAGE_ALERT:READ','OUTAGE_ALERT:CREATE','OUTAGE_ALERT:EDIT',
                        'OUTAGE_ALERT:PREVIEW','OUTAGE_ALERT:PUBLISH','OUTAGE_ALERT:UPDATE',
                        'OUTAGE_ALERT:RECOVER','OUTAGE_ALERT:CANCEL','OUTAGE_ALERT:LINK'
                    ]) AS permission
                    ON CONFLICT DO NOTHING;
                ELSIF OLD.itsm_role IS DISTINCT FROM NEW.itsm_role
                   OR OLD.has_itsm_access IS DISTINCT FROM NEW.has_itsm_access THEN
                    INSERT INTO public.itsm_outage_alert_grants (tenant_id, user_id, permission)
                    SELECT NEW.tenant_id, NEW.user_id, permission
                    FROM unnest(ARRAY[
                        'OUTAGE_ALERT:READ','OUTAGE_ALERT:CREATE','OUTAGE_ALERT:EDIT',
                        'OUTAGE_ALERT:PREVIEW','OUTAGE_ALERT:PUBLISH','OUTAGE_ALERT:UPDATE',
                        'OUTAGE_ALERT:RECOVER','OUTAGE_ALERT:CANCEL','OUTAGE_ALERT:LINK'
                    ]) AS permission
                    ON CONFLICT DO NOTHING;
                END IF;
            ELSE
                DELETE FROM public.itsm_outage_alert_grants
                WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id;
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER trg_sync_incident_manager_outage_alert_grants
        AFTER INSERT OR UPDATE OF itsm_role, has_itsm_access ON public.itsm_user_access
        FOR EACH ROW EXECUTE FUNCTION public.sync_incident_manager_outage_alert_grants();
        """
    )

    op.execute(
        """
        CREATE FUNCTION public.protect_outage_alert_publication() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'outage alert publications are immutable' USING ERRCODE = '55000';
        END;
        $$;
        CREATE TRIGGER trg_protect_outage_alert_publication
        BEFORE UPDATE OR DELETE ON public.itsm_outage_alert_publications
        FOR EACH ROW EXECUTE FUNCTION public.protect_outage_alert_publication();

        CREATE FUNCTION public.protect_outage_alert_recipient_snapshot() RETURNS trigger
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
        CREATE TRIGGER trg_protect_outage_alert_recipient_snapshot
        BEFORE UPDATE OR DELETE ON public.itsm_outage_alert_recipients
        FOR EACH ROW EXECUTE FUNCTION public.protect_outage_alert_recipient_snapshot();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_sync_incident_manager_outage_alert_grants ON public.itsm_user_access")
    op.execute("DROP FUNCTION IF EXISTS public.sync_incident_manager_outage_alert_grants()")
    op.execute("DROP TRIGGER IF EXISTS trg_protect_outage_alert_recipient_snapshot ON public.itsm_outage_alert_recipients")
    op.execute("DROP FUNCTION IF EXISTS public.protect_outage_alert_recipient_snapshot()")
    op.execute("DROP TRIGGER IF EXISTS trg_protect_outage_alert_publication ON public.itsm_outage_alert_publications")
    op.execute("DROP FUNCTION IF EXISTS public.protect_outage_alert_publication()")
    op.drop_index("uq_itsm_outage_alert_grant", table_name="itsm_outage_alert_grants")
    op.drop_index("idx_itsm_outage_alert_grant_lookup", table_name="itsm_outage_alert_grants")
    op.drop_table("itsm_outage_alert_grants")
