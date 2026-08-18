import { commandKey } from "./helpers";

export async function requestMlRecommendation(
  db:D1Database,applicationId:number,body:Record<string,unknown>,actor:string,
):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.application.ml.request";
  const prior=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`).bind(eventType,key).first<{event_metadata_json:string|null}>();
  if(prior?.event_metadata_json)return{...(JSON.parse(prior.event_metadata_json) as object),idempotent_reuse:true};
  const app=await db.prepare(
    `SELECT app.id,app.current_candidate_snapshot_id,app.decision_fence_token,release.id configuration_release_id,
            CAST(config.configuration_value_json AS INTEGER) outbox_max_delivery_attempts
     FROM application app
     JOIN system_configuration_release release ON release.release_status='active'
     JOIN system_configuration config ON config.configuration_release_id=release.id
       AND config.configuration_scope='outbox' AND config.configuration_key='max_delivery_attempts'
     WHERE app.id=?1 AND app.application_lifecycle_status='processing' AND app.application_decision_status='pending'`,
  ).bind(applicationId).first<{id:number;current_candidate_snapshot_id:number;decision_fence_token:string;configuration_release_id:number;outbox_max_delivery_attempts:number}>();
  if(!app?.current_candidate_snapshot_id)throw new Error("application_not_ml_eligible");
  const now=new Date().toISOString();const newFence=crypto.randomUUID();const outboxUuid=crypto.randomUUID();
  const metadata={application_id:applicationId,candidate_snapshot_id:app.current_candidate_snapshot_id,decision_fence_token:newFence};
  const results=await db.batch([
    db.prepare(`UPDATE application SET decision_fence_token=?2,updated_at=?3 WHERE id=?1 AND decision_fence_token=?4 AND application_lifecycle_status='processing'`)
      .bind(applicationId,newFence,now,app.decision_fence_token),
    db.prepare(`UPDATE etl_workflow_run SET workflow_status='cancelled',cancellation_reason_code='manual_ml_rerequest',completed_at=?2,updated_at=?2 WHERE application_id=?1 AND workflow_type='workflow_b' AND workflow_status IN ('requested','running','waiting')`)
      .bind(applicationId,now),
    db.prepare(`INSERT INTO outbox_event (event_uuid,deduplication_key,event_type,event_schema_version,aggregate_type,aggregate_id,destination_type,destination_key,event_payload_json,dispatch_status,delivery_attempt_count,max_delivery_attempts,available_at,created_at,updated_at)
      VALUES (?1,?2,'application.ml_requested','application-ml-requested-v1','application',?3,'cloudflare_workflow','workflow_b',?4,'pending',0,?5,?6,?6,?6)`)
      .bind(outboxUuid,`workflow_b_manual:${applicationId}:${key}`,applicationId,JSON.stringify({applicationId,candidateSnapshotId:app.current_candidate_snapshot_id,configurationReleaseId:app.configuration_release_id,decisionFenceToken:newFence}),app.outbox_max_delivery_attempts,now),
    db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at)
      SELECT ?1,?2,'application',id,'member',?3,?4,'author_command','ML recommendation requested',?5,?6,?6 FROM application
      WHERE id=?7 AND decision_fence_token=?8`)
      .bind(crypto.randomUUID(),eventType,actor,key,JSON.stringify(metadata),now,applicationId,newFence),
  ]);
  if(results.some((result)=>!result.success)||Number(results[0].meta.changes)!==1)throw new Error("application_ml_request_concurrent_update");
  return metadata;
}
