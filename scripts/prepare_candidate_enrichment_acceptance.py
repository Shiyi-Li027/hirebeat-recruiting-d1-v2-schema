#!/usr/bin/env python3
"""Dry-run-first seed of reviewed Skills for Candidate enrichment acceptance."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from import_reviewed_staging_catalog_seed import (
    DEFAULT_BASE_URL,
    normalize,
    request_json,
    stable_key,
)


DEFAULT_CANDIDATES = Path(
    "test-exports/staging/source-preflight/skill_candidates.json"
)
SELECTED_SKILLS = ("git", "python", "sql")
SKILL_TYPE_NAMES = {
    "function": "Function",
    "technical": "Technical",
}
CONFIRMATION_VALUE = "|".join(SELECTED_SKILLS)


def load_reviewed_skills(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise ValueError(
            f"candidate_file_missing:{path}; run npm run data:preflight first"
        )
    document = json.loads(path.read_text(encoding="utf-8"))
    rows = document.get("skills", [])
    selected: list[dict[str, Any]] = []
    for expected in SELECTED_SKILLS:
        matches = [
            row
            for row in rows
            if normalize(row.get("normalized_skill_name")) == expected
        ]
        if len(matches) != 1:
            raise ValueError(f"reviewed_skill_match_count:{expected}:{len(matches)}")
        row = matches[0]
        types = sorted(
            {
                normalize(value).replace(" ", "_")
                for value in row.get("skill_types", [])
                if normalize(value) in SKILL_TYPE_NAMES
            }
        )
        if not types:
            raise ValueError(f"reviewed_skill_type_missing:{expected}")
        selected.append(
            {
                "skill_name": str(row["skill_name"]).strip(),
                "normalized_skill_name": expected,
                "skill_types": types,
            }
        )
    return selected


def make_plan(rows: list[dict[str, Any]]) -> dict[str, Any]:
    type_codes = sorted({value for row in rows for value in row["skill_types"]})
    return {
        "schema_version": "hirebeat-candidate-enrichment-acceptance-setup-v1",
        "test_boundary": {
            "source": "reviewed_private_source_preflight",
            "selected_skill_count": len(rows),
            "expected_eligible_skill_count": len(rows),
            "expected_unmapped_skill_count": 1,
            "candidate_name": "Taylor Kim",
            "candidate_email": "taylor.kim.synthetic@example.com",
            "candidate_phone": "+1 202 555 0184",
            "source_record_id": "staging-google-enrichment-001",
        },
        "commands": {
            "skill_types": [
                {
                    "idempotency_key": stable_key("skill-type", code),
                    "skill_type_code": code,
                    "skill_type_name": SKILL_TYPE_NAMES[code],
                    "is_active": True,
                }
                for code in type_codes
            ],
            "skills": [
                {
                    "idempotency_key": stable_key(
                        "skill", row["normalized_skill_name"]
                    ),
                    "skill_name": row["skill_name"],
                    "normalized_skill_name": row["normalized_skill_name"],
                    "skill_types": row["skill_types"],
                    "is_active": True,
                }
                for row in rows
            ],
        },
    }


def apply_plan(base_url: str, value: dict[str, Any]) -> dict[str, Any]:
    type_ids: dict[str, int] = {}
    type_results: list[dict[str, Any]] = []
    for command in value["commands"]["skill_types"]:
        result = request_json(base_url, "POST", "/v1/reference/skill_type", command)
        type_ids[str(command["skill_type_code"])] = int(result["reference_id"])
        type_results.append(result)

    skill_results: list[dict[str, Any]] = []
    assignment_results: list[dict[str, Any]] = []
    for command in value["commands"]["skills"]:
        payload = {
            "idempotency_key": command["idempotency_key"],
            "skill_name": command["skill_name"],
            "is_active": command["is_active"],
        }
        result = request_json(base_url, "POST", "/v1/reference/skill", payload)
        skill_id = int(result["reference_id"])
        skill_results.append(result)
        for type_code in command["skill_types"]:
            assignment = request_json(
                base_url,
                "POST",
                "/v1/reference/skill_type_assignment",
                {
                    "idempotency_key": stable_key(
                        "skill-type-assignment",
                        str(command["normalized_skill_name"]),
                        str(type_code),
                    ),
                    "skill_id": skill_id,
                    "skill_type_id": type_ids[str(type_code)],
                },
            )
            assignment_results.append(assignment)
    return {
        "skill_types": type_results,
        "skills": skill_results,
        "skill_type_assignments": assignment_results,
        "next_step": value["test_boundary"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm")
    args = parser.parse_args()

    value = make_plan(load_reviewed_skills(args.candidates))
    print(json.dumps(value, indent=2, ensure_ascii=False))
    if not args.apply:
        print("DRY RUN ONLY: no network request or database write was performed.")
        print(f"Confirmation value: {CONFIRMATION_VALUE}")
        return 0
    if args.confirm != CONFIRMATION_VALUE:
        raise ValueError(f"confirmation_mismatch:expected:{CONFIRMATION_VALUE}")
    print(json.dumps(apply_plan(args.base_url, value), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
