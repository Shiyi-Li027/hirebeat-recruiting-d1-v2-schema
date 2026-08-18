import type { MlRunResult } from "./workflow-b-ml";

interface FinalContext {
  hiring_pipeline_id:number;initial_stage_id:number;initial_stage_run_id:number;
  ml_stage_id:number;decision_stage_id:number;first_transition_id:number;decision_transition_id:number;
  company_name_snapshot:string;position_name_snapshot:string;normalized_person_name:string;
  normalized_email_address:string;company_work_mode_name_snapshot:string|null;
  requested_start_date:string|null;requested_end_date:string|null;work_duration:string|null;
}

export interface FinalDecisionResult { recommendationResultId:number;offerId:number|null; }

export async function finalizeMlDecision(
  db:D1Database,workflowRunId:number,applicationId:number,candidateSnapshotId:number,
  fenceToken:string,ml:MlRunResult,outboxMaximumAttempts=8,
):Promise<FinalDecisionResult>{
  const existing=await db.prepare(
    `SELECT recommendation.id recommendation_id,offer.id offer_id
     FROM application app
     JOIN ml_recommendation_result recommendation
       ON recommendation.application_id=app.id
      AND recommendation.candidate_snapshot_id=?2
     LEFT JOIN offer ON offer.ml_recommendation_result_id=recommendation.id
     WHERE app.id=?1 AND app.decision_fence_token=?3
       AND app.application_lifecycle_status='completed'
       AND app.application_decision_status IN ('rejected','offer_created')
     ORDER BY recommendation.id DESC LIMIT 1`,
  ).bind(applicationId,candidateSnapshotId,fenceToken)
    .first<{recommendation_id:number;offer_id:number|null}>();
  if(existing){
    return{recommendationResultId:existing.recommendation_id,offerId:existing.offer_id};
  }
  const decisionStageCode=ml.recommendation==="offer"?"offer_process":"rejected";
  const context=await db.prepare(
    `SELECT app.hiring_pipeline_id,initial_stage.id initial_stage_id,initial_run.id initial_stage_run_id,
            ml_stage.id ml_stage_id,decision_stage.id decision_stage_id,
            first_edge.id first_transition_id,decision_edge.id decision_transition_id,
            app.company_name_snapshot,app.position_name_snapshot,candidate.normalized_person_name,
            candidate.normalized_email_address,app.company_work_mode_name_snapshot,
            app.requested_start_date,app.requested_end_date,app.work_duration
     FROM application app JOIN candidate_snapshot candidate ON candidate.id=?2 AND candidate.application_id=app.id
     JOIN pipeline_stage initial_stage ON initial_stage.id=app.current_stage_id
     JOIN application_stage_run initial_run ON initial_run.application_id=app.id AND initial_run.pipeline_stage_id=initial_stage.id
     JOIN pipeline_stage ml_stage ON ml_stage.hiring_pipeline_id=app.hiring_pipeline_id AND ml_stage.stage_code='ml_recommendation'
     JOIN pipeline_stage decision_stage ON decision_stage.hiring_pipeline_id=app.hiring_pipeline_id AND decision_stage.stage_code=?4
     JOIN pipeline_stage_transition first_edge ON first_edge.hiring_pipeline_id=app.hiring_pipeline_id
       AND first_edge.from_stage_id=initial_stage.id AND first_edge.to_stage_id=ml_stage.id AND first_edge.is_allowed=1
     JOIN pipeline_stage_transition decision_edge ON decision_edge.hiring_pipeline_id=app.hiring_pipeline_id
       AND decision_edge.from_stage_id=ml_stage.id AND decision_edge.to_stage_id=decision_stage.id AND decision_edge.is_allowed=1
     WHERE app.id=?1 AND app.decision_fence_token=?3 AND app.application_lifecycle_status='processing'
       AND app.application_decision_status='pending' AND candidate.snapshot_status='enriched'`,
  ).bind(applicationId,candidateSnapshotId,fenceToken,decisionStageCode).first<FinalContext>();
  if(!context)throw new Error("final_decision_fence_or_pipeline_path_invalid");
  const now=new Date().toISOString();
  const recommendationUuid=crypto.randomUUID();const mlStageUuid=crypto.randomUUID();const finalStageUuid=crypto.randomUUID();
  const transitionOneUuid=crypto.randomUUID();const transitionTwoUuid=crypto.randomUUID();const offerUuid=crypto.randomUUID();
  const offerFence=crypto.randomUUID();const offerHistoryUuid=crypto.randomUUID();const offerEventUuid=crypto.randomUUID();
  const statements:D1PreparedStatement[]=[];
  statements.push(db.prepare(
    `INSERT INTO ml_recommendation_result (recommendation_result_uuid,ml_analysis_run_id,application_id,
       candidate_snapshot_id,anomaly_result_id,similarity_result_id,threshold_policy_id,
       recommendation_method,recommendation_decision,decision_reason_code,match_score_snapshot,
       threshold_snapshot,passed_threshold,result_metadata_json,decided_at,published_at,created_at)
     SELECT ?1,?2,app.id,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?15
     FROM application app WHERE app.id=?3 AND app.decision_fence_token=?16
       AND app.application_lifecycle_status='processing' AND app.application_decision_status='pending'`,
  ).bind(recommendationUuid,ml.mlAnalysisRunId,applicationId,candidateSnapshotId,ml.anomalyResultId,
    ml.similarityResultId,ml.thresholdPolicyId,ml.method,ml.recommendation,ml.reasonCode,ml.matchScore,ml.threshold,
    ml.threshold===null?null:(ml.recommendation==="offer"?1:0),JSON.stringify({decisionFenceToken:fenceToken}),now,fenceToken));
  statements.push(db.prepare(
    `INSERT INTO application_stage_run (application_stage_run_uuid,application_id,hiring_pipeline_id,pipeline_stage_id,
       workflow_run_id,ml_recommendation_result_id,idempotency_key,application_fence_token,actual_sequence_no,attempt_no,
       run_status,stage_outcome_code,passed_threshold,executor_type,result_summary,result_metadata_json,
       scheduled_at,started_at,completed_at,created_at,updated_at)
     SELECT ?1,?2,?3,?4,?5,recommendation.id,?6,?7,2,1,'completed',?8,?9,'ml',?10,?11,?12,?12,?12,?12,?12
     FROM ml_recommendation_result recommendation WHERE recommendation.recommendation_result_uuid=?13`,
  ).bind(mlStageUuid,applicationId,context.hiring_pipeline_id,context.ml_stage_id,workflowRunId,
    `stage:${applicationId}:ml_recommendation:1`,fenceToken,ml.recommendation,ml.threshold===null?null:(ml.recommendation==="offer"?1:0),
    `ML recommendation: ${ml.recommendation}`,JSON.stringify({matchScore:ml.matchScore,threshold:ml.threshold,method:ml.method}),now,recommendationUuid));
  statements.push(db.prepare(
    `INSERT INTO application_stage_run (application_stage_run_uuid,application_id,hiring_pipeline_id,pipeline_stage_id,
       workflow_run_id,idempotency_key,application_fence_token,actual_sequence_no,attempt_no,run_status,
       stage_outcome_code,executor_type,result_summary,result_metadata_json,scheduled_at,started_at,completed_at,created_at,updated_at)
     SELECT ?1,?2,?3,?4,?5,?6,?7,3,1,'completed',?8,'system_rule',?9,'{}',?10,?10,?10,?10,?10
     FROM ml_recommendation_result recommendation WHERE recommendation.recommendation_result_uuid=?11`,
  ).bind(finalStageUuid,applicationId,context.hiring_pipeline_id,context.decision_stage_id,workflowRunId,
    `stage:${applicationId}:${decisionStageCode}:1`,fenceToken,ml.recommendation==="offer"?"draft_offer_created":"rejected",
    ml.recommendation==="offer"?"Offer draft created":"Application rejected",now,recommendationUuid));
  statements.push(db.prepare(
    `INSERT INTO application_stage_transition_event (transition_event_uuid,application_id,hiring_pipeline_id,
       configured_transition_id,from_stage_run_id,from_stage_id,to_stage_run_id,to_stage_id,movement_type,
       reason_code,initiated_by_type,workflow_run_id,application_fence_token,idempotency_key,event_metadata_json,occurred_at,created_at)
     SELECT ?1,?2,?3,?4,?5,?6,target.id,?7,'skip_forward','workflow_b_ml_stage','system_rule',?8,?9,?10,'{}',?11,?11
     FROM application_stage_run target WHERE target.application_stage_run_uuid=?12`,
  ).bind(transitionOneUuid,applicationId,context.hiring_pipeline_id,context.first_transition_id,context.initial_stage_run_id,
    context.initial_stage_id,context.ml_stage_id,workflowRunId,fenceToken,`transition:${applicationId}:received-to-ml`,now,mlStageUuid));
  statements.push(db.prepare(
    `INSERT INTO application_stage_transition_event (transition_event_uuid,application_id,hiring_pipeline_id,
       configured_transition_id,from_stage_run_id,from_stage_id,to_stage_run_id,to_stage_id,movement_type,
       reason_code,initiated_by_type,workflow_run_id,application_fence_token,idempotency_key,event_metadata_json,occurred_at,created_at)
     SELECT ?1,?2,?3,?4,source.id,?5,target.id,?6,?7,?8,'ml',?9,?10,?11,'{}',?12,?12
     FROM application_stage_run source JOIN application_stage_run target ON target.application_stage_run_uuid=?14
     WHERE source.application_stage_run_uuid=?13`,
  ).bind(transitionTwoUuid,applicationId,context.hiring_pipeline_id,context.decision_transition_id,context.ml_stage_id,
    context.decision_stage_id,ml.recommendation==="offer"?"skip_forward":"direct_terminal",ml.reasonCode,
    workflowRunId,fenceToken,`transition:${applicationId}:ml-to-${decisionStageCode}`,now,mlStageUuid,finalStageUuid));
  if(ml.recommendation==="offer"){
    statements.push(db.prepare(
      `INSERT INTO offer (offer_uuid,application_id,candidate_snapshot_id,creating_stage_run_id,
       ml_recommendation_result_id,decision_source,current_status,status_version,offer_fence_token,
       company_name_snapshot,position_title_snapshot,candidate_name_snapshot,candidate_email_snapshot,
       application_work_mode_snapshot,requested_start_date_snapshot,requested_end_date_snapshot,
       work_duration_snapshot,current_status_changed_at,created_at,updated_at)
       SELECT ?1,?2,?3,stage.id,recommendation.id,'ml_recommendation','draft',1,?4,?5,?6,?7,?8,
              ?9,?10,?11,?12,?13,?13,?13 FROM application_stage_run stage
       JOIN ml_recommendation_result recommendation ON recommendation.recommendation_result_uuid=?14
       WHERE stage.application_stage_run_uuid=?15`,
    ).bind(offerUuid,applicationId,candidateSnapshotId,offerFence,context.company_name_snapshot,context.position_name_snapshot,
      context.normalized_person_name,context.normalized_email_address,context.company_work_mode_name_snapshot,
      context.requested_start_date,context.requested_end_date,context.work_duration,now,recommendationUuid,finalStageUuid));
    statements.push(db.prepare(
      `INSERT INTO offer_status_history (offer_status_history_uuid,offer_id,application_id,workflow_run_id,stage_run_id,
       idempotency_key,from_status,to_status,initiated_by_type,reason_code,event_metadata_json,occurred_at,created_at)
       SELECT ?1,offer.id,?2,?3,stage.id,?4,NULL,'draft','ml','ml_recommendation_offer','{}',?5,?5
       FROM offer JOIN application_stage_run stage ON stage.application_stage_run_uuid=?6 WHERE offer.offer_uuid=?7`,
    ).bind(offerHistoryUuid,applicationId,workflowRunId,`offer-history:${applicationId}:draft`,now,finalStageUuid,offerUuid));
    statements.push(db.prepare(
      `INSERT INTO outbox_event (event_uuid,deduplication_key,event_type,event_schema_version,aggregate_type,aggregate_id,
       destination_type,destination_key,producer_workflow_run_id,event_payload_json,dispatch_status,delivery_attempt_count,
       max_delivery_attempts,available_at,created_at,updated_at)
       SELECT ?1,?2,'offer.draft_created','offer-draft-created-v1','offer',offer.id,'internal_event','offer_lifecycle',?3,
              json_object('offerId',offer.id,'applicationId',?4),'pending',0,?5,?6,?6,?6 FROM offer WHERE offer.offer_uuid=?7`,
    ).bind(offerEventUuid,`offer-lifecycle:${applicationId}:draft`,workflowRunId,applicationId,outboxMaximumAttempts,now,offerUuid));
  }
  statements.push(db.prepare(
    `UPDATE application SET application_lifecycle_status='completed',application_decision_status=?2,
       decision_reason_code=?3,current_stage_id=?4,current_stage_entered_at=?5,decided_at=?5,completed_at=?5,updated_at=?5
     WHERE id=?1 AND decision_fence_token=?6 AND application_lifecycle_status='processing' AND application_decision_status='pending'`,
  ).bind(applicationId,ml.recommendation==="offer"?"offer_created":"rejected",ml.reasonCode,context.decision_stage_id,now,fenceToken));
  const results=await db.batch(statements);if(results.some((result)=>!result.success))throw new Error("ml_decision_atomic_publish_failed");
  const result=await db.prepare(
    `SELECT recommendation.id recommendation_id,offer.id offer_id FROM ml_recommendation_result recommendation
     JOIN application app ON app.id=recommendation.application_id
     LEFT JOIN offer ON offer.ml_recommendation_result_id=recommendation.id
     WHERE recommendation.recommendation_result_uuid=?1 AND app.application_lifecycle_status='completed'
       AND app.application_decision_status=?2`,
  ).bind(recommendationUuid,ml.recommendation==="offer"?"offer_created":"rejected").first<{recommendation_id:number;offer_id:number|null}>();
  if(!result)throw new Error("ml_decision_publish_verification_failed");
  return{recommendationResultId:result.recommendation_id,offerId:result.offer_id};
}
