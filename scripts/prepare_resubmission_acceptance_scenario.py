#!/usr/bin/env python3
"""Dry-run-first setup for the isolated rejected-resubmission acceptance case."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Any

from import_reviewed_staging_catalog_seed import (
    DEFAULT_BASE_URL,
    normalize,
    request_json,
    stable_key,
)


POSITION_NAME = "Classical Violin Performance Instructor (Synthetic Acceptance)"
NORMALIZED_POSITION_NAME = normalize(POSITION_NAME)
POSITION_JD = """The conservatory seeks an instructor for advanced classical violin
performance. Responsibilities include coaching solo repertoire, chamber music,
orchestral excerpts, bow technique, intonation, sight reading, and audition
preparation. The instructor will plan individual lessons, lead studio classes,
evaluate recitals, coordinate accompanists, and mentor students preparing for
conservatory juries. Applicants should demonstrate professional performance
experience, detailed knowledge of violin pedagogy, and familiarity with major
Baroque, Classical, Romantic, and contemporary repertoire."""


def make_plan(company_id: int) -> dict[str, Any]:
    jd = POSITION_JD.strip()
    jd_hash = hashlib.sha256(jd.encode("utf-8")).hexdigest()
    return {
        "schema_version": "hirebeat-resubmission-acceptance-setup-v1",
        "test_boundary": {
            "company_id": company_id,
            "position_name": POSITION_NAME,
            "normalized_position_name": NORMALIZED_POSITION_NAME,
            "position_jd_character_count": len(jd),
            "position_jd_sha256": jd_hash,
            "expected_first_application_decision": "rejected",
            "expected_second_submission_attempt_number": 2,
        },
        "commands": {
            "position": {
                "idempotency_key": stable_key(
                    "resubmission-position",
                    str(company_id),
                    NORMALIZED_POSITION_NAME,
                    jd_hash,
                ),
                "company_id": company_id,
                "position_name": POSITION_NAME,
                "position_jd": jd,
                "position_status": "active",
            },
            "catalog_revision": {
                "idempotency_key": stable_key(
                    "resubmission-catalog-revision",
                    str(company_id),
                    NORMALIZED_POSITION_NAME,
                    jd_hash,
                ),
                "change_reason": (
                    "Synthetic staging acceptance position for rejected "
                    "resubmission testing"
                ),
            },
        },
    }


def redacted_plan(plan: dict[str, Any]) -> dict[str, Any]:
    value = json.loads(json.dumps(plan))
    value["commands"]["position"]["position_jd"] = {
        "redacted": True,
        "character_count": value["test_boundary"][
            "position_jd_character_count"
        ],
        "sha256": value["test_boundary"]["position_jd_sha256"],
    }
    return value


def apply_plan(base_url: str, plan: dict[str, Any]) -> dict[str, Any]:
    position = request_json(
        base_url,
        "POST",
        "/v1/catalog/positions",
        plan["commands"]["position"],
    )
    revision = request_json(
        base_url,
        "POST",
        "/v1/catalog/revisions",
        plan["commands"]["catalog_revision"],
    )
    return {
        "position": position,
        "catalog_revision": revision,
        "next_step": {
            "position_id": position["position_id"],
            "position_name": POSITION_NAME,
            "candidate_name": "Riley Chen",
            "candidate_email": "riley.chen.synthetic@example.com",
            "candidate_phone": "+1 202 555 0198",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--company-id", type=int, default=1)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--confirm",
        help=(
            "Required with --apply; must equal the normalized synthetic "
            "position name printed by the dry run."
        ),
    )
    args = parser.parse_args()
    if args.company_id <= 0:
        raise ValueError("company_id_must_be_positive")

    plan = make_plan(args.company_id)
    print(json.dumps(redacted_plan(plan), indent=2, ensure_ascii=False))
    if not args.apply:
        print("DRY RUN ONLY: no network request or database write was performed.")
        print(f"Confirmation value: {NORMALIZED_POSITION_NAME}")
        return 0
    if args.confirm != NORMALIZED_POSITION_NAME:
        raise ValueError(
            f"confirmation_mismatch:expected:{NORMALIZED_POSITION_NAME}"
        )
    print(json.dumps(apply_plan(args.base_url, plan), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
