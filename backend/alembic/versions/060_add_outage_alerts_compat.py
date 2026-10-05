"""Apply the standalone Outage & Alerts schema after the main-line chain.

This compatibility revision is needed because some local databases were
already stamped through revision 057 by the main branch before this feature
was added to the incident-manager branch.  Fresh databases run the original
055 migration first; the guard makes this revision a no-op in that case.
"""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("itsm_outage_alerts", schema="public"):
        return

    migration_path = Path(__file__).with_name("055_add_outage_alerts.py")
    spec = spec_from_file_location("_outage_alerts_055", migration_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the Outage & Alerts schema migration")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    module.upgrade()


def downgrade() -> None:
    # The original feature migration owns the downgrade implementation.  This
    # compatibility revision intentionally leaves data untouched on downgrade.
    pass
