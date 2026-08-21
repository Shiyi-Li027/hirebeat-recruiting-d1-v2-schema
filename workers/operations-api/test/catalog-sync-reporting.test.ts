import assert from "node:assert/strict";
import test from "node:test";

import {
  beginCatalogSyncRun,
  catalogSyncRetryAt,
  reportCatalogSyncTargetResult,
  requireCatalogSyncResultCommand,
  requireCatalogSyncResultStatus,
  requireCatalogSyncStartCommand,
  requireCatalogSyncTargetType,
  summarizeCatalogSyncTargets,
} from "../src/catalog-sync-reporting";

test("Catalog Sync target types fail closed", () => {
  assert.equal(
    requireCatalogSyncTargetType("google_form"),
    "google_form",
  );
  assert.equal(
    requireCatalogSyncTargetType("airtable"),
    "airtable",
  );
  assert.throws(
    () => requireCatalogSyncTargetType("spreadsheet"),
    /catalog_sync_target_type_invalid/,
  );
});

test("Catalog Sync result statuses exclude internal states", () => {
  assert.equal(
    requireCatalogSyncResultStatus("succeeded"),
    "succeeded",
  );
  assert.equal(
    requireCatalogSyncResultStatus("failed_retryable"),
    "failed_retryable",
  );
  assert.equal(
    requireCatalogSyncResultStatus("failed_terminal"),
    "failed_terminal",
  );
  assert.throws(
    () => requireCatalogSyncResultStatus("running"),
    /catalog_sync_result_status_invalid/,
  );
});

test("all successful targets complete the parent run", () => {
  assert.deepEqual(
    summarizeCatalogSyncTargets([
      "succeeded",
      "succeeded",
    ]),
    {
      sync_status: "succeeded",
      expected_target_count: 2,
      succeeded_target_count: 2,
      failed_target_count: 0,
      completed: true,
    },
  );
});

test("retryable target failure keeps the run retryable", () => {
  assert.deepEqual(
    summarizeCatalogSyncTargets([
      "succeeded",
      "failed_retryable",
    ]),
    {
      sync_status: "failed_retryable",
      expected_target_count: 2,
      succeeded_target_count: 1,
      failed_target_count: 1,
      completed: false,
    },
  );
});

test("mixed success and terminal failure is partial success", () => {
  assert.deepEqual(
    summarizeCatalogSyncTargets([
      "succeeded",
      "failed_terminal",
    ]),
    {
      sync_status: "partially_succeeded",
      expected_target_count: 2,
      succeeded_target_count: 1,
      failed_target_count: 1,
      completed: true,
    },
  );
});

test("all terminal failures fail the parent terminally", () => {
  assert.deepEqual(
    summarizeCatalogSyncTargets([
      "failed_terminal",
      "failed_terminal",
    ]),
    {
      sync_status: "failed_terminal",
      expected_target_count: 2,
      succeeded_target_count: 0,
      failed_target_count: 2,
      completed: true,
    },
  );
});

test("pending work keeps the parent run running", () => {
  assert.equal(
    summarizeCatalogSyncTargets([
      "succeeded",
      "pending",
    ]).sync_status,
    "running",
  );
});

test("an empty target set is rejected", () => {
  assert.throws(
    () => summarizeCatalogSyncTargets([]),
    /catalog_sync_targets_empty/,
  );
});


test("Catalog Sync start commands validate target identity", () => {
  assert.deepEqual(
    requireCatalogSyncStartCommand({
      catalog_revision_id: 7,
      target_type: "google_form",
      target_key: "form-123",
    }),
    {
      catalog_revision_id: 7,
      target_type: "google_form",
      target_key: "form-123",
    },
  );

  assert.throws(
    () => requireCatalogSyncStartCommand({
      catalog_revision_id: 0,
      target_type: "google_form",
      target_key: "form-123",
    }),
    /catalog_revision_id_invalid/,
  );

  assert.throws(
    () => requireCatalogSyncStartCommand({
      catalog_revision_id: 7,
      target_type: "google_form",
      target_key: " ",
    }),
    /catalog_sync_target_key_invalid/,
  );
});

test("successful Catalog Sync results reject error fields", () => {
  assert.deepEqual(
    requireCatalogSyncResultCommand({
      result_status: "succeeded",
      external_revision_key: "snapshot-sha256",
    }),
    {
      result_status: "succeeded",
      external_revision_key: "snapshot-sha256",
      last_error_code: null,
      last_error_detail: null,
    },
  );

  assert.throws(
    () => requireCatalogSyncResultCommand({
      result_status: "succeeded",
      last_error_code: "unexpected_error",
    }),
    /catalog_sync_success_must_not_include_error/,
  );
});

test("failed Catalog Sync results require an error code", () => {
  assert.deepEqual(
    requireCatalogSyncResultCommand({
      result_status: "failed_retryable",
      last_error_code: "provider_http_503",
      last_error_detail: "Provider temporarily unavailable.",
    }),
    {
      result_status: "failed_retryable",
      external_revision_key: null,
      last_error_code: "provider_http_503",
      last_error_detail: "Provider temporarily unavailable.",
    },
  );

  assert.throws(
    () => requireCatalogSyncResultCommand({
      result_status: "failed_terminal",
    }),
    /catalog_sync_failure_error_code_required/,
  );
});


interface FakeCatalogSyncDatabaseOptions {
  prior?: Record<string, unknown> | null;
  revisionExists?: boolean;
}

function fakeCatalogSyncDatabase(
  options: FakeCatalogSyncDatabaseOptions = {},
): {
  db: D1Database;
  state: {
    batch_calls: number;
    batch_statement_count: number;
  };
} {
  const prior = options.prior ?? null;
  const revisionExists = options.revisionExists ?? true;

  const state = {
    batch_calls: 0,
    batch_statement_count: 0,
  };

  const result = {
    catalog_sync_run_id: 41,
    catalog_sync_run_uuid: "catalog-sync-run-uuid",
    catalog_revision_id: 7,
    sync_status: "running",
    catalog_sync_target_run_id: 52,
    target_type: "google_form",
    target_key: "form-123",
    target_status: "pending",
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            sql,
            values,
            async first() {
              if (sql.includes("FROM audit_event")) {
                return prior
                  ? {
                      event_metadata_json:
                        JSON.stringify(prior),
                    }
                  : null;
              }

              if (sql.includes("FROM catalog_revision")) {
                return revisionExists ? { id: 7 } : null;
              }

              throw new Error(
                `unexpected_fake_first_query:${sql}`,
              );
            },
          };
        },
      };
    },

    async batch(statements: unknown[]) {
      state.batch_calls += 1;
      state.batch_statement_count = statements.length;

      return [
        {
          success: true,
          results: [],
          meta: { changes: 1 },
        },
        {
          success: true,
          results: [],
          meta: { changes: 1 },
        },
        {
          success: true,
          results: [
            {
              event_metadata_json: JSON.stringify(result),
            },
          ],
          meta: { changes: 1 },
        },
      ];
    },
  } as unknown as D1Database;

  return { db, state };
}

test("Catalog Sync start atomically creates run, target and audit evidence", async () => {
  const { db, state } = fakeCatalogSyncDatabase();

  const result = await beginCatalogSyncRun(
    db,
    {
      idempotency_key: "catalog-sync-command-001",
      catalog_revision_id: 7,
      target_type: "google_form",
      target_key: "form-123",
    },
    "test@example.com",
  );

  assert.deepEqual(result, {
    catalog_sync_run_id: 41,
    catalog_sync_run_uuid: "catalog-sync-run-uuid",
    catalog_revision_id: 7,
    sync_status: "running",
    catalog_sync_target_run_id: 52,
    target_type: "google_form",
    target_key: "form-123",
    target_status: "pending",
  });

  assert.equal(state.batch_calls, 1);
  assert.equal(state.batch_statement_count, 3);
});

test("Catalog Sync start replays prior idempotent command evidence", async () => {
  const prior = {
    catalog_sync_run_id: 41,
    catalog_sync_target_run_id: 52,
    target_status: "pending",
  };

  const { db, state } = fakeCatalogSyncDatabase({
    prior,
  });

  const result = await beginCatalogSyncRun(
    db,
    {
      idempotency_key: "catalog-sync-command-001",
      catalog_revision_id: 7,
      target_type: "google_form",
      target_key: "form-123",
    },
    "test@example.com",
  );

  assert.deepEqual(result, {
    ...prior,
    idempotent_reuse: true,
  });

  assert.equal(state.batch_calls, 0);
});

test("Catalog Sync start rejects an unknown Catalog revision", async () => {
  const { db, state } = fakeCatalogSyncDatabase({
    revisionExists: false,
  });

  await assert.rejects(
    () => beginCatalogSyncRun(
      db,
      {
        idempotency_key: "catalog-sync-command-001",
        catalog_revision_id: 999,
        target_type: "google_form",
        target_key: "form-123",
      },
      "test@example.com",
    ),
    /catalog_revision_not_found/,
  );

  assert.equal(state.batch_calls, 0);
});

interface FakeCatalogSyncResultDatabaseOptions {
  prior?: Record<string, unknown> | null;
  targetExists?: boolean;
  targetStatus?:
    | "pending"
    | "running"
    | "succeeded"
    | "failed_retryable"
    | "failed_terminal"
    | "cancelled";
  attemptCount?: number;
  batchChanges?: [number, number, number];
}

function fakeCatalogSyncResultDatabase(
  options: FakeCatalogSyncResultDatabaseOptions = {},
): {
  db: D1Database;
  state: {
    batch_calls: number;
    batch_statement_count: number;
    batch_sql: string[];
  };
} {
  const prior = options.prior ?? null;
  const targetExists = options.targetExists ?? true;
  const targetStatus = options.targetStatus ?? "pending";
  const attemptCount = options.attemptCount ?? 0;
  const batchChanges =
    options.batchChanges ?? [1, 1, 1];

  const state = {
    batch_calls: 0,
    batch_statement_count: 0,
    batch_sql: [] as string[],
  };

  const result = {
    catalog_sync_run_id: 41,
    catalog_sync_target_run_id: 52,
    target_type: "google_form",
    target_key: "form-123",
    target_status: "succeeded",
    attempt_count: attemptCount + 1,
    external_revision_key: "snapshot-sha256",
    last_error_code: null,
    last_error_detail: null,
    next_attempt_at: null,
    completed_at: "2026-08-21T12:00:00.000Z",
    sync_status: "succeeded",
    expected_target_count: 1,
    succeeded_target_count: 1,
    failed_target_count: 0,
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            sql,
            values,

            async first() {
              if (sql.includes("FROM audit_event")) {
                return prior
                  ? {
                      event_metadata_json:
                        JSON.stringify(prior),
                    }
                  : null;
              }

              if (
                sql.includes(
                  "FROM catalog_sync_target_run",
                )
              ) {
                if (!targetExists) return null;

                return {
                  id: 52,
                  catalog_sync_run_id: 41,
                  target_status: targetStatus,
                  attempt_count: attemptCount,
                };
              }

              throw new Error(
                `unexpected_fake_result_first_query:${sql}`,
              );
            },
          };
        },
      };
    },

    async batch(statements: unknown[]) {
      state.batch_calls += 1;
      state.batch_statement_count = statements.length;
      state.batch_sql = statements.map(
        (statement) =>
          (statement as { sql: string }).sql,
      );

      return [
        {
          success: true,
          results: [],
          meta: { changes: batchChanges[0] },
        },
        {
          success: true,
          results: [],
          meta: { changes: batchChanges[1] },
        },
        {
          success: true,
          results: [
            {
              event_metadata_json:
                JSON.stringify(result),
            },
          ],
          meta: { changes: batchChanges[2] },
        },
      ];
    },
  } as unknown as D1Database;

  return { db, state };
}

test(
  "Catalog Sync result reporting uses bounded retry backoff",
  () => {
    const now = new Date("2026-08-21T12:00:00.000Z");

    assert.equal(
      catalogSyncRetryAt(1, now),
      "2026-08-21T12:01:00.000Z",
    );

    assert.equal(
      catalogSyncRetryAt(2, now),
      "2026-08-21T12:02:00.000Z",
    );

    assert.equal(
      catalogSyncRetryAt(7, now),
      "2026-08-21T13:00:00.000Z",
    );

    assert.equal(
      catalogSyncRetryAt(20, now),
      "2026-08-21T13:00:00.000Z",
    );
  },
);

test(
  "Catalog Sync result atomically updates target, parent and audit evidence",
  async () => {
    const { db, state } =
      fakeCatalogSyncResultDatabase();

    const result =
      await reportCatalogSyncTargetResult(
        db,
        52,
        {
          idempotency_key:
            "catalog-sync-result-command-001",
          result_status: "succeeded",
          external_revision_key:
            "snapshot-sha256",
        },
        "test@example.com",
      );

    assert.equal(
      result.catalog_sync_target_run_id,
      52,
    );
    assert.equal(result.target_status, "succeeded");
    assert.equal(result.sync_status, "succeeded");

    assert.equal(state.batch_calls, 1);
    assert.equal(state.batch_statement_count, 3);

    assert.match(
      state.batch_sql[0],
      /UPDATE catalog_sync_target_run/,
    );
    assert.match(
      state.batch_sql[0],
      /attempt_count = \?9/,
    );
    assert.match(
      state.batch_sql[1],
      /UPDATE catalog_sync_run/,
    );
    assert.match(
      state.batch_sql[2],
      /INSERT INTO audit_event/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.target_status = \?8/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.updated_at = \?9/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.external_revision_key IS \?10/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.last_error_code IS \?11/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.last_error_detail IS \?12/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.next_attempt_at IS \?13/,
    );
    assert.match(
      state.batch_sql[2],
      /target\.completed_at IS \?14/,
    );
  },
);

test(
  "Catalog Sync result replays prior idempotent command evidence",
  async () => {
    const prior = {
      catalog_sync_run_id: 41,
      catalog_sync_target_run_id: 52,
      target_status: "succeeded",
      sync_status: "succeeded",
    };

    const { db, state } =
      fakeCatalogSyncResultDatabase({
        prior,
      });

    const result =
      await reportCatalogSyncTargetResult(
        db,
        52,
        {
          idempotency_key:
            "catalog-sync-result-command-001",
          result_status: "succeeded",
          external_revision_key:
            "snapshot-sha256",
        },
        "test@example.com",
      );

    assert.deepEqual(result, {
      ...prior,
      idempotent_reuse: true,
    });

    assert.equal(state.batch_calls, 0);
  },
);

test(
  "Catalog Sync result rejects an already finalized target",
  async () => {
    const { db, state } =
      fakeCatalogSyncResultDatabase({
        targetStatus: "succeeded",
        attemptCount: 1,
      });

    await assert.rejects(
      () => reportCatalogSyncTargetResult(
        db,
        52,
        {
          idempotency_key:
            "catalog-sync-result-command-002",
          result_status: "succeeded",
          external_revision_key:
            "snapshot-sha256",
        },
        "test@example.com",
      ),
      /catalog_sync_target_run_finalized/,
    );

    assert.equal(state.batch_calls, 0);
  },
);

test(
  "Catalog Sync result rejects a concurrent target-state change",
  async () => {
    const { db, state } =
      fakeCatalogSyncResultDatabase({
        targetStatus: "running",
        attemptCount: 2,
        batchChanges: [0, 1, 0],
      });

    await assert.rejects(
      () => reportCatalogSyncTargetResult(
        db,
        52,
        {
          idempotency_key:
            "catalog-sync-result-command-003",
          result_status: "failed_retryable",
          last_error_code:
            "provider_http_503",
        },
        "test@example.com",
      ),
      /catalog_sync_result_atomic_write_failed/,
    );

    assert.equal(state.batch_calls, 1);
    assert.equal(state.batch_statement_count, 3);
  },
);
