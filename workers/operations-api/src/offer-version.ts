import { commandKey, sha256 } from "./helpers";
import { requireFutureResponseDueAt } from "./offer-deadline";
import { loadSystemTimePolicy } from "./time-policy";

export function canonical(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  const object=value as Record<string,unknown>;
  return `{${Object.keys(object).sort().map((key)=>`${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function nullableText(value:unknown):string|null{
  const text=String(value??"").trim();return text||null;
}

function nullableNonnegativeInteger(value:unknown,name:string):number|null{
  if(value===undefined||value===null||value==="")return null;
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<0)throw new Error(`${name}_invalid`);
  return parsed;
}

export async function createOfferVersion(
  db:D1Database,offerId:number,body:Record<string,unknown>,actor:string,
):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.offer.version.create";
  const prior=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`)
    .bind(eventType,key).first<{event_metadata_json:string|null}>();
  if(prior?.event_metadata_json)return{...(JSON.parse(prior.event_metadata_json) as object),idempotent_reuse:true};

  const offer=await db.prepare(`SELECT id,current_status,current_offer_version_id FROM offer WHERE id=?1`)
    .bind(offerId).first<{id:number;current_status:string;current_offer_version_id:number|null}>();
  if(!offer)throw new Error("offer_not_found");
  if(["accepted","declined","expired","withdrawn","cancelled"].includes(offer.current_status))throw new Error("offer_terminal");

  const title=String(body.offer_title??"").trim();if(!title)throw new Error("offer_title_required");
  const compensationAmount=nullableNonnegativeInteger(body.compensation_amount_minor_units,"compensation_amount_minor_units");
  const currency=nullableText(body.compensation_currency_code)?.toUpperCase()??null;
  const period=nullableText(body.compensation_period);
  if((compensationAmount===null)!==(currency===null)||(compensationAmount===null)!==(period===null))throw new Error("compensation_fields_must_be_all_null_or_all_present");

  const nowDate=new Date();
  const timePolicy=await loadSystemTimePolicy(db);
  const inputTimeZone=nullableText(body.response_due_at_timezone);
  if(inputTimeZone&&inputTimeZone!==timePolicy.businessTimeZone)throw new Error("response_due_at_timezone_not_supported");
  const terms={
    offer_title:title,employment_type_id:body.employment_type_id??null,
    work_location:nullableText(body.work_location),work_mode:nullableText(body.work_mode),
    employment_start_date:nullableText(body.employment_start_date),employment_end_date:nullableText(body.employment_end_date),
    work_duration:nullableText(body.work_duration),compensation_amount_minor_units:compensationAmount,
    compensation_currency_code:currency,compensation_period:period,
    signing_bonus_minor_units:nullableNonnegativeInteger(body.signing_bonus_minor_units,"signing_bonus_minor_units"),
    target_bonus_description:nullableText(body.target_bonus_description),equity_description:nullableText(body.equity_description),
    response_due_at:requireFutureResponseDueAt(body.response_due_at,nowDate,inputTimeZone),additional_terms:body.additional_terms??null,
  };
  const termsJson=canonical(terms);const termsHash=await sha256(termsJson);
  const duplicate=await db.prepare(`SELECT id,version_no FROM offer_version WHERE offer_id=?1 AND terms_sha256=?2`)
    .bind(offerId,termsHash).first<{id:number;version_no:number}>();
  if(duplicate)return{offer_id:offerId,offer_version_id:duplicate.id,version_no:duplicate.version_no,terms_sha256:termsHash,idempotent_terms_reuse:true};

  const next=await db.prepare(`SELECT COALESCE(MAX(version_no),0)+1 version_no FROM offer_version WHERE offer_id=?1`)
    .bind(offerId).first<{version_no:number}>();
  const versionNo=next?.version_no??1;const versionUuid=crypto.randomUUID();const now=nowDate.toISOString();
  const metadata={offer_id:offerId,offer_version_uuid:versionUuid,version_no:versionNo,terms_sha256:termsHash,
    response_due_at:terms.response_due_at,response_due_at_input_timezone:inputTimeZone,
    storage_timezone:timePolicy.storageTimeZone,business_timezone:timePolicy.businessTimeZone};
  const results=await db.batch([
    db.prepare(`INSERT INTO offer_version (
      offer_version_uuid,offer_id,version_no,terms_sha256,offer_title,employment_type_id,work_location,work_mode,
      employment_start_date,employment_end_date,work_duration,compensation_amount_minor_units,compensation_currency_code,
      compensation_period,signing_bonus_minor_units,target_bonus_description,equity_description,response_due_at,
      offer_terms_json,prepared_by_type,prepared_by_reference,created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,'recruiter',?20,?21)`)
      .bind(versionUuid,offerId,versionNo,termsHash,title,body.employment_type_id??null,terms.work_location,terms.work_mode,
        terms.employment_start_date,terms.employment_end_date,terms.work_duration,compensationAmount,currency,period,
        terms.signing_bonus_minor_units,terms.target_bonus_description,terms.equity_description,terms.response_due_at,termsJson,actor,now),
    db.prepare(`UPDATE offer SET current_offer_version_id=(SELECT id FROM offer_version WHERE offer_version_uuid=?2),updated_at=?3
      WHERE id=?1 AND current_status NOT IN ('accepted','declined','expired','withdrawn','cancelled')`)
      .bind(offerId,versionUuid,now),
    db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,
      reason_code,event_summary,event_metadata_json,occurred_at,recorded_at)
      VALUES (?1,?2,'offer',?3,'member',?4,?5,'author_command','Immutable Offer version created',?6,?7,?7)`)
      .bind(crypto.randomUUID(),eventType,offerId,actor,key,JSON.stringify(metadata),now),
  ]);
  if(results.some((result)=>!result.success)||results.some((result)=>Number(result.meta.changes)!==1))throw new Error("offer_version_concurrent_update");
  const created=await db.prepare(`SELECT id FROM offer_version WHERE offer_version_uuid=?1`).bind(versionUuid).first<{id:number}>();
  if(!created)throw new Error("offer_version_create_failed");
  return{...metadata,offer_version_id:created.id};
}
