import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalIntakeRequest } from "../../src/contracts/canonical-intake";
import { IngressError } from "../../src/errors/ingress-error";
import { StagingIntakeFaultInjector } from "../../src/services/staging-intake-fault-injector";

function request(sourceRecordId: string): CanonicalIntakeRequest {
  return {
    schemaVersion: "canonical-intake-v1",
    source: {
      sourceSystem: "google_form",
      sourceRecordId,
      sourceEventKey: `google-form:${sourceRecordId}`,
      submissionUuid: "11111111-1111-5111-8111-111111111111",
      sourceSubmittedAt: "2026-08-19T00:00:00.000Z",
    },
    technicalDelivery: {
      mechanism: "initial_delivery",
      causeCode: null,
      deliveredAt: "2026-08-19T00:00:01.000Z",
    },
    catalog: {
      companyId: 1,
      companyName: "Synthetic Company",
      companyWorkModeId: 1,
      companyWorkModeName: "On-site",
      positionId: 1,
      positionName: "Synthetic Position",
    },
    applicant: {
      personName: "Synthetic Candidate",
      personEmailAddress: "synthetic@example.com",
      personPhone: "+1 202 555 0100",
      startWorkingDate: "2026-09-01",
      endWorkingDate: null,
      workDuration: null,
    },
    resume: { kind: "no_resume" },
    sourceFieldSnapshot: {},
  };
}

function assertFault(
  action: () => void,
  safeCode: string,
  kind: "retryable" | "terminal",
): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof IngressError &&
      error.safeCode === safeCode &&
      error.kind === kind,
  );
}

test("fault injection requires staging and explicit enablement", () => {
  const source = request(
    "staging-google-fault-source-download-retry-once-disabled",
  );
  new StagingIntakeFaultInjector("production", "enabled")
    .beforeResumeResolve(source, 1);
  new StagingIntakeFaultInjector("staging", undefined)
    .beforeResumeResolve(source, 1);
});

test("ordinary staging source IDs never inject", () => {
  const injector = new StagingIntakeFaultInjector("staging", "enabled");
  injector.beforeResumeResolve(request("staging-google-enrichment-001"), 1);
  injector.beforeParser(request("staging-google-enrichment-001"), 1);
});

test("source-download fault is retryable only on attempt one", () => {
  const injector = new StagingIntakeFaultInjector("staging", "enabled");
  const source = request(
    "staging-google-fault-source-download-retry-once-001",
  );
  assertFault(
    () => injector.beforeResumeResolve(source, 1),
    "staging_fault_source_download_503",
    "retryable",
  );
  injector.beforeResumeResolve(source, 2);
});

test("Parser retryable faults recover after attempt one", () => {
  const injector = new StagingIntakeFaultInjector("staging", "enabled");
  for (const [mode, code] of [
    ["parser-429-retry-once", "parser_http_429"],
    ["parser-timeout-retry-once", "parser_timeout"],
  ] as const) {
    const source = request(`staging-google-fault-${mode}-001`);
    assertFault(() => injector.beforeParser(source, 1), code, "retryable");
    injector.beforeParser(source, 2);
  }
});

test("Parser empty-text fault is terminal on every attempt", () => {
  const injector = new StagingIntakeFaultInjector("staging", "enabled");
  const source = request("staging-google-fault-parser-empty-terminal-001");
  assertFault(
    () => injector.beforeParser(source, 1),
    "parser_empty_resume_text",
    "terminal",
  );
  assertFault(
    () => injector.beforeParser(source, 2),
    "parser_empty_resume_text",
    "terminal",
  );
});
