#!/usr/bin/env python3
"""Dry-run-first setup, withdrawal and recovery for Position-JD acceptance."""

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


POSITION_NAME = "Data Quality Analyst (Synthetic JD Recovery)"
NORMALIZED_POSITION_NAME = normalize(POSITION_NAME)
POSITION_JD = """The data quality analyst monitors production data pipelines and
builds validation controls using SQL and Python. Responsibilities include
freshness and completeness checks, incident triage, root-cause analysis,
operational dashboards, remediation verification, and clear documentation.
Candidates should have experience with ETL workflows, automated testing,
monitoring, version control, and communicating data-quality findings."""


def create_plan(company_id: int) -> dict[str, Any]:
    jd = POSITION_JD.strip()
    jd_hash = hashlib.sha256(jd.encode("utf-8")).hexdigest()
    return {
        "schema_version": "hirebeat-position-jd-wait-acceptance-v1",
        "mode": "create_active",
        "test_boundary": {
            "company_id": company_id,
            "position_name": POSITION_NAME,
            "normalized_position_name": NORMALIZED_POSITION_NAME,
            "initial_position_status": "active",
            "position_jd_character_count": len(jd),
            "position_jd_sha256": jd_hash,
            "expected_waiter_count_before_activation": 1,
            "expected_resumed_waiter_count": 1,
        },
        "commands": {
            "position": {
                "idempotency_key": stable_key(
                    "jd-wait-position-active", str(company_id), jd_hash
                ),
                "company_id": company_id,
                "position_name": POSITION_NAME,
                "position_jd": jd,
                "position_status": "active",
            },
            "catalog_revision": {
                "idempotency_key": stable_key(
                    "jd-wait-catalog-create", str(company_id), jd_hash
                ),
                "change_reason": (
                    "Publish active synthetic Position before JD withdrawal acceptance"
                ),
            },
        },
    }


def draft_plan(position_id: int) -> dict[str, Any]:
    return {
        "schema_version": "hirebeat-position-jd-wait-acceptance-v1",
        "mode": "withdraw_to_draft",
        "test_boundary": {
            "position_id": position_id,
            "position_name": POSITION_NAME,
            "expected_resumed_waiter_count": 0,
        },
        "commands": {
            "position": {
                "idempotency_key": stable_key(
                    "jd-wait-position-withdraw", str(position_id)
                ),
                "position_jd": None,
                "position_status": "draft",
            },
            "catalog_revision": {
                "idempotency_key": stable_key(
                    "jd-wait-catalog-withdraw", str(position_id)
                ),
                "change_reason": (
                    "Withdraw synthetic Position after Workflow A acceptance"
                ),
            },
        },
    }


def activation_plan(position_id: int) -> dict[str, Any]:
    jd = POSITION_JD.strip()
    jd_hash = hashlib.sha256(jd.encode("utf-8")).hexdigest()
    return {
        "schema_version": "hirebeat-position-jd-wait-acceptance-v1",
        "mode": "activate_ready_position",
        "test_boundary": {
            "position_id": position_id,
            "position_name": POSITION_NAME,
            "position_jd_character_count": len(jd),
            "position_jd_sha256": jd_hash,
            "expected_resumed_waiter_count": 1,
        },
        "commands": {
            "position": {
                "idempotency_key": stable_key(
                    "jd-wait-position-activate", str(position_id), jd_hash
                ),
                "position_jd": jd,
                "position_status": "active",
            },
            "catalog_revision": {
                "idempotency_key": stable_key(
                    "jd-wait-catalog-revision", str(position_id), jd_hash
                ),
                "change_reason": (
                    "Activate synthetic Position after JD-wait recovery acceptance"
                ),
            },
        },
    }


def redacted(value: dict[str, Any]) -> dict[str, Any]:
    copy = json.loads(json.dumps(value))
    if copy["mode"] in {"create_active", "activate_ready_position"}:
        copy["commands"]["position"]["position_jd"] = {
            "redacted": True,
            "character_count": copy["test_boundary"]["position_jd_character_count"],
            "sha256": copy["test_boundary"]["position_jd_sha256"],
        }
    return copy


def apply_create(base_url: str, plan: dict[str, Any]) -> dict[str, Any]:
    position = request_json(
        base_url, "POST", "/v1/catalog/positions", plan["commands"]["position"]
    )
    revision = request_json(
        base_url, "POST", "/v1/catalog/revisions", plan["commands"]["catalog_revision"]
    )
    return {
        "position": position,
        "catalog_revision": revision,
        "next_step": {
            "position_id": position["position_id"],
            "position_name": POSITION_NAME,
            "candidate_name": "Jordan Lee",
            "candidate_email": "jordan.lee.synthetic@example.com",
            "candidate_phone": "+1 202 555 0176",
            "first_source_record_id": "staging-google-jd-wait-001",
            "second_source_record_id": "staging-google-jd-wait-002",
        },
    }


def apply_position_transition(base_url: str, plan: dict[str, Any]) -> dict[str, Any]:
    position_id = int(plan["test_boundary"]["position_id"])
    position = request_json(
        base_url,
        "PATCH",
        f"/v1/catalog/positions/{position_id}",
        plan["commands"]["position"],
    )
    revision = request_json(
        base_url,
        "POST",
        "/v1/catalog/revisions",
        plan["commands"]["catalog_revision"],
    )
    expected = int(plan["test_boundary"]["expected_resumed_waiter_count"])
    resumed = int(position.get("resumed_waiting_workflow_count", -1))
    if resumed != expected:
        raise RuntimeError(f"unexpected_resumed_waiting_workflow_count:{resumed}")
    return {"position": position, "catalog_revision": revision}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--company-id", type=int, default=1)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--draft-position-id", type=int)
    mode.add_argument("--activate-position-id", type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm")
    args = parser.parse_args()
    if args.company_id <= 0:
        raise ValueError("company_id_must_be_positive")
    if args.activate_position_id is not None and args.activate_position_id <= 0:
        raise ValueError("activate_position_id_must_be_positive")
    if args.draft_position_id is not None and args.draft_position_id <= 0:
        raise ValueError("draft_position_id_must_be_positive")

    if args.draft_position_id is not None:
        plan = draft_plan(args.draft_position_id)
    elif args.activate_position_id is not None:
        plan = activation_plan(args.activate_position_id)
    else:
        plan = create_plan(args.company_id)
    print(json.dumps(redacted(plan), indent=2, ensure_ascii=False))
    if not args.apply:
        print("DRY RUN ONLY: no network request or database write was performed.")
        print(f"Confirmation value: {NORMALIZED_POSITION_NAME}")
        return 0
    if args.confirm != NORMALIZED_POSITION_NAME:
        raise ValueError(f"confirmation_mismatch:expected:{NORMALIZED_POSITION_NAME}")
    result = apply_create(args.base_url, plan) if plan["mode"] == "create_active" else apply_position_transition(args.base_url, plan)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, TypeError, ValueError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
