import assert from "node:assert/strict";

import { IngressError } from "../../src/errors/ingress-error";
import { isIntakeQueueMessage } from "../../src/contracts/intake-queue-message";
import {
  classifyIntakeFailure,
  queueMessageOwnsCurrentRecoveryFence,
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

const common = {
  submissionUuid: "940eba8a-696a-5121-a533-4ca5b7912236",
  acceptedPayloadHmac: "a".repeat(64),
  replayEnvelopeKey: "intake-replay-envelopes/v1/example.json",
  requestId: "request-1",
  enqueuedAt: "2026-08-19T00:00:00.000Z",
};
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v1",
}), true);
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v1",
  recoveryFenceToken: "must-not-appear-on-v1",
}), false);
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v2",
  deliveryKind: "initial",
  recoveryFenceToken: null,
}), true);
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v2",
  deliveryKind: "controlled_recovery",
  recoveryFenceToken: "recovery-fence-1",
}), true);
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v2",
  deliveryKind: "controlled_recovery",
  recoveryFenceToken: null,
}), false);
assert.equal(isIntakeQueueMessage({
  ...common,
  schemaVersion: "intake-queue-message-v2",
  deliveryKind: "initial",
  recoveryFenceToken: "unexpected-fence",
}), false);

const acceptedPayloadHmac = "a".repeat(64);
const initialMessage = {
  ...common,
  schemaVersion: "intake-queue-message-v2" as const,
  deliveryKind: "initial" as const,
  recoveryFenceToken: null,
};
const recoveryMessage = {
  ...common,
  schemaVersion: "intake-queue-message-v2" as const,
  deliveryKind: "controlled_recovery" as const,
  recoveryFenceToken: "recovery-fence-1",
};
const activeRecovery = {
  recovery_fence_token: "recovery-fence-1",
  accepted_payload_hmac: acceptedPayloadHmac,
  intake_status: "failed_retryable",
};
assert.equal(
  queueMessageOwnsCurrentRecoveryFence(initialMessage, activeRecovery),
  false,
  "an ordinary stale delivery must not race an active controlled recovery",
);
assert.equal(
  queueMessageOwnsCurrentRecoveryFence(recoveryMessage, activeRecovery),
  true,
  "the matching controlled-recovery message owns the active fence",
);
assert.equal(
  queueMessageOwnsCurrentRecoveryFence(
    initialMessage,
    { ...activeRecovery, intake_status: "succeeded" },
  ),
  true,
  "a completed Intake must accept ordinary redelivery for idempotency audit",
);
assert.equal(
  queueMessageOwnsCurrentRecoveryFence(
    { ...recoveryMessage, recoveryFenceToken: "stale-fence" },
    activeRecovery,
  ),
  false,
  "a stale controlled-recovery message must lose the fence",
);

console.log("Intake Queue classification and backoff tests passed.");
