import { sha256 } from "./crypto";
import { calculateSimilarity } from "./ml-client";
import type { OrchestratorEnv } from "./env";

interface MlInput {
  application_id:number;candidate_snapshot_id:number;person_id:number;position_id:number;
  decision_fence_token:string;resume_text:string;resume_text_sha256:string;position_jd:string|null;
  seniority_name:string|null;employment_count:number;education_count:number;skill_count:number;project_count:number;
}

export interface MlRunResult {
  mlAnalysisRunId:number;
  anomalyResultId:number;
  similarityResultId:number|null;
  thresholdPolicyId:number|null;
  matchScore:number|null;
  threshold:number|null;
  recommendation:"offer"|"no_offer";
  method:"anomaly_exclusion"|"fixed_similarity_threshold";
  reasonCode:string;
}

async function input(db:D1Database,applicationId:number,candidateSnapshotId:number,fence:string):Promise<MlInput>{
  const row=await db.prepare(
    `SELECT app.id application_id,candidate.id candidate_snapshot_id,candidate.person_id,app.position_id,
            app.decision_fence_token,resume.resume_text,resume.resume_text_sha256,position.position_jd,
            seniority.seniority_name,
            (SELECT COUNT(*) FROM candidate_position cp WHERE cp.candidate_snapshot_id=candidate.id) employment_count,
            (SELECT COUNT(*) FROM candidate_education ce WHERE ce.candidate_snapshot_id=candidate.id) education_count,
            (SELECT COUNT(*) FROM candidate_skill cs WHERE cs.candidate_snapshot_id=candidate.id) skill_count,
            (SELECT COUNT(*) FROM candidate_project cp WHERE cp.candidate_snapshot_id=candidate.id) project_count
     FROM application app JOIN candidate_snapshot candidate ON candidate.id=?2 AND candidate.application_id=app.id
     JOIN application_source_lineage lineage ON lineage.application_id=app.id AND lineage.relation_role='primary_decision_input'
     JOIN resume_extraction extraction ON extraction.id=lineage.source_resume_extraction_id
     JOIN raw_submission_resume resume ON resume.id=extraction.raw_submission_resume_id
     JOIN position ON position.id=app.position_id
     LEFT JOIN seniority ON seniority.id=position.seniority_id
     WHERE app.id=?1 AND app.decision_fence_token=?3 AND app.application_lifecycle_status='processing'
       AND app.application_decision_status='pending' AND candidate.snapshot_status='enriched'`,
  ).bind(applicationId,candidateSnapshotId,fence).first<MlInput>();
  if(!row)throw new Error("ml_input_missing_or_fence_invalid");
  if(!row.resume_text||!row.resume_text_sha256)throw new Error("ml_resume_text_missing");
  return row;
}

export async function executeMl(
  env:OrchestratorEnv,workflowRunId:number,applicationId:number,candidateSnapshotId:number,fence:string,requestTimeoutMs=30_000,
):Promise<MlRunResult>{
  const source=await input(env.DB,applicationId,candidateSnapshotId,fence);
  const positionJd=source.position_jd?.trim()??"";
  const inputSnapshot=await sha256(JSON.stringify({
    candidateSnapshotId,
    decisionFenceToken:fence,
    resume:source.resume_text_sha256,
    positionId:source.position_id,
    positionJd:await sha256(positionJd),
  }));
  const pipelineSha=await sha256("hirebeat-ml-v1:all-MiniLM-L6-v2:full-resume-vs-full-jd");
  const jdSha=await sha256(positionJd);
  const now=new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ml_analysis_run (ml_analysis_run_uuid,application_id,candidate_snapshot_id,person_id,
       workflow_run_id,idempotency_key,application_fence_token,model_revision,model_config_json,pipeline_code,
       pipeline_source_code_sha256,anomaly_rule_version,input_snapshot_sha256,resume_text_sha256,position_jd_sha256,
       input_feature_snapshot_json,run_status,started_at,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,'{}','hirebeat-ml-v1',?8,'anomaly-v1',?9,?10,?11,?12,'running',?13,?13,?13)`,
  ).bind(crypto.randomUUID(),applicationId,candidateSnapshotId,source.person_id,workflowRunId,
    `ml:${applicationId}:${inputSnapshot}`,fence,pipelineSha,inputSnapshot,source.resume_text_sha256,jdSha,
    JSON.stringify({employmentCount:source.employment_count,educationCount:source.education_count,skillCount:source.skill_count,projectCount:source.project_count}),now).run();
  const run=await env.DB.prepare(`SELECT id,run_status FROM ml_analysis_run WHERE application_id=?1 AND input_snapshot_sha256=?2`)
    .bind(applicationId,inputSnapshot).first<{id:number;run_status:string}>();
  if(!run)throw new Error("ml_analysis_run_create_failed");
  const almostEmpty=source.employment_count===0&&source.education_count===0&&source.skill_count===0&&source.project_count===0;
  const senior=(source.seniority_name??"").toLowerCase();
  const seniorWithoutEmployment=/(senior|lead|principal|manager|director|executive)/.test(senior)&&source.employment_count===0;
  const anomalyFlags={candidate_profile_almost_empty:almostEmpty,senior_role_without_employment:seniorWithoutEmployment,position_jd_missing_or_too_short:positionJd.length<10};
  const hasAnomaly=Object.values(anomalyFlags).some(Boolean);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ml_anomaly_result (ml_analysis_run_id,application_id,candidate_snapshot_id,
       has_any_anomaly,anomaly_flags_json,disposition,created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`,
  ).bind(run.id,applicationId,candidateSnapshotId,hasAnomaly?1:0,JSON.stringify(anomalyFlags),hasAnomaly?"excluded_no_offer":"clean",now).run();
  const anomaly=await env.DB.prepare(`SELECT id FROM ml_anomaly_result WHERE ml_analysis_run_id=?1`).bind(run.id).first<{id:number}>();
  if(!anomaly)throw new Error("ml_anomaly_result_create_failed");
  if(hasAnomaly){
    await env.DB.prepare(`UPDATE ml_analysis_run SET run_status='succeeded',completed_at=?2,updated_at=?2 WHERE id=?1`).bind(run.id,now).run();
    return{mlAnalysisRunId:run.id,anomalyResultId:anomaly.id,similarityResultId:null,thresholdPolicyId:null,matchScore:null,threshold:null,recommendation:"no_offer",method:"anomaly_exclusion",reasonCode:"anomaly_excluded"};
  }
  const similarity=await calculateSimilarity(env.ML_SERVICE_URL,env.ML_SERVICE_AUTH_TOKEN,source.resume_text,positionJd,requestTimeoutMs);
  if(similarity.resume_text_sha256!==source.resume_text_sha256||similarity.position_jd_sha256!==jdSha)throw new Error("ml_service_input_hash_mismatch");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ml_similarity_result (ml_analysis_run_id,application_id,candidate_snapshot_id,position_id,
       match_score,similarity_metric,computed_at,created_at) VALUES (?1,?2,?3,?4,?5,'cosine_similarity',?6,?6)`,
  ).bind(run.id,applicationId,candidateSnapshotId,source.position_id,similarity.match_score,now).run();
  const similarityRow=await env.DB.prepare(`SELECT id FROM ml_similarity_result WHERE ml_analysis_run_id=?1`).bind(run.id).first<{id:number}>();
  const policy=await env.DB.prepare(
    `SELECT id,match_score_threshold FROM ml_threshold_policy WHERE policy_status='active'
     AND ((policy_scope_type='position' AND position_id=?1) OR policy_scope_type='global_default')
     ORDER BY CASE policy_scope_type WHEN 'position' THEN 1 ELSE 2 END LIMIT 1`,
  ).bind(source.position_id).first<{id:number;match_score_threshold:number}>();
  if(!similarityRow||!policy)throw new Error("ml_similarity_or_threshold_policy_missing");
  const pass=similarity.match_score>=policy.match_score_threshold;
  await env.DB.prepare(`UPDATE ml_analysis_run SET model_revision=?2,run_status='succeeded',completed_at=?3,updated_at=?3 WHERE id=?1`)
    .bind(run.id,similarity.model_revision,now).run();
  return{mlAnalysisRunId:run.id,anomalyResultId:anomaly.id,similarityResultId:similarityRow.id,
    thresholdPolicyId:policy.id,matchScore:similarity.match_score,threshold:policy.match_score_threshold,
    recommendation:pass?"offer":"no_offer",method:"fixed_similarity_threshold",reasonCode:pass?"similarity_threshold_passed":"similarity_threshold_not_met"};
}
