import { keyedHmac } from "./crypto";

export interface DedupResult {
  dedupRunId:number;
  entryDecision:string;
  submissionAttemptNumber:number|null;
  maxSubmissionAttempts:number|null;
  previousApplicationId:number|null;
  selectedPriorSubmissionNormalizedId:number|null;
  groupKey:string|null;
}

interface TargetRow{ id:number;company_id:number;position_id:number;requested_start_year_month:string|null;normalized_last_name:string|null; }
interface MatchRow{ prior_id:number;has_application:number;source_submitted_at:string|null;strong_count:number;resume_count:number;total_count:number; }
interface PriorApplication{ id:number;application_lifecycle_status:string;application_decision_status:string;submission_attempt_number:number;max_submission_attempts_snapshot:number; }

export async function runDedup(
  db:D1Database,workflowRunId:number,stepRunId:number,submissionNormalizedId:number,
  hmacSecret:string,
):Promise<DedupResult>{
  const existing=await db.prepare(
    `SELECT id,application_entry_decision,submission_attempt_number,
            max_submission_attempts_snapshot,selected_prior_submission_normalized_id,
            dedup_group_key
     FROM submission_dedup_run WHERE target_submission_normalized_id=?1
       AND dedup_rule_version='dedup-v1' AND run_status='succeeded'`,
  ).bind(submissionNormalizedId).first<any>();
  if(existing){
    const previous=existing.selected_prior_submission_normalized_id?await priorApplication(db,existing.selected_prior_submission_normalized_id):null;
    return{dedupRunId:existing.id,entryDecision:existing.application_entry_decision,
      submissionAttemptNumber:existing.submission_attempt_number,maxSubmissionAttempts:existing.max_submission_attempts_snapshot,
      previousApplicationId:previous?.id??null,selectedPriorSubmissionNormalizedId:existing.selected_prior_submission_normalized_id,
      groupKey:existing.dedup_group_key};
  }
  // Dedup match/evidence rows are unpublished, workflow-owned derivatives.
  // Remove only a partial run for this target/version before retrying; child
  // matches and evidence cascade with the run.
  await db.prepare(
    `DELETE FROM submission_dedup_run
     WHERE target_submission_normalized_id=?1
       AND dedup_rule_version='dedup-v1' AND run_status<>'succeeded'`,
  ).bind(submissionNormalizedId).run();
  const target=await db.prepare(
    `SELECT id,company_id,position_id,requested_start_year_month,normalized_last_name
     FROM submission_normalized WHERE id=?1`,
  ).bind(submissionNormalizedId).first<TargetRow>();
  if(!target)throw new Error("dedup_target_missing");
  const now=new Date().toISOString();
  const groupKey=target.requested_start_year_month?`${target.company_id}|${target.position_id}|${target.requested_start_year_month}`:null;
  const company=await db.prepare(`SELECT COALESCE(default_max_submission_attempts,5) maximum FROM company WHERE id=?1`)
    .bind(target.company_id).first<{maximum:number}>();
  const maximum=company?.maximum??5;
  const runUuid=crypto.randomUUID();
  await db.prepare(
    `INSERT INTO submission_dedup_run (
       dedup_run_uuid,target_submission_normalized_id,workflow_run_id,step_run_id,
       dedup_rule_version,idempotency_key,dedup_company_id,dedup_position_id,
       dedup_requested_start_year_month,dedup_group_key,run_status,
       application_entry_decision,scope_submission_count,evaluated_pair_count,
       matched_pair_count,rule_config_json,started_at,created_at,updated_at
     ) SELECT ?1,?2,?3,?4,'dedup-v1',?5,company_id,position_id,
              requested_start_year_month,?6,'running','pending',
              (SELECT COUNT(*) FROM submission_normalized prior
                WHERE prior.company_id=target.company_id AND prior.position_id=target.position_id
                  AND prior.requested_start_year_month=target.requested_start_year_month
                  AND prior.id<>target.id),0,0,
              json_object('strongTypes',json_array('email','phone','linkedin_url'),
                          'githubRequiresLastName',1,'group','company_position_start_year_month'),
              ?7,?7,?7
       FROM submission_normalized target WHERE target.id=?2`,
  ).bind(runUuid,submissionNormalizedId,workflowRunId,stepRunId,`dedup:${submissionNormalizedId}:v1`,groupKey,now).run();
  const run=await db.prepare(`SELECT id FROM submission_dedup_run WHERE dedup_run_uuid=?1`).bind(runUuid).first<{id:number}>();
  if(!run)throw new Error("dedup_run_create_failed");
  if(!groupKey){
    await finishRun(db,run.id,{decision:"not_evaluated_missing_group_key",entry:"blocked_missing_dedup_group",reason:"requested_start_year_month_missing",attempt:null,maximum,selected:null,canonical:null,scope:0,evaluated:0,matched:0,strong:0,resume:0,score:null},now);
    return{dedupRunId:run.id,entryDecision:"blocked_missing_dedup_group",submissionAttemptNumber:null,maxSubmissionAttempts:maximum,previousApplicationId:null,selectedPriorSubmissionNormalizedId:null,groupKey:null};
  }
  const matchQuery=await db.prepare(
    `SELECT prior.id prior_id,
            EXISTS(SELECT 1 FROM application_source_lineage l WHERE l.source_submission_normalized_id=prior.id AND l.relation_role='primary_decision_input') has_application,
            raw.source_submitted_at,
            SUM(CASE WHEN target_feature.feature_type IN ('email','phone','linkedin_url') THEN 1 ELSE 0 END) strong_count,
            SUM(CASE WHEN target_feature.feature_type='github_url' AND target.normalized_last_name=prior.normalized_last_name THEN 1 ELSE 0 END) resume_count,
            COUNT(*) total_count
     FROM submission_normalized target
     JOIN submission_normalized prior
       ON prior.company_id=target.company_id AND prior.position_id=target.position_id
      AND prior.requested_start_year_month=target.requested_start_year_month AND prior.id<>target.id
     JOIN raw_submission raw ON raw.id=prior.raw_submission_id
     JOIN submission_identity_feature target_feature ON target_feature.submission_normalized_id=target.id
     JOIN submission_identity_feature prior_feature
       ON prior_feature.submission_normalized_id=prior.id
      AND prior_feature.feature_type=target_feature.feature_type
      AND prior_feature.normalized_value_hmac=target_feature.normalized_value_hmac
     WHERE target.id=?1
     GROUP BY prior.id
     HAVING strong_count>0 OR resume_count>0
     ORDER BY has_application DESC,raw.source_submitted_at DESC,prior.id DESC`,
  ).bind(submissionNormalizedId).all<MatchRow>();
  const matches=matchQuery.results;
  let selected:number|null=null;
  for(const match of matches){
    const isSelected=selected===null&&match.has_application===1;
    if(isSelected)selected=match.prior_id;
    const matchUuid=crypto.randomUUID();
    await db.prepare(
      `INSERT INTO submission_dedup_match (
         dedup_match_uuid,dedup_run_id,target_submission_normalized_id,
         matched_submission_normalized_id,primary_match_rule,is_selected_prior_submission,
         strong_evidence_count,resume_identity_evidence_count,total_evidence_count,
         has_strong_identity_match,has_resume_identity_match,final_match_score,matched_at,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1.0,?12,?12)`,
    ).bind(matchUuid,run.id,submissionNormalizedId,match.prior_id,match.strong_count>0?"strong_identity_exact":"github_plus_last_name",
      isSelected?1:0,match.strong_count,match.resume_count,match.total_count,match.strong_count>0?1:0,match.resume_count>0?1:0,now).run();
    const matchId=await db.prepare(`SELECT id FROM submission_dedup_match WHERE dedup_match_uuid=?1`).bind(matchUuid).first<{id:number}>();
    if(!matchId)throw new Error("dedup_match_create_failed");
    const evidence=await db.prepare(
      `SELECT target_feature.id target_id,prior_feature.id prior_id,
              target_feature.feature_type,target_feature.normalized_value_hmac,target_feature.hmac_key_version
       FROM submission_identity_feature target_feature
       JOIN submission_identity_feature prior_feature
         ON prior_feature.submission_normalized_id=?2
        AND prior_feature.feature_type=target_feature.feature_type
        AND prior_feature.normalized_value_hmac=target_feature.normalized_value_hmac
       WHERE target_feature.submission_normalized_id=?1`,
    ).bind(submissionNormalizedId,match.prior_id).all<{target_id:number;prior_id:number;feature_type:string;normalized_value_hmac:string;hmac_key_version:string}>();
    let evidenceOrder=0;
    for(const item of evidence.results){
      if(item.feature_type==="github_url" && !target.normalized_last_name)continue;
      evidenceOrder+=1;
      const evidenceType=item.feature_type==="email"?"email_exact_match":item.feature_type==="phone"?"phone_last_10_exact_match":item.feature_type==="linkedin_url"?"linkedin_exact_match":"github_exact_match_with_same_normalized_last_name";
      const githubLastNameHmac=item.feature_type==="github_url"&&target.normalized_last_name?await keyedHmac(target.normalized_last_name,hmacSecret):null;
      await db.prepare(
      `INSERT INTO submission_match_evidence (
         evidence_uuid,dedup_match_id,evidence_type,evidence_strength,
         target_identity_feature_id,matched_identity_feature_id,matched_value_hmac,
         hmac_key_version,is_primary_rule,evidence_score,github_last_name_match,
         matched_normalized_last_name_hmac,evidence_metadata_json,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1.0,?10,?11,'{}',?12)`,
    ).bind(crypto.randomUUID(),matchId.id,evidenceType,item.feature_type==="github_url"?"medium":"strong",
      item.target_id,item.prior_id,item.normalized_value_hmac,item.hmac_key_version,evidenceOrder===1?1:0,
      item.feature_type==="github_url"?1:null,githubLastNameHmac,now).run();}
  }
  let entry:string;let attempt:number|null;let reason:string;let previous:PriorApplication|null=null;
  if(matches.length===0){entry="admitted_new_application";attempt=1;reason="no_duplicate_identity_match";}
  else if(selected===null){entry="blocked_prior_application_state";attempt=null;reason="duplicate_has_no_published_application";}
  else{
    previous=await priorApplication(db,selected);
    if(!previous){entry="blocked_prior_application_state";attempt=null;reason="selected_prior_application_missing";}
    else if(previous.application_decision_status==="offer_created"){
      entry="blocked_offer_finalized";attempt=null;reason="prior_application_offer_created";
    }else if(!["processing","completed"].includes(previous.application_lifecycle_status)||!["pending","rejected"].includes(previous.application_decision_status)){
      entry="blocked_prior_application_state";attempt=null;reason="prior_application_state_not_resubmittable";
    }else if(previous.submission_attempt_number>=maximum){entry="blocked_resubmission_limit";attempt=null;reason="max_submission_attempts_reached";}
    else{entry="admitted_resubmission";attempt=previous.submission_attempt_number+1;reason="duplicate_allowed_resubmission";}
  }
  const strong=matches.some((m)=>m.strong_count>0)?1:0;const resume=matches.some((m)=>m.resume_count>0)?1:0;
  await finishRun(db,run.id,{decision:matches.length?"duplicate_detected":"no_duplicate",entry,reason,attempt,maximum,selected,canonical:selected??submissionNormalizedId,scope:matches.length,evaluated:matches.length,matched:matches.length,strong,resume,score:matches.length?1.0:0.0},now);
  return{dedupRunId:run.id,entryDecision:entry,submissionAttemptNumber:attempt,maxSubmissionAttempts:maximum,
    previousApplicationId:previous?.id??null,selectedPriorSubmissionNormalizedId:selected,groupKey};
}

async function priorApplication(db:D1Database,submissionNormalizedId:number):Promise<PriorApplication|null>{
  return db.prepare(
    `SELECT app.id,app.application_lifecycle_status,app.application_decision_status,
            app.submission_attempt_number,app.max_submission_attempts_snapshot
     FROM application_source_lineage lineage JOIN application app ON app.id=lineage.application_id
     WHERE lineage.source_submission_normalized_id=?1 AND lineage.relation_role='primary_decision_input'
     ORDER BY app.submission_attempt_number DESC,app.id DESC LIMIT 1`,
  ).bind(submissionNormalizedId).first<PriorApplication>();
}

async function finishRun(db:D1Database,id:number,v:any,now:string):Promise<void>{
  await db.prepare(
    `UPDATE submission_dedup_run SET run_status='succeeded',dedup_decision=?2,
       application_entry_decision=?3,decision_reason_code=?4,
       selected_prior_submission_normalized_id=?5,canonical_submission_normalized_id=?6,
       identity_component_key=?7,submission_attempt_number=?8,max_submission_attempts_snapshot=?9,
       scope_submission_count=?10,evaluated_pair_count=?11,matched_pair_count=?12,
       has_strong_identity_match=?13,has_resume_identity_match=?14,final_match_score=?15,
       completed_at=?16,updated_at=?16 WHERE id=?1`,
  ).bind(id,v.decision,v.entry,v.reason,v.selected,v.canonical,v.selected?`identity:${v.selected}`:null,v.attempt,v.maximum,
    v.scope,v.evaluated,v.matched,v.strong,v.resume,v.score,now).run();
}
