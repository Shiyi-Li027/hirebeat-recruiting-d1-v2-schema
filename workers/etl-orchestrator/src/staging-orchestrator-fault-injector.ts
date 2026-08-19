interface OutboxFaultTarget {
  eventType: string;
  destinationKey: string | null;
  aggregateId: number;
  deliveryAttemptCount: number;
}

type WorkflowAFault = "transient" | "terminal" | null;
type OutboxBoundaryFault = "invalid_json" | "invalid_destination" | null;

const OUTBOX_RETRY_SOURCE =
  "staging-google-fault-outbox-workflow-create-retry-once-001";
const OUTBOX_POST_CREATE_ACK_RETRY_SOURCE =
  "staging-google-fault-outbox-post-create-ack-retry-once-001";
const OUTBOX_INVALID_JSON_SOURCE =
  "staging-google-fault-outbox-invalid-json-terminal-001";
const OUTBOX_INVALID_DESTINATION_SOURCE =
  "staging-google-fault-outbox-invalid-destination-terminal-001";
const WORKFLOW_A_TRANSIENT_SOURCE =
  "staging-google-fault-workflow-a-transient-retry-once-001";
const WORKFLOW_A_TERMINAL_SOURCE =
  "staging-google-fault-workflow-a-terminal-contract-001";

export function workflowAFaultForSource(
  sourceRecordId: string,
  stepKey: string,
  attemptNumber: number,
): WorkflowAFault {
  if (stepKey !== "normalize_submission") return null;
  if (sourceRecordId === WORKFLOW_A_TERMINAL_SOURCE) return "terminal";
  if (
    sourceRecordId === WORKFLOW_A_TRANSIENT_SOURCE &&
    attemptNumber === 1
  ) return "transient";
  return null;
}

export function shouldInjectOutboxRetry(
  sourceRecordId: string,
  target: Omit<OutboxFaultTarget, "aggregateId">,
): boolean {
  return (
    sourceRecordId === OUTBOX_RETRY_SOURCE &&
    target.eventType === "raw_submission.published" &&
    target.destinationKey === "workflow_a" &&
    target.deliveryAttemptCount === 1
  );
}

export function shouldInjectOutboxPostCreateAckRetry(
  sourceRecordId: string,
  target: Omit<OutboxFaultTarget, "aggregateId">,
): boolean {
  return (
    sourceRecordId === OUTBOX_POST_CREATE_ACK_RETRY_SOURCE &&
    target.eventType === "raw_submission.published" &&
    target.destinationKey === "workflow_a" &&
    target.deliveryAttemptCount === 1
  );
}

export function outboxBoundaryFaultForSource(
  sourceRecordId: string,
  target: Pick<OutboxFaultTarget, "eventType" | "destinationKey">,
): OutboxBoundaryFault {
  if (
    target.eventType !== "raw_submission.published" ||
    target.destinationKey !== "workflow_a"
  ) return null;
  if (sourceRecordId === OUTBOX_INVALID_JSON_SOURCE) return "invalid_json";
  if (sourceRecordId === OUTBOX_INVALID_DESTINATION_SOURCE) {
    return "invalid_destination";
  }
  return null;
}

export class StagingOrchestratorFaultInjector {
  private readonly enabled: boolean;

  constructor(deploymentStage: string, explicitEnablement: string | undefined) {
    this.enabled =
      deploymentStage === "staging" && explicitEnablement === "enabled";
  }

  private async sourceRecordId(
    db: D1Database,
    rawSubmissionId: number,
  ): Promise<string | null> {
    const row = await db.prepare(
      `SELECT source_record_id FROM raw_submission WHERE id=?1`,
    ).bind(rawSubmissionId).first<{ source_record_id: string }>();
    return row?.source_record_id ?? null;
  }

  async beforeOutboxPublish(
    db: D1Database,
    target: OutboxFaultTarget,
    input: { destinationKey: string | null; eventPayloadJson: string },
  ): Promise<{ destinationKey: string | null; eventPayloadJson: string }> {
    if (
      !this.enabled ||
      target.eventType !== "raw_submission.published" ||
      target.destinationKey !== "workflow_a"
    ) return input;
    const sourceRecordId = await this.sourceRecordId(db, target.aggregateId);
    if (
      sourceRecordId &&
      shouldInjectOutboxRetry(sourceRecordId, {
        eventType: target.eventType,
        destinationKey: target.destinationKey,
        deliveryAttemptCount: target.deliveryAttemptCount,
      })
    ) {
      throw new Error("staging_fault_outbox_workflow_create_unavailable");
    }
    if (!sourceRecordId) return input;
    const boundaryFault = outboxBoundaryFaultForSource(sourceRecordId, target);
    if (boundaryFault === "invalid_json") {
      // The D1 CHECK(json_valid(...)) prevents corrupt JSON at rest. Override
      // only the in-memory dispatch input to exercise the real parser and
      // permanent-error classification without weakening that constraint.
      return { ...input, eventPayloadJson: "{" };
    }
    if (boundaryFault === "invalid_destination") {
      return { ...input, destinationKey: "staging_invalid_destination" };
    }
    return input;
  }

  async afterOutboxPublish(
    db: D1Database,
    target: OutboxFaultTarget,
  ): Promise<void> {
    if (
      !this.enabled ||
      target.deliveryAttemptCount !== 1 ||
      target.eventType !== "raw_submission.published" ||
      target.destinationKey !== "workflow_a"
    ) return;
    const sourceRecordId = await this.sourceRecordId(db, target.aggregateId);
    if (
      sourceRecordId &&
      shouldInjectOutboxPostCreateAckRetry(sourceRecordId, {
        eventType: target.eventType,
        destinationKey: target.destinationKey,
        deliveryAttemptCount: target.deliveryAttemptCount,
      })
    ) {
      throw new Error("staging_fault_outbox_post_create_ack_interrupted");
    }
  }

  async beforeWorkflowAStep(
    db: D1Database,
    rawSubmissionId: number,
    stepKey: string,
    attemptNumber: number,
  ): Promise<void> {
    if (!this.enabled) return;
    const sourceRecordId = await this.sourceRecordId(db, rawSubmissionId);
    if (!sourceRecordId) return;
    const fault = workflowAFaultForSource(
      sourceRecordId,
      stepKey,
      attemptNumber,
    );
    if (fault === "transient") {
      throw new Error("staging_fault_workflow_a_transient_service_error");
    }
    if (fault === "terminal") {
      // `configuration_missing` is a frozen terminal marker. The Workflow
      // boundary converts this error to Cloudflare NonRetryableError.
      throw new Error("staging_fault_workflow_contract_configuration_missing");
    }
  }
}

export const STAGING_ORCHESTRATOR_FAULT_SOURCES = {
  outboxRetry: OUTBOX_RETRY_SOURCE,
  outboxPostCreateAckRetry: OUTBOX_POST_CREATE_ACK_RETRY_SOURCE,
  outboxInvalidJson: OUTBOX_INVALID_JSON_SOURCE,
  outboxInvalidDestination: OUTBOX_INVALID_DESTINATION_SOURCE,
  workflowATransient: WORKFLOW_A_TRANSIENT_SOURCE,
  workflowATerminal: WORKFLOW_A_TERMINAL_SOURCE,
} as const;
