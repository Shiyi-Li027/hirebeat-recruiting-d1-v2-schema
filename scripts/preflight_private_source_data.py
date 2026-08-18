#!/usr/bin/env python3
"""Read-only preflight for local private staging CSV sources.

The command never connects to D1 and never writes candidate PII to its output.
It prepares public Catalog/Skill candidates and aggregate-only Raw quality
metrics under the Git-ignored test-exports directory.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


EXPECTED_FILES = {
    "function_skills": "Function_Skills.csv",
    "industry_labels": "label_industry.csv",
    "language_skills": "Language_Skills.csv",
    "linkedin_jobs": "linkedin_jobs_english.csv",
    "technical_skills": "Technical_Skills.csv",
    "raw_submissions": "raw_submission_matched_to_linkedin.csv",
}

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize(value: Any) -> str:
    """Match the production importer: NFKC, trim, collapse spaces, lowercase."""

    return re.sub(
        r"\s+",
        " ",
        unicodedata.normalize("NFKC", "" if value is None else str(value)).strip(),
    ).lower()


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"missing_header:{path.name}")
        columns = [str(column) for column in reader.fieldnames]
        rows = [
            {column: "" if row.get(column) is None else str(row[column]) for column in columns}
            for row in reader
        ]
    return columns, rows


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def duplicate_row_count(columns: list[str], rows: Iterable[dict[str, str]]) -> int:
    seen: set[tuple[str, ...]] = set()
    duplicates = 0
    for row in rows:
        key = tuple(row[column] for column in columns)
        if key in seen:
            duplicates += 1
        else:
            seen.add(key)
    return duplicates


def file_profile(path: Path, columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    return {
        "file_name": path.name,
        "file_size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "row_count": len(rows),
        "columns": columns,
        "duplicate_full_row_count": duplicate_row_count(columns, rows),
        "blank_count_by_column": {
            column: sum(not row[column].strip() for row in rows) for column in columns
        },
    }


def require_columns(name: str, columns: list[str], required: set[str]) -> None:
    missing = sorted(required.difference(columns))
    if missing:
        raise ValueError(f"{name}:missing_columns:{','.join(missing)}")


def catalog_preflight(rows: list[dict[str, str]]) -> tuple[dict[str, Any], dict[str, Any]]:
    required = {
        "Job Title",
        "Company",
        "Location",
        "Salary Range",
        "Detailed JD",
        "Seniority Level",
        "Employment Type",
        "Job Function",
        "Industries",
    }
    require_columns("linkedin_jobs", list(rows[0]) if rows else [], required)

    grouped: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    invalid_company = invalid_position = invalid_jd = 0
    for row in rows:
        company = normalize(row["Company"])
        position = normalize(row["Job Title"])
        jd = row["Detailed JD"].strip()
        invalid_company += not bool(company)
        invalid_position += not bool(position)
        invalid_jd += len(jd) < 10
        if company and position:
            grouped[(company, position)].append(row)

    deterministic: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    for (company_key, position_key), versions in sorted(grouped.items()):
        valid_versions = [row for row in versions if len(row["Detailed JD"].strip()) >= 10]
        distinct_jd_hashes = sorted(
            {
                hashlib.sha256(row["Detailed JD"].strip().encode("utf-8")).hexdigest()
                for row in valid_versions
            }
        )
        base = {
            "normalized_company_name": company_key,
            "normalized_position_name": position_key,
            "source_row_count": len(versions),
            "valid_jd_version_count": len(valid_versions),
            "distinct_valid_jd_count": len(distinct_jd_hashes),
        }
        if len(valid_versions) == 1 and len(versions) == 1:
            row = valid_versions[0]
            deterministic.append(
                {
                    **base,
                    "company_name": row["Company"].strip(),
                    "position_name": row["Job Title"].strip(),
                    "position_jd": row["Detailed JD"].strip(),
                    "location": row["Location"].strip() or None,
                    "seniority_level": row["Seniority Level"].strip() or None,
                    "employment_type": row["Employment Type"].strip() or None,
                    "job_function": row["Job Function"].strip() or None,
                    "industries": row["Industries"].strip() or None,
                }
            )
        elif valid_versions:
            ambiguous.append({**base, "valid_jd_sha256": distinct_jd_hashes})

    summary = {
        "source_row_count": len(rows),
        "normalized_company_count": len({key[0] for key in grouped}),
        "normalized_company_position_count": len(grouped),
        "blank_company_count": int(invalid_company),
        "blank_position_count": int(invalid_position),
        "missing_or_short_jd_count": int(invalid_jd),
        "deterministic_single_version_candidate_count": len(deterministic),
        "multi_version_or_duplicate_pair_count": len(ambiguous),
        "policy": {
            "deterministic_candidates": "exactly one source row and one JD of at least 10 characters",
            "ambiguous_pairs": "not auto-selected; requires a reviewed version-selection policy",
            "salary_range": "not imported when the source column is blank",
        },
    }
    candidates = {
        "schema_version": "hirebeat-catalog-preflight-v1",
        "deterministic_candidates": deterministic,
        "ambiguous_pairs": ambiguous,
    }
    return summary, candidates


def skill_preflight(
    function_rows: list[dict[str, str]],
    technical_rows: list[dict[str, str]],
    language_rows: list[dict[str, str]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    assignments: dict[str, dict[str, Any]] = {}

    def add(name: str, skill_type: str, display_name: str, group: str | None = None) -> None:
        key = normalize(name)
        if not key:
            return
        item = assignments.setdefault(
            key,
            {"skill_name": display_name.strip(), "normalized_skill_name": key, "skill_types": set(), "source_groups": set()},
        )
        item["skill_types"].add(skill_type)
        if group and group.strip():
            item["source_groups"].add(group.strip())

    for row in function_rows:
        add(row.get("Skill", ""), "function", row.get("Skill", ""), row.get("Group"))
    for row in technical_rows:
        add(row.get("Technical", ""), "technical", row.get("Technical", ""))
    for row in language_rows:
        add(row.get("Language", ""), "language", row.get("Language", ""))

    candidates = []
    multi_type = 0
    for key in sorted(assignments):
        item = assignments[key]
        types = sorted(item["skill_types"])
        multi_type += len(types) > 1
        candidates.append(
            {
                "skill_name": item["skill_name"],
                "normalized_skill_name": key,
                "skill_types": types,
                "source_groups": sorted(item["source_groups"]),
            }
        )
    summary = {
        "unique_normalized_skill_count": len(candidates),
        "multi_type_skill_count": multi_type,
        "function_source_row_count": len(function_rows),
        "technical_source_row_count": len(technical_rows),
        "language_source_row_count": len(language_rows),
        "policy": {
            "skill_identity": "normalized skill name",
            "multiple_types": "preserved through one skill_type_assignment per distinct type",
            "function_group": "retained as source metadata; not silently converted into a schema type",
        },
    }
    return summary, {"schema_version": "hirebeat-skill-preflight-v1", "skills": candidates}


def raw_quality(rows: list[dict[str, str]], catalog_rows: list[dict[str, str]]) -> dict[str, Any]:
    required = {
        "name",
        "resume_text",
        "contact_email",
        "resume",
        "company",
        "position",
        "mode",
        "duration",
        "start_date",
        "end_date",
        "created_at",
        "original_company",
        "original_position",
        "match_type",
        "position_title_similarity_score",
    }
    require_columns("raw_submissions", list(rows[0]) if rows else [], required)
    catalog_pairs = {
        (normalize(row["Company"]), normalize(row["Job Title"]))
        for row in catalog_rows
        if normalize(row["Company"]) and normalize(row["Job Title"])
    }
    matched = sum(
        (normalize(row["company"]), normalize(row["position"])) in catalog_pairs
        for row in rows
    )
    mode_counts = Counter(normalize(row["mode"]) or "<blank>" for row in rows)
    match_counts = Counter(row["match_type"].strip() or "<blank>" for row in rows)
    return {
        "source_row_count": len(rows),
        "duplicate_full_row_count": duplicate_row_count(list(rows[0]) if rows else [], rows),
        "resume_text_missing_or_short_count": sum(len(row["resume_text"].strip()) < 10 for row in rows),
        "resume_reference_blank_count": sum(not row["resume"].strip() for row in rows),
        "email_blank_count": sum(not row["contact_email"].strip() for row in rows),
        "email_basic_format_failure_count": sum(
            not EMAIL_PATTERN.fullmatch(row["contact_email"].strip()) for row in rows
        ),
        "normalized_catalog_pair_match_count": matched,
        "mode_counts": dict(sorted(mode_counts.items())),
        "match_type_counts": dict(sorted(match_counts.items())),
        "privacy_policy": "aggregate metrics only; no candidate fields are emitted",
        "load_policy": "never bulk-load directly; use generated synthetic applicants for automated acceptance",
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=Path("test-inputs/private-source-data"))
    parser.add_argument("--output-dir", type=Path, default=Path("test-exports/staging/source-preflight"))
    args = parser.parse_args()

    missing = [name for name in EXPECTED_FILES.values() if not (args.input_dir / name).is_file()]
    if missing:
        raise SystemExit("missing private source files: " + ", ".join(sorted(missing)))

    loaded: dict[str, tuple[list[str], list[dict[str, str]]]] = {}
    profiles: dict[str, Any] = {}
    for key, name in EXPECTED_FILES.items():
        path = args.input_dir / name
        columns, rows = read_csv(path)
        loaded[key] = (columns, rows)
        profiles[key] = file_profile(path, columns, rows)

    catalog_summary, catalog_candidates = catalog_preflight(loaded["linkedin_jobs"][1])
    skill_summary, skill_candidates = skill_preflight(
        loaded["function_skills"][1], loaded["technical_skills"][1], loaded["language_skills"][1]
    )
    industry_rows = loaded["industry_labels"][1]
    industry_summary = {
        "source_row_count": len(industry_rows),
        "schema_destination": None,
        "decision": "deferred because the confirmed schema has no authoritative industry table",
    }
    summary = {
        "schema_version": "hirebeat-private-source-preflight-v1",
        "files": profiles,
        "catalog": catalog_summary,
        "skills": skill_summary,
        "industry": industry_summary,
        "raw_submission_quality": raw_quality(
            loaded["raw_submissions"][1], loaded["linkedin_jobs"][1]
        ),
    }
    write_json(args.output_dir / "source_preflight_summary.json", summary)
    write_json(args.output_dir / "catalog_candidates.json", catalog_candidates)
    write_json(args.output_dir / "skill_candidates.json", skill_candidates)
    print(f"Preflight completed: {args.output_dir}")
    print(json.dumps({
        "catalog_candidates": catalog_summary["deterministic_single_version_candidate_count"],
        "ambiguous_catalog_pairs": catalog_summary["multi_version_or_duplicate_pair_count"],
        "unique_skills": skill_summary["unique_normalized_skill_count"],
        "raw_rows": summary["raw_submission_quality"]["source_row_count"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
