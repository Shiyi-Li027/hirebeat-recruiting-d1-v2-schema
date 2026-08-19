import assert from "node:assert/strict";
import test from "node:test";

import {
  outboxBoundaryFaultForSource,
  shouldInjectOutboxRetry,
  shouldInjectOutboxPostCreateAckRetry,
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

test("post-create acknowledgement failure targets only delivery one", () => {
  const base = {
    eventType: "raw_submission.published",
    destinationKey: "workflow_a",
    deliveryAttemptCount: 1,
  };
  assert.equal(
    shouldInjectOutboxPostCreateAckRetry(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxPostCreateAckRetry,
      base,
    ),
    true,
  );
  assert.equal(
    shouldInjectOutboxPostCreateAckRetry(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxPostCreateAckRetry,
      { ...base, deliveryAttemptCount: 2 },
    ),
    false,
  );
});

test("invalid Outbox boundary fixtures require exact source and route", () => {
  const route = {
    eventType: "raw_submission.published",
    destinationKey: "workflow_a",
  };
  assert.equal(
    outboxBoundaryFaultForSource(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxInvalidJson,
      route,
    ),
    "invalid_json",
  );
  assert.equal(
    outboxBoundaryFaultForSource(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxInvalidDestination,
      route,
    ),
    "invalid_destination",
  );
  assert.equal(
    outboxBoundaryFaultForSource(
      STAGING_ORCHESTRATOR_FAULT_SOURCES.outboxInvalidJson,
      { ...route, destinationKey: "workflow_b" },
    ),
    null,
  );
  assert.equal(
    outboxBoundaryFaultForSource("staging-google-enrichment-001", route),
    null,
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
