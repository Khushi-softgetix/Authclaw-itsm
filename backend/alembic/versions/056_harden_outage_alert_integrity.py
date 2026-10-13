"""Harden Outage & Alerts tenant integrity and remove unsupported expiry.

Revision ID: 056
Revises: 055
"""

from alembic import op
import sqlalchemy as sa


revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


ALERT_CHILDREN = (
    "itsm_outage_alert_services",
    "itsm_outage_alert_cis",
    "itsm_outage_alert_links",
    "itsm_outage_alert_audiences",
    "itsm_outage_alert_publications",
)


def upgrade() -> None:
    # Expiry was exposed in the form and schema without any authoritative
    # transition, worker, publication, or notification behavior. Refuse to
    # reinterpret historical data silently if an environment ever used it.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM public.itsm_outage_alerts WHERE status = 'EXPIRED'
            ) OR EXISTS (
                SELECT 1 FROM public.itsm_outage_alert_publications
                WHERE publication_type = 'EXPIRY'
            ) THEN
                RAISE EXCEPTION
                    'cannot remove unsupported outage-alert expiry while expiry records exist';
            END IF;
        END
        $$;
        """
    )
    op.drop_constraint("ck_outage_alert_status", "itsm_outage_alerts", type_="check")
    op.create_check_constraint(
        "ck_outage_alert_status",
        "itsm_outage_alerts",
        "status IN ('DRAFT','ACTIVE','RECOVERED','CANCELLED')",
    )
    op.drop_constraint(
        "ck_outage_alert_publication_type",
        "itsm_outage_alert_publications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_outage_alert_publication_type",
        "itsm_outage_alert_publications",
        "publication_type IN ('INITIAL','UPDATE','RECOVERY')",
    )
    op.drop_column("itsm_outage_alerts", "expires_at")

    # Parent ids are globally unique already, but PostgreSQL requires an
    # explicit composite key before tenant-bound foreign keys can reference
    # (tenant_id, id). These constraints make tenant ownership structural,
    # rather than relying solely on application filters and RLS.
    op.create_unique_constraint(
        "uq_itsm_outage_alert_tenant_id",
        "itsm_outage_alerts",
        ["tenant_id", "id"],
    )
    op.create_unique_constraint(
        "uq_itsm_outage_alert_publication_tenant_id",
        "itsm_outage_alert_publications",
        ["tenant_id", "id"],
    )
    for table_name in ALERT_CHILDREN:
        op.create_foreign_key(
            f"fk_{table_name}_tenant_alert",
            table_name,
            "itsm_outage_alerts",
            ["tenant_id", "alert_id"],
            ["tenant_id", "id"],
            ondelete="CASCADE",
        )
    op.create_foreign_key(
        "fk_outage_alert_recipient_tenant_publication",
        "itsm_outage_alert_recipients",
        "itsm_outage_alert_publications",
        ["tenant_id", "publication_id"],
        ["tenant_id", "id"],
        ondelete="CASCADE",
    )

    # The Alert -> current publication relationship is cyclic. A trigger
    # enforces tenant equality without an ON DELETE action that could attempt
    # to null the non-null tenant_id column. Publication deletion is already
    # prohibited by the immutable-evidence trigger from revision 054.
    op.execute(
        """
        CREATE FUNCTION public.enforce_outage_alert_current_publication_tenant()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.current_publication_id IS NOT NULL
               AND NOT EXISTS (
                    SELECT 1
                    FROM public.itsm_outage_alert_publications AS publication
                    WHERE publication.id = NEW.current_publication_id
                      AND publication.tenant_id = NEW.tenant_id
               ) THEN
                RAISE EXCEPTION
                    'outage alert current publication must belong to the same tenant'
                    USING ERRCODE = '23503';
            END IF;
            RETURN NEW;
        END;
        $$;

        CREATE TRIGGER trg_enforce_outage_alert_current_publication_tenant
        BEFORE INSERT OR UPDATE OF tenant_id, current_publication_id
        ON public.itsm_outage_alerts
        FOR EACH ROW
        EXECUTE FUNCTION public.enforce_outage_alert_current_publication_tenant();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_enforce_outage_alert_current_publication_tenant "
        "ON public.itsm_outage_alerts"
    )
    op.execute(
        "DROP FUNCTION IF EXISTS public.enforce_outage_alert_current_publication_tenant()"
    )
    op.drop_constraint(
        "fk_outage_alert_recipient_tenant_publication",
        "itsm_outage_alert_recipients",
        type_="foreignkey",
    )
    for table_name in reversed(ALERT_CHILDREN):
        op.drop_constraint(
            f"fk_{table_name}_tenant_alert",
            table_name,
            type_="foreignkey",
        )
    op.drop_constraint(
        "uq_itsm_outage_alert_publication_tenant_id",
        "itsm_outage_alert_publications",
        type_="unique",
    )
    op.drop_constraint(
        "uq_itsm_outage_alert_tenant_id",
        "itsm_outage_alerts",
        type_="unique",
    )

    op.add_column(
        "itsm_outage_alerts",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_constraint("ck_outage_alert_status", "itsm_outage_alerts", type_="check")
    op.create_check_constraint(
        "ck_outage_alert_status",
        "itsm_outage_alerts",
        "status IN ('DRAFT','ACTIVE','RECOVERED','EXPIRED','CANCELLED')",
    )
    op.drop_constraint(
        "ck_outage_alert_publication_type",
        "itsm_outage_alert_publications",
        type_="check",
    )
    op.create_check_constraint(
        "ck_outage_alert_publication_type",
        "itsm_outage_alert_publications",
        "publication_type IN ('INITIAL','UPDATE','RECOVERY','EXPIRY')",
    )
