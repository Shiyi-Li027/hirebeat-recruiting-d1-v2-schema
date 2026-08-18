export interface OrchestratorConfiguration {
  defaultStepMaxAttempts:number;
  outboxMaxDeliveryAttempts:number;
  mlRequestTimeoutMs:number;
}

export async function loadOrchestratorConfiguration(
  db:D1Database,releaseId:number,
):Promise<OrchestratorConfiguration>{
  const rows=await db.prepare(
    `SELECT configuration_scope,configuration_key,configuration_value_json
     FROM system_configuration WHERE configuration_release_id=?1`,
  ).bind(releaseId).all<{configuration_scope:string;configuration_key:string;configuration_value_json:string}>();
  const values=new Map(rows.results.map((row)=>[`${row.configuration_scope}.${row.configuration_key}`,JSON.parse(row.configuration_value_json) as unknown]));
  const integer=(key:string,fallback:number,min:number,max:number)=>{
    const value=Number(values.get(key)??fallback);
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`runtime_configuration_invalid:${key}`);
    return value;
  };
  return{
    defaultStepMaxAttempts:integer("workflow.default_step_max_attempts",5,1,20),
    outboxMaxDeliveryAttempts:integer("outbox.max_delivery_attempts",8,1,50),
    mlRequestTimeoutMs:integer("ml_inference.request_timeout_ms",30_000,1_000,300_000),
  };
}
