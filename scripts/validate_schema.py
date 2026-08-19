#!/usr/bin/env python3
"""Validate the generated D1 migration locally using Python's SQLite engine."""

from __future__ import annotations

import argparse
import csv
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
STATUS_POLICY = ROOT / "schema/status_field_policy.csv"
EXPECTED_TABLE_COUNT = 84
EXPECTED_INDEX_COUNT = 120
ALLOWED_TRIGGER_NAMES = {
    "trg_offer_sent_requires_future_response_due_insert",
    "trg_offer_sent_requires_future_response_due_update",
    "trg_position_active_requires_jd_insert",
    "trg_position_active_requires_jd_update",
}
ALLOWED_STATUS_STRATEGIES = {
    "default_active",
    "schema_default",
    "conditional_importer_default",
    "explicit_required",
    "nullable_transition_origin",
}
EXPECTED_SYSTEM_CONFIGURATION = {
    ("ml_inference", "request_timeout_ms"): "30000",
    ("offer", "default_response_window_days"): "7",
    ("outbox", "max_delivery_attempts"): "8",
    ("submission_ingress", "active_stale_seconds"): "300",
    ("submission_ingress", "max_attempts"): "5",
    ("submission_ingress", "max_resume_file_size_bytes"): "10485760",
    ("submission_ingress", "parser_timeout_ms"): "30000",
    ("workflow", "default_step_max_attempts"): "5",
}


def normalize_default(value: str | None) -> str:
    """Normalize SQLite PRAGMA defaults for comparison with the policy CSV."""
    if value is None:
        return ""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def load_status_policy() -> dict[tuple[str, str], dict[str, str]]:
    if not STATUS_POLICY.is_file():
        raise SystemExit(
            "Schema validation failed: schema/status_field_policy.csv is missing."
        )
    with STATUS_POLICY.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    policies: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        key = (row["table_name"], row["column_name"])
        if key in policies:
            raise SystemExit(
                f"Schema validation failed: duplicate status policy for {key}."
            )
        if row["strategy"] not in ALLOWED_STATUS_STRATEGIES:
            raise SystemExit(
                "Schema validation failed: unsupported status strategy "
                f"{row['strategy']!r} for {key}."
            )
        if not row["policy_description"].strip():
            raise SystemExit(
                f"Schema validation failed: status policy {key} has no description."
            )
        policies[key] = row
    return policies


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

        # Catalog publication order is significant. A -> B -> A must be able
        # to store the returning A as a new revision even though its integrity
        # hash matches a historical row.
        connection.execute("SAVEPOINT validate_catalog_republication")
        try:
            repeated_hash = "a" * 64
            connection.execute(
                """
                INSERT INTO catalog_revision (
                  catalog_revision_uuid, revision_number,
                  catalog_snapshot_json, snapshot_sha256, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                ("validator-catalog-a1", 900001, "{}", repeated_hash, "2026-08-19T00:00:00Z"),
            )
            connection.execute(
                """
                INSERT INTO catalog_revision (
                  catalog_revision_uuid, revision_number,
                  catalog_snapshot_json, snapshot_sha256, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                ("validator-catalog-a2", 900002, "{}", repeated_hash, "2026-08-19T00:00:01Z"),
            )
        except sqlite3.IntegrityError as error:
            raise SystemExit(
                "Schema validation failed: catalog_revision must allow a "
                "historical snapshot hash to be republished after an "
                "intervening revision."
            ) from error
        finally:
            connection.execute("ROLLBACK TO validate_catalog_republication")
            connection.execute("RELEASE validate_catalog_republication")

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
        actual_status_columns: dict[tuple[str, str], tuple[int, str]] = {}
        table_names = [
            row[0]
            for row in connection.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                """
            )
        ]
        for table_name in table_names:
            escaped_table = table_name.replace('"', '""')
            for column in connection.execute(
                f'PRAGMA table_info("{escaped_table}")'
            ):
                column_name = column[1]
                if (
                    column_name == "is_active"
                    or column_name == "status"
                    or column_name.endswith("_status")
                ):
                    actual_status_columns[(table_name, column_name)] = (
                        column[3],
                        normalize_default(column[4]),
                    )
        trigger_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger'"
            )
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
    if active_releases != [("hirebeat-system-configuration-v2", 2)]:
        raise SystemExit(
            "Schema validation failed: expected exactly one active current "
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

    policies = load_status_policy()
    actual_keys = set(actual_status_columns)
    policy_keys = set(policies)
    missing_policies = sorted(actual_keys - policy_keys)
    stale_policies = sorted(policy_keys - actual_keys)
    if missing_policies or stale_policies:
        raise SystemExit(
            "Schema validation failed: every *_status/is_active field must have "
            "exactly one explicit policy. "
            f"Missing={missing_policies}; stale={stale_policies}."
        )
    for key, row in policies.items():
        actual_not_null, actual_default = actual_status_columns[key]
        if actual_not_null != int(row["expected_not_null"]):
            raise SystemExit(
                f"Schema validation failed: {key} NOT NULL differs from policy."
            )
        if actual_default != row["expected_default"]:
            raise SystemExit(
                f"Schema validation failed: {key} default {actual_default!r} "
                f"differs from policy {row['expected_default']!r}."
            )
        if row["strategy"] == "default_active" and (
            actual_not_null != 1 or actual_default != "1"
        ):
            raise SystemExit(
                f"Schema validation failed: {key} must remain NOT NULL DEFAULT 1."
            )
        if row["strategy"] == "explicit_required" and (
            actual_not_null != 1 or actual_default
        ):
            raise SystemExit(
                f"Schema validation failed: {key} must remain required without "
                "a guessed schema default."
            )

    unexpected_triggers = sorted(trigger_names - ALLOWED_TRIGGER_NAMES)
    missing_triggers = sorted(ALLOWED_TRIGGER_NAMES - trigger_names)
    if unexpected_triggers or missing_triggers:
        raise SystemExit(
            "Schema validation failed: triggers are restricted to reviewed "
            "cross-column invariants. "
            f"Unexpected={unexpected_triggers}; missing={missing_triggers}."
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
        f"{index_count} explicit indexes, {len(policies)} status policies, "
        f"{len(trigger_names)} reviewed cross-column triggers, 0 FK violations."
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
