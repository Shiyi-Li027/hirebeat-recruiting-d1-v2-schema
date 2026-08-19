#!/usr/bin/env python3
"""Export one Workflow's auditable D1 rows for human inspection.

The output is diagnostic only. It is never an ETL input and is ignored by Git.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
from typing import Any

from time_policy import (
    BUSINESS_TIMEZONE,
    BUSINESS_ZONE,
    STORAGE_TIMEZONE,
    add_human_time_columns,
    eastern_display,
)


ROOT = pathlib.Path(__file__).resolve().parents[1]


def execute(sql: str, remote: bool) -> list[dict[str, Any]]:
    command = ["npx", "wrangler", "d1", "execute", "DB"]
    command.append("--remote" if remote else "--local")
    command += ["--json", "--command", sql]
    process = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True)
    payload = json.loads(process.stdout)
    if not payload or not payload[0].get("success"):
        raise RuntimeError(f"D1 export query failed: {payload}")
    return payload[0].get("results", [])


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def write_csv(path: pathlib.Path, rows: list[dict[str, Any]]) -> tuple[int, str]:
    fields = list(rows[0]) if rows else []
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        if fields:
            writer.writeheader()
            writer.writerows(rows)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return len(rows), digest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow-run-uuid", required=True)
    parser.add_argument("--environment", choices=("local", "staging", "production"), required=True)
    args = parser.parse_args()
    remote = args.environment != "local"
    workflow_uuid = quote(args.workflow_run_uuid)
    workflow_rows = execute(f"SELECT * FROM etl_workflow_run WHERE workflow_run_uuid={workflow_uuid};", remote)
    if len(workflow_rows) != 1:
        raise SystemExit("Expected exactly one etl_workflow_run for the supplied UUID.")
    run = workflow_rows[0]
    run_id = int(run["id"])
    raw_id = run.get("raw_submission_id")
    application_id = run.get("application_id")
    queries: dict[str, str] = {
        "etl_workflow_run.csv": f"SELECT * FROM etl_workflow_run WHERE id={run_id};",
        "etl_step_run.csv": f"SELECT * FROM etl_step_run WHERE workflow_run_id={run_id} ORDER BY id;",
        "etl_step_attempt.csv": f"SELECT attempt.* FROM etl_step_attempt attempt JOIN etl_step_run step ON step.id=attempt.step_run_id WHERE step.workflow_run_id={run_id} ORDER BY attempt.id;",
        "outbox_event.csv": f"SELECT * FROM outbox_event WHERE producer_workflow_run_id={run_id} ORDER BY id;",
        "audit_event.csv": f"SELECT * FROM audit_event WHERE workflow_run_id={run_id} ORDER BY id;",
    }
    if raw_id is not None:
        raw = int(raw_id)
        queries.update({
            "raw_submission.csv": f"SELECT * FROM raw_submission WHERE id={raw};",
            "raw_submission_resume.csv": f"SELECT * FROM raw_submission_resume WHERE raw_submission_id={raw};",
            "submission_normalized.csv": f"SELECT * FROM submission_normalized WHERE raw_submission_id={raw};",
            "resume_extraction.csv": f"SELECT extraction.* FROM resume_extraction extraction JOIN submission_normalized normalized ON normalized.id=extraction.submission_normalized_id WHERE normalized.raw_submission_id={raw};",
            "submission_dedup_run.csv": f"SELECT run.* FROM submission_dedup_run run JOIN submission_normalized normalized ON normalized.id=run.target_submission_normalized_id WHERE normalized.raw_submission_id={raw};",
        })
    if application_id is not None:
        app = int(application_id)
        queries.update({
            "application.csv": f"SELECT * FROM application WHERE id={app};",
            "candidate_snapshot.csv": f"SELECT * FROM candidate_snapshot WHERE application_id={app};",
            "application_source_lineage.csv": f"SELECT * FROM application_source_lineage WHERE application_id={app};",
            "application_stage_run.csv": f"SELECT * FROM application_stage_run WHERE application_id={app} ORDER BY actual_sequence_no;",
            "ml_analysis_run.csv": f"SELECT * FROM ml_analysis_run WHERE application_id={app};",
            "ml_recommendation_result.csv": f"SELECT * FROM ml_recommendation_result WHERE application_id={app};",
            "offer.csv": f"SELECT * FROM offer WHERE application_id={app};",
        })
    policy_rows = execute(
        """SELECT c.configuration_key, c.configuration_value_json
           FROM system_configuration AS c
           JOIN system_configuration_release AS r
             ON r.id=c.configuration_release_id
          WHERE r.release_status='active'
            AND c.configuration_scope='localization'
          ORDER BY c.configuration_key;""",
        remote,
    )
    policy = {
        row["configuration_key"]: json.loads(row["configuration_value_json"])
        for row in policy_rows
    }
    if policy != {
        "business_timezone": BUSINESS_TIMEZONE,
        "storage_timezone": STORAGE_TIMEZONE,
    }:
        raise SystemExit(f"Active D1 time policy is missing or unsupported: {policy}")
    generated_at_utc = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    date = dt.datetime.now(BUSINESS_ZONE).date().isoformat()
    output = ROOT / "test-exports" / args.environment / date / args.workflow_run_uuid
    output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, Any]] = []
    for filename, sql in queries.items():
        rows = add_human_time_columns(execute(sql, remote))
        count, digest = write_csv(output / filename, rows)
        manifest.append({
            "file_name": filename,
            "row_count": count,
            "sha256": digest,
            "storage_timezone": STORAGE_TIMEZONE,
            "human_display_timezone": BUSINESS_TIMEZONE,
            "generated_at_utc": generated_at_utc,
            "generated_at_eastern": eastern_display(generated_at_utc),
        })
    write_csv(output / "00_export_manifest.csv", manifest)
    print(output)


if __name__ == "__main__":
    main()
