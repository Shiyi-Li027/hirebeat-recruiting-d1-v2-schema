import type {
  OrchestratorEnv,
  WorkflowAParams,
  WorkflowBParams,
} from "./env";

interface OutboxRow {
  id: number;
  event_uuid: string;
  event_type: string;
  aggregate_id: number;
  destination_key: string | null;
  event_payload_json: string;
  delivery_attempt_count: number;
  max_delivery_attempts: number;
}

function nextAttemptAt(attempt: number): string {
  const seconds = Math.min(900, 2 ** Math.min(attempt, 9));
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_dispatch_error";
}

export async function createOrConfirmWorkflow<PARAMS>(
  workflow: Workflow<PARAMS>,
  instanceId: string,
  params: PARAMS,
): Promise<void> {
  try {
    await workflow.create({ id: instanceId, params });
    return;
  } catch (createError) {
    // The Workflow API rejects a duplicate caller-supplied instance ID. That
    // can happen when create() succeeded but the Outbox `published` update was
    // interrupted. Confirming the existing instance makes the at-least-once
    // Outbox consumer idempotent without starting a second Workflow.
    try {
      const existing = await workflow.get(instanceId);
      const status = await existing.status();
      if (status.status !== "unknown") return;
    } catch {
      // Preserve the original create failure; the dispatcher will retry it.
    }
    throw createError;
  }
}

export class OutboxDispatcher {
  constructor(private readonly env: OrchestratorEnv) {}

  private async claim(owner: string, now: string): Promise<OutboxRow | null> {
    const leaseExpiry = new Date(Date.parse(now) + 60_000).toISOString();
    return this.env.DB.prepare(
      `UPDATE outbox_event
       SET dispatch_status = 'dispatching',
           delivery_attempt_count = delivery_attempt_count + 1,
           lease_owner = ?1,
           lease_expires_at = ?2,
           updated_at = ?3
       WHERE id = (
         SELECT id FROM outbox_event
         WHERE (
           dispatch_status IN ('pending', 'failed_retryable')
           AND available_at <= ?3
           AND COALESCE(next_attempt_at, available_at) <= ?3
         ) OR (
           dispatch_status = 'dispatching'
           AND lease_expires_at <= ?3
         )
         ORDER BY available_at, id
         LIMIT 1
       )
       AND delivery_attempt_count < max_delivery_attempts
       RETURNING id, event_uuid, event_type, aggregate_id, destination_key,
                 event_payload_json, delivery_attempt_count,
                 max_delivery_attempts`,
    )
      .bind(owner, leaseExpiry, now)
      .first<OutboxRow>();
  }

  private async publish(row: OutboxRow): Promise<void> {
    const payload = JSON.parse(row.event_payload_json) as Record<string, unknown>;
    if (
      row.event_type === "raw_submission.published" &&
      row.destination_key === "workflow_a"
    ) {
      const configuration = await this.env.DB.prepare(
        `SELECT configuration_release_id
         FROM raw_submission_intake_run AS intake
         JOIN raw_submission AS raw
           ON raw.raw_submission_intake_run_id = intake.id
         WHERE raw.id = ?1`,
      )
        .bind(row.aggregate_id)
        .first<{ configuration_release_id: number }>();
      if (!configuration) throw new Error("raw_submission_configuration_missing");
      const params: WorkflowAParams = {
        outboxEventId: row.id,
        rawSubmissionId: row.aggregate_id,
        configurationReleaseId: configuration.configuration_release_id,
      };
      await createOrConfirmWorkflow(this.env.WORKFLOW_A, row.event_uuid, params);
      return;
    }
    if (
      (row.event_type === "application.core_published" || row.event_type === "application.ml_requested" ||
       row.event_type === "application.position_jd_ready") &&
      row.destination_key === "workflow_b"
    ) {
      const applicationId = Number(payload.applicationId);
      const candidateSnapshotId = Number(payload.candidateSnapshotId);
      const configurationReleaseId = Number(payload.configurationReleaseId);
      const decisionFenceToken = String(payload.decisionFenceToken ?? "");
      if (
        !Number.isSafeInteger(applicationId) ||
        !Number.isSafeInteger(candidateSnapshotId) ||
        !Number.isSafeInteger(configurationReleaseId) ||
        decisionFenceToken.length === 0
      ) throw new Error("workflow_b_event_payload_invalid");
      const params: WorkflowBParams = {
        outboxEventId: row.id,
        applicationId,
        candidateSnapshotId,
        configurationReleaseId,
        decisionFenceToken,
      };
      await createOrConfirmWorkflow(this.env.WORKFLOW_B, row.event_uuid, params);
      return;
    }
    if (
      row.event_type === "offer.draft_created" &&
      row.destination_key === "offer_lifecycle"
    ) {
      // The draft is already durable in D1. This event is the stable extension
      // point for future document generation, approval, email, or e-signature.
      // Release 1 intentionally acknowledges it without an external side effect.
      return;
    }
    throw new Error(`unsupported_outbox_destination:${row.event_type}`);
  }

  async dispatchAvailable(maximumEvents = 25): Promise<number> {
    const owner = crypto.randomUUID();
    let dispatched = 0;
    for (let index = 0; index < maximumEvents; index += 1) {
      const row = await this.claim(owner, new Date().toISOString());
      if (!row) break;
      try {
        await this.publish(row);
        const now = new Date().toISOString();
        await this.env.DB.prepare(
          `UPDATE outbox_event
           SET dispatch_status = 'published', published_at = ?3,
               lease_owner = NULL, lease_expires_at = NULL,
               last_error_code = NULL, last_error_detail = NULL,
               updated_at = ?3
           WHERE id = ?1 AND lease_owner = ?2 AND dispatch_status = 'dispatching'`,
        )
          .bind(row.id, owner, now)
          .run();
        dispatched += 1;
      } catch (error) {
        const exhausted = row.delivery_attempt_count >= row.max_delivery_attempts;
        const now = new Date().toISOString();
        await this.env.DB.prepare(
          `UPDATE outbox_event
           SET dispatch_status = ?3,
               next_attempt_at = ?4,
               lease_owner = NULL,
               lease_expires_at = NULL,
               last_error_code = ?5,
               last_error_detail = ?6,
               updated_at = ?7
           WHERE id = ?1 AND lease_owner = ?2 AND dispatch_status = 'dispatching'`,
        )
          .bind(
            row.id,
            owner,
            exhausted ? "failed_terminal" : "failed_retryable",
            exhausted ? null : nextAttemptAt(row.delivery_attempt_count),
            safeErrorCode(error),
            "Outbox destination did not accept the event.",
            now,
          )
          .run();
      }
    }
    return dispatched;
  }
}
