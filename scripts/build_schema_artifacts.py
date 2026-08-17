#!/usr/bin/env python3
"""Build the deployable HireBeat D1 schema artifacts from confirmed group SQL."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

MODULES = [
    Path("shared_reference/001_shared_reference_schema.sql"),
    Path("catalog/002_recruitment_catalog_draft.sql"),
    Path("submission_ingress/003_submission_ingress_draft.sql"),
    Path("workflow_control/004_workflow_control_draft.sql"),
    Path("submission_processing/005_submission_processing_draft.sql"),
    Path("dedup_admission/006_dedup_admission_draft.sql"),
    Path("application_core/007_application_core_draft.sql"),
    Path("candidate_profile/008_candidate_profile_draft.sql"),
    Path("machine_learning/009_machine_learning_draft.sql"),
    Path("hiring_pipeline/010_hiring_pipeline_draft.sql"),
    Path("offer/011_offer_lifecycle_draft.sql"),
]

CREATE_OUTPUT = ROOT / "schema/HIREBEAT_D1_CREATE_2026-08-17.sql"
DELETE_OUTPUT = ROOT / "schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql"
BASELINE_MIGRATION = ROOT / "migrations/0001_initial_schema.sql"
BASELINE_MIGRATION_SHA256 = (
    "63364e24b932fbe8e4a11314cb0afd76f3c46d5aa216af6c717deb3276f0a0f4"
)

EXPECTED_TABLE_COUNT = 82
EXPECTED_INDEX_COUNT = 117


def strip_module_pragma(sql: str) -> str:
    """Remove per-module FK pragma; D1 enforces FKs and needs deferred checks here."""
    return re.sub(
        r"(?im)^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*\n?",
        "",
        sql,
    ).strip()


def build_create_sql() -> str:
    sections = [
        "-- HireBeat D1 complete current schema",
        "-- Generated: 2026-08-17",
        "-- Source: 11 confirmed G01-G11 schema modules",
        "-- Contains schema only: 82 application tables and 117 explicit indexes.",
        "-- Seed/reference rows must be deployed in later migrations.",
        "-- Do not add BEGIN/COMMIT; D1 executes migrations transactionally.",
        "",
        "PRAGMA defer_foreign_keys = on;",
    ]

    for module in MODULES:
        module_path = ROOT / module
        if not module_path.is_file():
            raise FileNotFoundError(f"Missing schema module: {module_path}")
        sections.extend(
            [
                "",
                "-- ============================================================",
                f"-- BEGIN SOURCE MODULE: {module.as_posix()}",
                "-- ============================================================",
                strip_module_pragma(module_path.read_text(encoding="utf-8")),
                f"-- END SOURCE MODULE: {module.as_posix()}",
            ]
        )

    sections.extend(
        [
            "",
            "PRAGMA defer_foreign_keys = off;",
            "PRAGMA optimize;",
            "",
        ]
    )
    return "\n".join(sections)


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
        "-- WARNING: permanently drops all 82 HireBeat application tables and their data.",
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

    create_sql = build_create_sql()
    table_names, index_count = inspect_schema(create_sql)

    if len(table_names) != EXPECTED_TABLE_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_TABLE_COUNT} tables, found {len(table_names)}"
        )
    if index_count != EXPECTED_INDEX_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_INDEX_COUNT} explicit indexes, found {index_count}"
        )

    CREATE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    create_bytes = create_sql.encode("utf-8")
    CREATE_OUTPUT.write_bytes(create_bytes)
    DELETE_OUTPUT.write_text(build_delete_sql(table_names), encoding="utf-8")

    print(f"Generated: {CREATE_OUTPUT.relative_to(ROOT)}")
    print(
        "Preserved immutable baseline: "
        f"{BASELINE_MIGRATION.relative_to(ROOT)} ({baseline_hash})"
    )
    print(f"Generated: {DELETE_OUTPUT.relative_to(ROOT)}")
    print(f"Validated tables: {len(table_names)}")
    print(f"Validated explicit indexes: {index_count}")


if __name__ == "__main__":
    main()
