import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { OrchestratorEnv, WorkflowBParams } from "./env";
import { tracked, WorkflowLedger } from "./workflow-ledger";
import { publishCandidateEnrichment, type EnrichmentResult } from "./workflow-b-enrichment";
import { executeMl, type MlRunResult } from "./workflow-b-ml";
import { finalizeMlDecision, type FinalDecisionResult } from "./workflow-b-finalize";
import { loadOrchestratorConfiguration } from "./runtime-configuration";
import { toWorkflowThrowable } from "./workflow-errors";

export interface WorkflowBOutcome {
  status:"offer_created"|"rejected"|"waiting_position_jd"|"cancelled_stale";
  recommendationResultId:number|null;
  offerId:number|null;
}

export async function executeWorkflowB(
  env:OrchestratorEnv,event:WorkflowEvent<WorkflowBParams>,step:WorkflowStep,
):Promise<WorkflowBOutcome>{
  const payload=event.payload;
  const configuration=await step.do("load-workflow-b-configuration",()=>loadOrchestratorConfiguration(env.DB,payload.configurationReleaseId));
  const doConfigured=<T>(name:string,callback:()=>Promise<T>):Promise<T>=>step.do(name,{
    // Cloudflare `limit` is the total number of attempts, including the first.
    retries:{limit:Math.max(1,configuration.defaultStepMaxAttempts),delay:"1 second",backoff:"exponential"},
    timeout:"10 minutes",
  },async()=>{
    try{return await callback();}catch(error){throw toWorkflowThrowable(error);}
  });
  const ledger=new WorkflowLedger(env.DB,configuration.defaultStepMaxAttempts);
  const run=await doConfigured("register-workflow-b",()=>ledger.ensureWorkflow({
    type:"workflow_b",version:env.WORKFLOW_B_VERSION,outboxEventId:payload.outboxEventId,
    applicationId:payload.applicationId,fenceToken:payload.decisionFenceToken,
    configurationReleaseId:payload.configurationReleaseId,
  }));
  try{
    const fenceValid=await doConfigured("verify-application-fence",()=>tracked(
      ledger,run.id,"verify_application_fence","Verify Application fence",async()=>{
        const row=await env.DB.prepare(
          `SELECT 1 valid FROM application WHERE id=?1 AND current_candidate_snapshot_id=?2
           AND decision_fence_token=?3 AND application_lifecycle_status='processing'
           AND application_decision_status='pending'`,
        ).bind(payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken).first();
        return Boolean(row);
      },
    ));
    if(!fenceValid){
      await ledger.cancelWorkflow(run.id,"application_fence_invalid_or_superseded");
      return{status:"cancelled_stale",recommendationResultId:null,offerId:null};
    }
    const positionJdReady=await doConfigured("verify-position-jd-ready",()=>tracked(
      ledger,run.id,"verify_position_jd_ready","Verify Position JD is ready for ML",async()=>{
        const row=await env.DB.prepare(
          `SELECT position.position_jd FROM application
           JOIN position ON position.id=application.position_id
           WHERE application.id=?1 AND application.current_candidate_snapshot_id=?2
             AND application.decision_fence_token=?3
             AND application.application_lifecycle_status='processing'
             AND application.application_decision_status='pending'`,
        ).bind(payload.applicationId,payload.candidateSnapshotId,payload.decisionFenceToken)
          .first<{position_jd:string|null}>();
        return Boolean(row?.position_jd&&row.position_jd.trim().length>=10);
      },
    ));
    if(!positionJdReady){
      const now=new Date().toISOString();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO audit_event (
           event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,
           workflow_run_id,correlation_key,reason_code,event_summary,
           event_metadata_json,occurred_at,recorded_at
         ) VALUES (?1,'workflow_b.waiting_position_jd','application',?2,'workflow',?3,
                   ?3,?4,'position_jd_not_ready',
                   'Workflow B is waiting for Position JD','{}',?5,?5)`,
      ).bind(crypto.randomUUID(),payload.applicationId,String(run.id),
        `workflow-b:${run.id}:waiting-position-jd`,now).run();
      await ledger.waitWorkflow(run.id,"waiting_position_jd");
      return{status:"waiting_position_jd",recommendationResultId:null,offerId:null};
    }
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
