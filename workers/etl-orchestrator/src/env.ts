export interface WorkflowAParams {
  outboxEventId: number;
  rawSubmissionId: number;
  configurationReleaseId: number;
}

export interface WorkflowBParams {
  outboxEventId: number;
  applicationId: number;
  candidateSnapshotId: number;
  configurationReleaseId: number;
  decisionFenceToken: string;
}

export interface OrchestratorEnv {
  DB: D1Database;
  WORKFLOW_A: Workflow<WorkflowAParams>;
  WORKFLOW_B: Workflow<WorkflowBParams>;
  INTAKE_QUEUE: Queue<IntakeRecoveryQueueMessage>;
  DEPLOYMENT_STAGE: string;
  WORKFLOW_A_VERSION: string;
  WORKFLOW_B_VERSION: string;
  ML_SERVICE_URL: string;
  ML_SERVICE_AUTH_TOKEN: string;
  CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON: string;
  IDENTITY_HMAC_KEY_V1: string;
  ORCHESTRATOR_INTERNAL_AUTH_TOKEN: string;
}

export interface IntakeRecoveryQueueMessage {
  schemaVersion: "intake-queue-message-v2";
  submissionUuid: string;
  acceptedPayloadHmac: string;
  replayEnvelopeKey: string;
  requestId: string;
  enqueuedAt: string;
  recoveryFenceToken: string;
  deliveryKind: "controlled_recovery";
}
