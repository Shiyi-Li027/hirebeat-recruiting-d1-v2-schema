import { keyedHmac, sha256 } from "./crypto";
import type { DedupResult } from "./workflow-a-dedup";

export interface CorePublishResult { applicationId:number;candidateSnapshotId:number;decisionFenceToken:string;outboxEventId:number; }

interface CoreSourceRow{
  normalized_person_name:string;normalized_first_name:string|null;normalized_middle_name:string|null;normalized_last_name:string|null;
  normalized_email_address:string;normalized_phone:string|null;company_id:number;company_work_mode_id:number|null;position_id:number;
  requested_start_date:string|null;requested_end_date:string|null;requested_start_year_month:string;work_duration:string|null;
  raw_submission_id:number;company_name:string;position_name:string;work_mode_name:string|null;resume_text_sha256:string;
  extraction_version:string;linkedin_url:string|null;github_url:string|null;
}

export async function publishApplicationCore(
  db:D1Database,workflowRunId:number,configurationReleaseId:number,
  submissionNormalizedId:number,resumeExtractionId:number,dedup:DedupResult,
  hmacSecret:string,outboxMaximumAttempts=8,
):Promise<CorePublishResult>{
  if(!["admitted_new_application","admitted_resubmission"].includes(dedup.entryDecision)||!dedup.submissionAttemptNumber||!dedup.maxSubmissionAttempts||!dedup.groupKey)
    throw new Error("application_core_publish_not_admitted");
  const existing=await db.prepare(
    `SELECT app.id application_id,candidate.id candidate_id,app.decision_fence_token,
            outbox.id outbox_id
     FROM application_source_lineage lineage
     JOIN application app ON app.id=lineage.application_id
     JOIN candidate_snapshot candidate ON candidate.id=app.current_candidate_snapshot_id
     JOIN outbox_event outbox ON outbox.aggregate_id=app.id
       AND outbox.event_type='application.core_published'
     WHERE lineage.source_submission_normalized_id=?1
       AND lineage.relation_role='primary_decision_input'
     ORDER BY lineage.id DESC LIMIT 1`,
  ).bind(submissionNormalizedId).first<{
    application_id:number;candidate_id:number;decision_fence_token:string;outbox_id:number;
  }>();
  if(existing){
    return{
      applicationId:existing.application_id,
      candidateSnapshotId:existing.candidate_id,
      decisionFenceToken:existing.decision_fence_token,
      outboxEventId:existing.outbox_id,
    };
  }
  const source=await db.prepare(
    `SELECT n.normalized_person_name,n.normalized_first_name,n.normalized_middle_name,
            n.normalized_last_name,n.normalized_email_address,n.normalized_phone,
            n.company_id,n.company_work_mode_id,n.position_id,n.requested_start_date,
            n.requested_end_date,n.requested_start_year_month,n.work_duration,n.raw_submission_id,
            c.company_name,p.position_name,wm.work_mode_name,
            rr.resume_text_sha256,re.extraction_version,
            (SELECT normalized_value FROM submission_identity_feature f WHERE f.submission_normalized_id=n.id AND f.feature_type='linkedin_url' ORDER BY is_primary_candidate DESC,id LIMIT 1) linkedin_url,
            (SELECT normalized_value FROM submission_identity_feature f WHERE f.submission_normalized_id=n.id AND f.feature_type='github_url' ORDER BY is_primary_candidate DESC,id LIMIT 1) github_url
     FROM submission_normalized n JOIN company c ON c.id=n.company_id
     JOIN position p ON p.id=n.position_id
     LEFT JOIN company_work_mode cwm ON cwm.id=n.company_work_mode_id
     LEFT JOIN work_mode wm ON wm.id=cwm.work_mode_id
     JOIN resume_extraction re ON re.id=?2
     JOIN raw_submission_resume rr ON rr.id=re.raw_submission_resume_id
     WHERE n.id=?1 AND re.submission_normalized_id=n.id`,
  ).bind(submissionNormalizedId,resumeExtractionId).first<CoreSourceRow>();
  if(!source||!source.normalized_email_address||!source.requested_start_year_month)throw new Error("application_core_source_incomplete");
  const pipeline=await db.prepare(
    `SELECT pipeline.id pipeline_id,stage.id stage_id FROM hiring_pipeline pipeline
     JOIN pipeline_stage stage ON stage.hiring_pipeline_id=pipeline.id AND stage.is_initial=1
     WHERE pipeline.pipeline_family_code='hirebeat_flexible_hiring' AND pipeline.pipeline_status='active' LIMIT 1`,
  ).first<{pipeline_id:number;stage_id:number}>();
  if(!pipeline)throw new Error("active_hiring_pipeline_missing");
  const now=new Date().toISOString();const applicationUuid=crypto.randomUUID();const candidateUuid=crypto.randomUUID();
  const fence=crypto.randomUUID();const applicationStageUuid=crypto.randomUUID();const transitionUuid=crypto.randomUUID();const outboxUuid=crypto.randomUUID();
  const profileHash=await sha256(JSON.stringify({name:source.normalized_person_name,email:source.normalized_email_address,phone:source.normalized_phone,resume:source.resume_text_sha256,extraction:source.extraction_version}));
  const lineageHash=await sha256(JSON.stringify({submissionNormalizedId,rawSubmissionId:source.raw_submission_id,dedupRunId:dedup.dedupRunId,resumeExtractionId}));
  const emailHmac=await keyedHmac(source.normalized_email_address,hmacSecret);
  const phoneHmac=source.normalized_phone?await keyedHmac(source.normalized_phone,hmacSecret):null;
  const linkedinHmac=source.linkedin_url?await keyedHmac(source.linkedin_url,hmacSecret):null;
  const githubHmac=source.github_url?await keyedHmac(source.github_url,hmacSecret):null;
  const supersedeFence=crypto.randomUUID();
  const statements:D1PreparedStatement[]=[];
  statements.push(db.prepare(
    `INSERT OR IGNORE INTO person (
       person_uuid,normalized_person_name,normalized_first_name,normalized_middle_name,
       normalized_last_name,normalized_email_address,normalized_phone,person_status,created_at,updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,'active',?8,?8)`,
  ).bind(crypto.randomUUID(),source.normalized_person_name,source.normalized_first_name,source.normalized_middle_name,source.normalized_last_name,source.normalized_email_address,source.normalized_phone,now));
  statements.push(db.prepare(
    `INSERT INTO application (
       application_uuid,person_id,company_id,company_work_mode_id,position_id,
       previous_application_id,hiring_pipeline_id,current_stage_id,
       company_name_snapshot,company_work_mode_name_snapshot,position_name_snapshot,
       requested_start_date,requested_end_date,requested_start_year_month,work_duration,
       application_group_key,submission_attempt_number,max_submission_attempts_snapshot,
       application_lifecycle_status,application_decision_status,decision_fence_token,
       applied_at,current_stage_entered_at,created_at,updated_at
     ) SELECT ?1,person.id,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,
              ?16,?17,'processing','pending',?18,?19,?19,?19,?19
       FROM person WHERE normalized_email_address=?20`,
  ).bind(applicationUuid,source.company_id,source.company_work_mode_id,source.position_id,dedup.previousApplicationId,pipeline.pipeline_id,pipeline.stage_id,
    source.company_name,source.work_mode_name,source.position_name,source.requested_start_date,source.requested_end_date,source.requested_start_year_month,
    source.work_duration,dedup.groupKey,dedup.submissionAttemptNumber,dedup.maxSubmissionAttempts,fence,now,source.normalized_email_address));
  statements.push(db.prepare(
    `INSERT INTO candidate_snapshot (
       candidate_snapshot_uuid,application_id,person_id,snapshot_status,
       normalized_person_name,normalized_first_name,normalized_middle_name,normalized_last_name,
       normalized_email_address,normalized_phone,normalized_linkedin_url,normalized_github_url,
       source_resume_text_sha256,source_extraction_version,profile_snapshot_sha256,
       snapshot_created_at,created_at,updated_at
     ) SELECT ?1,app.id,app.person_id,'core_published',?2,?3,?4,?5,?6,?7,?8,?9,
              ?10,?11,?12,?13,?13,?13 FROM application app WHERE app.application_uuid=?14`,
  ).bind(candidateUuid,source.normalized_person_name,source.normalized_first_name,source.normalized_middle_name,source.normalized_last_name,
    source.normalized_email_address,source.normalized_phone,source.linkedin_url,source.github_url,source.resume_text_sha256,source.extraction_version,profileHash,now,applicationUuid));
  statements.push(db.prepare(
    `UPDATE application SET current_candidate_snapshot_id=(SELECT id FROM candidate_snapshot WHERE candidate_snapshot_uuid=?2),updated_at=?3 WHERE application_uuid=?1`,
  ).bind(applicationUuid,candidateUuid,now));
  statements.push(db.prepare(
    `INSERT INTO application_source_lineage (
       application_id,source_submission_normalized_id,source_raw_submission_id,
       source_dedup_run_id,source_resume_extraction_id,relation_role,
       source_snapshot_sha256,linked_at,created_at
     ) SELECT id,?2,?3,?4,?5,'primary_decision_input',?6,?7,?7 FROM application WHERE application_uuid=?1`,
  ).bind(applicationUuid,submissionNormalizedId,source.raw_submission_id,dedup.dedupRunId,resumeExtractionId,lineageHash,now));
  statements.push(db.prepare(`UPDATE person_name SET is_primary=0,updated_at=?2 WHERE person_id=(SELECT person_id FROM application WHERE application_uuid=?1) AND is_primary=1 AND normalized_name<>?3`)
    .bind(applicationUuid,now,source.normalized_person_name));
  statements.push(db.prepare(
    `INSERT INTO person_name (person_id,source_candidate_snapshot_id,display_name,normalized_name,name_source,is_primary,first_seen_at,last_seen_at,created_at,updated_at)
     SELECT app.person_id,candidate.id,?2,?2,'submitted_field',1,?3,?3,?3,?3
     FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id
     WHERE app.application_uuid=?1
     ON CONFLICT(person_id,normalized_name) DO UPDATE SET source_candidate_snapshot_id=excluded.source_candidate_snapshot_id,is_primary=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
  ).bind(applicationUuid,source.normalized_person_name,now));
  statements.push(db.prepare(`UPDATE person_contact SET is_primary=0,updated_at=?2 WHERE person_id=(SELECT person_id FROM application WHERE application_uuid=?1) AND contact_type_id=(SELECT id FROM contact_type WHERE contact_type_code='email') AND contact_value_hmac<>?3`)
    .bind(applicationUuid,now,emailHmac));
  statements.push(db.prepare(
    `INSERT INTO person_contact (person_id,contact_type_id,source_candidate_snapshot_id,normalized_contact_value,contact_value_hmac,hmac_key_version,is_primary,is_verified,first_seen_at,last_seen_at,created_at,updated_at)
     SELECT app.person_id,type.id,candidate.id,?2,?3,'identity-hmac-v1',1,0,?4,?4,?4,?4
     FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id
     JOIN contact_type type ON type.contact_type_code='email' WHERE app.application_uuid=?1
     ON CONFLICT(person_id,contact_type_id,contact_value_hmac) DO UPDATE SET source_candidate_snapshot_id=excluded.source_candidate_snapshot_id,is_primary=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
  ).bind(applicationUuid,source.normalized_email_address,emailHmac,now));
  if(source.normalized_phone&&phoneHmac){
    statements.push(db.prepare(
      `UPDATE person_contact SET is_primary=0,updated_at=?2
       WHERE person_id=(SELECT person_id FROM application WHERE application_uuid=?1)
         AND contact_type_id=(SELECT id FROM contact_type WHERE contact_type_code='phone')
         AND contact_value_hmac<>?3`,
    ).bind(applicationUuid,now,phoneHmac));
    statements.push(db.prepare(
    `INSERT INTO person_contact (person_id,contact_type_id,source_candidate_snapshot_id,normalized_contact_value,contact_value_hmac,hmac_key_version,is_primary,is_verified,first_seen_at,last_seen_at,created_at,updated_at)
     SELECT app.person_id,type.id,candidate.id,?2,?3,'identity-hmac-v1',1,0,?4,?4,?4,?4
     FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id
     JOIN contact_type type ON type.contact_type_code='phone' WHERE app.application_uuid=?1
     ON CONFLICT(person_id,contact_type_id,contact_value_hmac) DO UPDATE SET source_candidate_snapshot_id=excluded.source_candidate_snapshot_id,is_primary=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
  ).bind(applicationUuid,source.normalized_phone,phoneHmac,now));}
  for(const [type,url,hmac] of [["linkedin",source.linkedin_url,linkedinHmac],["github",source.github_url,githubHmac]] as const){if(url&&hmac){
    statements.push(db.prepare(
      `UPDATE person_link SET is_primary=0,updated_at=?2
       WHERE person_id=(SELECT person_id FROM application WHERE application_uuid=?1)
         AND link_type=?3 AND normalized_url_hmac<>?4`,
    ).bind(applicationUuid,now,type,hmac));
    statements.push(db.prepare(
    `INSERT INTO person_link (person_id,source_candidate_snapshot_id,link_type,normalized_url,normalized_url_hmac,hmac_key_version,is_primary,first_seen_at,last_seen_at,created_at,updated_at)
     SELECT app.person_id,candidate.id,?2,?3,?4,'identity-hmac-v1',1,?5,?5,?5,?5
     FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id WHERE app.application_uuid=?1
     ON CONFLICT(person_id,link_type,normalized_url_hmac) DO UPDATE SET source_candidate_snapshot_id=excluded.source_candidate_snapshot_id,is_primary=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
  ).bind(applicationUuid,type,url,hmac,now));}}
  statements.push(db.prepare(
    `INSERT INTO application_stage_run (
       application_stage_run_uuid,application_id,hiring_pipeline_id,pipeline_stage_id,
       workflow_run_id,idempotency_key,application_fence_token,actual_sequence_no,attempt_no,
       run_status,stage_outcome_code,executor_type,result_summary,result_metadata_json,
       scheduled_at,started_at,completed_at,created_at,updated_at
     ) SELECT ?1,id,?2,?3,?4,?5,?6,1,1,'completed','received','system_rule',
              'Application core published','{}',?7,?7,?7,?7,?7 FROM application WHERE application_uuid=?8`,
  ).bind(applicationStageUuid,pipeline.pipeline_id,pipeline.stage_id,workflowRunId,`stage:${applicationUuid}:application_received:1`,fence,now,applicationUuid));
  statements.push(db.prepare(
    `INSERT INTO application_stage_transition_event (
       transition_event_uuid,application_id,hiring_pipeline_id,to_stage_run_id,to_stage_id,
       movement_type,reason_code,initiated_by_type,workflow_run_id,application_fence_token,
       idempotency_key,event_metadata_json,occurred_at,created_at
     ) SELECT ?1,app.id,?2,stage.id,?3,'initial_entry','application_core_published','system_rule',
              ?4,?5,?6,'{}',?7,?7 FROM application app JOIN application_stage_run stage ON stage.application_id=app.id
       WHERE app.application_uuid=?8 AND stage.application_stage_run_uuid=?9`,
  ).bind(transitionUuid,pipeline.pipeline_id,pipeline.stage_id,workflowRunId,fence,`transition:${applicationUuid}:initial`,now,applicationUuid,applicationStageUuid));
  if(dedup.previousApplicationId){
    statements.push(db.prepare(
      `UPDATE application SET application_lifecycle_status='superseded',superseded_by_application_id=(SELECT id FROM application WHERE application_uuid=?2),
       superseded_at=?3,decision_fence_token=?4,updated_at=?3 WHERE id=?1 AND application_lifecycle_status IN ('processing','completed') AND application_decision_status IN ('pending','rejected')`,
    ).bind(dedup.previousApplicationId,applicationUuid,now,supersedeFence));
    statements.push(db.prepare(`UPDATE candidate_snapshot SET snapshot_status='superseded',superseded_at=?2,updated_at=?2 WHERE application_id=?1 AND snapshot_status<>'superseded'`)
      .bind(dedup.previousApplicationId,now));
    statements.push(db.prepare(`UPDATE application_stage_run SET run_status='cancelled',stage_outcome_code='cancelled',cancellation_reason_code='application_superseded',completed_at=?2,updated_at=?2 WHERE application_id=?1 AND run_status IN ('scheduled','in_progress','waiting')`)
      .bind(dedup.previousApplicationId,now));
    statements.push(db.prepare(`UPDATE etl_workflow_run SET workflow_status='cancelled',cancellation_reason_code='application_superseded',completed_at=?2,updated_at=?2 WHERE application_id=?1 AND workflow_status IN ('requested','running','waiting')`)
      .bind(dedup.previousApplicationId,now));
  }
  statements.push(db.prepare(
    `UPDATE person SET normalized_person_name=?2,normalized_first_name=?3,normalized_middle_name=?4,normalized_last_name=?5,
       normalized_phone=COALESCE(?6,normalized_phone),current_application_id=(SELECT id FROM application WHERE application_uuid=?1),
       current_candidate_snapshot_id=(SELECT id FROM candidate_snapshot WHERE candidate_snapshot_uuid=?7),updated_at=?8
     WHERE normalized_email_address=?9`,
  ).bind(applicationUuid,source.normalized_person_name,source.normalized_first_name,source.normalized_middle_name,source.normalized_last_name,source.normalized_phone,candidateUuid,now,source.normalized_email_address));
  statements.push(db.prepare(
    `INSERT INTO outbox_event (event_uuid,deduplication_key,event_type,event_schema_version,aggregate_type,aggregate_id,destination_type,destination_key,
       producer_workflow_run_id,event_payload_json,dispatch_status,delivery_attempt_count,max_delivery_attempts,available_at,created_at,updated_at)
     SELECT ?1,?2,'application.core_published','application-core-published-v1','application',app.id,'cloudflare_workflow','workflow_b',?3,
            json_object('applicationId',app.id,'candidateSnapshotId',candidate.id,'configurationReleaseId',?4,'decisionFenceToken',?5),
            'pending',0,?6,?7,?7,?7 FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id WHERE app.application_uuid=?8`,
  ).bind(outboxUuid,`workflow_b:${applicationUuid}`,workflowRunId,configurationReleaseId,fence,outboxMaximumAttempts,now,applicationUuid));
  const results=await db.batch(statements);if(results.some((result)=>!result.success))throw new Error("application_core_publish_transaction_failed");
  const result=await db.prepare(
    `SELECT app.id application_id,candidate.id candidate_id,outbox.id outbox_id
     FROM application app JOIN candidate_snapshot candidate ON candidate.application_id=app.id
     JOIN outbox_event outbox ON outbox.aggregate_id=app.id AND outbox.event_type='application.core_published'
     WHERE app.application_uuid=?1`,
  ).bind(applicationUuid).first<{application_id:number;candidate_id:number;outbox_id:number}>();
  if(!result)throw new Error("application_core_publish_verification_failed");
  return{applicationId:result.application_id,candidateSnapshotId:result.candidate_id,decisionFenceToken:fence,outboxEventId:result.outbox_id};
}
