import assert from "node:assert/strict";
import { transitionOffer } from "../src/offer-state";

class FakeStatement {
  args:unknown[]=[];
  constructor(readonly db:FakeDb,readonly sql:string){}
  bind(...args:unknown[]):FakeStatement{this.args=args;return this;}
  async first<T>():Promise<T|null>{return this.db.first(this.sql) as T|null;}
}

class FakeDb {
  constructor(readonly responseDueAt:string|null){}
  prepare(sql:string):FakeStatement{return new FakeStatement(this,sql);}

  first(sql:string):unknown{
    if(sql.includes("FROM audit_event"))return null;
    if(sql.includes("FROM offer WHERE id=?1"))return{
      id:3,application_id:8,current_offer_version_id:9,current_status:"ready_to_send",status_version:3,
    };
    if(sql.includes("FROM etl_workflow_run"))return{id:22};
    if(sql.includes("FROM offer_version"))return{
      version_no:1,response_due_at:this.responseDueAt,offer_terms_json:"{}",
    };
    if(sql.includes("FROM system_configuration_release"))return{
      configuration_release_id:3,
      configuration_release_key:"hirebeat-system-configuration-v3",
      release_version:3,
      configuration_value_json:"7",
    };
    throw new Error(`unexpected_query:${sql}`);
  }

  async batch(statements:FakeStatement[]):Promise<Array<{success:boolean;meta:{changes:number}}>>{
    assert.equal(statements.length,this.responseDueAt===null?5:3);
    const audit=statements.find((statement)=>statement.sql.includes("INSERT INTO audit_event"));
    assert.ok(audit,"audit statement must be present");
    assert.equal(statements[0],audit,"the audit command claim must precede all guarded mutations");
    assert.doesNotMatch(audit.sql,/CASE\s+WHEN\s+current_status/i);
    assert.match(
      audit.sql,
      /WHERE id=\?8 AND current_status=\?9 AND status_version=\?10/,
      "stale status writers must produce zero audit rows instead of a NULL event UUID",
    );
    for(const statement of statements.slice(1)){
      assert.match(
        statement.sql,
        /EXISTS \(SELECT 1 FROM audit_event WHERE event_type=/,
        "every state mutation must be fenced by this command's audit claim",
      );
    }
    return statements.map(()=>({success:true,meta:{changes:0}}));
  }
}

for(const [caseName,responseDueAt] of [
  ["explicit deadline","2099-01-15T22:00:00.000Z"],
  ["default-policy deadline",null],
] as const){
  await assert.rejects(
    ()=>transitionOffer(
      new FakeDb(responseDueAt) as unknown as D1Database,
      3,
      {
        idempotency_key:`staging-concurrency-regression-${caseName}`,
        to_status:"sent",
        reason_code:"unit_test",
      },
      "unit-test@example.com",
    ),
    /offer_status_concurrent_update/,
  );
}

console.log("Offer status concurrency regression test passed.");
