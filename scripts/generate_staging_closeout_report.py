#!/usr/bin/env python3
"""Generate a read-only, non-PII staging release-evidence snapshot."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
from typing import Any

from export_workflow_inspection import execute
from time_policy import BUSINESS_ZONE


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER_CONFIGS = {
    "submission_ingress": "workers/submission-ingress/wrangler.toml",
    "etl_orchestrator": "workers/etl-orchestrator/wrangler.toml",
    "operations_api": "workers/operations-api/wrangler.toml",
}


def command(args: list[str]) -> str:
    process = subprocess.run(
        args,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return process.stdout.strip()


def manifest_evidence(workflow_uuid: str) -> dict[str, Any]:
    matches = sorted(
        (ROOT / "test-exports" / "staging").glob(f"*/{workflow_uuid}")
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"workflow_evidence_directory_count:{workflow_uuid}:{len(matches)}"
        )
    directory = matches[0]
    manifest = directory / "00_export_manifest.csv"
    if not manifest.is_file():
        raise RuntimeError(f"workflow_manifest_missing:{workflow_uuid}")
    rows = list(csv.DictReader(manifest.open(encoding="utf-8-sig")))
    mismatches: list[str] = []
    timezone_pairs: set[tuple[str, str]] = set()
    for row in rows:
        path = directory / row["file_name"]
        if not path.is_file():
            mismatches.append(f"missing:{row['file_name']}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != row["sha256"]:
            mismatches.append(f"sha256:{row['file_name']}")
        timezone_pairs.add(
            (row["storage_timezone"], row["human_display_timezone"])
        )
    return {
        "workflow_run_uuid": workflow_uuid,
        "manifest_path": str(manifest),
        "file_count": len(rows),
        "hash_mismatches": mismatches,
        "timezone_pairs": [list(value) for value in sorted(timezone_pairs)],
        "passed": not mismatches
        and timezone_pairs == {("UTC", "America/New_York")},
    }


def worker_deployments() -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, config in WORKER_CONFIGS.items():
        output = command(
            [
                "npx",
                "wrangler",
                "deployments",
                "status",
                "--config",
                config,
                "--json",
            ]
        )
        result[name] = json.loads(output)
    return result


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-record-id", default="staging-google-enrichment-001"
    )
    parser.add_argument("--workflow-a-uuid", required=True)
    parser.add_argument("--workflow-b-uuid", required=True)
    parser.add_argument("--offer-concurrency-id", type=int, default=2)
    parser.add_argument(
        "--offer-concurrency-accepted-key",
        default="staging-offer-2-concurrent-accepted-v1",
    )
    parser.add_argument(
        "--offer-concurrency-declined-key",
        default="staging-offer-2-concurrent-declined-v1",
    )
    args = parser.parse_args()

    source = quote(args.source_record_id)
    workflow_a = quote(args.workflow_a_uuid)
    workflow_b = quote(args.workflow_b_uuid)
    offer_concurrency_id = args.offer_concurrency_id
    if offer_concurrency_id <= 0:
        raise SystemExit("offer_concurrency_id_invalid")
    accepted_key = quote(args.offer_concurrency_accepted_key)
    declined_key = quote(args.offer_concurrency_declined_key)
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")

    foreign_key_violations = execute("PRAGMA foreign_key_check;", True)
    configuration = execute(
        """SELECT r.id AS configuration_release_id,
                  r.configuration_release_key,
                  r.release_version,
                  c.configuration_scope,
                  c.configuration_key,
                  c.configuration_value_json
             FROM system_configuration_release AS r
             JOIN system_configuration AS c
               ON c.configuration_release_id=r.id
            WHERE r.release_status='active'
            ORDER BY c.configuration_scope,c.configuration_key;""",
        True,
    )
    catalog = execute(
        """SELECT id,revision_number,snapshot_sha256,created_at
             FROM catalog_revision ORDER BY revision_number DESC LIMIT 1;""",
        True,
    )
    workflows = execute(
        f"""SELECT workflow.workflow_run_uuid,workflow.workflow_type,
                   workflow.workflow_version,workflow.workflow_status,
                   workflow.run_attempt_count,
                   SUM(CASE WHEN attempt.attempt_status='failed_retryable'
                            THEN 1 ELSE 0 END) AS retryable_attempt_count,
                   SUM(CASE WHEN attempt.attempt_status='failed_terminal'
                            THEN 1 ELSE 0 END) AS terminal_attempt_count
              FROM etl_workflow_run AS workflow
              LEFT JOIN etl_step_run AS step
                ON step.workflow_run_id=workflow.id
              LEFT JOIN etl_step_attempt AS attempt
                ON attempt.step_run_id=step.id
             WHERE workflow.workflow_run_uuid IN ({workflow_a},{workflow_b})
             GROUP BY workflow.id
             ORDER BY workflow.workflow_type;""",
        True,
    )
    synthetic_case = execute(
        f"""SELECT
          intake.submission_uuid,intake.intake_status,intake.attempt_count,
          intake.technical_redelivery_count,
          intake.last_technical_redelivery_mechanism,
          raw.id AS raw_submission_id,resume.resume_text_status,
          resume.resume_text_origin,resume.resume_parser_version,
          app.id AS application_id,app.person_id,
          app.application_lifecycle_status,app.application_decision_status,
          snapshot.id AS candidate_snapshot_id,snapshot.snapshot_status,
          ml.model_name,ml.model_provider,ml.model_revision,ml.run_status AS ml_status,
          (SELECT COUNT(*) FROM candidate_education ce
            WHERE ce.candidate_snapshot_id=snapshot.id) AS candidate_education_count,
          (SELECT COUNT(*) FROM candidate_position cp
            WHERE cp.candidate_snapshot_id=snapshot.id) AS candidate_position_count,
          (SELECT COUNT(*) FROM candidate_skill cs
            WHERE cs.candidate_snapshot_id=snapshot.id) AS candidate_skill_count,
          (SELECT COUNT(*) FROM candidate_project cp
            WHERE cp.candidate_snapshot_id=snapshot.id) AS candidate_project_count,
          (SELECT COUNT(*) FROM resume_skill rs
            WHERE rs.resume_extraction_id=lineage.source_resume_extraction_id
              AND rs.extraction_eligibility_status='rejected_unmapped_skill')
            AS rejected_unmapped_skill_count,
          (SELECT COUNT(*) FROM offer o WHERE o.application_id=app.id)
            AS offer_count
        FROM raw_submission_intake_run AS intake
        JOIN raw_submission AS raw
          ON raw.raw_submission_intake_run_id=intake.id
        JOIN raw_submission_resume AS resume
          ON resume.raw_submission_id=raw.id
        JOIN application_source_lineage AS lineage
          ON lineage.source_raw_submission_id=raw.id
         AND lineage.relation_role='primary_decision_input'
        JOIN application AS app ON app.id=lineage.application_id
        JOIN candidate_snapshot AS snapshot ON snapshot.application_id=app.id
        LEFT JOIN ml_analysis_run AS ml ON ml.application_id=app.id
        WHERE intake.source_system='google_form'
          AND intake.source_record_id={source};""",
        True,
    )
    offer_concurrency = execute(
        f"""SELECT
          offer.id AS offer_id,
          offer.current_status,
          offer.status_version,
          offer.current_offer_version_id,
          (SELECT COUNT(*) FROM offer_status_history AS history
            WHERE history.offer_id=offer.id
              AND history.idempotency_key IN ({accepted_key},{declined_key}))
            AS competing_history_count,
          (SELECT COUNT(*) FROM offer_status_history AS history
            WHERE history.offer_id=offer.id
              AND history.idempotency_key={accepted_key})
            AS accepted_history_count,
          (SELECT COUNT(*) FROM offer_status_history AS history
            WHERE history.offer_id=offer.id
              AND history.idempotency_key={declined_key})
            AS declined_history_count,
          (SELECT history.to_status FROM offer_status_history AS history
            WHERE history.offer_id=offer.id
              AND history.idempotency_key IN ({accepted_key},{declined_key})
            ORDER BY history.id DESC LIMIT 1) AS winning_status,
          (SELECT history.idempotency_key FROM offer_status_history AS history
            WHERE history.offer_id=offer.id
              AND history.idempotency_key IN ({accepted_key},{declined_key})
            ORDER BY history.id DESC LIMIT 1) AS winning_idempotency_key,
          (SELECT COUNT(*) FROM audit_event AS audit
            WHERE audit.event_type='command.offer.status.transition'
              AND audit.entity_type='offer'
              AND audit.entity_id=offer.id
              AND audit.correlation_key IN ({accepted_key},{declined_key}))
            AS competing_audit_count,
          (SELECT COUNT(*) FROM audit_event AS audit
            WHERE audit.event_type='command.offer.status.transition'
              AND audit.entity_type='offer'
              AND audit.entity_id=offer.id
              AND audit.correlation_key={accepted_key})
            AS accepted_audit_count,
          (SELECT COUNT(*) FROM audit_event AS audit
            WHERE audit.event_type='command.offer.status.transition'
              AND audit.entity_type='offer'
              AND audit.entity_id=offer.id
              AND audit.correlation_key={declined_key})
            AS declined_audit_count
        FROM offer
        WHERE offer.id={offer_concurrency_id};""",
        True,
    )

    expected_case = {
        "intake_status": "succeeded",
        "attempt_count": 1,
        "last_technical_redelivery_mechanism": "webhook_redelivery",
        "resume_text_status": "available",
        "application_lifecycle_status": "completed",
        "application_decision_status": "offer_created",
        "snapshot_status": "enriched",
        "ml_status": "succeeded",
        "candidate_education_count": 1,
        "candidate_position_count": 1,
        "candidate_skill_count": 3,
        "candidate_project_count": 1,
        "rejected_unmapped_skill_count": 1,
        "offer_count": 1,
    }
    case_passed = len(synthetic_case) == 1 and all(
        synthetic_case[0].get(key) == value for key, value in expected_case.items()
    )
    if case_passed:
        case_passed = int(
            synthetic_case[0].get("technical_redelivery_count", 0)
        ) >= 1
        case_passed = case_passed and bool(
            synthetic_case[0].get("resume_parser_version")
        )
        case_passed = case_passed and (
            synthetic_case[0].get("model_name") == "all-MiniLM-L6-v2"
            and synthetic_case[0].get("model_provider")
            == "sentence_transformers"
        )
    workflow_passed = (
        len(workflows) == 2
        and {row["workflow_type"] for row in workflows}
        == {"workflow_a", "workflow_b"}
        and all(row["workflow_status"] == "succeeded" for row in workflows)
    )
    concurrency_passed = len(offer_concurrency) == 1
    if concurrency_passed:
        concurrency = offer_concurrency[0]
        concurrency_passed = (
            concurrency["current_status"] in {"accepted", "declined"}
            and concurrency["status_version"] == 5
            and concurrency["current_status"] == concurrency["winning_status"]
            and concurrency["competing_history_count"] == 1
            and concurrency["competing_audit_count"] == 1
            and concurrency["accepted_history_count"]
            + concurrency["declined_history_count"]
            == 1
            and concurrency["accepted_audit_count"]
            + concurrency["declined_audit_count"]
            == 1
            and concurrency["winning_idempotency_key"]
            in {
                args.offer_concurrency_accepted_key,
                args.offer_concurrency_declined_key,
            }
        )
    manifests = [
        manifest_evidence(args.workflow_a_uuid),
        manifest_evidence(args.workflow_b_uuid),
    ]
    migrations_output = command(
        ["npx", "wrangler", "d1", "migrations", "list", "DB", "--remote"]
    )
    git_status = command(["git", "status", "--short"])
    commit = command(["git", "rev-parse", "HEAD"])
    deployments = worker_deployments()
    configuration_release_keys = {
        row["configuration_release_key"] for row in configuration
    }
    localization = {
        row["configuration_key"]: json.loads(row["configuration_value_json"])
        for row in configuration
        if row["configuration_scope"] == "localization"
    }

    checks = {
        "foreign_keys": not foreign_key_violations,
        "migrations_current": "No migrations to apply" in migrations_output,
        "git_worktree_clean": git_status == "",
        "active_configuration_v3": configuration_release_keys
        == {"hirebeat-system-configuration-v3"}
        and localization
        == {
            "business_timezone": "America/New_York",
            "storage_timezone": "UTC",
        },
        "catalog_revision_present": len(catalog) == 1,
        "worker_deployments_recorded": set(deployments) == set(WORKER_CONFIGS)
        and all(bool(value) for value in deployments.values()),
        "synthetic_enrichment_case": case_passed,
        "workflow_pair": workflow_passed,
        "inspection_manifests": all(item["passed"] for item in manifests),
        "offer_status_concurrency_fence": concurrency_passed,
    }
    report = {
        "schema_version": "hirebeat-staging-closeout-report-v2",
        "generated_at_utc": generated_at,
        "git_commit": commit,
        "checks": checks,
        "core_synthetic_path_passed": all(checks.values()),
        "active_configuration": configuration,
        "latest_catalog_revision": catalog,
        "worker_deployments": deployments,
        "workflow_evidence": workflows,
        "synthetic_case_evidence": synthetic_case,
        "offer_status_concurrency_evidence": offer_concurrency,
        "inspection_manifest_evidence": manifests,
        "remaining_release_gates": [
            "Retain the successful GitHub Actions run for this exact commit.",
            "Complete any still-unexecuted fault-injection and intake/workflow concurrency cases listed in acceptance-plan sections 2, 3A, and 5.",
            "Complete provider-native Airtable/Form configuration when those submission windows enter scope.",
            "Create separate production resources and obtain GitHub Environment approval before production deployment.",
        ],
    }

    date = dt.datetime.now(BUSINESS_ZONE).date().isoformat()
    output = ROOT / "test-exports" / "staging" / date / "closeout"
    output.mkdir(parents=True, exist_ok=True)
    path = output / "staging_closeout_report.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(path)
    if not report["core_synthetic_path_passed"]:
        failed = [name for name, passed in checks.items() if not passed]
        raise SystemExit("closeout_checks_failed:" + ",".join(failed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
