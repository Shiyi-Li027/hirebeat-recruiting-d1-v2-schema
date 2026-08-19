interface OutboxFaultTarget {
  eventType: string;
  destinationKey: string | null;
  aggregateId: number;
  deliveryAttemptCount: number;
}

type WorkflowAFault = "transient" | "terminal" | null;

const OUTBOX_RETRY_SOURCE =
  "staging-google-fault-outbox-workflow-create-retry-once-001";
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
      shouldInjectOutboxRetry(sourceRecordId, {
        eventType: target.eventType,
        destinationKey: target.destinationKey,
        deliveryAttemptCount: target.deliveryAttemptCount,
      })
    ) {
      throw new Error("staging_fault_outbox_workflow_create_unavailable");
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
  workflowATransient: WORKFLOW_A_TRANSIENT_SOURCE,
  workflowATerminal: WORKFLOW_A_TERMINAL_SOURCE,
} as const;
