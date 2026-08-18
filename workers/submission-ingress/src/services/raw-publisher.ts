import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import type { ParsedResumeText } from "./parser-client";
import type { StoredResumeObject } from "./r2-resume-store";

export type ResumePublishOutcome =
  | { kind: "available"; parsed: ParsedResumeText }
  | { kind: "no_resume" }
  | { kind: "parse_failed_terminal"; errorCode: string; errorDetail: string };

export interface RawPublishInput {
  intakeRunId: number;
  attemptNumber: number;
  request: CanonicalIntakeRequest;
  resumeObject: StoredResumeObject | null;
  resumeOutcome: ResumePublishOutcome;
  payloadHmac: string;
  payloadHmacKeyVersion: string;
  outboxMaxDeliveryAttempts: number;
  now: string;
}

export interface RawPublishResult {
  rawSubmissionId: number;
  outboxEventId: number;
}

export interface RawPublisher {
  publish(input: RawPublishInput): Promise<RawPublishResult>;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256(text: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

export class D1RawPublisher implements RawPublisher {
  constructor(private readonly database: D1Database) {}

  async publish(input: RawPublishInput): Promise<RawPublishResult> {
    const available =
      input.resumeOutcome.kind === "available" ? input.resumeOutcome.parsed : null;
    const textHash = available ? await sha256(available.text) : null;
    const resumeStatus = input.resumeOutcome.kind;
    const origin = available
      ? available.parserName.toLowerCase().includes("pymupdf")
        ? "pymupdf"
        : "upstream_parser"
      : null;
    const parserVersion = available?.parserVersion ?? null;
    const parsedAt = available?.parsedAt ?? null;
    const source = input.request.resume;
    const originalName =
      source.kind === "pdf_reference" ? source.originalFileName : null;
    const sourceUrl = source.kind === "pdf_reference" ? source.sourceUrl : null;
    const sourceFileId =
      source.kind === "pdf_reference" ? source.sourceFileId : null;
    const declaredMime =
      source.kind === "pdf_reference" ? source.declaredMimeType : null;
    const eventUuid = crypto.randomUUID();
    const eventPayload = JSON.stringify({
      eventType: "raw_submission.published",
      eventSchemaVersion: "raw-submission-published-v1",
      submissionUuid: input.request.source.submissionUuid,
    });
    const terminalError =
      input.resumeOutcome.kind === "parse_failed_terminal"
        ? input.resumeOutcome
        : null;

    const statements = [
      this.database
        .prepare(
          `INSERT INTO raw_submission (
             raw_submission_intake_run_id, submission_uuid, source_system,
             source_record_id, source_event_key, source_schema_version,
             submitted_company_id, submitted_company_name,
             submitted_company_work_mode_id, submitted_company_work_mode_name,
             submitted_position_id, submitted_position_name, raw_person_name,
             raw_email_address, raw_phone, raw_start_working_date,
             raw_end_working_date, raw_work_duration, payload_hmac,
             payload_hmac_key_version, source_submitted_at, landed_at, updated_at
           ) SELECT
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
             ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22
           FROM raw_submission_intake_run
           WHERE id = ?1
             AND attempt_count = ?23
             AND intake_status = 'persisting_raw'`,
        )
        .bind(
          input.intakeRunId,
          input.request.source.submissionUuid,
          input.request.source.sourceSystem,
          input.request.source.sourceRecordId,
          input.request.source.sourceEventKey,
          input.request.schemaVersion,
          input.request.catalog.companyId,
          input.request.catalog.companyName,
          input.request.catalog.companyWorkModeId,
          input.request.catalog.companyWorkModeName,
          input.request.catalog.positionId,
          input.request.catalog.positionName,
          input.request.applicant.personName,
          input.request.applicant.personEmailAddress,
          input.request.applicant.personPhone,
          input.request.applicant.startWorkingDate,
          input.request.applicant.endWorkingDate,
          input.request.applicant.workDuration,
          input.payloadHmac,
          input.payloadHmacKeyVersion,
          input.request.source.sourceSubmittedAt,
          input.now,
          input.attemptNumber,
        ),
      this.database
        .prepare(
          `INSERT INTO raw_submission_resume (
             raw_submission_id, resume_text, resume_text_status,
             resume_text_origin, resume_parser_version, resume_text_sha256,
             resume_parsed_at, resume_original_file_name, resume_source_url,
             resume_source_file_id, resume_mime_type, resume_file_size_bytes,
             resume_r2_object_key, created_at, updated_at, resume_file_sha256
           ) SELECT
             id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
             ?14, ?14, ?15
           FROM raw_submission WHERE submission_uuid = ?1`,
        )
        .bind(
          input.request.source.submissionUuid,
          available?.text ?? null,
          resumeStatus,
          origin,
          parserVersion,
          textHash,
          parsedAt,
          originalName,
          sourceUrl,
          sourceFileId,
          input.resumeObject ? "application/pdf" : declaredMime,
          input.resumeObject?.sizeBytes ?? null,
          input.resumeObject?.objectKey ?? null,
          input.now,
          input.resumeObject?.sha256 ?? null,
        ),
      this.database
        .prepare(
          `INSERT INTO outbox_event (
             event_uuid, deduplication_key, event_type, event_schema_version,
             aggregate_type, aggregate_id, destination_type, destination_key,
             event_payload_json, dispatch_status, delivery_attempt_count,
             max_delivery_attempts, available_at, created_at, updated_at
           ) SELECT
             ?2, ?3, 'raw_submission.published', 'raw-submission-published-v1',
             'raw_submission', id, 'cloudflare_workflow', 'workflow_a', ?4,
             'pending', 0, ?5, ?6, ?6, ?6
           FROM raw_submission WHERE submission_uuid = ?1`,
        )
        .bind(
          input.request.source.submissionUuid,
          eventUuid,
          `workflow_a:${input.request.source.submissionUuid}`,
          eventPayload,
          input.outboxMaxDeliveryAttempts,
          input.now,
        ),
      this.database
        .prepare(
          `UPDATE raw_submission_intake_run
           SET intake_status = 'succeeded',
               last_error_code = ?3,
               last_error_detail = ?4,
               completed_at = ?5,
               updated_at = ?5
           WHERE id = ?1
             AND attempt_count = ?2
             AND intake_status = 'persisting_raw'`,
        )
        .bind(
          input.intakeRunId,
          input.attemptNumber,
          terminalError?.errorCode ?? null,
          terminalError?.errorDetail ?? null,
          input.now,
        ),
    ];

    let results: D1Result[];
    try {
      results = await this.database.batch(statements);
    } catch (cause) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "raw_publish_transaction_failed",
        message: "Raw Submission publication failed.",
        httpStatus: 503,
        cause,
      });
    }
    if (results.some((result) => !result.success) || results[3].meta.changes !== 1) {
      throw new IngressError({
        kind: "conflict",
        safeCode: "raw_publish_attempt_fence_lost",
        message: "The active intake attempt no longer owns publication.",
        httpStatus: 409,
      });
    }

    const raw = await this.database
      .prepare("SELECT id FROM raw_submission WHERE submission_uuid = ?1")
      .bind(input.request.source.submissionUuid)
      .first<{ id: number }>();
    const outbox = await this.database
      .prepare("SELECT id FROM outbox_event WHERE deduplication_key = ?1")
      .bind(`workflow_a:${input.request.source.submissionUuid}`)
      .first<{ id: number }>();
    if (!raw || !outbox) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "raw_publish_verification_failed",
        message: "Raw publication could not be verified.",
        httpStatus: 503,
      });
    }
    return { rawSubmissionId: raw.id, outboxEventId: outbox.id };
  }
}
