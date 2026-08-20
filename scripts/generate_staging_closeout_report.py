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
FAULT_SOURCE_RECORD_IDS = {
    "source_download": "staging-google-fault-source-download-retry-once-001",
    "parser_429": "staging-google-fault-parser-429-retry-once-001",
    "parser_timeout": "staging-google-fault-parser-timeout-retry-once-001",
    "parser_empty": "staging-google-fault-parser-empty-terminal-001",
}
ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS = {
    "outbox_retry": (
        "staging-google-fault-outbox-workflow-create-retry-once-001"
    ),
    "outbox_post_create_ack": (
        "staging-google-fault-outbox-post-create-ack-retry-once-001"
    ),
    "outbox_invalid_json": (
        "staging-google-fault-outbox-invalid-json-terminal-001"
    ),
    "outbox_invalid_destination": (
        "staging-google-fault-outbox-invalid-destination-terminal-001"
    ),
    "workflow_transient": (
        "staging-google-fault-workflow-a-transient-retry-once-001"
    ),
    "workflow_terminal": (
        "staging-google-fault-workflow-a-terminal-contract-001"
    ),
}
PROVIDER_BRIDGE_FILES = (
    "provider-integrations/google-form/Code.js",
    "provider-integrations/google-form/appsscript.json",
    "provider-integrations/airtable/submission-automation.js",
    "provider-integrations/airtable/catalog-sync-automation.js",
    "20_provider_native_submission_windows.md",
)


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
    parser.add_argument(
        "--intake-concurrency-source-record-id",
        default="staging-google-intake-concurrency-001",
    )
    parser.add_argument(
        "--malformed-envelope-source-record-id",
        default="staging-google-malformed-envelope-001",
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
    intake_concurrency_source = quote(
        args.intake_concurrency_source_record_id
    )
    malformed_envelope_source = quote(
        args.malformed_envelope_source_record_id
    )
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
    intake_concurrency = execute(
        f"""SELECT
          intake.id AS intake_run_id,
          intake.submission_uuid,
          intake.intake_status,
          intake.attempt_count,
          intake.technical_redelivery_count,
          intake.last_technical_redelivery_mechanism,
          intake.last_technical_redelivery_cause_code,
          intake.last_error_code,
          (SELECT COUNT(*) FROM raw_submission AS raw
            WHERE raw.raw_submission_intake_run_id=intake.id)
            AS raw_submission_count,
          (SELECT COUNT(*) FROM raw_submission_resume AS resume
            WHERE resume.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS resume_count,
          (SELECT COUNT(DISTINCT resume.resume_r2_object_key)
             FROM raw_submission_resume AS resume
            WHERE resume.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS distinct_resume_r2_key_count,
          (SELECT COUNT(*) FROM outbox_event AS outbox
            WHERE outbox.aggregate_type='raw_submission'
              AND outbox.event_type='raw_submission.published'
              AND outbox.aggregate_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS raw_published_outbox_count,
          (SELECT COUNT(*) FROM outbox_event AS outbox
            WHERE outbox.aggregate_type='raw_submission'
              AND outbox.event_type='raw_submission.published'
              AND outbox.dispatch_status='published'
              AND outbox.aggregate_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS published_raw_outbox_count,
          (SELECT COUNT(*) FROM etl_workflow_run AS workflow
            WHERE workflow.workflow_type='workflow_a'
              AND workflow.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS workflow_a_count,
          (SELECT COUNT(*) FROM etl_workflow_run AS workflow
            WHERE workflow.workflow_type='workflow_a'
              AND workflow.workflow_status='succeeded'
              AND workflow.run_attempt_count=1
              AND workflow.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS succeeded_single_attempt_workflow_a_count,
          (SELECT COUNT(*) FROM submission_normalized AS normalized
            WHERE normalized.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS normalized_count,
          (SELECT COUNT(*) FROM resume_extraction AS extraction
            WHERE extraction.submission_normalized_id IN (
              SELECT normalized.id FROM submission_normalized AS normalized
              WHERE normalized.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id)))
            AS resume_extraction_count,
          (SELECT COUNT(*) FROM submission_dedup_run AS dedup
            WHERE dedup.target_submission_normalized_id IN (
              SELECT normalized.id FROM submission_normalized AS normalized
              WHERE normalized.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id)))
            AS dedup_run_count,
          (SELECT COUNT(*) FROM application_source_lineage AS lineage
            WHERE lineage.source_raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS application_lineage_count
        FROM raw_submission_intake_run AS intake
        WHERE intake.source_system='google_form'
          AND intake.source_record_id={intake_concurrency_source};""",
        True,
    )
    malformed_envelope = execute(
        f"""WITH target_intake AS (
          SELECT id FROM raw_submission_intake_run
           WHERE source_system='google_form'
             AND source_record_id={malformed_envelope_source}
        ), target_raw AS (
          SELECT id FROM raw_submission
           WHERE raw_submission_intake_run_id IN (
             SELECT id FROM target_intake)
        )
        SELECT
          (SELECT COUNT(*) FROM target_intake) AS intake_run_count,
          (SELECT COUNT(*) FROM target_raw) AS raw_submission_count,
          (SELECT COUNT(*) FROM raw_submission_resume
            WHERE raw_submission_id IN (SELECT id FROM target_raw))
            AS resume_count,
          (SELECT COUNT(*) FROM outbox_event
            WHERE aggregate_type='raw_submission'
              AND aggregate_id IN (SELECT id FROM target_raw))
            AS outbox_event_count,
          (SELECT COUNT(*) FROM etl_workflow_run
            WHERE raw_submission_id IN (SELECT id FROM target_raw))
            AS workflow_run_count;""",
        True,
    )
    fault_sources = ",".join(
        quote(value) for value in FAULT_SOURCE_RECORD_IDS.values()
    )
    source_parser_faults = execute(
        f"""SELECT
          intake.source_record_id,
          intake.submission_uuid,
          intake.intake_status,
          intake.attempt_count,
          intake.technical_redelivery_count,
          intake.last_technical_redelivery_mechanism,
          intake.last_technical_redelivery_cause_code,
          intake.last_error_code,
          (SELECT COUNT(*) FROM raw_submission AS raw
            WHERE raw.raw_submission_intake_run_id=intake.id)
            AS raw_submission_count,
          (SELECT COUNT(*) FROM raw_submission_resume AS resume
            WHERE resume.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS resume_count,
          (SELECT COUNT(DISTINCT resume.resume_r2_object_key)
             FROM raw_submission_resume AS resume
            WHERE resume.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS distinct_resume_r2_key_count,
          (SELECT resume.resume_text_status
             FROM raw_submission_resume AS resume
            WHERE resume.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id)
            LIMIT 1) AS resume_text_status,
          (SELECT COUNT(*) FROM outbox_event AS outbox
            WHERE outbox.aggregate_type='raw_submission'
              AND outbox.event_type='raw_submission.published'
              AND outbox.aggregate_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS raw_published_outbox_count,
          (SELECT COUNT(*) FROM etl_workflow_run AS workflow
            WHERE workflow.workflow_type='workflow_a'
              AND workflow.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id))
            AS workflow_a_count,
          (SELECT workflow.workflow_status
             FROM etl_workflow_run AS workflow
            WHERE workflow.workflow_type='workflow_a'
              AND workflow.raw_submission_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id)
            ORDER BY workflow.id DESC LIMIT 1) AS workflow_a_status,
          (SELECT audit.reason_code FROM audit_event AS audit
            WHERE audit.entity_type='raw_submission'
              AND audit.event_type='submission.initial_cleaning_blocked'
              AND audit.entity_id IN (
                SELECT raw.id FROM raw_submission AS raw
                WHERE raw.raw_submission_intake_run_id=intake.id)
            ORDER BY audit.id DESC LIMIT 1) AS initial_cleaning_reason,
          (SELECT COUNT(*) FROM submission_normalized AS normalized
            WHERE normalized.raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS normalized_count,
          (SELECT COUNT(*) FROM application_source_lineage AS lineage
            WHERE lineage.source_raw_submission_id IN (
              SELECT raw.id FROM raw_submission AS raw
              WHERE raw.raw_submission_intake_run_id=intake.id))
            AS application_lineage_count
        FROM raw_submission_intake_run AS intake
        WHERE intake.source_system='google_form'
          AND intake.source_record_id IN ({fault_sources})
        ORDER BY intake.source_record_id;""",
        True,
    )
    outbox_retry_source = quote(
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_retry"]
    )
    outbox_workflow_retry = execute(
        f"""SELECT
          intake.source_record_id,
          intake.submission_uuid,
          outbox.id AS outbox_event_id,
          outbox.event_uuid,
          outbox.dispatch_status,
          outbox.delivery_attempt_count,
          outbox.max_delivery_attempts,
          outbox.next_attempt_at,
          outbox.lease_owner,
          outbox.lease_expires_at,
          outbox.last_error_code,
          outbox.published_at,
          (SELECT COUNT(*) FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a')
            AS workflow_a_count,
          (SELECT workflow.workflow_status
             FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a'
            ORDER BY workflow.id DESC LIMIT 1) AS workflow_a_status,
          (SELECT workflow.run_attempt_count
             FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a'
            ORDER BY workflow.id DESC LIMIT 1)
            AS workflow_a_run_attempt_count
        FROM raw_submission_intake_run AS intake
        JOIN raw_submission AS raw
          ON raw.raw_submission_intake_run_id=intake.id
        JOIN outbox_event AS outbox
          ON outbox.aggregate_type='raw_submission'
         AND outbox.aggregate_id=raw.id
         AND outbox.event_type='raw_submission.published'
        WHERE intake.source_system='google_form'
          AND intake.source_record_id={outbox_retry_source};""",
        True,
    )
    outbox_boundary_sources = ",".join(
        quote(ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS[key])
        for key in (
            "outbox_post_create_ack",
            "outbox_invalid_json",
            "outbox_invalid_destination",
        )
    )
    outbox_boundary_faults = execute(
        f"""SELECT
          intake.source_record_id,
          intake.submission_uuid,
          outbox.id AS outbox_event_id,
          outbox.event_uuid,
          outbox.event_type,
          outbox.destination_key AS stored_destination_key,
          outbox.dispatch_status,
          outbox.delivery_attempt_count,
          outbox.max_delivery_attempts,
          outbox.next_attempt_at,
          outbox.lease_owner,
          outbox.lease_expires_at,
          outbox.last_error_code,
          outbox.last_error_detail,
          outbox.published_at,
          json_valid(outbox.event_payload_json) AS stored_payload_json_valid,
          (SELECT COUNT(*) FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a')
            AS workflow_a_count,
          (SELECT workflow.workflow_status
             FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a'
            ORDER BY workflow.id DESC LIMIT 1) AS workflow_a_status,
          (SELECT workflow.run_attempt_count
             FROM etl_workflow_run AS workflow
            WHERE workflow.trigger_outbox_event_id=outbox.id
              AND workflow.workflow_type='workflow_a'
            ORDER BY workflow.id DESC LIMIT 1)
            AS workflow_a_run_attempt_count,
          (SELECT COUNT(*) FROM submission_normalized AS normalized
            WHERE normalized.raw_submission_id=raw.id) AS normalized_count
        FROM raw_submission_intake_run AS intake
        JOIN raw_submission AS raw
          ON raw.raw_submission_intake_run_id=intake.id
        JOIN outbox_event AS outbox
          ON outbox.aggregate_type='raw_submission'
         AND outbox.aggregate_id=raw.id
         AND outbox.event_type='raw_submission.published'
        WHERE intake.source_system='google_form'
          AND intake.source_record_id IN ({outbox_boundary_sources})
        ORDER BY intake.source_record_id;""",
        True,
    )
    workflow_fault_sources = ",".join(
        quote(ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS[key])
        for key in ("workflow_transient", "workflow_terminal")
    )
    workflow_step_faults = execute(
        f"""SELECT
          intake.source_record_id,
          intake.submission_uuid,
          workflow.id AS workflow_run_id,
          workflow.workflow_run_uuid,
          workflow.workflow_status,
          workflow.run_attempt_count,
          workflow.last_error_code AS workflow_last_error_code,
          workflow.completed_at AS workflow_completed_at,
          step.id AS step_run_id,
          step.step_status,
          step.attempt_count AS step_attempt_count,
          step.max_attempts AS step_max_attempts,
          step.last_error_code AS step_last_error_code,
          (SELECT COUNT(*) FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id) AS total_step_attempt_count,
          (SELECT COUNT(*) FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id
              AND attempt.attempt_status='failed_retryable')
            AS failed_retryable_attempt_count,
          (SELECT COUNT(*) FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id
              AND attempt.attempt_status='failed_terminal')
            AS failed_terminal_attempt_count,
          (SELECT COUNT(*) FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id
              AND attempt.attempt_status='succeeded')
            AS succeeded_attempt_count,
          (SELECT attempt.error_class FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id
            ORDER BY attempt.attempt_number LIMIT 1)
            AS first_attempt_error_class,
          (SELECT attempt.error_code FROM etl_step_attempt AS attempt
            WHERE attempt.step_run_id=step.id
            ORDER BY attempt.attempt_number LIMIT 1)
            AS first_attempt_error_code,
          (SELECT COUNT(*) FROM submission_normalized AS normalized
            WHERE normalized.raw_submission_id=raw.id) AS normalized_count,
          (SELECT COUNT(*) FROM application_source_lineage AS lineage
            WHERE lineage.source_raw_submission_id=raw.id)
            AS application_lineage_count
        FROM raw_submission_intake_run AS intake
        JOIN raw_submission AS raw
          ON raw.raw_submission_intake_run_id=intake.id
        JOIN etl_workflow_run AS workflow
          ON workflow.raw_submission_id=raw.id
         AND workflow.workflow_type='workflow_a'
        JOIN etl_step_run AS step
          ON step.workflow_run_id=workflow.id
         AND step.step_key='normalize_submission'
        WHERE intake.source_system='google_form'
          AND intake.source_record_id IN ({workflow_fault_sources})
        ORDER BY intake.source_record_id;""",
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
    intake_concurrency_passed = len(intake_concurrency) == 1
    if intake_concurrency_passed:
        intake_fence = intake_concurrency[0]
        intake_concurrency_passed = (
            intake_fence["intake_status"] == "succeeded"
            and intake_fence["attempt_count"] == 1
            and intake_fence["technical_redelivery_count"] >= 1
            and intake_fence["last_error_code"] is None
            and intake_fence["raw_submission_count"] == 1
            and intake_fence["resume_count"] == 1
            and intake_fence["distinct_resume_r2_key_count"] == 1
            and intake_fence["raw_published_outbox_count"] == 1
            and intake_fence["published_raw_outbox_count"] == 1
            and intake_fence["workflow_a_count"] == 1
            and intake_fence["succeeded_single_attempt_workflow_a_count"] == 1
            and intake_fence["normalized_count"] == 1
            and intake_fence["resume_extraction_count"] == 1
            and intake_fence["dedup_run_count"] == 1
            and intake_fence["application_lineage_count"] <= 1
        )
    malformed_envelope_zero_write_passed = len(malformed_envelope) == 1
    if malformed_envelope_zero_write_passed:
        malformed_fence = malformed_envelope[0]
        malformed_envelope_zero_write_passed = all(
            malformed_fence[key] == 0
            for key in (
                "intake_run_count",
                "raw_submission_count",
                "resume_count",
                "outbox_event_count",
                "workflow_run_count",
            )
        )
    fault_rows = {
        row["source_record_id"]: row for row in source_parser_faults
    }
    source_parser_faults_passed = set(fault_rows) == set(
        FAULT_SOURCE_RECORD_IDS.values()
    )
    if source_parser_faults_passed:
        for key in ("source_download", "parser_429", "parser_timeout"):
            row = fault_rows[FAULT_SOURCE_RECORD_IDS[key]]
            source_parser_faults_passed = source_parser_faults_passed and (
                row["intake_status"] == "succeeded"
                and row["attempt_count"] == 2
                and row["technical_redelivery_count"] == 1
                and row["last_technical_redelivery_mechanism"] == "queue_retry"
                and row["last_technical_redelivery_cause_code"]
                == "cloudflare_queue_redelivery"
                and row["last_error_code"] is None
                and row["raw_submission_count"] == 1
                and row["resume_count"] == 1
                and row["distinct_resume_r2_key_count"] == 1
                and row["resume_text_status"] == "available"
                and row["raw_published_outbox_count"] == 1
            )
        empty = fault_rows[FAULT_SOURCE_RECORD_IDS["parser_empty"]]
        source_parser_faults_passed = source_parser_faults_passed and (
            empty["intake_status"] == "succeeded"
            and empty["attempt_count"] == 1
            and empty["technical_redelivery_count"] == 0
            and empty["last_error_code"] == "parser_empty_resume_text"
            and empty["raw_submission_count"] == 1
            and empty["resume_count"] == 1
            and empty["distinct_resume_r2_key_count"] == 1
            and empty["resume_text_status"] == "parse_failed_terminal"
            and empty["raw_published_outbox_count"] == 1
            and empty["workflow_a_count"] == 1
            and empty["workflow_a_status"] == "succeeded"
            and empty["initial_cleaning_reason"]
            == "resume_text_missing_or_too_short"
            and empty["normalized_count"] == 0
            and empty["application_lineage_count"] == 0
        )
    outbox_workflow_retry_passed = len(outbox_workflow_retry) == 1
    if outbox_workflow_retry_passed:
        outbox_retry = outbox_workflow_retry[0]
        outbox_workflow_retry_passed = (
            outbox_retry["dispatch_status"] == "published"
            and outbox_retry["delivery_attempt_count"] == 2
            and outbox_retry["lease_owner"] is None
            and outbox_retry["lease_expires_at"] is None
            and outbox_retry["last_error_code"] is None
            and bool(outbox_retry["published_at"])
            and outbox_retry["workflow_a_count"] == 1
            and outbox_retry["workflow_a_status"] == "succeeded"
            and outbox_retry["workflow_a_run_attempt_count"] == 1
        )
    outbox_boundary_rows = {
        row["source_record_id"]: row for row in outbox_boundary_faults
    }
    outbox_post_create_ack_passed = set(outbox_boundary_rows) == {
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_post_create_ack"],
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_invalid_json"],
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_invalid_destination"],
    }
    outbox_terminal_boundaries_passed = outbox_post_create_ack_passed
    if outbox_post_create_ack_passed:
        post_create = outbox_boundary_rows[
            ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_post_create_ack"]
        ]
        invalid_json = outbox_boundary_rows[
            ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["outbox_invalid_json"]
        ]
        invalid_destination = outbox_boundary_rows[
            ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS[
                "outbox_invalid_destination"
            ]
        ]
        outbox_post_create_ack_passed = (
            post_create["stored_destination_key"] == "workflow_a"
            and post_create["dispatch_status"] == "published"
            and post_create["delivery_attempt_count"] == 2
            and post_create["lease_owner"] is None
            and post_create["lease_expires_at"] is None
            and post_create["last_error_code"] is None
            and bool(post_create["published_at"])
            and post_create["stored_payload_json_valid"] == 1
            and post_create["workflow_a_count"] == 1
            and post_create["workflow_a_status"] == "succeeded"
            and post_create["workflow_a_run_attempt_count"] == 1
            and post_create["normalized_count"] == 1
        )
        terminal_common = all(
            row["stored_destination_key"] == "workflow_a"
            and row["dispatch_status"] == "failed_terminal"
            and row["delivery_attempt_count"] == 1
            and row["next_attempt_at"] is None
            and row["lease_owner"] is None
            and row["lease_expires_at"] is None
            and row["published_at"] is None
            and row["stored_payload_json_valid"] == 1
            and row["workflow_a_count"] == 0
            and row["normalized_count"] == 0
            for row in (invalid_json, invalid_destination)
        )
        outbox_terminal_boundaries_passed = (
            terminal_common
            and invalid_json["last_error_code"]
            == "outbox_payload_json_invalid"
            and invalid_destination["last_error_code"]
            == "unsupported_outbox_destination:raw_submission.published"
        )
    workflow_fault_rows = {
        row["source_record_id"]: row for row in workflow_step_faults
    }
    workflow_step_faults_passed = set(workflow_fault_rows) == {
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["workflow_transient"],
        ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["workflow_terminal"],
    }
    if workflow_step_faults_passed:
        transient = workflow_fault_rows[
            ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["workflow_transient"]
        ]
        terminal = workflow_fault_rows[
            ORCHESTRATOR_FAULT_SOURCE_RECORD_IDS["workflow_terminal"]
        ]
        workflow_step_faults_passed = (
            transient["workflow_status"] == "succeeded"
            and transient["run_attempt_count"] == 1
            and transient["workflow_last_error_code"] is None
            and transient["step_status"] == "succeeded"
            and transient["step_attempt_count"] == 2
            and transient["total_step_attempt_count"] == 2
            and transient["failed_retryable_attempt_count"] == 1
            and transient["failed_terminal_attempt_count"] == 0
            and transient["succeeded_attempt_count"] == 1
            and transient["first_attempt_error_class"] == "transient"
            and transient["first_attempt_error_code"]
            == "staging_fault_workflow_a_transient_service_error"
            and transient["normalized_count"] == 1
            and terminal["workflow_status"] == "failed_terminal"
            and terminal["run_attempt_count"] == 1
            and terminal["workflow_last_error_code"]
            == (
                "NonRetryableError: "
                "staging_fault_workflow_contract_configuration_missing"
            )
            and terminal["step_status"] == "failed_terminal"
            and terminal["step_attempt_count"] == 1
            and terminal["total_step_attempt_count"] == 1
            and terminal["failed_retryable_attempt_count"] == 0
            and terminal["failed_terminal_attempt_count"] == 1
            and terminal["succeeded_attempt_count"] == 0
            and terminal["first_attempt_error_class"] == "terminal"
            and terminal["first_attempt_error_code"]
            == "staging_fault_workflow_contract_configuration_missing"
            and terminal["normalized_count"] == 0
            and terminal["application_lineage_count"] == 0
        )
    google_form_provider_native = execute(
        """
        WITH target_intake AS (
          SELECT *
          FROM raw_submission_intake_run
          WHERE id = 29
            AND source_system = 'google_form'
        ),
        target_raw AS (
          SELECT id
          FROM raw_submission
          WHERE raw_submission_intake_run_id IN (
            SELECT id FROM target_intake
          )
        ),
        target_normalized AS (
          SELECT id
          FROM submission_normalized
          WHERE raw_submission_id IN (
            SELECT id FROM target_raw
          )
        )
        SELECT
          intake.id AS intake_run_id,
          intake.submission_uuid,
          intake.intake_status,
          intake.attempt_count,
          intake.technical_redelivery_count,
          intake.last_error_code AS intake_last_error_code,
          intake.completed_at AS intake_completed_at,

          (SELECT COUNT(*) FROM target_raw)
            AS raw_submission_count,

          (SELECT COUNT(*)
             FROM raw_submission_resume
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            ))
            AS resume_count,

          (SELECT resume_text_status
             FROM raw_submission_resume
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            )
            LIMIT 1)
            AS resume_text_status,

          (SELECT COUNT(*)
             FROM outbox_event
            WHERE aggregate_type = 'raw_submission'
              AND aggregate_id IN (
                SELECT id FROM target_raw
              )
              AND event_type = 'raw_submission.published')
            AS raw_published_outbox_count,

          (SELECT COUNT(*)
             FROM etl_workflow_run
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            )
              AND workflow_type = 'workflow_a')
            AS workflow_a_count,

          (SELECT workflow_status
             FROM etl_workflow_run
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            )
              AND workflow_type = 'workflow_a'
            ORDER BY id DESC
            LIMIT 1)
            AS workflow_a_status,

          (SELECT run_attempt_count
             FROM etl_workflow_run
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            )
              AND workflow_type = 'workflow_a'
            ORDER BY id DESC
            LIMIT 1)
            AS workflow_a_attempt_count,

          (SELECT last_error_code
             FROM etl_workflow_run
            WHERE raw_submission_id IN (
              SELECT id FROM target_raw
            )
              AND workflow_type = 'workflow_a'
            ORDER BY id DESC
            LIMIT 1)
            AS workflow_a_error,

          (SELECT COUNT(*) FROM target_normalized)
            AS normalized_count,

          (SELECT COUNT(*)
             FROM resume_extraction
            WHERE submission_normalized_id IN (
              SELECT id FROM target_normalized
            ))
            AS resume_extraction_count,

          (SELECT COUNT(*)
             FROM submission_dedup_run
            WHERE target_submission_normalized_id IN (
              SELECT id FROM target_normalized
            ))
            AS dedup_run_count,

          (SELECT COUNT(*)
             FROM application_source_lineage
            WHERE source_raw_submission_id IN (
              SELECT id FROM target_raw
            ))
            AS application_lineage_count,

          (SELECT id
             FROM application
            WHERE id = 10)
            AS application_id,

          (SELECT id
             FROM etl_workflow_run
            WHERE id = 37
              AND application_id = 10
              AND workflow_type = 'workflow_b')
            AS workflow_b_run_id,

          (SELECT workflow_run_uuid
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_uuid,

          (SELECT workflow_status
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_status,

          (SELECT current_step_key
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_current_step_key,

          (SELECT run_attempt_count
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_attempt_count,

          (SELECT last_error_code
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_error,

          (SELECT completed_at
             FROM etl_workflow_run
            WHERE id = 37)
            AS workflow_b_completed_at,

          (SELECT COUNT(*)
             FROM ml_analysis_run
            WHERE application_id = 10)
            AS ml_run_count,

          (SELECT COUNT(*)
             FROM ml_recommendation_result
            WHERE application_id = 10)
            AS recommendation_count,

          (SELECT COUNT(*)
             FROM offer
            WHERE application_id = 10)
            AS offer_count,

          (SELECT id
             FROM offer
            WHERE id = 5
              AND application_id = 10)
            AS offer_id,

          (SELECT current_status
             FROM offer
            WHERE id = 5)
            AS offer_status,

          (SELECT status_version
             FROM offer
            WHERE id = 5)
            AS offer_status_version,

          (SELECT current_offer_version_id
             FROM offer
            WHERE id = 5)
            AS current_offer_version_id,

          (SELECT created_at
             FROM offer
            WHERE id = 5)
            AS offer_created_at

        FROM target_intake AS intake;
        """
    )

    google_form_provider_native_passed = False
    if len(google_form_provider_native) == 1:
        evidence = google_form_provider_native[0]
        google_form_provider_native_passed = (
            evidence["intake_run_id"] == 29
            and evidence["submission_uuid"]
                == "667c2839-9f8e-528c-9e7e-4b0fcabc4def"
            and evidence["intake_status"] == "succeeded"
            and evidence["attempt_count"] == 1
            and evidence["technical_redelivery_count"] == 0
            and evidence["intake_last_error_code"] is None
            and bool(evidence["intake_completed_at"])
            and evidence["raw_submission_count"] == 1
            and evidence["resume_count"] == 1
            and evidence["resume_text_status"] == "available"
            and evidence["raw_published_outbox_count"] == 1
            and evidence["workflow_a_count"] == 1
            and evidence["workflow_a_status"] == "succeeded"
            and evidence["workflow_a_attempt_count"] == 1
            and evidence["workflow_a_error"] is None
            and evidence["normalized_count"] == 1
            and evidence["resume_extraction_count"] == 1
            and evidence["dedup_run_count"] == 1
            and evidence["application_lineage_count"] == 1
            and evidence["application_id"] == 10
            and evidence["workflow_b_run_id"] == 37
            and evidence["workflow_b_uuid"]
                == "c53d6b8b-9d77-4876-bb9b-596d5dbfd214"
            and evidence["workflow_b_status"] == "succeeded"
            and evidence["workflow_b_current_step_key"] is None
            and evidence["workflow_b_attempt_count"] == 1
            and evidence["workflow_b_error"] is None
            and bool(evidence["workflow_b_completed_at"])
            and evidence["ml_run_count"] == 1
            and evidence["recommendation_count"] == 1
            and evidence["offer_count"] == 1
            and evidence["offer_id"] == 5
            and evidence["offer_status"] == "draft"
            and evidence["offer_status_version"] == 1
            and evidence["current_offer_version_id"] is None
            and bool(evidence["offer_created_at"])
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
        "intake_concurrent_redelivery_fence": intake_concurrency_passed,
        "malformed_envelope_zero_write_fence": (
            malformed_envelope_zero_write_passed
        ),
        "source_parser_fault_injection": source_parser_faults_passed,
        "outbox_workflow_create_retry_fence": outbox_workflow_retry_passed,
        "outbox_post_create_ack_idempotency": outbox_post_create_ack_passed,
        "outbox_terminal_boundary_classification": (
            outbox_terminal_boundaries_passed
        ),
        "workflow_step_fault_classification": workflow_step_faults_passed,
        "google_form_provider_native_path": google_form_provider_native_passed,
        "provider_bridge_templates_present": all(
            (ROOT / relative_path).is_file()
            for relative_path in PROVIDER_BRIDGE_FILES
        ),
    }
    report = {
        "schema_version": "hirebeat-staging-closeout-report-v9",
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
        "intake_concurrency_evidence": intake_concurrency,
        "malformed_envelope_evidence": malformed_envelope,
        "source_parser_fault_evidence": source_parser_faults,
        "outbox_workflow_retry_evidence": outbox_workflow_retry,
        "outbox_boundary_fault_evidence": outbox_boundary_faults,
        "workflow_step_fault_evidence": workflow_step_faults,
        "google_form_provider_native_evidence": google_form_provider_native,
        "inspection_manifest_evidence": manifests,
        "deferred_scope": [
            "airtable_provider_native_submission_window",
        ],
        "remaining_release_gates": [
            "Retain the successful GitHub Actions run for this exact commit.",
            "Wire durable catalog_sync_run/catalog_sync_target_run result reporting before production provider enablement.",
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
