import assert from "node:assert/strict";

import { isRecoverableTechnicalExhaustion } from "../src/intake-recovery";

assert.equal(
  isRecoverableTechnicalExhaustion(
    "retry_exhausted:google_token_network_error",
  ),
  true,
);
assert.equal(
  isRecoverableTechnicalExhaustion("intake_queue_attempts_exhausted"),
  true,
);
assert.equal(isRecoverableTechnicalExhaustion("resume_pdf_invalid"), false);
assert.equal(isRecoverableTechnicalExhaustion("blocked_inactive_position"), false);
assert.equal(isRecoverableTechnicalExhaustion(null), false);

console.log("Controlled Intake recovery-policy tests passed.");
