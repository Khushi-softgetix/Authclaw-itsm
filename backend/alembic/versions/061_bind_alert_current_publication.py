"""Bind an Alert's current-publication pointer to that same Alert.

Revision ID: 061
Revises: 060
"""

from alembic import op


revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Do not silently bless pre-existing pointer corruption. A valid pointer
    # must identify a publication created for this exact Alert.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM public.itsm_outage_alerts AS alert
                JOIN public.itsm_outage_alert_publications AS publication
                  ON publication.id = alert.current_publication_id
                WHERE publication.tenant_id <> alert.tenant_id
                   OR publication.alert_id <> alert.id
            ) THEN
                RAISE EXCEPTION
                    'cannot bind outage alert current publications while invalid pointers exist';
            END IF;
        END
        $$;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.enforce_outage_alert_current_publication_tenant()
        RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.current_publication_id IS NOT NULL
               AND NOT EXISTS (
                    SELECT 1
                    FROM public.itsm_outage_alert_publications AS publication
                    WHERE publication.id = NEW.current_publication_id
                      AND publication.tenant_id = NEW.tenant_id
                      AND publication.alert_id = NEW.id
               ) THEN
                RAISE EXCEPTION
                    'outage alert current publication must belong to the same alert and tenant'
                    USING ERRCODE = '23503';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.enforce_outage_alert_current_publication_tenant()
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
        """
    )
