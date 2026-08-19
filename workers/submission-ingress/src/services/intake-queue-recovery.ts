import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import type { IntakeQueueMessage } from "../contracts/intake-queue-message";
import { isIntakeQueueMessage } from "../contracts/intake-queue-message";
import { IngressError } from "../errors/ingress-error";
import type { ProductionIntakeService } from "./production-intake-service";
import type { IntakeReplayEnvelopeStore } from "./intake-replay-envelope-store";
import type { PayloadHmacService } from "./payload-hmac";

export type IntakeFailureDisposition =
  | "retryable"
  | "terminal"
  | "stale_noop";

export function classifyIntakeFailure(error: unknown): IntakeFailureDisposition {
  if (!(error instanceof IngressError)) return "retryable";
  if (error.kind === "retryable") return "retryable";
  if (
    error.kind === "conflict" &&
    error.safeCode === "intake_attempt_fence_lost"
  ) {
    return "stale_noop";
  }
  return "terminal";
}

export function queueBackoffSeconds(attempts: number): number {
  const base = Math.min(30 * 2 ** Math.max(0, attempts - 1), 900);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.round(base * jitter));
}

function asQueueRetry(
  request: CanonicalIntakeRequest,
  attempts: number,
  deliveryKind: "initial" | "controlled_recovery",
): CanonicalIntakeRequest {
  if (attempts <= 1 && deliveryKind === "initial") return request;
  return {
    ...request,
    technicalDelivery: {
      mechanism:
        attempts <= 1 ? "worker_restart_recovery" : "queue_retry",
      causeCode:
        attempts <= 1
          ? "operator_approved_controlled_recovery"
          : "cloudflare_queue_redelivery",
      deliveredAt: new Date().toISOString(),
    },
  };
}

interface IntakeRecoveryFenceState {
  recovery_fence_token: string | null;
  accepted_payload_hmac: string | null;
  intake_status: string;
}

export function queueMessageOwnsCurrentRecoveryFence(
  message: IntakeQueueMessage,
  row: IntakeRecoveryFenceState | null,
): boolean {
  if (message.deliveryKind !== "controlled_recovery") {
    if (row === null || row.recovery_fence_token === null) return true;
    return (
      row.intake_status === "succeeded" ||
      row.intake_status === "failed_terminal" ||
      row.intake_status === "cancelled"
    );
  }
  if (row === null) return false;
  return (
    row.recovery_fence_token === message.recoveryFenceToken &&
    row.accepted_payload_hmac === message.acceptedPayloadHmac
  );
}

async function ownsCurrentRecoveryFence(
  db: D1Database,
  message: IntakeQueueMessage,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT recovery_fence_token, accepted_payload_hmac, intake_status
     FROM raw_submission_intake_run
     WHERE submission_uuid = ?1`,
  ).bind(message.submissionUuid).first<IntakeRecoveryFenceState>();
  return queueMessageOwnsCurrentRecoveryFence(message, row);
}

export async function processIntakeQueueMessage(options: {
  message: Message<unknown>;
  store: IntakeReplayEnvelopeStore;
  hmac: PayloadHmacService;
  intake: ProductionIntakeService;
  db: D1Database;
}): Promise<void> {
  const body = options.message.body;
  if (!isIntakeQueueMessage(body)) {
    options.message.ack();
    return;
  }

  try {
    if (!(await ownsCurrentRecoveryFence(options.db, body))) {
      options.message.ack();
      return;
    }
    const request = await options.store.get(body.replayEnvelopeKey);
    if (request.source.submissionUuid !== body.submissionUuid) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "replay_envelope_submission_mismatch",
        message: "The replay envelope does not match the queued Submission.",
        httpStatus: 400,
      });
    }
    const hmac = await options.hmac.calculate(request);
    if (hmac.hmacHex !== body.acceptedPayloadHmac) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "replay_envelope_hmac_mismatch",
        message: "The replay envelope failed its integrity check.",
        httpStatus: 400,
      });
    }

    const receipt = await options.intake.receive(
      asQueueRetry(
        request,
        options.message.attempts,
        body.deliveryKind ?? "initial",
      ),
    );
    if (receipt.outcome === "existing_in_progress") {
      options.message.retry({ delaySeconds: 60 });
      return;
    }
    options.message.ack();
  } catch (error) {
    const disposition = classifyIntakeFailure(error);
    if (disposition === "retryable") {
      options.message.retry({
        delaySeconds: queueBackoffSeconds(options.message.attempts),
      });
      return;
    }
    options.message.ack();
  }
}

export function makeIntakeQueueMessage(options: {
  request: CanonicalIntakeRequest;
  acceptedPayloadHmac: string;
  replayEnvelopeKey: string;
  requestId: string;
  recoveryFenceToken?: string | null;
  deliveryKind?: "initial" | "controlled_recovery";
}): IntakeQueueMessage {
  return {
    schemaVersion: "intake-queue-message-v2",
    submissionUuid: options.request.source.submissionUuid,
    acceptedPayloadHmac: options.acceptedPayloadHmac,
    replayEnvelopeKey: options.replayEnvelopeKey,
    requestId: options.requestId,
    enqueuedAt: new Date().toISOString(),
    recoveryFenceToken: options.recoveryFenceToken ?? null,
    deliveryKind: options.deliveryKind ?? "initial",
  };
}

export async function finalizeDeadLetterBatch(
  db:D1Database,
  batch:MessageBatch<unknown>,
):Promise<void>{
  const now=new Date().toISOString();
  await Promise.all(batch.messages.map(async(message)=>{
    if(!isIntakeQueueMessage(message.body)){message.ack();return;}
    await db.prepare(
      `UPDATE raw_submission_intake_run
       SET intake_status='failed_terminal',
           last_error_code='intake_queue_attempts_exhausted',
           last_error_detail='Automatic Queue delivery exhausted the configured total-attempt limit.',
           completed_at=?2,updated_at=?2
       WHERE submission_uuid=?1
         AND intake_status='failed_retryable'
         AND accepted_payload_hmac=?3
         AND recovery_fence_token IS ?4`,
    ).bind(
      message.body.submissionUuid,
      now,
      message.body.acceptedPayloadHmac,
      message.body.recoveryFenceToken ?? null,
    ).run();
    message.ack();
  }));
}
