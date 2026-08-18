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
  DEPLOYMENT_STAGE: string;
  WORKFLOW_A_VERSION: string;
  WORKFLOW_B_VERSION: string;
  ML_SERVICE_URL: string;
  ML_SERVICE_AUTH_TOKEN: string;
  IDENTITY_HMAC_KEY_V1: string;
  ORCHESTRATOR_INTERNAL_AUTH_TOKEN: string;
}
