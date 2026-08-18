import { commandKey } from "./helpers";

const ALLOWED:Record<string,string[]>= {
  draft:["preparing","cancelled"],preparing:["ready_to_send","cancelled"],
  ready_to_send:["sent","cancelled"],sent:["viewed","accepted","declined","expired","withdrawn"],
  viewed:["accepted","declined","expired","withdrawn"],accepted:[],declined:[],expired:[],withdrawn:[],cancelled:[],
};

export async function transitionOffer(
  db:D1Database,offerId:number,body:Record<string,unknown>,actor:string,
):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.offer.status.transition";
  const prior=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`)
    .bind(eventType,key).first<{event_metadata_json:string|null}>();
  if(prior?.event_metadata_json)return{...(JSON.parse(prior.event_metadata_json) as object),idempotent_reuse:true};
  const offer=await db.prepare(`SELECT id,application_id,current_offer_version_id,current_status,status_version FROM offer WHERE id=?1`)
    .bind(offerId).first<{id:number;application_id:number;current_offer_version_id:number|null;current_status:string;status_version:number}>();
  if(!offer)throw new Error("offer_not_found");const to=String(body.to_status??"");
  if(!ALLOWED[offer.current_status]?.includes(to))throw new Error("offer_status_transition_not_allowed");
  if(["ready_to_send","sent","viewed","accepted","declined","expired","withdrawn"].includes(to)&&!offer.current_offer_version_id)throw new Error("offer_version_required_for_status");
  const workflow=await db.prepare(`SELECT id FROM etl_workflow_run WHERE application_id=?1 AND workflow_type='workflow_b' AND workflow_status='succeeded' ORDER BY id DESC LIMIT 1`)
    .bind(offer.application_id).first<{id:number}>();if(!workflow)throw new Error("offer_source_workflow_missing");
  const now=new Date().toISOString();const reason=String(body.reason_code??"author_command");const historyUuid=crypto.randomUUID();
  const metadata={offer_id:offerId,from_status:offer.current_status,to_status:to,status_version:offer.status_version+1};
  const results=await db.batch([
    db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at)
      SELECT ?1,?2,'offer',id,'member',?3,?4,?5,'Offer status transitioned',?6,?7,?7 FROM offer
      WHERE id=?8 AND current_status=?9 AND status_version=?10`)
      .bind(crypto.randomUUID(),eventType,actor,key,reason,JSON.stringify(metadata),now,offerId,offer.current_status,offer.status_version),
    db.prepare(`INSERT INTO offer_status_history (offer_status_history_uuid,offer_id,application_id,offer_version_id,workflow_run_id,idempotency_key,from_status,to_status,initiated_by_type,initiated_by_reference,reason_code,event_metadata_json,occurred_at,created_at)
      SELECT ?1,id,application_id,current_offer_version_id,?2,?3,?4,?5,'recruiter',?6,?7,'{}',?8,?8 FROM offer
      WHERE id=?9 AND current_status=?4 AND status_version=?10`)
      .bind(historyUuid,workflow.id,key,offer.current_status,to,actor,reason,now,offerId,offer.status_version),
    db.prepare(`UPDATE offer SET current_status=?2,status_version=status_version+1,current_status_changed_at=?3,updated_at=?3 WHERE id=?1 AND current_status=?4 AND status_version=?5`)
      .bind(offerId,to,now,offer.current_status,offer.status_version),
  ]);
  if(results.some((result)=>!result.success)||results.some((result)=>Number(result.meta.changes)!==1))throw new Error("offer_status_concurrent_update");
  return metadata;
}
