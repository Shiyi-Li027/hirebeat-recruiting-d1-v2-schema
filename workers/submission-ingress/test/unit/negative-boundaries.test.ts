import assert from "node:assert/strict";

import { adaptGoogleFormEvent } from "../../src/adapters/google-form-adapter";
import { IngressError } from "../../src/errors/ingress-error";
import { processIntakeQueueMessage } from "../../src/services/intake-queue-recovery";
import { requireInternalAuthentication } from "../../src/services/internal-auth";

const expectedToken="e".repeat(64);

await assert.rejects(
  ()=>requireInternalAuthentication(new Request("https://example.test"),expectedToken),
  (error:unknown)=>error instanceof IngressError&&error.safeCode==="missing_internal_authentication",
);
await assert.rejects(
  ()=>requireInternalAuthentication(new Request("https://example.test",{
    headers:{authorization:`Bearer ${"x".repeat(64)}`},
  }),expectedToken),
  (error:unknown)=>error instanceof IngressError&&error.safeCode==="invalid_internal_authentication",
);
await requireInternalAuthentication(new Request("https://example.test",{
  headers:{authorization:`Bearer ${expectedToken}`},
}),expectedToken);

await assert.rejects(
  ()=>adaptGoogleFormEvent(
    {sourceRecordId:"staging-malformed",fields:"not-an-object"},
    {
      uuidNamespace:"676628aa-0c13-4b8f-9dc1-3d675f7487a2",
      sourceSchemaVersion:"canonical-intake-v1",
    },
  ),
  (error:unknown)=>error instanceof IngressError&&error.safeCode==="source_fields_missing",
);

let ackCount=0;
let retryCount=0;
let intakeCallCount=0;
const acceptedHmac="a".repeat(64);
const message={
  body:{
    schemaVersion:"intake-queue-message-v2",
    submissionUuid:"940eba8a-696a-5121-a533-4ca5b7912236",
    acceptedPayloadHmac:acceptedHmac,
    replayEnvelopeKey:`intake-replay-envelopes/v1/example/${acceptedHmac}.json`,
    requestId:"negative-boundary-test",
    enqueuedAt:"2026-08-19T00:00:00.000Z",
    recoveryFenceToken:null,
    deliveryKind:"initial",
  },
  attempts:1,
  ack(){ackCount+=1;},
  retry(){retryCount+=1;},
};
const request={
  schemaVersion:"canonical-intake-v1",
  source:{
    sourceSystem:"google_form",
    sourceRecordId:"staging-hmac-mismatch",
    sourceEventKey:"google-form:staging-hmac-mismatch",
    submissionUuid:"940eba8a-696a-5121-a533-4ca5b7912236",
    sourceSubmittedAt:"2026-08-19T00:00:00.000Z",
  },
  technicalDelivery:{
    mechanism:"initial_delivery",
    causeCode:null,
    deliveredAt:"2026-08-19T00:00:00.000Z",
  },
  catalog:{
    companyId:1,companyName:"Synthetic Company",companyWorkModeId:1,
    companyWorkModeName:"On-site",positionId:1,positionName:"Synthetic Position",
  },
  applicant:{
    personName:"Synthetic Applicant",personEmailAddress:"synthetic@example.com",
    personPhone:"+1 202 555 0100",startWorkingDate:"2026-09-01",
    endWorkingDate:null,workDuration:"12 months",
  },
  resume:{kind:"no_resume"},
  sourceFieldSnapshot:{},
};
const db={
  prepare(){return{bind(){return this;},async first(){return null;}};},
};

await processIntakeQueueMessage({
  message:message as unknown as Message<unknown>,
  store:{async get(){return request;}} as never,
  hmac:{async calculate(){return{hmacHex:"b".repeat(64),keyVersion:"v1"};}},
  intake:{async receive(){intakeCallCount+=1;return{outcome:"created"};}} as never,
  db:db as unknown as D1Database,
});

assert.equal(ackCount,1,"an HMAC mismatch must be acknowledged as terminal");
assert.equal(retryCount,0,"an HMAC mismatch must not be retried");
assert.equal(intakeCallCount,0,"an HMAC mismatch must never reach Intake publication");

console.log("Ingress negative-boundary tests passed.");
