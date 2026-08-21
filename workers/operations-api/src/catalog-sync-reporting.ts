import { commandKey } from "./helpers";

export type CatalogSyncTargetType =
  | "airtable"
  | "google_form";

export type CatalogSyncTargetStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export type CatalogSyncRunStatus =
  | "pending"
  | "running"
  | "partially_succeeded"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "cancelled";

export interface CatalogSyncRunSummary {
  sync_status: CatalogSyncRunStatus;
  expected_target_count: number;
  succeeded_target_count: number;
  failed_target_count: number;
  completed: boolean;
}

export function requireCatalogSyncTargetType(
  value: unknown,
): CatalogSyncTargetType {
  if (value === "airtable" || value === "google_form") {
    return value;
  }
  throw new Error("catalog_sync_target_type_invalid");
}

export function requireCatalogSyncResultStatus(
  value: unknown,
): Extract<
  CatalogSyncTargetStatus,
  "succeeded" | "failed_retryable" | "failed_terminal"
> {
  if (
    value === "succeeded" ||
    value === "failed_retryable" ||
    value === "failed_terminal"
  ) {
    return value;
  }
  throw new Error("catalog_sync_result_status_invalid");
}


export interface CatalogSyncStartCommand {
  catalog_revision_id: number;
  target_type: CatalogSyncTargetType;
  target_key: string;
}

export interface CatalogSyncResultCommand {
  result_status: Extract<
    CatalogSyncTargetStatus,
    "succeeded" | "failed_retryable" | "failed_terminal"
  >;
  external_revision_key: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
}

function requireCatalogSyncText(
  value: unknown,
  errorCode: string,
  maximumLength: number,
): string {
  const text = String(value ?? "").trim();
  if (text.length === 0 || text.length > maximumLength) {
    throw new Error(errorCode);
  }
  return text;
}

function optionalCatalogSyncText(
  value: unknown,
  errorCode: string,
  maximumLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  if (text.length > maximumLength) {
    throw new Error(errorCode);
  }
  return text;
}

export function requireCatalogSyncStartCommand(
  body: Record<string, unknown>,
): CatalogSyncStartCommand {
  const catalogRevisionId = Number(body.catalog_revision_id);
  if (
    !Number.isSafeInteger(catalogRevisionId) ||
    catalogRevisionId <= 0
  ) {
    throw new Error("catalog_revision_id_invalid");
  }

  return {
    catalog_revision_id: catalogRevisionId,
    target_type: requireCatalogSyncTargetType(
      body.target_type,
    ),
    target_key: requireCatalogSyncText(
      body.target_key,
      "catalog_sync_target_key_invalid",
      500,
    ),
  };
}

export function requireCatalogSyncResultCommand(
  body: Record<string, unknown>,
): CatalogSyncResultCommand {
  const resultStatus = requireCatalogSyncResultStatus(
    body.result_status,
  );
  const externalRevisionKey = optionalCatalogSyncText(
    body.external_revision_key,
    "catalog_sync_external_revision_key_invalid",
    500,
  );
  const lastErrorCode = optionalCatalogSyncText(
    body.last_error_code,
    "catalog_sync_last_error_code_invalid",
    200,
  );
  const lastErrorDetail = optionalCatalogSyncText(
    body.last_error_detail,
    "catalog_sync_last_error_detail_invalid",
    2000,
  );

  if (
    resultStatus === "succeeded" &&
    (lastErrorCode !== null || lastErrorDetail !== null)
  ) {
    throw new Error(
      "catalog_sync_success_must_not_include_error",
    );
  }

  if (
    resultStatus !== "succeeded" &&
    lastErrorCode === null
  ) {
    throw new Error(
      "catalog_sync_failure_error_code_required",
    );
  }

  return {
    result_status: resultStatus,
    external_revision_key: externalRevisionKey,
    last_error_code: lastErrorCode,
    last_error_detail: lastErrorDetail,
  };
}


const CATALOG_SYNC_START_EVENT_TYPE =
  "command.catalog_sync.run.create";

async function priorCatalogSyncCommand(
  db: D1Database,
  eventType: string,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(
    `SELECT event_metadata_json
     FROM audit_event
     WHERE event_type = ?1
       AND correlation_key = ?2`,
  ).bind(
    eventType,
    idempotencyKey,
  ).first<{ event_metadata_json: string | null }>();

  if (!row?.event_metadata_json) return null;

  const value = JSON.parse(row.event_metadata_json);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("catalog_sync_audit_metadata_invalid");
  }

  return value as Record<string, unknown>;
}

export async function beginCatalogSyncRun(
  db: D1Database,
  body: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  const idempotencyKey = commandKey(body);
  const prior = await priorCatalogSyncCommand(
    db,
    CATALOG_SYNC_START_EVENT_TYPE,
    idempotencyKey,
  );

  if (prior) {
    return {
      ...prior,
      idempotent_reuse: true,
    };
  }

  const command = requireCatalogSyncStartCommand(body);

  const revision = await db.prepare(
    `SELECT id
     FROM catalog_revision
     WHERE id = ?1`,
  ).bind(
    command.catalog_revision_id,
  ).first<{ id: number }>();

  if (!revision) {
    throw new Error("catalog_revision_not_found");
  }

  const now = new Date().toISOString();
  const runUuid = crypto.randomUUID();
  const auditUuid = crypto.randomUUID();

  let statements: D1Result[];

  try {
    statements = await db.batch([
      db.prepare(
        `INSERT INTO catalog_sync_run (
           catalog_sync_run_uuid,
           catalog_revision_id,
           idempotency_key,
           sync_status,
           expected_target_count,
           succeeded_target_count,
           failed_target_count,
           started_at,
           created_at,
           updated_at
         )
         VALUES (
           ?1, ?2, ?3, 'running',
           1, 0, 0, ?4, ?4, ?4
         )`,
      ).bind(
        runUuid,
        command.catalog_revision_id,
        idempotencyKey,
        now,
      ),

      db.prepare(
        `INSERT INTO catalog_sync_target_run (
           catalog_sync_run_id,
           target_type,
           target_key,
           target_status,
           attempt_count,
           created_at,
           updated_at
         )
         SELECT
           id,
           ?1,
           ?2,
           'pending',
           0,
           ?3,
           ?3
         FROM catalog_sync_run
         WHERE catalog_sync_run_uuid = ?4`,
      ).bind(
        command.target_type,
        command.target_key,
        now,
        runUuid,
      ),

      db.prepare(
        `INSERT INTO audit_event (
           event_uuid,
           event_type,
           entity_type,
           entity_id,
           actor_type,
           actor_id,
           correlation_key,
           reason_code,
           event_summary,
           event_metadata_json,
           occurred_at,
           recorded_at
         )
         SELECT
           ?1,
           ?2,
           'catalog_sync_run',
           run.id,
           'member',
           ?3,
           ?4,
           'provider_catalog_sync_requested',
           'A provider Catalog synchronization run was requested.',
           json_object(
             'catalog_sync_run_id', run.id,
             'catalog_sync_run_uuid', run.catalog_sync_run_uuid,
             'catalog_revision_id', run.catalog_revision_id,
             'sync_status', run.sync_status,
             'catalog_sync_target_run_id', target.id,
             'target_type', target.target_type,
             'target_key', target.target_key,
             'target_status', target.target_status
           ),
           ?5,
           ?5
         FROM catalog_sync_run AS run
         JOIN catalog_sync_target_run AS target
           ON target.catalog_sync_run_id = run.id
         WHERE run.catalog_sync_run_uuid = ?6
         RETURNING event_metadata_json`,
      ).bind(
        auditUuid,
        CATALOG_SYNC_START_EVENT_TYPE,
        actor,
        idempotencyKey,
        now,
        runUuid,
      ),
    ]);
  } catch (error) {
    const replay = await priorCatalogSyncCommand(
      db,
      CATALOG_SYNC_START_EVENT_TYPE,
      idempotencyKey,
    );

    if (replay) {
      return {
        ...replay,
        idempotent_reuse: true,
      };
    }

    throw error;
  }

  if (
    Number(statements[0].meta.changes) !== 1 ||
    Number(statements[1].meta.changes) !== 1 ||
    Number(statements[2].meta.changes) !== 1
  ) {
    throw new Error("catalog_sync_start_atomic_write_failed");
  }

  const auditRow = statements[2].results?.[0] as
    | { event_metadata_json?: string }
    | undefined;

  if (!auditRow?.event_metadata_json) {
    throw new Error("catalog_sync_start_result_missing");
  }

  const result = JSON.parse(auditRow.event_metadata_json);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("catalog_sync_start_result_invalid");
  }

  return result as Record<string, unknown>;
}

export function summarizeCatalogSyncTargets(
  statuses: readonly CatalogSyncTargetStatus[],
): CatalogSyncRunSummary {
  if (statuses.length === 0) {
    throw new Error("catalog_sync_targets_empty");
  }

  const expected = statuses.length;
  const succeeded = statuses.filter(
    (status) => status === "succeeded",
  ).length;
  const retryable = statuses.filter(
    (status) => status === "failed_retryable",
  ).length;
  const terminal = statuses.filter(
    (status) => status === "failed_terminal",
  ).length;
  const cancelled = statuses.filter(
    (status) => status === "cancelled",
  ).length;
  const active = statuses.filter(
    (status) => status === "pending" || status === "running",
  ).length;
  const failed = retryable + terminal;

  let syncStatus: CatalogSyncRunStatus;
  let completed = false;

  if (retryable > 0) {
    syncStatus = "failed_retryable";
  } else if (active > 0) {
    syncStatus = "running";
  } else if (succeeded === expected) {
    syncStatus = "succeeded";
    completed = true;
  } else if (
    succeeded > 0 &&
    terminal + cancelled > 0
  ) {
    syncStatus = "partially_succeeded";
    completed = true;
  } else if (terminal > 0) {
    syncStatus = "failed_terminal";
    completed = true;
  } else if (cancelled === expected) {
    syncStatus = "cancelled";
    completed = true;
  } else {
    syncStatus = "running";
  }

  return {
    sync_status: syncStatus,
    expected_target_count: expected,
    succeeded_target_count: succeeded,
    failed_target_count: failed,
    completed,
  };
}

const CATALOG_SYNC_RESULT_EVENT_TYPE =
  "command.catalog_sync.target.result";

interface CatalogSyncTargetRow {
  id: number;
  catalog_sync_run_id: number;
  target_status: CatalogSyncTargetStatus;
  attempt_count: number;
}

export function catalogSyncRetryAt(
  attemptNumber: number,
  now: Date,
): string {
  const exponent = Math.max(0, attemptNumber - 1);
  const delaySeconds = Math.min(
    3600,
    60 * (2 ** exponent),
  );

  return new Date(
    now.getTime() + delaySeconds * 1000,
  ).toISOString();
}

export async function reportCatalogSyncTargetResult(
  db: D1Database,
  targetRunId: number,
  body: Record<string, unknown>,
  actor: string,
): Promise<Record<string, unknown>> {
  if (
    !Number.isSafeInteger(targetRunId) ||
    targetRunId <= 0
  ) {
    throw new Error("catalog_sync_target_run_id_invalid");
  }

  const idempotencyKey = commandKey(body);
  const prior = await priorCatalogSyncCommand(
    db,
    CATALOG_SYNC_RESULT_EVENT_TYPE,
    idempotencyKey,
  );

  if (prior) {
    return {
      ...prior,
      idempotent_reuse: true,
    };
  }

  const command = requireCatalogSyncResultCommand(body);

  const target = await db.prepare(
    `SELECT
       id,
       catalog_sync_run_id,
       target_status,
       attempt_count
     FROM catalog_sync_target_run
     WHERE id = ?1`,
  ).bind(
    targetRunId,
  ).first<CatalogSyncTargetRow>();

  if (!target) {
    throw new Error("catalog_sync_target_run_not_found");
  }

  if (
    target.target_status === "succeeded" ||
    target.target_status === "failed_terminal" ||
    target.target_status === "cancelled"
  ) {
    throw new Error("catalog_sync_target_run_finalized");
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const nextAttemptNumber = target.attempt_count + 1;

  const nextAttemptAt =
    command.result_status === "failed_retryable"
      ? catalogSyncRetryAt(nextAttemptNumber, nowDate)
      : null;

  const completedAt =
    command.result_status === "succeeded" ||
    command.result_status === "failed_terminal"
      ? now
      : null;

  const auditUuid = crypto.randomUUID();

  let statements: D1Result[];

  try {
    statements = await db.batch([
      db.prepare(
        `UPDATE catalog_sync_target_run
         SET target_status = ?1,
             attempt_count = attempt_count + 1,
             external_revision_key = ?2,
             last_error_code = ?3,
             last_error_detail = ?4,
             next_attempt_at = ?5,
             started_at = COALESCE(started_at, ?7),
             completed_at = ?6,
             updated_at = ?7
         WHERE id = ?8
           AND attempt_count = ?9
           AND target_status IN (
             'pending',
             'running',
             'failed_retryable'
           )`,
      ).bind(
        command.result_status,
        command.external_revision_key,
        command.last_error_code,
        command.last_error_detail,
        nextAttemptAt,
        completedAt,
        now,
        targetRunId,
        target.attempt_count,
      ),

      db.prepare(
        `WITH target_summary AS (
           SELECT
             COUNT(*) AS expected_count,
             SUM(
               CASE WHEN target_status = 'succeeded'
                    THEN 1 ELSE 0 END
             ) AS succeeded_count,
             SUM(
               CASE WHEN target_status IN (
                 'failed_retryable',
                 'failed_terminal'
               ) THEN 1 ELSE 0 END
             ) AS failed_count,
             SUM(
               CASE WHEN target_status = 'failed_retryable'
                    THEN 1 ELSE 0 END
             ) AS retryable_count,
             SUM(
               CASE WHEN target_status IN ('pending', 'running')
                    THEN 1 ELSE 0 END
             ) AS active_count,
             SUM(
               CASE WHEN target_status = 'failed_terminal'
                    THEN 1 ELSE 0 END
             ) AS terminal_count,
             SUM(
               CASE WHEN target_status = 'cancelled'
                    THEN 1 ELSE 0 END
             ) AS cancelled_count
           FROM catalog_sync_target_run
           WHERE catalog_sync_run_id = ?2
         ),
         resolved AS (
           SELECT
             expected_count,
             succeeded_count,
             failed_count,
             CASE
               WHEN retryable_count > 0
                 THEN 'failed_retryable'
               WHEN active_count > 0
                 THEN 'running'
               WHEN succeeded_count = expected_count
                 THEN 'succeeded'
               WHEN succeeded_count > 0
                    AND terminal_count + cancelled_count > 0
                 THEN 'partially_succeeded'
               WHEN terminal_count > 0
                 THEN 'failed_terminal'
               WHEN cancelled_count = expected_count
                 THEN 'cancelled'
               ELSE 'running'
             END AS resolved_status
           FROM target_summary
         )
         UPDATE catalog_sync_run
         SET expected_target_count = (
               SELECT expected_count FROM resolved
             ),
             succeeded_target_count = (
               SELECT succeeded_count FROM resolved
             ),
             failed_target_count = (
               SELECT failed_count FROM resolved
             ),
             sync_status = (
               SELECT resolved_status FROM resolved
             ),
             completed_at = CASE
               WHEN (
                 SELECT resolved_status FROM resolved
               ) IN (
                 'partially_succeeded',
                 'succeeded',
                 'failed_terminal',
                 'cancelled'
               )
               THEN COALESCE(completed_at, ?1)
               ELSE NULL
             END,
             updated_at = ?1
         WHERE id = ?2`,
      ).bind(
        now,
        target.catalog_sync_run_id,
      ),

      db.prepare(
        `INSERT INTO audit_event (
           event_uuid,
           event_type,
           entity_type,
           entity_id,
           actor_type,
           actor_id,
           correlation_key,
           reason_code,
           event_summary,
           event_metadata_json,
           occurred_at,
           recorded_at
         )
         SELECT
           ?1,
           ?2,
           'catalog_sync_target_run',
           target.id,
           'member',
           ?3,
           ?4,
           'provider_catalog_sync_result',
           'A provider Catalog synchronization result was reported.',
           json_object(
             'catalog_sync_run_id', run.id,
             'catalog_sync_target_run_id', target.id,
             'target_type', target.target_type,
             'target_key', target.target_key,
             'target_status', target.target_status,
             'attempt_count', target.attempt_count,
             'external_revision_key',
               target.external_revision_key,
             'last_error_code', target.last_error_code,
             'last_error_detail', target.last_error_detail,
             'next_attempt_at', target.next_attempt_at,
             'completed_at', target.completed_at,
             'sync_status', run.sync_status,
             'expected_target_count',
               run.expected_target_count,
             'succeeded_target_count',
               run.succeeded_target_count,
             'failed_target_count',
               run.failed_target_count
           ),
           ?5,
           ?5
         FROM catalog_sync_target_run AS target
         JOIN catalog_sync_run AS run
           ON run.id = target.catalog_sync_run_id
         WHERE target.id = ?6
           AND target.attempt_count = ?7
           AND target.target_status = ?8
           AND target.updated_at = ?9
           AND target.external_revision_key IS ?10
           AND target.last_error_code IS ?11
           AND target.last_error_detail IS ?12
           AND target.next_attempt_at IS ?13
           AND target.completed_at IS ?14
         RETURNING event_metadata_json`,
      ).bind(
        auditUuid,
        CATALOG_SYNC_RESULT_EVENT_TYPE,
        actor,
        idempotencyKey,
        now,
        targetRunId,
        nextAttemptNumber,
        command.result_status,
        now,
        command.external_revision_key,
        command.last_error_code,
        command.last_error_detail,
        nextAttemptAt,
        completedAt,
      ),
    ]);
  } catch (error) {
    const replay = await priorCatalogSyncCommand(
      db,
      CATALOG_SYNC_RESULT_EVENT_TYPE,
      idempotencyKey,
    );

    if (replay) {
      return {
        ...replay,
        idempotent_reuse: true,
      };
    }

    throw error;
  }

  if (
    Number(statements[0].meta.changes) !== 1 ||
    Number(statements[1].meta.changes) !== 1 ||
    Number(statements[2].meta.changes) !== 1
  ) {
    throw new Error(
      "catalog_sync_result_atomic_write_failed",
    );
  }

  const auditRow = statements[2].results?.[0] as
    | { event_metadata_json?: string }
    | undefined;

  if (!auditRow?.event_metadata_json) {
    throw new Error("catalog_sync_result_missing");
  }

  const result = JSON.parse(auditRow.event_metadata_json);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("catalog_sync_result_invalid");
  }

  return result as Record<string, unknown>;
}
