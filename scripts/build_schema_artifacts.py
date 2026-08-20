#!/usr/bin/env python3
"""Validate the canonical HireBeat D1 schema and build derived artifacts."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


CREATE_OUTPUT = ROOT / "schema/HIREBEAT_D1_CREATE_2026-08-17.sql"
DELETE_OUTPUT = ROOT / "schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql"
BASELINE_MIGRATION = ROOT / "migrations/0001_initial_schema.sql"
BASELINE_MIGRATION_SHA256 = (
    "63364e24b932fbe8e4a11314cb0afd76f3c46d5aa216af6c717deb3276f0a0f4"
)

EXPECTED_TABLE_COUNT = 84
EXPECTED_INDEX_COUNT = 120


def load_create_sql() -> str:
    """Read the checked-in complete current schema as the canonical source."""
    if not CREATE_OUTPUT.is_file():
        raise FileNotFoundError(
            f"Missing canonical schema: {CREATE_OUTPUT.relative_to(ROOT)}"
        )
    return CREATE_OUTPUT.read_text(encoding="utf-8")


def inspect_schema(create_sql: str) -> tuple[list[str], int]:
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(create_sql)
        table_names = [
            row[0]
            for row in connection.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY rowid
                """
            )
        ]
        index_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM sqlite_master
            WHERE type = 'index'
              AND sql IS NOT NULL
            """
        ).fetchone()[0]
        violations = list(connection.execute("PRAGMA foreign_key_check"))
        if violations:
            raise RuntimeError(f"Foreign-key violations: {violations[:20]}")
        return table_names, index_count
    finally:
        connection.close()


def build_delete_sql(table_names: list[str]) -> str:
    lines = [
        "-- HireBeat D1 destructive application-table cleanup script",
        "-- Generated: 2026-08-17",
        "-- WARNING: permanently drops all 84 HireBeat application tables and their data.",
        "-- This intentionally does NOT drop Cloudflare/SQLite internal tables or d1_migrations.",
        "-- Never add this file to migrations/ or an automatic GitHub Actions workflow.",
        "-- Prefer deleting/recreating a disposable D1 database for a completely clean reset.",
        "",
        "PRAGMA defer_foreign_keys = on;",
        "",
    ]
    for table_name in reversed(table_names):
        escaped_name = table_name.replace('"', '""')
        lines.append(f'DROP TABLE IF EXISTS "{escaped_name}";')
    lines.extend(["", "PRAGMA defer_foreign_keys = off;", ""])
    return "\n".join(lines)


def main() -> None:
    if not BASELINE_MIGRATION.is_file():
        raise FileNotFoundError(
            f"Missing immutable baseline migration: {BASELINE_MIGRATION}"
        )
    baseline_hash = hashlib.sha256(BASELINE_MIGRATION.read_bytes()).hexdigest()
    if baseline_hash != BASELINE_MIGRATION_SHA256:
        raise RuntimeError(
            "migrations/0001_initial_schema.sql is an immutable deployed "
            "baseline and must not be modified. Create a new migration instead."
        )

    create_sql = load_create_sql()
    table_names, index_count = inspect_schema(create_sql)

    if len(table_names) != EXPECTED_TABLE_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_TABLE_COUNT} tables, found {len(table_names)}"
        )
    if index_count != EXPECTED_INDEX_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_INDEX_COUNT} explicit indexes, found {index_count}"
        )

    DELETE_OUTPUT.write_text(build_delete_sql(table_names), encoding="utf-8")

    print(f"Validated canonical schema: {CREATE_OUTPUT.relative_to(ROOT)}")
    print(
        "Preserved immutable baseline: "
        f"{BASELINE_MIGRATION.relative_to(ROOT)} ({baseline_hash})"
    )
    print(f"Generated: {DELETE_OUTPUT.relative_to(ROOT)}")
    print(f"Validated tables: {len(table_names)}")
    print(f"Validated explicit indexes: {index_count}")


if __name__ == "__main__":
    main()
