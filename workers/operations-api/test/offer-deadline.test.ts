import assert from "node:assert/strict";
import test from "node:test";
import { parseResponseDueAt, requireFutureResponseDueAt, responseDueAtFromDays } from "../src/offer-deadline";

test("RFC 3339 offsets are normalized to UTC",()=>{
  assert.equal(parseResponseDueAt("2026-08-27T17:00:00-04:00"),"2026-08-27T21:00:00.000Z");
});

test("invalid calendar timestamps are rejected",()=>{
  assert.throws(()=>parseResponseDueAt("2026-02-30T21:00:00Z"),/response_due_at_invalid_rfc3339/);
});

test("explicit deadlines must be in the future",()=>{
  assert.throws(()=>requireFutureResponseDueAt("2026-08-18T20:59:59Z",new Date("2026-08-18T21:00:00Z")),/response_due_at_must_be_future/);
});

test("default deadline is calculated from the actual send instant",()=>{
  assert.equal(responseDueAtFromDays(new Date("2026-08-18T21:00:00Z"),7),"2026-08-25T21:00:00.000Z");
});
