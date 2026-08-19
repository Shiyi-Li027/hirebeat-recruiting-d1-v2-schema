import assert from "node:assert/strict";

import { IngressError } from "../../src/errors/ingress-error";
import {
  classifyIntakeFailure,
  queueBackoffSeconds,
} from "../../src/services/intake-queue-recovery";

assert.equal(classifyIntakeFailure(new IngressError({
  kind:"retryable",safeCode:"parser_503",message:"temporary",httpStatus:503,
})),"retryable");
assert.equal(classifyIntakeFailure(new IngressError({
  kind:"validation",safeCode:"invalid_pdf",message:"bad",httpStatus:400,
})),"terminal");
assert.equal(classifyIntakeFailure(new IngressError({
  kind:"conflict",safeCode:"intake_attempt_fence_lost",message:"stale",httpStatus:409,
})),"stale_noop");

for(let attempt=1;attempt<=5;attempt+=1){
  const delay=queueBackoffSeconds(attempt);
  const base=Math.min(30*2**Math.max(0,attempt-1),900);
  assert.ok(delay>=Math.floor(base*0.8));
  assert.ok(delay<=Math.ceil(base*1.2));
}

console.log("Intake Queue classification and backoff tests passed.");
