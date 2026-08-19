import assert from "node:assert/strict";

import { createOrConfirmWorkflow, nextAttemptAt } from "../src/outbox-dispatcher";

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
console.log("Outbox Workflow instance idempotency tests passed.");
