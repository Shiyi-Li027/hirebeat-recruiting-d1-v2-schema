interface WaitingJdRow {
  application_id:number;candidate_snapshot_id:number;old_fence_token:string;
  workflow_run_id:number;configuration_release_id:number;max_delivery_attempts:number;
}

interface ExpiringOfferRow {
  offer_id:number;application_id:number;offer_version_id:number;
  workflow_run_id:number;stage_run_id:number;current_status:string;status_version:number;
}

export interface ReconcileResult { jdWaitersRequeued:number; offersExpired:number; }

async function reconcileJdWaiters(db:D1Database,limit:number):Promise<number>{
  const waiting=(await db.prepare(
    `SELECT app.id application_id,app.current_candidate_snapshot_id candidate_snapshot_id,
            app.decision_fence_token old_fence_token,w.id workflow_run_id,
            w.configuration_release_id,
            CAST(config.configuration_value_json AS INTEGER) max_delivery_attempts
     FROM application app
     JOIN position p ON p.id=app.position_id AND p.position_status='active'
       AND p.position_jd IS NOT NULL AND length(trim(p.position_jd))>=10
     JOIN etl_workflow_run w ON w.application_id=app.id
       AND w.workflow_type='workflow_b' AND w.workflow_status='waiting'
       AND w.current_step_key='waiting_position_jd'
     JOIN system_configuration config ON config.configuration_release_id=w.configuration_release_id
       AND config.configuration_scope='outbox' AND config.configuration_key='max_delivery_attempts'
     WHERE app.application_lifecycle_status='processing'
       AND app.application_decision_status='pending'
       AND app.current_candidate_snapshot_id IS NOT NULL
       AND w.id=(SELECT MAX(latest.id) FROM etl_workflow_run latest
                 WHERE latest.application_id=app.id AND latest.workflow_type='workflow_b'
                   AND latest.workflow_status='waiting' AND latest.current_step_key='waiting_position_jd')
       AND NOT EXISTS (SELECT 1 FROM outbox_event o
                       WHERE o.deduplication_key='workflow_b_jd_ready:'||app.id||':'||w.id)
     ORDER BY app.id LIMIT ?1`,
  ).bind(limit).all<WaitingJdRow>()).results;
  let count=0;
  for(const item of waiting){
    const now=new Date().toISOString();const fence=crypto.randomUUID();
    const results=await db.batch([
      db.prepare(`UPDATE application SET decision_fence_token=?2,updated_at=?3
                  WHERE id=?1 AND decision_fence_token=?4
                    AND application_lifecycle_status='processing'
                    AND application_decision_status='pending'`)
        .bind(item.application_id,fence,now,item.old_fence_token),
      db.prepare(`UPDATE etl_workflow_run SET workflow_status='cancelled',
                  cancellation_reason_code='position_jd_ready_reconciled',completed_at=?2,
                  last_progressed_at=?2,updated_at=?2
                  WHERE id=?1 AND workflow_status='waiting'
                    AND EXISTS(SELECT 1 FROM application WHERE id=?3 AND decision_fence_token=?4)`)
        .bind(item.workflow_run_id,now,item.application_id,fence),
      db.prepare(`INSERT OR IGNORE INTO outbox_event (
                    event_uuid,deduplication_key,event_type,event_schema_version,
                    aggregate_type,aggregate_id,destination_type,destination_key,
                    event_payload_json,dispatch_status,delivery_attempt_count,
                    max_delivery_attempts,available_at,created_at,updated_at)
                  SELECT ?1,?2,'application.position_jd_ready','application-position-jd-ready-v1',
                         'application',id,'cloudflare_workflow','workflow_b',
                         json_object('applicationId',id,'candidateSnapshotId',current_candidate_snapshot_id,
                                     'configurationReleaseId',?3,'decisionFenceToken',?4),
                         'pending',0,?5,?6,?6,?6 FROM application
                  WHERE id=?7 AND decision_fence_token=?4
                    AND application_lifecycle_status='processing'
                    AND application_decision_status='pending'`)
        .bind(crypto.randomUUID(),`workflow_b_jd_ready:${item.application_id}:${item.workflow_run_id}`,
          item.configuration_release_id,fence,item.max_delivery_attempts,now,item.application_id),
    ]);
    if(Number(results[2].meta.changes)===1)count+=1;
  }
  return count;
}

async function expireOffers(db:D1Database,limit:number):Promise<number>{
  const rows=(await db.prepare(
    `SELECT o.id offer_id,o.application_id,o.current_offer_version_id offer_version_id,
            stage.workflow_run_id,o.creating_stage_run_id stage_run_id,
            o.current_status,o.status_version
     FROM offer o
     JOIN offer_version v ON v.id=o.current_offer_version_id AND v.offer_id=o.id
     JOIN application_stage_run stage ON stage.id=o.creating_stage_run_id
     WHERE o.current_status IN ('sent','viewed')
       AND v.response_due_at IS NOT NULL AND v.response_due_at<=?1
       AND NOT EXISTS(SELECT 1 FROM offer_status_history h
                      WHERE h.idempotency_key='offer-auto-expire:'||o.id||':'||v.id)
     ORDER BY v.response_due_at,o.id LIMIT ?2`,
  ).bind(new Date().toISOString(),limit).all<ExpiringOfferRow>()).results;
  let count=0;
  for(const row of rows){
    const now=new Date().toISOString();const idempotency=`offer-auto-expire:${row.offer_id}:${row.offer_version_id}`;
    const results=await db.batch([
      db.prepare(`UPDATE offer SET current_status='expired',status_version=status_version+1,
                  offer_fence_token=?2,current_status_changed_at=?3,updated_at=?3
                  WHERE id=?1 AND status_version=?4 AND current_status=?5`)
        .bind(row.offer_id,crypto.randomUUID(),now,row.status_version,row.current_status),
      db.prepare(`INSERT OR IGNORE INTO offer_status_history (
                    offer_status_history_uuid,offer_id,application_id,offer_version_id,
                    workflow_run_id,stage_run_id,idempotency_key,from_status,to_status,
                    initiated_by_type,initiated_by_reference,reason_code,note,
                    event_metadata_json,occurred_at,created_at)
                  SELECT ?1,id,application_id,current_offer_version_id,?2,creating_stage_run_id,
                         ?3,?4,'expired','system_rule','scheduled_reconciler',
                         'response_deadline_elapsed',NULL,'{}',?5,?5
                  FROM offer WHERE id=?6 AND current_status='expired' AND updated_at=?5`)
        .bind(crypto.randomUUID(),row.workflow_run_id,idempotency,row.current_status,now,row.offer_id),
      db.prepare(`INSERT OR IGNORE INTO audit_event (
                    event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,
                    workflow_run_id,correlation_key,reason_code,event_summary,
                    event_metadata_json,occurred_at,recorded_at)
                  SELECT ?1,'offer.expired_automatically','offer',?2,'system','scheduled_reconciler',
                         ?3,?4,'response_deadline_elapsed','Offer expired after response deadline',
                         json_object('offerVersionId',?5),?6,?6
                  WHERE EXISTS(SELECT 1 FROM offer_status_history WHERE idempotency_key=?4)`)
        .bind(crypto.randomUUID(),row.offer_id,row.workflow_run_id,idempotency,row.offer_version_id,now),
    ]);
    if(Number(results[1].meta.changes)===1)count+=1;
  }
  return count;
}

export async function reconcileOperationalState(db:D1Database,limit=25):Promise<ReconcileResult>{
  return{
    jdWaitersRequeued:await reconcileJdWaiters(db,limit),
    offersExpired:await expireOffers(db,limit),
  };
}
