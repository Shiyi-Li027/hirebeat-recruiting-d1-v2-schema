import assert from "node:assert/strict";
import test from "node:test";
import { localTimestampInTimeZone, parseResponseDueAt, requireFutureResponseDueAt, responseDueAtFromDays } from "../src/offer-deadline";

test("RFC 3339 offsets are normalized to UTC",()=>{
  assert.equal(parseResponseDueAt("2026-08-27T17:00:00-04:00"),"2026-08-27T21:00:00.000Z");
});

test("America/New_York wall-clock input uses the seasonal UTC offset",()=>{
  assert.equal(parseResponseDueAt("2026-08-27T17:00:00","America/New_York"),"2026-08-27T21:00:00.000Z");
  assert.equal(parseResponseDueAt("2026-01-27T17:00:00","America/New_York"),"2026-01-27T22:00:00.000Z");
});

test("a wall-clock timestamp without a declared time zone remains invalid",()=>{
  assert.throws(()=>parseResponseDueAt("2026-08-27T17:00:00"),/response_due_at_invalid_rfc3339/);
});

test("DST gaps and repeated wall-clock instants require correction or an explicit offset",()=>{
  assert.throws(()=>localTimestampInTimeZone("2026-03-08T02:30:00","America/New_York"),/response_due_at_nonexistent_local_time/);
  assert.throws(()=>localTimestampInTimeZone("2026-11-01T01:30:00","America/New_York"),/response_due_at_ambiguous_local_time/);
  assert.equal(parseResponseDueAt("2026-11-01T01:30:00-04:00"),"2026-11-01T05:30:00.000Z");
  assert.equal(parseResponseDueAt("2026-11-01T01:30:00-05:00"),"2026-11-01T06:30:00.000Z");
  assert.throws(()=>localTimestampInTimeZone("2026-08-27T17:00:00","Invalid/Zone"),/response_due_at_timezone_invalid/);
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
