#!/usr/bin/env python3
"""Generate the review matrix from the fully migrated SQLite schema."""

from __future__ import annotations

import csv
import re
import sqlite3
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
INVENTORY = ROOT / "00_master_table_inventory.csv"
STATUS_POLICY = ROOT / "schema/status_field_policy.csv"
CSV_OUTPUT = ROOT / "schema/HIREBEAT_D1_CONSTRAINT_DEFAULT_MATRIX.csv"
MD_OUTPUT = ROOT / "schema/HIREBEAT_D1_CONSTRAINT_DEFAULT_MATRIX.md"
SQL_TEMPLATE_OUTPUT = ROOT / "schema/HIREBEAT_D1_MANUAL_INSERT_TEMPLATES.sql"


def normalize_default(value: str | None) -> str:
    if value is None:
        return ""
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def load_group_map() -> dict[str, tuple[int, str, str]]:
    result: dict[str, tuple[int, str, str]] = {}
    with INVENTORY.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["design_status"] == "confirmed":
                result[row["table_name"]] = (
                    int(row["group_order"]),
                    row["group_code"],
                    row["group_name"],
                )
    return result


def load_status_policy() -> dict[tuple[str, str], dict[str, str]]:
    with STATUS_POLICY.open(newline="", encoding="utf-8-sig") as handle:
        return {
            (row["table_name"], row["column_name"]): row
            for row in csv.DictReader(handle)
        }


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def extract_check_expressions(ddl: str) -> list[str]:
    """Return balanced CHECK(...) bodies from a CREATE TABLE statement."""
    expressions: list[str] = []
    upper = ddl.upper()
    cursor = 0
    while True:
        start = upper.find("CHECK", cursor)
        if start < 0:
            return expressions
        open_paren = ddl.find("(", start + len("CHECK"))
        if open_paren < 0:
            return expressions
        depth = 0
        quote: str | None = None
        index = open_paren
        while index < len(ddl):
            char = ddl[index]
            if quote:
                if char == quote:
                    if index + 1 < len(ddl) and ddl[index + 1] == quote:
                        index += 1
                    else:
                        quote = None
            elif char in {"'", '"'}:
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    expressions.append(ddl[open_paren + 1 : index])
                    cursor = index + 1
                    break
            index += 1
        else:
            return expressions


def derivation_rule(
    table: str,
    column: str,
    column_type: str,
    is_primary_key: bool,
    policy: dict[str, str] | None,
) -> str:
    if policy:
        return policy["policy_description"]
    if is_primary_key and column_type.upper() == "INTEGER":
        return "Omit on INSERT to let SQLite/D1 allocate the row ID; never guess or reuse an ID."
    if column.startswith("normalized_"):
        return "Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value."
    if column.endswith("_uuid") or column.endswith("_key"):
        return "Canonical importer generates or validates the stable identifier; manual SQL must provide it unless a table-specific template says otherwise."
    if column in {"created_at", "updated_at", "landed_at"} or column.endswith("_at"):
        return "Canonical importer writes an RFC 3339 UTC timestamp when the business event occurs; do not invent a placeholder time."
    if column == "position_jd":
        return "May be NULL for draft Positions; active status requires trimmed JD length of at least 10 characters."
    return "No implicit business derivation. Follow the canonical importer or table-specific manual SQL template."


def main() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        connection.executescript(path.read_text(encoding="utf-8"))

    group_map = load_group_map()
    policies = load_status_policy()
    tables = [
        row[0]
        for row in connection.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        )
    ]
    tables.sort(key=lambda table: (*group_map.get(table, (999, "UNMAPPED", ""))[:2], table))
    rows: list[dict[str, str]] = []
    table_summaries: dict[str, dict[str, list[str]]] = {}
    manual_templates: list[str] = [
        "-- HireBeat D1 canonical manual INSERT templates",
        "-- Generated from the fully migrated schema. Review values before execution.",
        "-- These templates intentionally do not guess identities, parent IDs, evidence, or timestamps.",
        "-- Prefer the protected production importers. Manual SQL is a privileged repair/admin path.",
        "-- :column_name tokens are review placeholders, not literal values; bind or replace every token safely.",
        "-- Each template is the minimum insert shape. Add reviewed nullable columns only when real values exist.",
        "",
    ]

    for table in tables:
        _, group_code, group_name = group_map.get(
            table, (999, "UNMAPPED", "unmapped")
        )
        ddl_row = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        ddl = ddl_row[0] if ddl_row and ddl_row[0] else ""
        check_expressions = extract_check_expressions(ddl)
        fk_by_column: dict[str, list[str]] = defaultdict(list)
        for fk in connection.execute(f"PRAGMA foreign_key_list({quote_identifier(table)})"):
            fk_by_column[fk[3]].append(f"{fk[2]}.{fk[4]} ON DELETE {fk[6]}")
        unique_columns: set[str] = set()
        for index in connection.execute(f"PRAGMA index_list({quote_identifier(table)})"):
            if index[2]:
                for index_column in connection.execute(
                    f"PRAGMA index_info({quote_identifier(index[1])})"
                ):
                    if index_column[2]:
                        unique_columns.add(index_column[2])

        summary = {"required": [], "defaults": [], "nullable": [], "derived": []}
        table_columns = list(
            connection.execute(
            f"PRAGMA table_info({quote_identifier(table)})"
            )
        )
        for _, column, column_type, not_null, default, primary_key in table_columns:
            normalized_default = normalize_default(default)
            policy = policies.get((table, column))
            has_check = any(
                re.search(rf"\b{re.escape(column)}\b", expression, re.I)
                for expression in check_expressions
            )
            if table == "position" and column in {"position_status", "position_jd"}:
                has_check = True
            required = bool(not_null and default is None and not primary_key)
            nullable = not bool(not_null or primary_key)
            error_parts = []
            if required:
                error_parts.append(f"omit → NOT NULL constraint failed: {table}.{column}")
            if fk_by_column.get(column):
                error_parts.append("unknown parent ID → FOREIGN KEY constraint failed")
            if column in unique_columns:
                error_parts.append("duplicate protected value → UNIQUE constraint failed")
            if has_check:
                error_parts.append("invalid value/combination → CHECK or trigger rejection")
            if not error_parts:
                error_parts.append("invalid values may still be rejected by the canonical importer")

            derivation = derivation_rule(
                table, column, column_type, bool(primary_key), policy
            )
            rows.append(
                {
                    "group_code": group_code,
                    "group_name": group_name,
                    "table_name": table,
                    "column_name": column,
                    "declared_type": column_type,
                    "primary_key": "yes" if primary_key else "no",
                    "not_null": "yes" if not_null else "no",
                    "required_without_default": "yes" if required else "no",
                    "nullable": "yes" if nullable else "no",
                    "schema_default": normalized_default,
                    "foreign_key": " | ".join(fk_by_column.get(column, [])),
                    "unique_participant": "yes" if column in unique_columns else "no",
                    "check_or_cross_column_rule": "yes" if has_check else "no",
                    "status_policy": policy["strategy"] if policy else "",
                    "derivation_or_authoring_rule": derivation,
                    "common_failure": "; ".join(error_parts),
                }
            )
            if required:
                summary["required"].append(column)
            if default is not None:
                summary["defaults"].append(f"{column}={normalized_default}")
            if nullable:
                summary["nullable"].append(column)
            if policy or column.startswith("normalized_") or column == "position_jd":
                summary["derived"].append(f"{column}: {derivation}")
        table_summaries[table] = summary

        template_columns = [
            row
            for row in table_columns
            if not (row[5] and row[2].upper() == "INTEGER")
            and row[3]
            and row[4] is None
        ]
        if table == "position":
            by_name = {row[1]: row for row in table_columns}
            for extra in ("position_jd", "position_status"):
                if extra not in {row[1] for row in template_columns}:
                    template_columns.append(by_name[extra])
        manual_templates.extend(
            [
                "-- ============================================================",
                f"-- {group_code} {table}",
                f"-- Nullable optional columns: {', '.join(summary['nullable']) or 'none'}",
                f"-- Schema defaults when omitted: {', '.join(summary['defaults']) or 'none'}",
                f"INSERT INTO {quote_identifier(table)} (",
            ]
        )
        manual_templates.extend(
            [
                f"  {quote_identifier(row[1])}{',' if index < len(template_columns) - 1 else ''}"
                for index, row in enumerate(template_columns)
            ]
        )
        manual_templates.append(") VALUES (")
        for index, row in enumerate(template_columns):
            column = row[1]
            if table == "position" and column == "position_status":
                value = (
                    "CASE WHEN :position_status IS NOT NULL THEN :position_status "
                    "WHEN length(trim(COALESCE(:position_jd, ''))) >= 10 "
                    "THEN 'active' ELSE 'draft' END"
                )
            else:
                value = f":{column}"
            manual_templates.append(
                f"  {value}{',' if index < len(template_columns) - 1 else ''}"
            )
        manual_templates.extend([");", ""])

    CSV_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with CSV_OUTPUT.open("w", newline="", encoding="utf-8-sig") as handle:
        # Git and the repository use LF on every platform. csv defaults to
        # CRLF, which makes `git diff --check` report every generated row as
        # trailing whitespace on macOS/Linux.
        writer = csv.DictWriter(
            handle,
            fieldnames=list(rows[0]),
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# HireBeat D1 全表约束与默认值矩阵",
        "",
        "> 此文档由 `scripts/generate_constraint_matrix.py` 从全部 migration 实际执行后的 SQLite schema 自动生成。不要手工编辑。逐字段详情见同目录 CSV。",
        "",
        "## 冻结规则",
        "",
        "- 数据库原生 `NOT NULL`、`CHECK`、FK、`UNIQUE` 是最后防线。",
        "- 仅在存在唯一且安全的初始值时使用 `DEFAULT`。",
        "- 关键业务值缺失时拒绝写入，不使用空字符串、`unknown` 或占位 ID 猜测。",
        "- Trigger 只处理普通单列约束无法表达的跨字段不变量。",
        "- 正式 importer 负责友好错误代码、标准化、稳定标识和业务推导。",
        "- 手写 SQL 必须采用审核过的表级模板。",
        "",
        "## 表级摘要",
        "",
    ]
    current_group = None
    for table in tables:
        _, group_code, group_name = group_map.get(
            table, (999, "UNMAPPED", "unmapped")
        )
        if group_code != current_group:
            lines.extend([f"### {group_code} — {group_name}", ""])
            current_group = group_code
        summary = table_summaries[table]
        lines.extend(
            [
                f"#### `{table}`",
                "",
                f"- 无默认值必填字段：{', '.join(f'`{x}`' for x in summary['required']) or '无'}",
                f"- Schema 默认值：{', '.join(f'`{x}`' for x in summary['defaults']) or '无'}",
                f"- 可为 NULL：{', '.join(f'`{x}`' for x in summary['nullable']) or '无'}",
                "- 推导/状态规则：",
            ]
        )
        if summary["derived"]:
            lines.extend([f"  - {item}" for item in summary["derived"]])
        else:
            lines.append("  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。")
        lines.extend(
            [
                "- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。",
                "",
            ]
        )

    MD_OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    SQL_TEMPLATE_OUTPUT.write_text("\n".join(manual_templates), encoding="utf-8")
    print(f"Generated: {CSV_OUTPUT.relative_to(ROOT)} ({len(rows)} columns)")
    print(f"Generated: {MD_OUTPUT.relative_to(ROOT)} ({len(tables)} tables)")
    print(f"Generated: {SQL_TEMPLATE_OUTPUT.relative_to(ROOT)} ({len(tables)} templates)")


if __name__ == "__main__":
    main()
