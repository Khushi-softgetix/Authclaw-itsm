"""Force RLS for ITSM user access records.

Revision ID: 049
Revises: 048
"""

from alembic import op


revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply the required owner-bypass protection to existing installations."""
    op.execute("ALTER TABLE public.itsm_user_access FORCE ROW LEVEL SECURITY;")


def downgrade() -> None:
    op.execute("ALTER TABLE public.itsm_user_access NO FORCE ROW LEVEL SECURITY;")
