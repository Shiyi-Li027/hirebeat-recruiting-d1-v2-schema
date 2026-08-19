import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { OrchestratorEnv, WorkflowAParams } from "./env";
import { runDedup, type DedupResult } from "./workflow-a-dedup";
import { extractResume, type ExtractionResult } from "./workflow-a-extraction";
import { initialCleaning, normalizeSubmission, type NormalizationResult } from "./workflow-a-normalization";
import { publishApplicationCore, type CorePublishResult } from "./workflow-a-publish-core";
import { tracked, WorkflowLedger, type WorkflowRunIdentity } from "./workflow-ledger";
import { loadOrchestratorConfiguration } from "./runtime-configuration";
import { compensateWorkflowAStaging } from "./workflow-a-compensation";
import { toWorkflowThrowable } from "./workflow-errors";

const WORKFLOW_A_STEP_VERSION = "workflow-a-step-v1";

export interface WorkflowAOutcome {
  status: "published" | "blocked";
  reasonCode?: string;
  applicationId?: number;
  candidateSnapshotId?: number;
}

async function workflowRun(
  env: OrchestratorEnv,
  payload: WorkflowAParams,
): Promise<WorkflowRunIdentity> {
  return new WorkflowLedger(env.DB).ensureWorkflow({
    type: "workflow_a",
    version: env.WORKFLOW_A_VERSION,
    outboxEventId: payload.outboxEventId,
    rawSubmissionId: payload.rawSubmissionId,
    configurationReleaseId: payload.configurationReleaseId,
  });
}

export async function executeWorkflowA(
  env: OrchestratorEnv,
  event: WorkflowEvent<WorkflowAParams>,
  step: WorkflowStep,
): Promise<WorkflowAOutcome> {
  const payload = event.payload;
  const configuration=await step.do("load-workflow-a-configuration",()=>loadOrchestratorConfiguration(env.DB,payload.configurationReleaseId));
  const doConfigured=<T>(name:string,callback:()=>Promise<T>):Promise<T>=>step.do(name,{
    // Cloudflare `limit` is the total number of attempts, including the first.
    retries:{limit:Math.max(1,configuration.defaultStepMaxAttempts),delay:"1 second",backoff:"exponential"},
    timeout:"10 minutes",
  },async()=>{
    try{return await callback();}catch(error){throw toWorkflowThrowable(error);}
  });
  const run = await doConfigured("register-workflow-a", () => workflowRun(env, payload));
  const ledger = new WorkflowLedger(env.DB,configuration.defaultStepMaxAttempts);

  try {
    const cleaning = await doConfigured("initial-cleaning", () => tracked(
      ledger,
      run.id,
      "initial_cleaning",
      "Initial cleaning",
      () => initialCleaning(env.DB, run.id, payload.rawSubmissionId),
    ));
    if (!cleaning.admitted) {
      await doConfigured("complete-blocked-workflow-a", async () => {
        await ledger.completeWorkflow(run.id);
      });
      return { status: "blocked", reasonCode: cleaning.reasonCode ?? "initial_cleaning_blocked" };
    }

    const normalized = await doConfigured("normalize-submission", () => tracked<NormalizationResult>(
      ledger,
      run.id,
      "normalize_submission",
      "Normalize submission",
      (stepRunId) => normalizeSubmission(env.DB, run.id, stepRunId, payload.rawSubmissionId),
    ));
    const extraction = await doConfigured("extract-resume-entities", () => tracked<ExtractionResult>(
      ledger,
      run.id,
      "extract_resume_entities",
      "Extract resume entities",
      (stepRunId) => extractResume(
        env.DB,
        run.id,
        stepRunId,
        normalized.submissionNormalizedId,
        env.IDENTITY_HMAC_KEY_V1,
      ),
    ));
    const dedup = await doConfigured("deduplicate-and-admit", () => tracked<DedupResult>(
      ledger,
      run.id,
      "dedup_admission",
      "Deduplicate and decide Application admission",
      (stepRunId) => runDedup(
        env.DB,
        run.id,
        stepRunId,
        normalized.submissionNormalizedId,
        env.IDENTITY_HMAC_KEY_V1,
      ),
    ));
    if (!dedup.entryDecision.startsWith("admitted_")) {
      await doConfigured("complete-dedup-blocked-workflow-a", async () => {
        await ledger.completeWorkflow(run.id);
      });
      return { status: "blocked", reasonCode: dedup.entryDecision };
    }

    const published = await doConfigured("publish-application-core", () => tracked<CorePublishResult>(
      ledger,
      run.id,
      "publish_application_core",
      "Publish Person/Application/Candidate core",
      () => publishApplicationCore(
        env.DB,
        run.id,
        payload.configurationReleaseId,
        normalized.submissionNormalizedId,
        extraction.resumeExtractionId,
        dedup,
        env.IDENTITY_HMAC_KEY_V1,
        configuration.outboxMaxDeliveryAttempts,
      ),
    ));
    await doConfigured("complete-workflow-a", async () => {
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE candidate_snapshot SET snapshot_status='enrichment_running',updated_at=?2
           WHERE id=?1 AND snapshot_status='core_published'`,
        ).bind(published.candidateSnapshotId, now),
      ]);
      await ledger.completeWorkflow(run.id);
    });
    return {
      status: "published",
      applicationId: published.applicationId,
      candidateSnapshotId: published.candidateSnapshotId,
    };
  } catch (error) {
    await compensateWorkflowAStaging(env.DB,run.id);
    await ledger.failWorkflow(run.id, error);
    throw error;
  }
}

export { WORKFLOW_A_STEP_VERSION };
