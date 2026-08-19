import assert from "node:assert/strict";
import test from "node:test";
import { catalogRevisionOptions } from "../src/catalog";

function databaseReturning(row:Record<string,unknown>|null):D1Database{
  return {
    prepare(){
      return {
        bind(){
          return { first:async()=>row };
        },
      };
    },
  } as unknown as D1Database;
}

test("historical Catalog options preserve the published revision snapshot",async()=>{
  const result=await catalogRevisionOptions(databaseReturning({
    id:7,
    revision_number:7,
    snapshot_sha256:"a".repeat(64),
    catalog_snapshot_json:JSON.stringify({
      companies:[{id:1,company_name:"AGS Logistics"}],
      company_work_modes:[{company_work_mode_id:1,company_id:1,work_mode_name:"On-site"}],
      positions:[{id:4,company_id:1,position_name:"Data Quality Analyst"}],
    }),
    created_at:"2026-08-19T00:00:00.000Z",
  }),7);
  assert.deepEqual(result.revision,{
    id:7,
    revision_number:7,
    snapshot_sha256:"a".repeat(64),
    created_at:"2026-08-19T00:00:00.000Z",
  });
  assert.equal((result.positions as Array<{id:number}>)[0].id,4);
});

test("missing and malformed historical revisions fail closed",async()=>{
  await assert.rejects(()=>catalogRevisionOptions(databaseReturning(null),7),/catalog_revision_not_found/);
  await assert.rejects(()=>catalogRevisionOptions(databaseReturning({
    id:7,revision_number:7,snapshot_sha256:"a".repeat(64),
    catalog_snapshot_json:"not-json",created_at:"2026-08-19T00:00:00.000Z",
  }),7),/catalog_revision_snapshot_invalid/);
});
