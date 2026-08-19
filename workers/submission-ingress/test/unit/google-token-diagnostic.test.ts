import assert from "node:assert/strict";

import { safeGoogleTokenDiagnostic } from "../../src/services/google-access-token";

const sensitive = "private-key-and-jwt-assertion-must-not-appear";
const diagnostic = safeGoogleTokenDiagnostic(
  new TypeError(sensitive),
  false,
  10_000,
);
assert.deepEqual(diagnostic, {
  event: "google_token_fetch_failed",
  failureStage: "google_oauth_token_fetch",
  failureClass: "fetch_type_error",
  errorName: "TypeError",
  timeoutMs: 10_000,
});
assert.equal(JSON.stringify(diagnostic).includes(sensitive), false);

const timeout = safeGoogleTokenDiagnostic(
  new DOMException(sensitive, "AbortError"),
  true,
  30_000,
);
assert.equal(timeout.failureClass, "timeout");
assert.equal(timeout.errorName, "AbortError");
assert.equal(JSON.stringify(timeout).includes(sensitive), false);

console.log("Google Token safe-diagnostic tests passed.");
