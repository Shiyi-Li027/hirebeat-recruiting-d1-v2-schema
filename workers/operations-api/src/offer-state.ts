import { commandKey, sha256 } from "./helpers";
import { loadOfferDeadlinePolicy, parseResponseDueAt, responseDueAtFromDays } from "./offer-deadline";
import { canonical } from "./offer-version";

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
  const nowDate=new Date();const now=nowDate.toISOString();const reason=String(body.reason_code??"author_command");const historyUuid=crypto.randomUUID();
  let responseDueAt:string|null=null;let deadlineSource:"explicit"|"default_policy"|null=null;
  let derived:{uuid:string;versionNo:number;termsHash:string;termsJson:string;policyReleaseId:number;policyReleaseKey:string;policyReleaseVersion:number;windowDays:number}|null=null;
  if(to==="sent"){
    const version=await db.prepare(`SELECT version_no,response_due_at,offer_terms_json FROM offer_version WHERE id=?1 AND offer_id=?2`)
      .bind(offer.current_offer_version_id,offerId).first<{version_no:number;response_due_at:string|null;offer_terms_json:string}>();
    if(!version)throw new Error("offer_version_required_for_status");
    responseDueAt=parseResponseDueAt(version.response_due_at);
    if(responseDueAt!==null){
      if(Date.parse(responseDueAt)<=nowDate.getTime())throw new Error("response_due_at_must_be_after_sent_at");
      deadlineSource="explicit";
    }else{
      const policy=await loadOfferDeadlinePolicy(db);responseDueAt=responseDueAtFromDays(nowDate,policy.defaultResponseWindowDays);
      let priorTerms:Record<string,unknown>;
      try{const parsed=JSON.parse(version.offer_terms_json) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error();priorTerms=parsed as Record<string,unknown>;}catch{throw new Error("offer_terms_json_invalid");}
      const termsJson=canonical({...priorTerms,response_due_at:responseDueAt});const termsHash=await sha256(termsJson);
      derived={uuid:crypto.randomUUID(),versionNo:version.version_no+1,termsHash,termsJson,
        policyReleaseId:policy.configurationReleaseId,policyReleaseKey:policy.configurationReleaseKey,
        policyReleaseVersion:policy.releaseVersion,windowDays:policy.defaultResponseWindowDays};
      deadlineSource="default_policy";
    }
  }
  const metadata={offer_id:offerId,from_status:offer.current_status,to_status:to,status_version:offer.status_version+1,
    response_due_at:responseDueAt,response_due_at_source:deadlineSource,
    ...(derived?{derived_offer_version_uuid:derived.uuid,default_response_window_days:derived.windowDays,
      configuration_release_id:derived.policyReleaseId,configuration_release_key:derived.policyReleaseKey,
      configuration_release_version:derived.policyReleaseVersion}:{}),
  };
  const statements:D1PreparedStatement[]=[];
  if(derived){
    statements.push(db.prepare(`INSERT INTO offer_version (
      offer_version_uuid,offer_id,version_no,terms_sha256,offer_title,employment_type_id,work_location,work_mode,
      employment_start_date,employment_end_date,work_duration,compensation_amount_minor_units,compensation_currency_code,
      compensation_period,signing_bonus_minor_units,target_bonus_description,equity_description,response_due_at,
      offer_terms_json,prepared_by_type,prepared_by_reference,created_at)
      SELECT ?1,offer_id,?2,?3,offer_title,employment_type_id,work_location,work_mode,
        employment_start_date,employment_end_date,work_duration,compensation_amount_minor_units,compensation_currency_code,
        compensation_period,signing_bonus_minor_units,target_bonus_description,equity_description,?4,
        ?5,'recruiter',?6,?7 FROM offer_version
      WHERE id=?8 AND offer_id=?9`)
      .bind(derived.uuid,derived.versionNo,derived.termsHash,responseDueAt,derived.termsJson,
        `${actor};default_policy:${derived.policyReleaseKey}`,now,offer.current_offer_version_id,offerId));
    statements.push(db.prepare(`UPDATE offer SET current_offer_version_id=(SELECT id FROM offer_version WHERE offer_version_uuid=?2),updated_at=?3
      WHERE id=?1 AND current_offer_version_id=?4 AND current_status=?5 AND status_version=?6`)
      .bind(offerId,derived.uuid,now,offer.current_offer_version_id,offer.current_status,offer.status_version));
  }
  statements.push(db.prepare(`UPDATE offer SET current_status=?2,status_version=status_version+1,current_status_changed_at=?3,updated_at=?3
    WHERE id=?1 AND current_status=?4 AND status_version=?5`)
    .bind(offerId,to,now,offer.current_status,offer.status_version));
  statements.push(db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at)
    SELECT CASE WHEN current_status=?1 AND status_version=?2 THEN ?3 ELSE NULL END,?4,'offer',id,'member',?5,?6,?7,
      'Offer status transitioned',?8,?9,?9 FROM offer WHERE id=?10`)
    .bind(to,offer.status_version+1,crypto.randomUUID(),eventType,actor,key,reason,JSON.stringify(metadata),now,offerId));
  statements.push(db.prepare(`INSERT INTO offer_status_history (offer_status_history_uuid,offer_id,application_id,offer_version_id,workflow_run_id,idempotency_key,from_status,to_status,initiated_by_type,initiated_by_reference,reason_code,event_metadata_json,occurred_at,created_at)
    SELECT ?1,id,application_id,current_offer_version_id,?2,?3,?4,?5,'recruiter',?6,?7,?8,?9,?9 FROM offer
    WHERE id=?10 AND current_status=?5 AND status_version=?11`)
    .bind(historyUuid,workflow.id,key,offer.current_status,to,actor,reason,JSON.stringify({response_due_at:responseDueAt,response_due_at_source:deadlineSource}),now,offerId,offer.status_version+1));
  const results=await db.batch(statements);
  if(results.some((result)=>!result.success)||results.some((result)=>Number(result.meta.changes)!==1))throw new Error("offer_status_concurrent_update");
  const current=await db.prepare(`SELECT current_offer_version_id FROM offer WHERE id=?1`).bind(offerId).first<{current_offer_version_id:number|null}>();
  return{...metadata,current_offer_version_id:current?.current_offer_version_id??null};
}
