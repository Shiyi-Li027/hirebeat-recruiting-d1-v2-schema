#!/usr/bin/env python3
"""Validate the generated D1 migration locally using Python's SQLite engine."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations/0001_initial_schema.sql"
CONFIG = ROOT / "wrangler.toml"
EXPECTED_TABLE_COUNT = 82
EXPECTED_INDEX_COUNT = 116


def validate(check_config: bool) -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql)
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
        f"{table_count} tables, {index_count} explicit indexes, 0 FK violations."
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
