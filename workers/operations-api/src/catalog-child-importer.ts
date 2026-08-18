import { commandKey, requirePositiveInteger } from "./helpers";

type ChildPayload={table:string;columns:Record<string,unknown>};
type Builder=(body:Record<string,unknown>)=>ChildPayload;

function optionalText(body:Record<string,unknown>,key:string):string|null{
  if(body[key]===undefined||body[key]===null)return null;const value=String(body[key]).trim();return value||null;
}
function requiredText(body:Record<string,unknown>,key:string):string{
  const value=optionalText(body,key);if(!value)throw new Error(`${key}_required`);return value;
}
function positive(body:Record<string,unknown>,key:string,required=false):number|null{
  if(body[key]===undefined||body[key]===null){if(required)throw new Error(`${key}_required`);return null;}
  return requirePositiveInteger(body[key],key);
}
function nonnegative(body:Record<string,unknown>,key:string):number|null{
  if(body[key]===undefined||body[key]===null)return null;const value=Number(body[key]);
  if(!Number.isSafeInteger(value)||value<0)throw new Error(`${key}_invalid`);return value;
}
function optionalNumber(body:Record<string,unknown>,key:string):number|null{
  if(body[key]===undefined||body[key]===null)return null;const value=Number(body[key]);
  if(!Number.isFinite(value))throw new Error(`${key}_invalid`);return value;
}
function bool(body:Record<string,unknown>,key:string,defaultValue:number):number{
  if(body[key]===undefined||body[key]===null)return defaultValue;
  if(body[key]===true||body[key]===1)return 1;if(body[key]===false||body[key]===0)return 0;
  throw new Error(`${key}_invalid`);
}
function requirement(body:Record<string,unknown>):string{
  const value=String(body.requirement_type??"");if(!["required","preferred"].includes(value))throw new Error("requirement_type_invalid");return value;
}

const BUILDERS:Record<string,Builder>={
  company_contact_info:body=>({table:"company_contact_info",columns:{company_id:positive(body,"company_id",true),contact_type_id:positive(body,"contact_type_id"),contact_value:requiredText(body,"contact_value"),contact_name:optionalText(body,"contact_name"),contact_position_title:optionalText(body,"contact_position_title"),is_primary:bool(body,"is_primary",0),priority_rank:positive(body,"priority_rank"),is_active:bool(body,"is_active",1)}}),
  company_work_mode:body=>({table:"company_work_mode",columns:{company_id:positive(body,"company_id",true),work_mode_id:positive(body,"work_mode_id",true),is_active:bool(body,"is_active",1)}}),
  position_salary_range:body=>({table:"position_salary_range",columns:{position_id:positive(body,"position_id",true),salary_min_cents:nonnegative(body,"salary_min_cents"),salary_max_cents:nonnegative(body,"salary_max_cents"),currency_code:requiredText(body,"currency_code").toUpperCase(),salary_period:requiredText(body,"salary_period").toLowerCase(),is_active:bool(body,"is_active",1)}}),
  position_skill:body=>({table:"position_skill",columns:{position_id:positive(body,"position_id",true),skill_id:positive(body,"skill_id",true),requirement_type:requirement(body),minimum_proficiency_level_id:positive(body,"minimum_proficiency_level_id"),onet_importance_score:optionalNumber(body,"onet_importance_score"),onet_dependence_score:optionalNumber(body,"onet_dependence_score"),onet_preparation_score:optionalNumber(body,"onet_preparation_score"),is_active:bool(body,"is_active",1)}}),
  position_education_requirement:body=>({table:"position_education_requirement",columns:{position_id:positive(body,"position_id",true),degree_id:positive(body,"degree_id",true),field_study_id:positive(body,"field_study_id"),requirement_type:requirement(body),is_active:bool(body,"is_active",1)}}),
  position_certification_requirement:body=>({table:"position_certification_requirement",columns:{position_id:positive(body,"position_id",true),certification_id:positive(body,"certification_id",true),requirement_type:requirement(body),is_active:bool(body,"is_active",1)}}),
};

async function replay(db:D1Database,eventType:string,key:string):Promise<Record<string,unknown>|null>{
  const row=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`).bind(eventType,key).first<{event_metadata_json:string|null}>();
  return row?.event_metadata_json?JSON.parse(row.event_metadata_json) as Record<string,unknown>:null;
}

export function catalogChildTypes():string[]{return Object.keys(BUILDERS).sort();}

export async function createCatalogChild(db:D1Database,type:string,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const build=BUILDERS[type];if(!build)throw new Error("catalog_child_type_not_supported");
  const key=commandKey(body);const eventType=`command.catalog.${type}.create`;const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const payload=build(body);const now=new Date().toISOString();const columns={...payload.columns,created_at:now,updated_at:now};
  const names=Object.keys(columns);const placeholders=names.map((_,index)=>`?${index+1}`);
  const row=await db.prepare(`INSERT INTO ${payload.table} (${names.join(",")}) VALUES (${placeholders.join(",")}) RETURNING id`)
    .bind(...Object.values(columns)).first<{id:number}>();if(!row)throw new Error("catalog_child_create_failed");
  const result={catalog_child_type:type,catalog_child_id:row.id,is_active:(columns as Record<string,unknown>).is_active};
  await db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at) VALUES (?1,?2,?3,?4,'member',?5,?6,'author_command','Catalog child record created',?7,?8,?8)`)
    .bind(crypto.randomUUID(),eventType,payload.table,row.id,actor,key,JSON.stringify(result),now).run();
  return result;
}

export async function setCatalogChildActive(db:D1Database,type:string,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const build=BUILDERS[type];if(!build)throw new Error("catalog_child_type_not_supported");
  if(body.is_active===undefined||body.is_active===null)throw new Error("is_active_required");
  const table=type;const value=bool(body,"is_active",1);const key=commandKey(body);const eventType=`command.catalog.${type}.active_state`;
  const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};const now=new Date().toISOString();
  const row=await db.prepare(`UPDATE ${table} SET is_active=?2,updated_at=?3 WHERE id=?1 RETURNING id`).bind(id,value,now).first<{id:number}>();
  if(!row)throw new Error("catalog_child_not_found");const result={catalog_child_type:type,catalog_child_id:id,is_active:value};
  await db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at) VALUES (?1,?2,?3,?4,'member',?5,?6,'author_command','Catalog child active state changed',?7,?8,?8)`)
    .bind(crypto.randomUUID(),eventType,table,id,actor,key,JSON.stringify(result),now).run();
  return result;
}
