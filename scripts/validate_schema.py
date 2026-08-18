#!/usr/bin/env python3
"""Validate the generated D1 migration locally using Python's SQLite engine."""

from __future__ import annotations

import argparse
import hashlib
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
BASELINE_MIGRATION = MIGRATIONS_DIR / "0001_initial_schema.sql"
BASELINE_MIGRATION_SHA256 = (
    "63364e24b932fbe8e4a11314cb0afd76f3c46d5aa216af6c717deb3276f0a0f4"
)
CONFIG = ROOT / "wrangler.toml"
EXPECTED_TABLE_COUNT = 84
EXPECTED_INDEX_COUNT = 120
EXPECTED_SYSTEM_CONFIGURATION = {
    ("ml_inference", "request_timeout_ms"): "30000",
    ("outbox", "max_delivery_attempts"): "8",
    ("submission_ingress", "active_stale_seconds"): "300",
    ("submission_ingress", "max_attempts"): "5",
    ("submission_ingress", "max_resume_file_size_bytes"): "10485760",
    ("submission_ingress", "parser_timeout_ms"): "30000",
    ("workflow", "default_step_max_attempts"): "5",
}


def validate(check_config: bool) -> None:
    migration_paths = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_paths:
        raise SystemExit("Schema validation failed: no migration files found.")
    if migration_paths[0] != BASELINE_MIGRATION:
        raise SystemExit(
            "Schema validation failed: 0001_initial_schema.sql must be the "
            "first migration."
        )
    baseline_hash = hashlib.sha256(BASELINE_MIGRATION.read_bytes()).hexdigest()
    if baseline_hash != BASELINE_MIGRATION_SHA256:
        raise SystemExit(
            "Schema validation failed: deployed baseline migration 0001 was "
            "modified. Restore it and create a later migration instead."
        )

    connection = sqlite3.connect(":memory:")
    try:
        for migration_path in migration_paths:
            connection.executescript(migration_path.read_text(encoding="utf-8"))
        table_count = connection.execute(
            """
            SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            """
        ).fetchone()[0]
        index_count = connection.execute(
            """
            SELECT COUNT(*) FROM sqlite_master
            WHERE type = 'index' AND sql IS NOT NULL
            """
        ).fetchone()[0]
        violations = list(connection.execute("PRAGMA foreign_key_check"))

        active_releases = connection.execute(
            """
            SELECT configuration_release_key, release_version
            FROM system_configuration_release
            WHERE release_status = 'active'
            """
        ).fetchall()
        configuration_items = {
            (scope, key): value
            for scope, key, value in connection.execute(
                """
                SELECT c.configuration_scope,
                       c.configuration_key,
                       c.configuration_value_json
                FROM system_configuration AS c
                JOIN system_configuration_release AS r
                  ON r.id = c.configuration_release_id
                WHERE r.release_status = 'active'
                """
            )
        }
        release_columns = {
            row[1] for row in connection.execute(
                "PRAGMA table_info(system_configuration_release)"
            )
        }
        configuration_columns = {
            row[1] for row in connection.execute(
                "PRAGMA table_info(system_configuration)"
            )
        }
        intake_columns = {
            row[1]: row[3]
            for row in connection.execute(
                "PRAGMA table_info(raw_submission_intake_run)"
            )
        }
        workflow_columns = {
            row[1]: row[3]
            for row in connection.execute("PRAGMA table_info(etl_workflow_run)")
        }
    finally:
        connection.close()

    if table_count != EXPECTED_TABLE_COUNT:
        raise SystemExit(
            f"Schema validation failed: expected {EXPECTED_TABLE_COUNT} tables, "
            f"found {table_count}."
        )
    if index_count != EXPECTED_INDEX_COUNT:
        raise SystemExit(
            f"Schema validation failed: expected {EXPECTED_INDEX_COUNT} indexes, "
            f"found {index_count}."
        )
    if violations:
        raise SystemExit(f"Schema validation failed: FK violations {violations[:20]}")
    if active_releases != [("hirebeat-system-configuration-v1", 1)]:
        raise SystemExit(
            "Schema validation failed: expected exactly one active bootstrap "
            f"configuration release, found {active_releases}."
        )
    if configuration_items != EXPECTED_SYSTEM_CONFIGURATION:
        raise SystemExit(
            "Schema validation failed: active system configuration differs "
            f"from the confirmed bootstrap values: {configuration_items}."
        )
    forbidden_release_columns = {"environment_name"} & release_columns
    forbidden_configuration_columns = {
        "value_type",
        "is_sensitive",
    } & configuration_columns
    if forbidden_release_columns or forbidden_configuration_columns:
        raise SystemExit(
            "Schema validation failed: removed System Configuration columns "
            "were reintroduced."
        )
    if intake_columns.get("configuration_release_id") != 0:
        raise SystemExit(
            "Schema validation failed: raw_submission_intake_run."
            "configuration_release_id must remain nullable for history."
        )
    if workflow_columns.get("configuration_release_id") != 0:
        raise SystemExit(
            "Schema validation failed: etl_workflow_run."
            "configuration_release_id must remain nullable for history."
        )

    if check_config:
        config_text = CONFIG.read_text(encoding="utf-8")
        if "REPLACE_WITH_" in config_text:
            raise SystemExit(
                "wrangler.toml still contains REPLACE_WITH_ placeholders. "
                "Set database_name and database_id before deployment."
            )

    print(
        "Schema validation succeeded: "
        f"{len(migration_paths)} migrations, {table_count} tables, "
        f"{index_count} explicit indexes, 0 FK violations."
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check-config",
        action="store_true",
        help="Also reject placeholder values in wrangler.toml.",
    )
    args = parser.parse_args()
    validate(check_config=args.check_config)


if __name__ == "__main__":
    main()
