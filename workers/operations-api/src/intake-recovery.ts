import { commandKey } from "./helpers";

interface ExhaustedIntakeRow {
  id: number;
  submission_uuid: string;
  accepted_payload_hmac: string | null;
  intake_status: string;
  last_error_code: string | null;
  configuration_release_id: number | null;
  raw_submission_id: number | null;
  max_delivery_attempts: number | null;
}

const COMMAND_EVENT_TYPE = "command.intake.recovery.request";

async function priorCommand(
  db: D1Database,
  key: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(
    `SELECT event_metadata_json
     FROM audit_event
     WHERE event_type = ?1 AND correlation_key = ?2`,
  ).bind(COMMAND_EVENT_TYPE, key).first<{ event_metadata_json: string | null }>();
  return row?.event_metadata_json
    ? JSON.parse(row.event_metadata_json) as Record<string, unknown>
    : null;
}

export function isRecoverableTechnicalExhaustion(
  code: string | null,
): boolean {
  return Boolean(
    code?.startsWith("retry_exhausted:") ||
      code === "intake_queue_attempts_exhausted",
  );
}

export async function requestIntakeRecovery(
  db: D1Database,
  intakeRunId: number,
  body: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  const key = commandKey(body);
  const prior = await priorCommand(db, key);
  if (prior) return { ...prior, idempotent_reuse: true };

  const reason = String(body.recovery_reason ?? "").trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new Error("recovery_reason_invalid");
  }

  const row = await db.prepare(
    `SELECT intake.id,
            intake.submission_uuid,
            intake.accepted_payload_hmac,
            intake.intake_status,
            intake.last_error_code,
            intake.configuration_release_id,
            raw.id AS raw_submission_id,
            CAST(config.configuration_value_json AS INTEGER) AS max_delivery_attempts
     FROM raw_submission_intake_run AS intake
     LEFT JOIN raw_submission AS raw
       ON raw.raw_submission_intake_run_id = intake.id
     LEFT JOIN system_configuration AS config
       ON config.configuration_release_id = intake.configuration_release_id
      AND config.configuration_scope = 'outbox'
      AND config.configuration_key = 'max_delivery_attempts'
     WHERE intake.id = ?1`,
  ).bind(intakeRunId).first<ExhaustedIntakeRow>();
  if (!row) throw new Error("intake_run_not_found");
  if (row.raw_submission_id !== null) {
    throw new Error("intake_recovery_forbidden_after_raw_publish");
  }
  if (row.intake_status !== "failed_terminal") {
    throw new Error("intake_run_not_terminal");
  }
  if (!isRecoverableTechnicalExhaustion(row.last_error_code)) {
    throw new Error("intake_failure_not_recoverable_technical_exhaustion");
  }
  if (!row.accepted_payload_hmac || !/^[a-f0-9]{64}$/.test(row.accepted_payload_hmac)) {
    throw new Error("intake_accepted_payload_hmac_missing");
  }
  if (!row.configuration_release_id) {
    throw new Error("intake_configuration_release_missing");
  }
  if (!row.max_delivery_attempts || row.max_delivery_attempts <= 0) {
    throw new Error("intake_outbox_attempt_policy_missing");
  }

  const now = new Date().toISOString();
  const recoveryFenceToken = crypto.randomUUID();
  const eventUuid = crypto.randomUUID();
  const replayEnvelopeKey =
    `intake-replay-envelopes/v1/${row.submission_uuid}/${row.accepted_payload_hmac}.json`;
  const deduplicationKey = `intake_recovery:${intakeRunId}:${key}`;
  const payload = {
    schemaVersion: "intake-controlled-recovery-v1",
    submissionUuid: row.submission_uuid,
    acceptedPayloadHmac: row.accepted_payload_hmac,
    replayEnvelopeKey,
    recoveryFenceToken,
    requestId: eventUuid,
  };
  const result = {
    intake_run_id: intakeRunId,
    submission_uuid: row.submission_uuid,
    status: "recovery_queued",
    outbox_event_uuid: eventUuid,
  };

  const statements = await db.batch([
    db.prepare(
      `UPDATE raw_submission_intake_run
       SET intake_status = 'failed_retryable',
           attempt_count = 0,
           recovery_fence_token = ?2,
           last_error_code = NULL,
           last_error_detail = NULL,
           last_attempt_started_at = NULL,
           completed_at = NULL,
           updated_at = ?3
       WHERE id = ?1
         AND intake_status = 'failed_terminal'
         AND NOT EXISTS (
           SELECT 1 FROM raw_submission
           WHERE raw_submission_intake_run_id = ?1
         )`,
    ).bind(intakeRunId, recoveryFenceToken, now),
    db.prepare(
      `INSERT INTO outbox_event (
         event_uuid, deduplication_key, event_type, event_schema_version,
         aggregate_type, aggregate_id, destination_type, destination_key,
         event_payload_json, dispatch_status, delivery_attempt_count,
         max_delivery_attempts, available_at, created_at, updated_at
       )
       SELECT ?1, ?2, 'raw_submission.intake_recovery_requested',
              'intake-controlled-recovery-v1',
              'raw_submission_intake_run', id,
              'cloudflare_queue', 'submission_intake',
              ?3, 'pending', 0, ?4, ?5, ?5, ?5
       FROM raw_submission_intake_run
       WHERE id = ?6
         AND intake_status = 'failed_retryable'
         AND recovery_fence_token = ?7`,
    ).bind(
      eventUuid,
      deduplicationKey,
      JSON.stringify(payload),
      row.max_delivery_attempts,
      now,
      intakeRunId,
      recoveryFenceToken,
    ),
    db.prepare(
      `INSERT INTO audit_event (
         event_uuid, event_type, entity_type, entity_id, actor_type, actor_id,
         correlation_key, reason_code, event_summary, event_metadata_json,
         occurred_at, recorded_at
       )
       SELECT ?1, ?2, 'raw_submission_intake_run', id, 'member', ?3,
              ?4, 'approved_technical_recovery',
              'A controlled replay of an exhausted Intake run was requested.',
              ?5, ?6, ?6
       FROM raw_submission_intake_run
       WHERE id = ?7
         AND intake_status = 'failed_retryable'
         AND recovery_fence_token = ?8`,
    ).bind(
      crypto.randomUUID(),
      COMMAND_EVENT_TYPE,
      actor,
      key,
      JSON.stringify({ ...result, recovery_reason: reason }),
      now,
      intakeRunId,
      recoveryFenceToken,
    ),
  ]);

  if (
    Number(statements[0].meta.changes) !== 1 ||
    Number(statements[1].meta.changes) !== 1 ||
    Number(statements[2].meta.changes) !== 1
  ) {
    throw new Error("intake_recovery_concurrent_state_change");
  }
  return result;
}
