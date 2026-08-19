import { keyedHmac, normalizeEmail, normalizePhone, normalizedUrl, normalizeWhitespace } from "./crypto";
import {
  classifySkillCandidates,
  extractEducation, extractEmployment, extractIdentityCandidates,
  extractProjects,
} from "./resume-rule-extractor";

export interface ExtractionResult {
  resumeExtractionId: number;
  rawSubmissionResumeId: number;
  resumeTextSha256: string;
}

interface ExtractionInput {
  submission_normalized_id:number;
  raw_submission_resume_id:number;
  resume_text:string;
  resume_text_sha256:string;
  normalized_email_address:string|null;
  normalized_phone:string|null;
}

export async function extractResume(
  db:D1Database,
  workflowRunId:number,
  stepRunId:number,
  submissionNormalizedId:number,
  hmacSecret:string,
):Promise<ExtractionResult>{
  const existing=await db.prepare(
    `SELECT id,raw_submission_resume_id,input_resume_text_sha256 FROM resume_extraction
     WHERE submission_normalized_id=?1 AND extraction_version='resume-rule-extraction-v1'
       AND extraction_status IN ('succeeded','succeeded_no_structured_entity')`,
  ).bind(submissionNormalizedId).first<{id:number;raw_submission_resume_id:number;input_resume_text_sha256:string}>();
  if(existing)return{resumeExtractionId:existing.id,rawSubmissionResumeId:existing.raw_submission_resume_id,resumeTextSha256:existing.input_resume_text_sha256};
  // A step retry may observe an extraction row whose parent insert committed
  // before a child-row write failed. All extraction candidates and resume-text
  // identity features are workflow-owned children, so deleting only this
  // unpublished version is a safe local compensation; ON DELETE CASCADE
  // removes its partial children.
  await db.prepare(
    `DELETE FROM resume_extraction
     WHERE submission_normalized_id=?1
       AND extraction_version='resume-rule-extraction-v1'
       AND extraction_status NOT IN ('succeeded','succeeded_no_structured_entity')`,
  ).bind(submissionNormalizedId).run();
  const input=await db.prepare(
    `SELECT normalized.id submission_normalized_id,resume.id raw_submission_resume_id,
            resume.resume_text,resume.resume_text_sha256,
            normalized.normalized_email_address,normalized.normalized_phone
     FROM submission_normalized normalized
     JOIN raw_submission_resume resume ON resume.raw_submission_id=normalized.raw_submission_id
     WHERE normalized.id=?1 AND resume.resume_text_status='available'`,
  ).bind(submissionNormalizedId).first<ExtractionInput>();
  if(!input||!input.resume_text||!input.resume_text_sha256)throw new Error("extractable_resume_text_missing");
  const education=extractEducation(input.resume_text);
  const employment=extractEmployment(input.resume_text);
  const projects=extractProjects(input.resume_text);
  const identities=extractIdentityCandidates(input.resume_text);
  const skills=await db.prepare(
    `SELECT id,skill_name,normalized_skill_name FROM skill WHERE is_active=1 ORDER BY length(normalized_skill_name) DESC`,
  ).all<{id:number;skill_name:string;normalized_skill_name:string}>();
  const skillCandidates=classifySkillCandidates(input.resume_text,skills.results);
  const matchedSkills=skillCandidates.filter(
    (skill)=>skill.extractionEligibilityStatus==="eligible",
  );
  const unmappedSkillCount=skillCandidates.length-matchedSkills.length;
  const warningsJson=unmappedSkillCount===0?"[]":JSON.stringify([
    {code:"unmapped_skill_candidates",count:unmappedSkillCount},
  ]);
  const now=new Date().toISOString();
  const extractionUuid=crypto.randomUUID();
  await db.prepare(
    `INSERT INTO resume_extraction (
       resume_extraction_uuid,submission_normalized_id,raw_submission_resume_id,
       workflow_run_id,step_run_id,extraction_version,idempotency_key,
       input_resume_text_sha256,extraction_status,identity_record_count,
       education_record_count,employment_record_count,skill_record_count,
       project_record_count,warning_count,warnings_json,started_at,created_at,updated_at
     ) VALUES (?1,?2,?3,?4,?5,'resume-rule-extraction-v1',?6,?7,'running',
               0,?8,?9,?10,?11,?12,?13,?14,?14,?14)`,
  ).bind(extractionUuid,submissionNormalizedId,input.raw_submission_resume_id,workflowRunId,
    stepRunId,`extract:${submissionNormalizedId}:v1`,input.resume_text_sha256,
    education.length,employment.length,skillCandidates.length,projects.length,
    unmappedSkillCount,warningsJson,now).run();
  const extraction=await db.prepare(`SELECT id FROM resume_extraction WHERE resume_extraction_uuid=?1`)
    .bind(extractionUuid).first<{id:number}>();
  if(!extraction)throw new Error("resume_extraction_create_failed");

  const degreeRows=(await db.prepare(`SELECT id,degree_code,degree_name FROM degree WHERE is_active=1`).all<{id:number;degree_code:string;degree_name:string}>()).results;
  let order=0;
  for(const item of education){
    order+=1;
    const degree=degreeRows.find((row)=>item.degreeName && (`${row.degree_code} ${row.degree_name}`).toLowerCase().split(/\s+/).some((token)=>token.length>2&&item.degreeName!.toLowerCase().includes(token)))??null;
    const status=!item.rawText?"rejected_missing_raw_text":!item.schoolName?"rejected_missing_school":!item.degreeName?"rejected_missing_degree":!degree?"rejected_unmapped_degree":"eligible";
    await db.prepare(
      `INSERT INTO resume_education (
         resume_extraction_id,source_entry_order,raw_education_text,raw_school_name,
         normalized_school_name,raw_degree_name,normalized_degree_name,degree_id,
         education_start_date,education_end_date,is_current,
         extraction_eligibility_status,rejection_reason_detail,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
    ).bind(extraction.id,order,item.rawText,item.schoolName,normalizeWhitespace(item.schoolName)?.toLowerCase()??null,
      item.degreeName,normalizeWhitespace(item.degreeName)?.toLowerCase()??null,degree?.id??null,item.startDate,item.endDate,
      item.endDate===null&&item.startDate!==null?1:null,status,status==="eligible"?null:status,now).run();
  }
  order=0;
  for(const item of employment){
    order+=1;
    const status=!item.rawText?"rejected_missing_raw_text":!item.companyName?"rejected_missing_company":!item.positionName?"rejected_missing_position":!item.startDate&&!item.endDate?"rejected_missing_date":"eligible";
    await db.prepare(
      `INSERT INTO resume_employment (
         resume_extraction_id,source_entry_order,raw_employment_text,raw_company_name,
         normalized_company_name,raw_position_name,normalized_position_name,
         employment_description,employment_start_date,employment_end_date,is_current,
         extraction_eligibility_status,rejection_reason_detail,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?3,?8,?9,?10,?11,?12,?13)`,
    ).bind(extraction.id,order,item.rawText,item.companyName,normalizeWhitespace(item.companyName)?.toLowerCase()??null,
      item.positionName,normalizeWhitespace(item.positionName)?.toLowerCase()??null,item.startDate,item.endDate,item.isCurrent,
      status,status==="eligible"?null:status,now).run();
  }
  order=0;
  for(const skill of skillCandidates){
    order+=1;
    await db.prepare(
      `INSERT INTO resume_skill (
         resume_extraction_id,source_entry_order,raw_skill_text,normalized_skill_name,
         skill_id,matched_context_text,match_method,extraction_eligibility_status,
         rejection_reason_detail,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(extraction.id,order,skill.rawSkillText,skill.normalizedSkillName,
      skill.skillId,skill.rawSkillText,skill.matchMethod,
      skill.extractionEligibilityStatus,skill.rejectionReasonDetail,now).run();
  }
  order=0;
  for(const item of projects){
    order+=1;
    const status=!item.rawText?"rejected_missing_raw_text":!item.projectName?"rejected_missing_project_name":"eligible";
    await db.prepare(
      `INSERT INTO resume_project (
         resume_extraction_id,source_entry_order,raw_project_text,raw_project_name,
         normalized_project_name,project_description,project_url,
         extraction_eligibility_status,rejection_reason_detail,created_at
       ) VALUES (?1,?2,?3,?4,?5,?3,?6,?7,?8,?9)`,
    ).bind(extraction.id,order,item.rawText,item.projectName,normalizeWhitespace(item.projectName)?.toLowerCase()??null,
      item.projectUrl,status,status==="eligible"?null:status,now).run();
  }

  const featureKeys=new Set<string>();
  const features:Array<{type:"email"|"phone"|"linkedin_url"|"github_url";value:string;source:"submitted_field"|"resume_text";handle:string|null;primary:number}> = [];
  const submittedEmail=normalizeEmail(input.normalized_email_address);
  const submittedPhone=normalizePhone(input.normalized_phone);
  if(submittedEmail)features.push({type:"email",value:submittedEmail,source:"submitted_field",handle:null,primary:1});
  if(submittedPhone)features.push({type:"phone",value:submittedPhone,source:"submitted_field",handle:null,primary:1});
  for(const identity of identities)features.push({type:identity.type,value:identity.type.endsWith("url")?(normalizedUrl(identity.value)??identity.value):identity.value,source:"resume_text",handle:identity.accountHandle,primary:0});
  let insertedIdentityCount=0;
  for(const feature of features){
    const key=`${feature.type}:${feature.source}:${feature.value}`;
    if(featureKeys.has(key))continue;featureKeys.add(key);
    const hmac=await keyedHmac(feature.value,hmacSecret);
    await db.prepare(
      `INSERT OR IGNORE INTO submission_identity_feature (
         submission_normalized_id,resume_extraction_id,feature_type,feature_source,
         normalized_value,normalized_value_hmac,hmac_key_version,account_handle,
         is_primary_candidate,selection_status,created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,'identity-hmac-v1',?7,?8,?9,?10)`,
    ).bind(submissionNormalizedId,feature.source==="resume_text"?extraction.id:null,feature.type,feature.source,
      feature.value,hmac,feature.handle,feature.primary,feature.primary?"selected":"additional_candidate",now).run();
    insertedIdentityCount+=1;
  }
  const structuredCount=education.length+employment.length+matchedSkills.length+projects.length;
  await db.prepare(
    `UPDATE resume_extraction SET extraction_status=?2,identity_record_count=?3,
       completed_at=?4,updated_at=?4 WHERE id=?1`,
  ).bind(extraction.id,structuredCount===0?"succeeded_no_structured_entity":"succeeded",insertedIdentityCount,now).run();
  return{resumeExtractionId:extraction.id,rawSubmissionResumeId:input.raw_submission_resume_id,resumeTextSha256:input.resume_text_sha256};
}
