import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldInjectOutboxRetry,
  STAGING_ORCHESTRATOR_FAULT_SOURCES,
  workflowAFaultForSource,
} from "../src/staging-orchestrator-fault-injector";

test("Outbox retry injection requires the exact first Workflow A delivery", () => {
  const base = {
    eventType: "raw_submission.published",
    destinationKey: "workflow_a",
    deliveryAttemptCount: 1,
  };
  assert.equal(
    shouldInjectOutboxRetry(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxRetry,
      base,
    ),
    true,
  );
  assert.equal(
    shouldInjectOutboxRetry(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxRetry,
      { ...base, deliveryAttemptCount: 2 },
    ),
    false,
  );
  assert.equal(
    shouldInjectOutboxRetry("staging-google-enrichment-001", base),
    false,
  );
});

test("Workflow A transient injection affects only normalize attempt one", () => {
  const source = STAGING_ORCHESTRATOR_FAULT_SOURCES.workflowATransient;
  assert.equal(workflowAFaultForSource(source, "normalize_submission", 1), "transient");
  assert.equal(workflowAFaultForSource(source, "normalize_submission", 2), null);
  assert.equal(workflowAFaultForSource(source, "initial_cleaning", 1), null);
});

test("Workflow A permanent contract fixture remains terminal on every attempt", () => {
  const source = STAGING_ORCHESTRATOR_FAULT_SOURCES.workflowATerminal;
  assert.equal(workflowAFaultForSource(source, "normalize_submission", 1), "terminal");
  assert.equal(workflowAFaultForSource(source, "normalize_submission", 2), "terminal");
  assert.equal(
    workflowAFaultForSource("staging-google-enrichment-001", "normalize_submission", 1),
    null,
  );
});
