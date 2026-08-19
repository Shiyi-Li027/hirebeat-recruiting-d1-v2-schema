import { isoDate, normalizeEmail, normalizePhone, normalizeWhitespace, splitName } from "./crypto";
import { positionAdmissionReason } from "./position-readiness";

interface RawInputRow {
  id: number;
  submission_uuid: string;
  submitted_company_id: number | null;
  submitted_company_work_mode_id: number | null;
  submitted_position_id: number | null;
  raw_person_name: string | null;
  raw_email_address: string | null;
  raw_phone: string | null;
  raw_start_working_date: string | null;
  raw_end_working_date: string | null;
  raw_work_duration: string | null;
  resume_text_status: string;
  resume_text: string | null;
  company_active: number | null;
  position_status: string | null;
  position_jd: string | null;
  position_company_id: number | null;
  work_mode_valid: number;
  active_work_mode_count: number;
}

export interface InitialCleaningResult {
  admitted: boolean;
  reasonCode: string | null;
}

export interface NormalizationResult {
  submissionNormalizedId: number;
  normalizedEmail: string;
  normalizedName: string;
}

async function rawInput(db: D1Database, rawSubmissionId: number): Promise<RawInputRow> {
  const row = await db.prepare(
    `SELECT raw.id, raw.submission_uuid, raw.submitted_company_id,
            raw.submitted_company_work_mode_id, raw.submitted_position_id,
            raw.raw_person_name, raw.raw_email_address, raw.raw_phone,
            raw.raw_start_working_date, raw.raw_end_working_date,
            raw.raw_work_duration, resume.resume_text_status, resume.resume_text,
            company.is_active AS company_active,
            position.position_status, position.position_jd,
            position.company_id AS position_company_id,
            CASE WHEN raw.submitted_company_work_mode_id IS NULL THEN 0
                 WHEN company_mode.id IS NOT NULL AND company_mode.is_active=1 THEN 1
                 ELSE 0 END AS work_mode_valid,
            (SELECT COUNT(*) FROM company_work_mode cwm
              WHERE cwm.company_id=raw.submitted_company_id AND cwm.is_active=1)
              AS active_work_mode_count
     FROM raw_submission raw
     JOIN raw_submission_resume resume ON resume.raw_submission_id=raw.id
     LEFT JOIN company ON company.id=raw.submitted_company_id
     LEFT JOIN position ON position.id=raw.submitted_position_id
     LEFT JOIN company_work_mode company_mode
       ON company_mode.id=raw.submitted_company_work_mode_id
      AND company_mode.company_id=raw.submitted_company_id
     WHERE raw.id=?1`,
  ).bind(rawSubmissionId).first<RawInputRow>();
  if (!row) throw new Error("raw_submission_not_found");
  return row;
}

export async function initialCleaning(
  db: D1Database,
  workflowRunId: number,
  rawSubmissionId: number,
): Promise<InitialCleaningResult> {
  const row = await rawInput(db, rawSubmissionId);
  const positionReason=positionAdmissionReason({
    submittedPositionId:row.submitted_position_id,
    submittedCompanyId:row.submitted_company_id,
    positionCompanyId:row.position_company_id,
    positionStatus:row.position_status,
    positionJd:row.position_jd,
  });
  let reason: string | null = null;
  if (row.resume_text_status !== "available" || (row.resume_text?.trim().length ?? 0) < 10)
    reason = "resume_text_missing_or_too_short";
  else if (!row.submitted_company_id || row.company_active !== 1)
    reason = "submitted_company_missing_or_inactive";
  else if (positionReason) reason = positionReason;
  else if (row.submitted_company_work_mode_id !== null && row.work_mode_valid !== 1)
    reason = "submitted_company_work_mode_invalid_or_inactive";
  else if (row.submitted_company_work_mode_id === null && row.active_work_mode_count > 0)
    reason = "company_work_mode_required_for_company";
  else if (!isoDate(row.raw_start_working_date))
    reason = "requested_start_date_missing_or_invalid";
  else if (!normalizeEmail(row.raw_email_address)) reason = "canonical_email_missing_or_invalid";
  else if (!normalizeWhitespace(row.raw_person_name)) reason = "candidate_name_missing";

  if (reason) {
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO audit_event (
         event_uuid,event_type,entity_type,entity_id,actor_type,workflow_run_id,
         correlation_key,reason_code,event_summary,event_metadata_json,
         occurred_at,recorded_at
       ) VALUES (?1,'submission.initial_cleaning_blocked','raw_submission',?2,
                 'system',?3,?4,?5,'Submission blocked by Initial Cleaning',
                 json_object('ruleVersion','initial-cleaning-v1'),?6,?6)`,
    ).bind(crypto.randomUUID(),rawSubmissionId,workflowRunId,row.submission_uuid,reason,now).run();
  }
  return { admitted: reason === null, reasonCode: reason };
}

export async function normalizeSubmission(
  db: D1Database,
  workflowRunId: number,
  stepRunId: number,
  rawSubmissionId: number,
): Promise<NormalizationResult> {
  const existing = await db.prepare(
    `SELECT id, normalized_email_address, normalized_person_name
     FROM submission_normalized WHERE raw_submission_id=?1 AND normalization_version='normalization-v1'`,
  ).bind(rawSubmissionId).first<{id:number;normalized_email_address:string;normalized_person_name:string}>();
  if (existing) return {submissionNormalizedId:existing.id,normalizedEmail:existing.normalized_email_address,normalizedName:existing.normalized_person_name};

  const raw = await rawInput(db, rawSubmissionId);
  const normalizedNameSource = normalizeWhitespace(raw.raw_person_name);
  const email = normalizeEmail(raw.raw_email_address);
  if (!normalizedNameSource || !email || !raw.submitted_company_id || !raw.submitted_position_id)
    throw new Error("normalization_required_input_missing");
  const name = splitName(normalizedNameSource);
  const phone = normalizePhone(raw.raw_phone);
  const startDate = isoDate(raw.raw_start_working_date);
  const endDate = isoDate(raw.raw_end_working_date);
  const warnings: string[] = [];
  if (raw.raw_start_working_date && !startDate) warnings.push("invalid_start_working_date");
  if (raw.raw_end_working_date && !endDate) warnings.push("invalid_end_working_date");
  if (raw.raw_phone && !phone) warnings.push("invalid_phone");
  const now = new Date().toISOString();
  const runUuid = crypto.randomUUID();
  const normalizedUuid = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO normalization_run (
         normalization_run_uuid,raw_submission_id,workflow_run_id,step_run_id,
         normalization_version,idempotency_key,normalization_status,warning_count,
         warnings_json,started_at,created_at,updated_at
       ) VALUES (?1,?2,?3,?4,'normalization-v1',?5,'running',?6,?7,?8,?8,?8)`,
    ).bind(runUuid,rawSubmissionId,workflowRunId,stepRunId,`normalize:${rawSubmissionId}:v1`,warnings.length,JSON.stringify(warnings),now),
    db.prepare(
      `INSERT INTO submission_normalized (
         submission_normalized_uuid,raw_submission_id,normalization_run_id,
         normalization_version,company_id,company_work_mode_id,position_id,
         normalized_person_name,normalized_first_name,normalized_middle_name,
         normalized_last_name,normalized_email_address,normalized_phone,
         requested_start_date,requested_end_date,requested_start_year_month,
         work_duration,normalized_at,created_at
       ) SELECT ?1,?2,id,'normalization-v1',?3,?4,?5,?6,?7,?8,?9,?10,
                ?11,?12,?13,substr(?12,1,7),?14,?15,?15
         FROM normalization_run WHERE normalization_run_uuid=?16`,
    ).bind(normalizedUuid,rawSubmissionId,raw.submitted_company_id,raw.submitted_company_work_mode_id,
      raw.submitted_position_id,name.normalizedName,name.firstName,name.middleName,name.lastName,email,phone,
      startDate,endDate,normalizeWhitespace(raw.raw_work_duration),now,runUuid),
    db.prepare(
      `UPDATE normalization_run SET normalization_status='succeeded',completed_at=?2,updated_at=?2
       WHERE normalization_run_uuid=?1`,
    ).bind(runUuid,now),
  ]);
  const row = await db.prepare(
    `SELECT id FROM submission_normalized WHERE submission_normalized_uuid=?1`,
  ).bind(normalizedUuid).first<{id:number}>();
  if (!row) throw new Error("normalization_publish_verification_failed");
  return { submissionNormalizedId:row.id,normalizedEmail:email,normalizedName:name.normalizedName };
}
