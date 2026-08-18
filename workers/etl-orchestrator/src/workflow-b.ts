import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { OrchestratorEnv, WorkflowBParams } from "./env";
import { tracked, WorkflowLedger } from "./workflow-ledger";
import { publishCandidateEnrichment, type EnrichmentResult } from "./workflow-b-enrichment";
import { executeMl, type MlRunResult } from "./workflow-b-ml";
import { finalizeMlDecision, type FinalDecisionResult } from "./workflow-b-finalize";
import { loadOrchestratorConfiguration } from "./runtime-configuration";

export interface WorkflowBOutcome {
  status:"offer_created"|"rejected";
  recommendationResultId:number;
  offerId:number|null;
}

export async function executeWorkflowB(
  env:OrchestratorEnv,event:WorkflowEvent<WorkflowBParams>,step:WorkflowStep,
):Promise<WorkflowBOutcome>{
  const payload=event.payload;
  const configuration=await step.do("load-workflow-b-configuration",()=>loadOrchestratorConfiguration(env.DB,payload.configurationReleaseId));
  const doConfigured=<T>(name:string,callback:()=>Promise<T>):Promise<T>=>step.do(name,{
    // Cloudflare `limit` counts retries after the first call; the database
    // configuration counts total attempts.
    retries:{limit:Math.max(0,configuration.defaultStepMaxAttempts-1),delay:"1 second",backoff:"exponential"},
    timeout:"10 minutes",
  },callback);
  const ledger=new WorkflowLedger(env.DB,configuration.defaultStepMaxAttempts);
  const run=await doConfigured("register-workflow-b",()=>ledger.ensureWorkflow({
    type:"workflow_b",version:env.WORKFLOW_B_VERSION,outboxEventId:payload.outboxEventId,
    applicationId:payload.applicationId,fenceToken:payload.decisionFenceToken,
    configurationReleaseId:payload.configurationReleaseId,
  }));
  try{
    await doConfigured("verify-application-fence",()=>tracked(
      ledger,run.id,"verify_application_fence","Verify Application fence",async()=>{
        const row=await env.DB.prepare(
          `SELECT 1 valid FROM application WHERE id=?1 AND current_candidate_snapshot_id=?2
           AND decision_fence_token=?3 AND application_lifecycle_status='processing'
           AND application_decision_status='pending'`,
        ).bind(payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken).first();
        if(!row)throw new Error("workflow_b_fence_invalid_or_superseded");
        return{valid:true};
      },
    ));
    await doConfigured("publish-candidate-enrichment",()=>tracked<EnrichmentResult>(
      ledger,run.id,"publish_candidate_enrichment","Publish Candidate enrichment",()=>publishCandidateEnrichment(
        env.DB,payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken,
      ),
    ));
    const ml=await doConfigured("run-ml-recommendation",()=>tracked<MlRunResult>(
      ledger,run.id,"run_ml_recommendation","Run anomaly and similarity recommendation",()=>executeMl(
        env,run.id,payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken,configuration.mlRequestTimeoutMs,
      ),
    ));
    const final=await doConfigured("publish-hiring-decision",()=>tracked<FinalDecisionResult>(
      ledger,run.id,"publish_hiring_decision","Atomically publish ML decision and Offer draft",()=>finalizeMlDecision(
        env.DB,run.id,payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken,ml,configuration.outboxMaxDeliveryAttempts,
      ),
    ));
    await doConfigured("complete-workflow-b",()=>ledger.completeWorkflow(run.id));
    return{status:ml.recommendation==="offer"?"offer_created":"rejected",recommendationResultId:final.recommendationResultId,offerId:final.offerId};
  }catch(error){
    const now=new Date().toISOString();
    await env.DB.prepare(
      `UPDATE ml_analysis_run SET run_status='failed_terminal',last_error_code=?2,last_error_detail=?2,
       completed_at=?3,updated_at=?3 WHERE application_id=?1 AND run_status='running'`,
    ).bind(payload.applicationId,error instanceof Error?error.message.slice(0,120):"workflow_b_failed",now).run();
    await ledger.failWorkflow(run.id,error);
    throw error;
  }
}
