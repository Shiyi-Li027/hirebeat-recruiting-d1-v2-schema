import type { ConfigurationReleaseIdentity } from "../config/runtime-configuration";
import type {
  CanonicalIntakeRequest,
  TechnicalRedeliveryMechanism,
} from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import type { IdempotencyIdentity } from "../services/idempotency-service";
import type { PayloadHmacResult } from "../services/payload-hmac";

export type IntakeStatus =
  | "received"
  | "resolving_resume_text"
  | "persisting_raw"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export interface IntakeRunRecord {
  id: number;
  intakeRunUuid: string;
  submissionUuid: string;
  sourceSystem: string;
  sourceRecordId: string;
  sourceEventKey: string;
  acceptedPayloadHmac: string;
  lastReceivedPayloadHmac: string;
  payloadHmacKeyVersion: string;
  intakeStatus: IntakeStatus;
  attemptCount: number;
  technicalRedeliveryCount: number;
  payloadConflictCount: number;
  lastAttemptStartedAt: string | null;
  updatedAt: string;
  configurationReleaseId: number;
}

export interface ProcessingClaim {
  intakeRunId: number;
  attemptNumber: number;
  intakeStatus: "resolving_resume_text";
  configurationReleaseId: number;
}

interface IntakeRunRow {
  id: number;
  intake_run_uuid: string;
  submission_uuid: string;
  source_system: string;
  source_record_id: string;
  source_event_key: string;
  accepted_payload_hmac: string;
  last_received_payload_hmac: string;
  payload_hmac_key_version: string;
  intake_status: IntakeStatus;
  attempt_count: number;
  technical_redelivery_count: number;
  payload_conflict_count: number;
  last_attempt_started_at: string | null;
  updated_at: string;
  configuration_release_id: number;
}

interface ProcessingClaimRow {
  id: number;
  attempt_count: number;
  intake_status: "resolving_resume_text";
  configuration_release_id: number;
}

const SELECT_COLUMNS = `
  id,
  intake_run_uuid,
  submission_uuid,
  source_system,
  source_record_id,
  source_event_key,
  accepted_payload_hmac,
  last_received_payload_hmac,
  payload_hmac_key_version,
  intake_status,
  attempt_count,
  technical_redelivery_count,
  payload_conflict_count,
  last_attempt_started_at,
  updated_at,
  configuration_release_id
`;

function mapRow(row: IntakeRunRow): IntakeRunRecord {
  return {
    id: row.id,
    intakeRunUuid: row.intake_run_uuid,
    submissionUuid: row.submission_uuid,
    sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id,
    sourceEventKey: row.source_event_key,
    acceptedPayloadHmac: row.accepted_payload_hmac,
    lastReceivedPayloadHmac: row.last_received_payload_hmac,
    payloadHmacKeyVersion: row.payload_hmac_key_version,
    intakeStatus: row.intake_status,
    attemptCount: row.attempt_count,
    technicalRedeliveryCount: row.technical_redelivery_count,
    payloadConflictCount: row.payload_conflict_count,
    lastAttemptStartedAt: row.last_attempt_started_at,
    updatedAt: row.updated_at,
    configurationReleaseId: row.configuration_release_id,
  };
}

export interface IntakeRunRepositoryPort {
  findByAnyIdentity(
    identity: IdempotencyIdentity,
  ): Promise<IntakeRunRecord[]>;
  createReceived(options: {
    request: CanonicalIntakeRequest;
    identity: IdempotencyIdentity;
    payloadHmac: PayloadHmacResult;
    release: ConfigurationReleaseIdentity;
    now: string;
  }): Promise<IntakeRunRecord>;
  recordTechnicalRedelivery(options: {
    intakeRunId: number;
    payloadHmac: PayloadHmacResult;
    mechanism: TechnicalRedeliveryMechanism;
    causeCode: string | null;
    now: string;
  }): Promise<void>;
  recordPayloadConflict(options: {
    intakeRunId: number;
    receivedPayloadHmac: PayloadHmacResult;
    now: string;
  }): Promise<void>;
  claimProcessingAttempt(options: {
    intakeRunId: number;
    maximumAttempts: number;
    staleBefore: string;
    now: string;
  }): Promise<ProcessingClaim | null>;
  markPersisting(options: {
    intakeRunId: number;
    attemptNumber: number;
    now: string;
  }): Promise<boolean>;
  freezeResolvedResumeFileHash(options: {
    intakeRunId: number;
    attemptNumber: number;
    sha256: string;
    now: string;
  }): Promise<"frozen" | "already_matching" | "conflict" | "fence_lost">;
  markFailure(options: {
    intakeRunId: number;
    attemptNumber: number;
    terminal: boolean;
    errorCode: string;
    errorDetail: string;
    now: string;
  }): Promise<boolean>;
}

export class D1IntakeRunRepository implements IntakeRunRepositoryPort {
  constructor(private readonly database: D1Database) {}

  async findByAnyIdentity(
    identity: IdempotencyIdentity,
  ): Promise<IntakeRunRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT ${SELECT_COLUMNS}
         FROM raw_submission_intake_run
         WHERE submission_uuid = ?1
            OR source_event_key = ?2
            OR (source_system = ?3 AND source_record_id = ?4)
         ORDER BY id
         LIMIT 3`,
      )
      .bind(
        identity.submissionUuid,
        identity.sourceEventKey,
        identity.sourceSystem,
        identity.sourceRecordId,
      )
      .all<IntakeRunRow>();

    return result.results.map(mapRow);
  }

  async createReceived(options: {
    request: CanonicalIntakeRequest;
    identity: IdempotencyIdentity;
    payloadHmac: PayloadHmacResult;
    release: ConfigurationReleaseIdentity;
    now: string;
  }): Promise<IntakeRunRecord> {
    const row = await this.database
      .prepare(
        `INSERT INTO raw_submission_intake_run (
           intake_run_uuid,
           submission_uuid,
           source_system,
           source_record_id,
           source_event_key,
           source_schema_version,
           accepted_payload_hmac,
           last_received_payload_hmac,
           payload_hmac_key_version,
           intake_status,
           attempt_count,
           technical_redelivery_count,
           payload_conflict_count,
           first_received_at,
           last_received_at,
           created_at,
           updated_at,
           configuration_release_id
         ) VALUES (
           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8,
           'received', 0, 0, 0, ?9, ?9, ?9, ?9, ?10
         )
         RETURNING ${SELECT_COLUMNS}`,
      )
      .bind(
        crypto.randomUUID(),
        options.identity.submissionUuid,
        options.identity.sourceSystem,
        options.identity.sourceRecordId,
        options.identity.sourceEventKey,
        options.request.schemaVersion,
        options.payloadHmac.hmacHex,
        options.payloadHmac.keyVersion,
        options.now,
        options.release.id,
      )
      .first<IntakeRunRow>();

    if (row === null) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "intake_run_create_failed",
        message: "The intake run could not be created.",
        httpStatus: 503,
      });
    }
    return mapRow(row);
  }

  async recordTechnicalRedelivery(options: {
    intakeRunId: number;
    payloadHmac: PayloadHmacResult;
    mechanism: TechnicalRedeliveryMechanism;
    causeCode: string | null;
    now: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET technical_redelivery_count = technical_redelivery_count + 1,
             last_received_payload_hmac = ?2,
             last_technical_redelivery_mechanism = ?3,
             last_technical_redelivery_cause_code = ?4,
             last_technical_redelivery_at = ?5,
             last_received_at = ?5,
             updated_at = ?5
         WHERE id = ?1`,
      )
      .bind(
        options.intakeRunId,
        options.payloadHmac.hmacHex,
        options.mechanism,
        options.causeCode,
        options.now,
      )
      .run();
  }

  async recordPayloadConflict(options: {
    intakeRunId: number;
    receivedPayloadHmac: PayloadHmacResult;
    now: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET payload_conflict_count = payload_conflict_count + 1,
             last_received_payload_hmac = ?2,
             last_received_at = ?3,
             last_error_code = 'idempotency_payload_conflict',
             last_error_detail = 'The same source identity was redelivered with different accepted payload content.',
             updated_at = ?3
         WHERE id = ?1`,
      )
      .bind(
        options.intakeRunId,
        options.receivedPayloadHmac.hmacHex,
        options.now,
      )
      .run();
  }

  async claimProcessingAttempt(options: {
    intakeRunId: number;
    maximumAttempts: number;
    staleBefore: string;
    now: string;
  }): Promise<ProcessingClaim | null> {
    const row = await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET intake_status = 'resolving_resume_text',
             attempt_count = attempt_count + 1,
             last_attempt_started_at = ?4,
             last_error_code = NULL,
             last_error_detail = NULL,
             updated_at = ?4
         WHERE id = ?1
           AND attempt_count < ?2
           AND (
             intake_status IN ('received', 'failed_retryable')
             OR (
               intake_status IN ('resolving_resume_text', 'persisting_raw')
               AND COALESCE(last_attempt_started_at, updated_at) <= ?3
             )
           )
         RETURNING
           id,
           attempt_count,
           intake_status,
           configuration_release_id`,
      )
      .bind(
        options.intakeRunId,
        options.maximumAttempts,
        options.staleBefore,
        options.now,
      )
      .first<ProcessingClaimRow>();

    if (row === null) {
      return null;
    }
    return {
      intakeRunId: row.id,
      attemptNumber: row.attempt_count,
      intakeStatus: row.intake_status,
      configurationReleaseId: row.configuration_release_id,
    };
  }

  async markPersisting(options: {
    intakeRunId: number;
    attemptNumber: number;
    now: string;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET intake_status = 'persisting_raw', updated_at = ?3
         WHERE id = ?1
           AND attempt_count = ?2
           AND intake_status = 'resolving_resume_text'`,
      )
      .bind(options.intakeRunId, options.attemptNumber, options.now)
      .run();
    return result.meta.changes === 1;
  }

  async freezeResolvedResumeFileHash(options: {
    intakeRunId: number;
    attemptNumber: number;
    sha256: string;
    now: string;
  }): Promise<"frozen" | "already_matching" | "conflict" | "fence_lost"> {
    if (!/^[0-9a-f]{64}$/.test(options.sha256)) {
      throw new IngressError({
        kind: "validation",
        safeCode: "invalid_resolved_resume_file_sha256",
        message: "The resolved Resume PDF hash is invalid.",
        httpStatus: 422,
      });
    }
    const current = await this.database
      .prepare(
        `SELECT accepted_resume_file_sha256
         FROM raw_submission_intake_run
         WHERE id = ?1
           AND attempt_count = ?2
           AND intake_status = 'resolving_resume_text'`,
      )
      .bind(options.intakeRunId, options.attemptNumber)
      .first<{ accepted_resume_file_sha256: string | null }>();
    if (!current) return "fence_lost";
    if (current.accepted_resume_file_sha256 === options.sha256) {
      return "already_matching";
    }
    if (current.accepted_resume_file_sha256 !== null) return "conflict";

    const result = await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET accepted_resume_file_sha256 = ?3, updated_at = ?4
         WHERE id = ?1
           AND attempt_count = ?2
           AND intake_status = 'resolving_resume_text'
           AND accepted_resume_file_sha256 IS NULL`,
      )
      .bind(
        options.intakeRunId,
        options.attemptNumber,
        options.sha256,
        options.now,
      )
      .run();
    return result.meta.changes === 1 ? "frozen" : "fence_lost";
  }

  async markFailure(options: {
    intakeRunId: number;
    attemptNumber: number;
    terminal: boolean;
    errorCode: string;
    errorDetail: string;
    now: string;
  }): Promise<boolean> {
    const status = options.terminal ? "failed_terminal" : "failed_retryable";
    const result = await this.database
      .prepare(
        `UPDATE raw_submission_intake_run
         SET intake_status = ?3,
             last_error_code = ?4,
             last_error_detail = ?5,
             completed_at = CASE WHEN ?3 = 'failed_terminal' THEN ?6 ELSE NULL END,
             updated_at = ?6
         WHERE id = ?1
           AND attempt_count = ?2
           AND intake_status IN ('resolving_resume_text', 'persisting_raw')`,
      )
      .bind(
        options.intakeRunId,
        options.attemptNumber,
        status,
        options.errorCode,
        options.errorDetail,
        options.now,
      )
      .run();
    return result.meta.changes === 1;
  }
}
