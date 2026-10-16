"""Add Known Error governance and workaround lifecycle to itsm_problem_details.

Revision ID: 053
Revises: 052
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None

_TABLE = "itsm_problem_details"
_CK_NAME = "ck_itsm_problem_workaround_status"
_IDX_STATUS = "idx_itsm_problem_ke_status"
_IDX_EXPIRY = "idx_itsm_problem_workaround_expiry"


def upgrade() -> None:
    # 1. Add new governance columns
    op.add_column(
        _TABLE,
        sa.Column(
            "workaround_status",
            sa.String(32),
            nullable=False,
            server_default="DRAFT",
        ),
    )
    op.add_column(
        _TABLE,
        sa.Column("workaround_approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        _TABLE,
        sa.Column(
            "workaround_approved_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        _TABLE,
        sa.Column("workaround_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        _TABLE,
        sa.Column("review_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        _TABLE,
        sa.Column("symptoms", sa.Text(), nullable=True),
    )

    # 2. Add check constraint for allowed workaround statuses
    op.create_check_constraint(
        _CK_NAME,
        _TABLE,
        "workaround_status IN ('DRAFT', 'APPROVED', 'RETIRED')",
    )

    # 3. Safe backfill for existing rows: ensure all legacy rows are explicitly DRAFT
    op.execute(
        f"UPDATE public.{_TABLE} SET workaround_status = 'DRAFT' WHERE workaround_status IS NULL;"
    )

    # 4. Create optimized indexes for Known Error triage lookups
    op.create_index(
        _IDX_STATUS,
        _TABLE,
        ["tenant_id", "known_error", "workaround_status"],
    )
    op.create_index(
        _IDX_EXPIRY,
        _TABLE,
        ["tenant_id", "workaround_expires_at"],
    )


def downgrade() -> None:
    op.drop_index(_IDX_EXPIRY, table_name=_TABLE)
    op.drop_index(_IDX_STATUS, table_name=_TABLE)
    op.drop_constraint(_CK_NAME, _TABLE, type_="check")
    op.drop_column(_TABLE, "symptoms")
    op.drop_column(_TABLE, "review_due_at")
    op.drop_column(_TABLE, "workaround_expires_at")
    op.drop_column(_TABLE, "workaround_approved_by_id")
    op.drop_column(_TABLE, "workaround_approved_at")
    op.drop_column(_TABLE, "workaround_status")
