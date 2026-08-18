export interface ExistingRawSubmission {
  id: number;
  submissionUuid: string;
}

export interface RawSubmissionRepository {
  findBySubmissionUuid(
    submissionUuid: string,
  ): Promise<ExistingRawSubmission | null>;
}

interface RawSubmissionRow {
  id: number;
  submission_uuid: string;
}

export class D1RawSubmissionRepository implements RawSubmissionRepository {
  constructor(private readonly database: D1Database) {}

  async findBySubmissionUuid(
    submissionUuid: string,
  ): Promise<ExistingRawSubmission | null> {
    const row = await this.database
      .prepare(
        `SELECT id, submission_uuid
         FROM raw_submission
         WHERE submission_uuid = ?1`,
      )
      .bind(submissionUuid)
      .first<RawSubmissionRow>();
    return row
      ? { id: row.id, submissionUuid: row.submission_uuid }
      : null;
  }
}
