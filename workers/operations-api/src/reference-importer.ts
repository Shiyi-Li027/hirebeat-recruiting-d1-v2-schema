import { commandKey, normalize, requirePositiveInteger } from "./helpers";

type ReferencePayload={table:string;columns:Record<string,unknown>;supportsActive:boolean};
type Builder=(body:Record<string,unknown>)=>ReferencePayload;

function requiredText(body:Record<string,unknown>,key:string):string{
  const value=String(body[key]??"").trim();
  if(!value)throw new Error(`${key}_required`);
  return value;
}
function optionalText(body:Record<string,unknown>,key:string):string|null{
  if(body[key]===undefined||body[key]===null)return null;
  const value=String(body[key]).trim();return value||null;
}
function integer(body:Record<string,unknown>,key:string,required=false):number|null{
  if(body[key]===undefined||body[key]===null){if(required)throw new Error(`${key}_required`);return null;}
  const value=Number(body[key]);if(!Number.isSafeInteger(value))throw new Error(`${key}_invalid`);return value;
}
function positive(body:Record<string,unknown>,key:string,required=false):number|null{
  if(body[key]===undefined||body[key]===null){if(required)throw new Error(`${key}_required`);return null;}
  return requirePositiveInteger(body[key],key);
}
function nullableBoolean(body:Record<string,unknown>,key:string):number|null{
  if(body[key]===undefined||body[key]===null)return null;
  if(body[key]===true||body[key]===1)return 1;if(body[key]===false||body[key]===0)return 0;
  throw new Error(`${key}_invalid`);
}
function active(body:Record<string,unknown>,required=false):number{
  if(body.is_active===undefined||body.is_active===null){if(required)throw new Error("is_active_required");return 1;}
  if(body.is_active===true||body.is_active===1)return 1;if(body.is_active===false||body.is_active===0)return 0;
  throw new Error("is_active_invalid");
}
function code(body:Record<string,unknown>,key:string):string{
  return requiredText(body,key).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}
function uuid(body:Record<string,unknown>,key:string):string{return optionalText(body,key)??crypto.randomUUID();}
function named(table:string,codeKey:string,nameKey:string,extra:Record<string,unknown>={}):Builder{
  return body=>({table,supportsActive:true,columns:{[codeKey]:code(body,codeKey),[nameKey]:requiredText(body,nameKey),...extra,is_active:active(body)}});
}

const BUILDERS:Record<string,Builder>={
  function:body=>{const name=requiredText(body,"function_name");return{table:"function",supportsActive:true,columns:{function_code:code(body,"function_code"),function_name:name,normalized_function_name:normalize(name),is_active:active(body)}};},
  seniority:body=>({table:"seniority",supportsActive:true,columns:{seniority_code:code(body,"seniority_code"),seniority_name:requiredText(body,"seniority_name"),seniority_rank:integer(body,"seniority_rank"),typical_experience_months_min:integer(body,"typical_experience_months_min"),typical_experience_months_max:integer(body,"typical_experience_months_max"),is_active:active(body)}}),
  contact_type:named("contact_type","contact_type_code","contact_type_name"),
  skill_type:named("skill_type","skill_type_code","skill_type_name"),
  skill:body=>{const name=requiredText(body,"skill_name");return{table:"skill",supportsActive:true,columns:{skill_uuid:uuid(body,"skill_uuid"),skill_name:name,normalized_skill_name:normalize(name),is_active:active(body)}};},
  skill_type_assignment:body=>({table:"skill_type_assignment",supportsActive:false,columns:{skill_id:positive(body,"skill_id",true),skill_type_id:positive(body,"skill_type_id",true)}}),
  skill_proficiency_level:body=>({table:"skill_proficiency_level",supportsActive:true,columns:{proficiency_level_code:code(body,"proficiency_level_code"),proficiency_level_name:requiredText(body,"proficiency_level_name"),proficiency_level_rank:integer(body,"proficiency_level_rank",true),is_active:active(body)}}),
  certification_type:named("certification_type","certification_type_code","certification_type_name"),
  issuing_organization:body=>{const name=requiredText(body,"organization_name");return{table:"issuing_organization",supportsActive:true,columns:{issuing_organization_uuid:uuid(body,"issuing_organization_uuid"),organization_name:name,normalized_organization_name:normalize(name),organization_url:optionalText(body,"organization_url"),is_active:active(body)}};},
  certification:body=>{const name=requiredText(body,"certification_name");return{table:"certification",supportsActive:true,columns:{certification_uuid:uuid(body,"certification_uuid"),certification_name:name,normalized_certification_name:normalize(name),certification_type_id:positive(body,"certification_type_id"),issuing_organization_id:positive(body,"issuing_organization_id"),certification_url:optionalText(body,"certification_url"),typical_validity_months:integer(body,"typical_validity_months"),is_active:active(body)}};},
  country:body=>({table:"country",supportsActive:true,columns:{country_code:requiredText(body,"country_code").toUpperCase(),country_name:requiredText(body,"country_name"),is_active:active(body)}}),
  state:body=>{const name=requiredText(body,"state_name");return{table:"state",supportsActive:true,columns:{country_id:positive(body,"country_id",true),state_code:optionalText(body,"state_code"),state_name:name,normalized_state_name:normalize(name),is_active:active(body)}};},
  city:body=>{const name=requiredText(body,"city_name");return{table:"city",supportsActive:true,columns:{city_uuid:uuid(body,"city_uuid"),country_id:positive(body,"country_id",true),state_id:positive(body,"state_id"),city_name:name,normalized_city_name:normalize(name),is_active:active(body)}};},
  location:body=>({table:"location",supportsActive:false,columns:{location_uuid:uuid(body,"location_uuid"),country_id:positive(body,"country_id"),state_id:positive(body,"state_id"),city_id:positive(body,"city_id"),postal_code:optionalText(body,"postal_code"),location_name:optionalText(body,"location_name")}}),
  degree:body=>({table:"degree",supportsActive:true,columns:{degree_code:code(body,"degree_code"),degree_name:requiredText(body,"degree_name"),degree_level_rank:integer(body,"degree_level_rank",true),is_active:active(body)}}),
  field_study:body=>{const name=requiredText(body,"field_study_name");return{table:"field_study",supportsActive:true,columns:{field_study_uuid:uuid(body,"field_study_uuid"),field_study_name:name,normalized_field_study_name:normalize(name),is_active:active(body)}};},
  major:body=>{const name=requiredText(body,"major_name");return{table:"major",supportsActive:true,columns:{major_uuid:uuid(body,"major_uuid"),field_study_id:positive(body,"field_study_id"),major_name:name,normalized_major_name:normalize(name),is_stem:nullableBoolean(body,"is_stem"),is_active:active(body)}};},
  school:body=>{const name=requiredText(body,"school_name");return{table:"school",supportsActive:true,columns:{school_uuid:uuid(body,"school_uuid"),school_name:name,normalized_school_name:normalize(name),school_url:optionalText(body,"school_url"),school_type:optionalText(body,"school_type"),school_category:optionalText(body,"school_category"),is_active:active(body)}};},
  work_mode:named("work_mode","work_mode_code","work_mode_name"),
  position_employment_type:named("position_employment_type","employment_type_code","employment_type_name"),
  position_occupational_type:body=>({table:"position_occupational_type",supportsActive:true,columns:{occupational_code:code(body,"occupational_code"),occupational_type_name:requiredText(body,"occupational_type_name"),is_active:active(body)}}),
};
const REFERENCE_META:Record<string,{table:string;supportsActive:boolean}>={
  function:{table:"function",supportsActive:true},seniority:{table:"seniority",supportsActive:true},
  contact_type:{table:"contact_type",supportsActive:true},skill_type:{table:"skill_type",supportsActive:true},
  skill:{table:"skill",supportsActive:true},skill_type_assignment:{table:"skill_type_assignment",supportsActive:false},
  skill_proficiency_level:{table:"skill_proficiency_level",supportsActive:true},certification_type:{table:"certification_type",supportsActive:true},
  issuing_organization:{table:"issuing_organization",supportsActive:true},certification:{table:"certification",supportsActive:true},
  country:{table:"country",supportsActive:true},state:{table:"state",supportsActive:true},city:{table:"city",supportsActive:true},
  location:{table:"location",supportsActive:false},degree:{table:"degree",supportsActive:true},field_study:{table:"field_study",supportsActive:true},
  major:{table:"major",supportsActive:true},school:{table:"school",supportsActive:true},work_mode:{table:"work_mode",supportsActive:true},
  position_employment_type:{table:"position_employment_type",supportsActive:true},
  position_occupational_type:{table:"position_occupational_type",supportsActive:true},
};

async function replay(db:D1Database,eventType:string,key:string):Promise<Record<string,unknown>|null>{
  const row=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`).bind(eventType,key).first<{event_metadata_json:string|null}>();
  return row?.event_metadata_json?JSON.parse(row.event_metadata_json) as Record<string,unknown>:null;
}

export function referenceTypes():string[]{return Object.keys(BUILDERS).sort();}

export async function createReference(db:D1Database,type:string,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const build=BUILDERS[type];if(!build)throw new Error("reference_type_not_supported");
  const key=commandKey(body);const eventType=`command.reference.${type}.create`;const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const payload=build(body);const now=new Date().toISOString();const columns={...payload.columns,created_at:now};
  if(type==="city"&&columns.state_id!==null){
    const valid=await db.prepare(`SELECT 1 valid FROM state WHERE id=?1 AND country_id=?2`).bind(columns.state_id,columns.country_id).first();
    if(!valid)throw new Error("city_state_country_mismatch");
  }
  if(type==="location"){
    if(columns.state_id!==null){
      const state=await db.prepare(`SELECT country_id FROM state WHERE id=?1`).bind(columns.state_id).first<{country_id:number}>();
      if(!state||columns.country_id!==null&&state.country_id!==columns.country_id)throw new Error("location_state_country_mismatch");
    }
    if(columns.city_id!==null){
      const city=await db.prepare(`SELECT country_id,state_id FROM city WHERE id=?1`).bind(columns.city_id).first<{country_id:number;state_id:number|null}>();
      if(!city||columns.country_id!==null&&city.country_id!==columns.country_id||columns.state_id!==null&&city.state_id!==columns.state_id)
        throw new Error("location_city_hierarchy_mismatch");
    }
  }
  if(payload.table!=="skill_type_assignment")Object.assign(columns,{updated_at:now});
  const names=Object.keys(columns);const placeholders=names.map((_,index)=>`?${index+1}`);
  const row=await db.prepare(`INSERT INTO ${payload.table} (${names.join(",")}) VALUES (${placeholders.join(",")}) RETURNING id`)
    .bind(...Object.values(columns)).first<{id:number}>();
  if(!row)throw new Error("reference_create_failed");
  const result={reference_type:type,reference_id:row.id,is_active:payload.supportsActive?(columns as Record<string,unknown>).is_active:null};
  await db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at) VALUES (?1,?2,?3,?4,'member',?5,?6,'author_command','Reference record created',?7,?8,?8)`)
    .bind(crypto.randomUUID(),eventType,payload.table,row.id,actor,key,JSON.stringify(result),now).run();
  return result;
}

export async function setReferenceActive(db:D1Database,type:string,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const meta=REFERENCE_META[type];if(!meta)throw new Error("reference_type_not_supported");
  if(!meta.supportsActive)throw new Error("reference_active_state_not_supported");
  const value=active(body,true);const key=commandKey(body);const eventType=`command.reference.${type}.active_state`;
  const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const now=new Date().toISOString();
  const row=await db.prepare(`UPDATE ${meta.table} SET is_active=?2,updated_at=?3 WHERE id=?1 RETURNING id`).bind(id,value,now).first<{id:number}>();
  if(!row)throw new Error("reference_not_found");
  const result={reference_type:type,reference_id:id,is_active:value};
  await db.prepare(`INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at) VALUES (?1,?2,?3,?4,'member',?5,?6,'author_command','Reference active state changed',?7,?8,?8)`)
    .bind(crypto.randomUUID(),eventType,meta.table,id,actor,key,JSON.stringify(result),now).run();
  return result;
}
