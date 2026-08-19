import assert from "node:assert/strict";
import worker from "../../src/index";

const token = "staging-ingress-test-token-which-is-long-enough";

const request = new Request(
  "https://ingress.example.test/internal/v1/sources/google-form",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sourceRecordId: "route-error-boundary-001",
      sourceEventKey: "google-form:route-error-boundary-001",
      sourceSubmittedAt: "2026-08-18T18:00:00.000Z",
      deliveredAt: "2026-08-19T01:21:01.000Z",
      technicalRedeliveryMechanism: "initial_delivery",
      fields: {
        "Company ID": 1,
        "Company Name": "Synthetic Company",
        "Company Work Mode ID": 1,
        "Company Work Mode": "On-site",
        "Position ID": 1,
        "Position Name": "Synthetic Position",
        "Candidate Name": "Synthetic Candidate",
        "Email Address": "synthetic@example.com",
        "Start Working Date": "2026-09-01",
        "Google Drive File ID": "1UZHYh4lC0DJvA3CtDQxSmf5Ixru5XHkt",
      },
    }),
  },
);

const environment = {
  DB: {
    prepare(): never {
      throw new Error("synthetic asynchronous D1 failure");
    },
  },
  hirebeat_hr_raw_resumes_pdf_r2_v1: {},
  DEPLOYMENT_STAGE: "test",
  SOURCE_SCHEMA_VERSION: "canonical-intake-v1",
  SUBMISSION_UUID_NAMESPACE: "676628aa-0c13-4b8f-9dc1-3d675f7487a2",
  PARSER_SERVICE_URL: "https://parser.example.test",
  SUBMISSION_HMAC_KEY_V1: "x".repeat(64),
  INGRESS_INTERNAL_AUTH_TOKEN: token,
  GOOGLE_SERVICE_ACCOUNT_JSON: "{}",
  CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON: "{}",
  PARSER_SERVICE_AUTH_TOKEN: "parser-test-token",
} as never;

const response = await worker.fetch(request, environment);
const body = (await response.json()) as {
  error?: string;
  requestId?: string;
};

assert.equal(response.status, 500);
assert.equal(body.error, "internal_error");
assert.match(body.requestId ?? "", /^[0-9a-f-]{36}$/);

console.log("Ingress route error-boundary regression test passed.");
