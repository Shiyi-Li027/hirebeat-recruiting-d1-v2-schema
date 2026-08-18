import { sha256 } from "./crypto";

interface ContextRow { person_id:number; resume_extraction_id:number; }

export interface EnrichmentResult {
  educationCount: number;
  employmentCount: number;
  skillCount: number;
  projectCount: number;
}

async function context(db:D1Database,applicationId:number,candidateSnapshotId:number):Promise<ContextRow>{
  const row=await db.prepare(
    `SELECT candidate.person_id,lineage.source_resume_extraction_id resume_extraction_id
     FROM candidate_snapshot candidate
     JOIN application_source_lineage lineage ON lineage.application_id=candidate.application_id
       AND lineage.relation_role='primary_decision_input'
     WHERE candidate.id=?1 AND candidate.application_id=?2`,
  ).bind(candidateSnapshotId,applicationId).first<ContextRow>();
  if(!row)throw new Error("enrichment_context_missing");
  return row;
}

export async function publishCandidateEnrichment(
  db:D1Database,applicationId:number,candidateSnapshotId:number,fenceToken:string,
):Promise<EnrichmentResult>{
  const fence=await db.prepare(
    `SELECT 1 valid FROM application app JOIN candidate_snapshot candidate
       ON candidate.id=?2 AND candidate.application_id=app.id
     WHERE app.id=?1 AND app.decision_fence_token=?3
       AND app.application_lifecycle_status='processing'
       AND candidate.snapshot_status IN ('core_published','enrichment_running')`,
  ).bind(applicationId,candidateSnapshotId,fenceToken).first();
  if(!fence)throw new Error("application_fence_invalid_or_superseded");
  const source=await context(db,applicationId,candidateSnapshotId);
  const now=new Date().toISOString();

  const education=(await db.prepare(
    `SELECT id,source_entry_order,raw_education_text,raw_school_name,normalized_school_name,
            school_id,raw_degree_name,normalized_degree_name,degree_id,
            raw_field_study_name,normalized_field_study_name,field_study_id,
            raw_major_name,normalized_major_name,major_id,gpa,
            education_start_date,education_end_date,is_current
     FROM resume_education WHERE resume_extraction_id=?1 AND extraction_eligibility_status='eligible'
     ORDER BY source_entry_order`,
  ).bind(source.resume_extraction_id).all<Record<string,unknown>>()).results;
  for(const row of education){
    const hash=await sha256(JSON.stringify({school:row.normalized_school_name,degree:row.degree_id,field:row.field_study_id,major:row.major_id,start:row.education_start_date,end:row.education_end_date,gpa:row.gpa}));
    let fact=await db.prepare(`SELECT id FROM person_education WHERE person_id=?1 AND education_record_sha256=?2`).bind(source.person_id,hash).first<{id:number}>();
    if(!fact){
      const uuid=crypto.randomUUID();
      await db.prepare(
        `INSERT INTO education (education_uuid,degree_id,school_id,field_study_id,major_id,
           raw_school_name,normalized_school_name,raw_degree_name,normalized_degree_name,
           raw_field_study_name,normalized_field_study_name,raw_major_name,normalized_major_name,
           gpa,education_description,education_start_date,education_end_date,is_current,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?19)`,
      ).bind(uuid,row.degree_id,row.school_id,row.field_study_id,row.major_id,row.raw_school_name,row.normalized_school_name,
        row.raw_degree_name,row.normalized_degree_name,row.raw_field_study_name,row.normalized_field_study_name,row.raw_major_name,
        row.normalized_major_name,row.gpa,row.raw_education_text,row.education_start_date,row.education_end_date,row.is_current,now).run();
      const educationId=await db.prepare(`SELECT id FROM education WHERE education_uuid=?1`).bind(uuid).first<{id:number}>();
      if(!educationId)throw new Error("education_fact_insert_failed");
      await db.prepare(
        `INSERT INTO person_education (person_id,education_id,first_source_candidate_snapshot_id,
           first_source_resume_education_id,education_record_sha256,recorded_at,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?6)`,
      ).bind(source.person_id,educationId.id,candidateSnapshotId,row.id,hash,now).run();
      fact=await db.prepare(`SELECT id FROM person_education WHERE education_id=?1`).bind(educationId.id).first<{id:number}>();
    }
    if(!fact)throw new Error("person_education_insert_failed");
    await db.prepare(
      `INSERT OR IGNORE INTO candidate_education (candidate_snapshot_id,person_id,person_education_id,
       source_resume_education_id,source_entry_order,is_highest_degree,created_at)
       VALUES (?1,?2,?3,?4,?5,0,?6)`,
    ).bind(candidateSnapshotId,source.person_id,fact.id,row.id,row.source_entry_order,now).run();
  }

  const employment=(await db.prepare(
    `SELECT id,source_entry_order,raw_employment_text,raw_company_name,normalized_company_name,
            raw_position_name,normalized_position_name,employment_description,
            employment_start_date,employment_end_date,is_current
     FROM resume_employment WHERE resume_extraction_id=?1 AND extraction_eligibility_status='eligible'
     ORDER BY source_entry_order`,
  ).bind(source.resume_extraction_id).all<Record<string,unknown>>()).results;
  for(const row of employment){
    const hash=await sha256(JSON.stringify({company:row.normalized_company_name,position:row.normalized_position_name,start:row.employment_start_date,end:row.employment_end_date,description:row.employment_description}));
    let fact=await db.prepare(`SELECT id FROM person_position WHERE person_id=?1 AND employment_record_sha256=?2`).bind(source.person_id,hash).first<{id:number}>();
    if(!fact){
      const uuid=crypto.randomUUID();
      await db.prepare(
        `INSERT INTO person_position (person_position_uuid,person_id,first_source_candidate_snapshot_id,
           first_source_resume_employment_id,raw_company_name,normalized_company_name,
           raw_position_name,normalized_position_name,position_description,position_start_date,
           position_end_date,is_current,employment_record_sha256,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)`,
      ).bind(uuid,source.person_id,candidateSnapshotId,row.id,row.raw_company_name,row.normalized_company_name,
        row.raw_position_name,row.normalized_position_name,row.employment_description ?? row.raw_employment_text,
        row.employment_start_date,row.employment_end_date,row.is_current,hash,now).run();
      fact=await db.prepare(`SELECT id FROM person_position WHERE person_position_uuid=?1`).bind(uuid).first<{id:number}>();
    }
    if(!fact)throw new Error("person_position_insert_failed");
    await db.prepare(
      `INSERT OR IGNORE INTO candidate_position (candidate_snapshot_id,person_id,person_position_id,
       source_resume_employment_id,source_entry_order,is_current_at_snapshot,is_primary_current_position,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,0,?7)`,
    ).bind(candidateSnapshotId,source.person_id,fact.id,row.id,row.source_entry_order,row.is_current,now).run();
  }

  const skills=(await db.prepare(
    `SELECT id,source_entry_order,skill_id,raw_skill_text,matched_context_text,match_method
     FROM resume_skill WHERE resume_extraction_id=?1 AND extraction_eligibility_status='eligible'
     ORDER BY source_entry_order`,
  ).bind(source.resume_extraction_id).all<Record<string,unknown>>()).results;
  for(const row of skills){
    await db.prepare(
      `INSERT INTO person_skill (person_id,skill_id,first_source_candidate_snapshot_id,
       latest_source_candidate_snapshot_id,first_seen_at,last_seen_at,created_at,updated_at)
       VALUES (?1,?2,?3,?3,?4,?4,?4,?4)
       ON CONFLICT(person_id,skill_id) DO UPDATE SET latest_source_candidate_snapshot_id=excluded.latest_source_candidate_snapshot_id,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
    ).bind(source.person_id,row.skill_id,candidateSnapshotId,now).run();
    const fact=await db.prepare(`SELECT id FROM person_skill WHERE person_id=?1 AND skill_id=?2`).bind(source.person_id,row.skill_id).first<{id:number}>();
    if(!fact)throw new Error("person_skill_insert_failed");
    await db.prepare(
      `INSERT OR IGNORE INTO candidate_skill (candidate_snapshot_id,person_id,person_skill_id,
       source_resume_skill_id,raw_skill_text,matched_context_text,match_method,created_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    ).bind(candidateSnapshotId,source.person_id,fact.id,row.id,row.raw_skill_text,row.matched_context_text,row.match_method,now).run();
  }

  const projects=(await db.prepare(
    `SELECT id,source_entry_order,raw_project_text,raw_project_name,normalized_project_name,
            project_description,project_start_date,project_end_date,project_url
     FROM resume_project WHERE resume_extraction_id=?1 AND extraction_eligibility_status='eligible'
     ORDER BY source_entry_order`,
  ).bind(source.resume_extraction_id).all<Record<string,unknown>>()).results;
  for(const row of projects){
    const hash=await sha256(JSON.stringify({name:row.normalized_project_name,description:row.project_description,url:row.project_url,start:row.project_start_date,end:row.project_end_date}));
    let fact=await db.prepare(`SELECT id FROM person_project WHERE person_id=?1 AND project_record_sha256=?2`).bind(source.person_id,hash).first<{id:number}>();
    if(!fact){
      const uuid=crypto.randomUUID();
      await db.prepare(
        `INSERT INTO person_project (person_project_uuid,person_id,first_source_candidate_snapshot_id,
         project_name,normalized_project_name,project_description,project_url,project_start_date,
         project_end_date,project_record_sha256,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)`,
      ).bind(uuid,source.person_id,candidateSnapshotId,row.raw_project_name,row.normalized_project_name,
        row.project_description ?? row.raw_project_text,row.project_url,row.project_start_date,row.project_end_date,hash,now).run();
      fact=await db.prepare(`SELECT id FROM person_project WHERE person_project_uuid=?1`).bind(uuid).first<{id:number}>();
    }
    if(!fact)throw new Error("person_project_insert_failed");
    await db.prepare(
      `INSERT OR IGNORE INTO candidate_project (candidate_snapshot_id,person_id,person_project_id,
       source_resume_project_id,source_entry_order,created_at) VALUES (?1,?2,?3,?4,?5,?6)`,
    ).bind(candidateSnapshotId,source.person_id,fact.id,row.id,row.source_entry_order,now).run();
  }

  await db.prepare(`UPDATE candidate_education SET is_highest_degree=0 WHERE candidate_snapshot_id=?1`).bind(candidateSnapshotId).run();
  await db.prepare(
    `UPDATE candidate_education SET is_highest_degree=1 WHERE id=(
       SELECT ce.id FROM candidate_education ce JOIN person_education pe ON pe.id=ce.person_education_id
       JOIN education e ON e.id=pe.education_id JOIN degree d ON d.id=e.degree_id
       WHERE ce.candidate_snapshot_id=?1 ORDER BY d.degree_level_rank DESC,
       COALESCE(e.education_end_date,'9999-99') DESC,ce.id DESC LIMIT 1)`,
  ).bind(candidateSnapshotId).run();
  await db.prepare(
    `UPDATE person SET highest_person_education_id=(
       SELECT pe.id FROM person_education pe JOIN education e ON e.id=pe.education_id
       JOIN degree d ON d.id=e.degree_id WHERE pe.person_id=?1
       ORDER BY d.degree_level_rank DESC,COALESCE(e.education_end_date,'9999-99') DESC,pe.id DESC LIMIT 1),
       current_person_position_id=(SELECT pp.id FROM person_position pp WHERE pp.person_id=?1 AND pp.is_current=1 ORDER BY pp.position_start_date DESC,pp.id DESC LIMIT 1),updated_at=?2
     WHERE id=?1`,
  ).bind(source.person_id,now).run();
  await db.prepare(
    `UPDATE candidate_position SET is_primary_current_position=CASE WHEN id=(
       SELECT id FROM candidate_position WHERE candidate_snapshot_id=?1 AND is_current_at_snapshot=1
       ORDER BY source_entry_order,id LIMIT 1) THEN 1 ELSE 0 END WHERE candidate_snapshot_id=?1`,
  ).bind(candidateSnapshotId).run();
  await db.prepare(
    `UPDATE candidate_snapshot SET snapshot_status='enriched',enrichment_completed_at=?2,updated_at=?2
     WHERE id=?1`,
  ).bind(candidateSnapshotId,now).run();
  return {educationCount:education.length,employmentCount:employment.length,skillCount:skills.length,projectCount:projects.length};
}
