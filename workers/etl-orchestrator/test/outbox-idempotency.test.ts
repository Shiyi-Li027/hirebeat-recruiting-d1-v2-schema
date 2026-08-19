import assert from "node:assert/strict";

import {
  controlledRecoveryQueueMessage,
  createOrConfirmWorkflow,
  nextAttemptAt,
} from "../src/outbox-dispatcher";

async function createSuccess(): Promise<void> {
  let creates=0;
  const workflow={
    async create(){creates+=1;return{};},
    async get(){throw new Error("get must not run");},
  } as unknown as Workflow<{value:number}>;
  await createOrConfirmWorkflow(workflow,"event-1",{value:1});
  assert.equal(creates,1);
}

async function duplicateCreateIsConfirmed(): Promise<void> {
  let gets=0;
  const workflow={
    async create(){throw new Error("instance already exists");},
    async get(){
      gets+=1;
      return{async status(){return{status:"running"};}};
    },
  } as unknown as Workflow<{value:number}>;
  await createOrConfirmWorkflow(workflow,"event-2",{value:2});
  assert.equal(gets,1);
}

async function unknownInstancePreservesCreateError(): Promise<void> {
  const createError=new Error("workflow API unavailable");
  const workflow={
    async create(){throw createError;},
    async get(){return{async status(){return{status:"unknown"};}};},
  } as unknown as Workflow<{value:number}>;
  await assert.rejects(
    ()=>createOrConfirmWorkflow(workflow,"event-3",{value:3}),
    (error:unknown)=>error===createError,
  );
}

await createSuccess();
await duplicateCreateIsConfirmed();
await unknownInstancePreservesCreateError();
const before=Date.now();
const low=Date.parse(nextAttemptAt(1,()=>0));
const high=Date.parse(nextAttemptAt(1,()=>1));
assert.ok(low>=before+3_900&&low<=before+4_100);
assert.ok(high>=before+5_900&&high<=before+6_100);
const recoveryMessage=controlledRecoveryQueueMessage({
  event_type:"raw_submission.intake_recovery_requested",
  destination_key:"submission_intake",
  event_payload_json:JSON.stringify({
    submissionUuid:"940eba8a-696a-5121-a533-4ca5b7912236",
    acceptedPayloadHmac:"b".repeat(64),
    replayEnvelopeKey:"intake-replay-envelopes/v1/submission/hash.json",
    recoveryFenceToken:"recovery-fence-1",
    requestId:"request-1",
  }),
},"2026-08-19T00:00:00.000Z");
assert.deepEqual(recoveryMessage,{
  schemaVersion:"intake-queue-message-v2",
  submissionUuid:"940eba8a-696a-5121-a533-4ca5b7912236",
  acceptedPayloadHmac:"b".repeat(64),
  replayEnvelopeKey:"intake-replay-envelopes/v1/submission/hash.json",
  requestId:"request-1",
  enqueuedAt:"2026-08-19T00:00:00.000Z",
  recoveryFenceToken:"recovery-fence-1",
  deliveryKind:"controlled_recovery",
});
assert.throws(()=>controlledRecoveryQueueMessage({
  event_type:"raw_submission.intake_recovery_requested",
  destination_key:"submission_intake",
  event_payload_json:JSON.stringify({
    submissionUuid:"submission",
    acceptedPayloadHmac:"invalid",
    replayEnvelopeKey:"wrong-prefix",
    recoveryFenceToken:"",
    requestId:"request",
  }),
}),/intake_recovery_event_payload_invalid/);
console.log("Outbox Workflow instance idempotency tests passed.");
