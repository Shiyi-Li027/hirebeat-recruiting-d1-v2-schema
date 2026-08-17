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
EXPECTED_TABLE_COUNT = 82
EXPECTED_INDEX_COUNT = 117


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
