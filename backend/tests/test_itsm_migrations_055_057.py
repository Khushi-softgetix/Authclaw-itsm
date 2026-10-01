"""Regression coverage for ITSM migration adoption on drifted databases."""

import importlib.util
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import MagicMock, patch


VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def load_migration(revision: str):
    path = next(VERSIONS.glob(f"{revision}_*.py"))
    spec = importlib.util.spec_from_file_location(f"migration_{revision}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Inspector:
    def __init__(self, *, columns=None, indexes=None, tables=None):
        self.columns = columns or {}
        self.indexes = indexes or {}
        self.tables = tables or set()

    def get_columns(self, table_name, schema=None):
        return [{"name": name} for name in self.columns.get(table_name, set())]

    def get_indexes(self, table_name, schema=None):
        return [{"name": name} for name in self.indexes.get(table_name, set())]

    def has_table(self, table_name, schema=None):
        return table_name in self.tables


class ItsmMigrationDriftTests(TestCase):
    def test_055_adopts_or_creates_command_communications(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                migration = load_migration("055")
                operations = MagicMock()
                operations.get_bind.return_value = object()
                inspector = Inspector(columns={"itsm_major_incidents": {"command_communications"} if existing else set()})
                with patch.object(migration, "op", operations), patch.object(migration.sa, "inspect", return_value=inspector):
                    migration.upgrade()
                self.assertEqual(operations.add_column.call_count, 0 if existing else 1)

    def test_056_repairs_only_missing_incident_ci_schema(self):
        migration = load_migration("056")
        operations = MagicMock()
        operations.get_bind.return_value = object()
        inspector = Inspector(
            columns={
                "itsm_tickets": set(),
                "itsm_major_incidents": {"affected_service_ids", "affected_configuration_item_ids"},
            },
            indexes={"itsm_tickets": set()},
        )
        with patch.object(migration, "op", operations), patch.object(migration.sa, "inspect", return_value=inspector):
            migration.upgrade()

        self.assertEqual([call.args[1].name for call in operations.add_column.call_args_list], ["configuration_item_id"])
        operations.create_index.assert_called_once_with(
            "idx_itsm_tickets_tenant_ci",
            "itsm_tickets",
            ["tenant_id", "configuration_item_id"],
        )

    def test_057_adopts_saved_views_and_reapplies_security(self):
        migration = load_migration("057")
        operations = MagicMock()
        operations.get_bind.return_value = object()
        inspector = Inspector(tables={"itsm_incident_saved_views"})
        with patch.object(migration, "op", operations), patch.object(migration.sa, "inspect", return_value=inspector):
            migration.upgrade()

        operations.create_table.assert_not_called()
        statements = "\n".join(call.args[0] for call in operations.execute.call_args_list)
        self.assertIn("CREATE INDEX IF NOT EXISTS idx_itsm_saved_views_user", statements)
        self.assertIn("ENABLE ROW LEVEL SECURITY", statements)
        self.assertIn("CREATE POLICY tenant_isolation", statements)
        self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE", statements)


if __name__ == "__main__":
    main()
