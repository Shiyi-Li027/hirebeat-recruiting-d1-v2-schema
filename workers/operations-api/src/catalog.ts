import { commandKey, normalize, requirePositiveInteger, sha256 } from "./helpers";

async function replay(db:D1Database,eventType:string,key:string):Promise<Record<string,unknown>|null>{
  const row=await db.prepare(`SELECT event_metadata_json FROM audit_event WHERE event_type=?1 AND correlation_key=?2`)
    .bind(eventType,key).first<{event_metadata_json:string|null}>();
  return row?.event_metadata_json?JSON.parse(row.event_metadata_json) as Record<string,unknown>:null;
}

function audit(db:D1Database,eventType:string,entityType:string,entityId:number,actor:string,key:string,metadata:unknown,now:string):D1PreparedStatement{
  return db.prepare(
    `INSERT INTO audit_event (event_uuid,event_type,entity_type,entity_id,actor_type,actor_id,
     correlation_key,reason_code,event_summary,event_metadata_json,occurred_at,recorded_at)
     VALUES (?1,?2,?3,?4,'member',?5,?6,'author_command',?7,?8,?9,?9)`,
  ).bind(crypto.randomUUID(),eventType,entityType,entityId,actor,key,eventType,JSON.stringify(metadata),now);
}

export async function createCompany(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.company.create";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const name=String(body.company_name??"").trim();if(!name)throw new Error("company_name_required");
  const uuid=String(body.company_uuid??crypto.randomUUID());const now=new Date().toISOString();
  await db.prepare(
    `INSERT INTO company (company_uuid,company_name,normalized_company_name,company_website_url,
     company_linkedin_url,company_description,is_active,default_max_submission_attempts,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,COALESCE(?8,5),?9,?9)`,
  ).bind(uuid,name,normalize(name),body.company_website_url??null,body.company_linkedin_url??null,
    body.company_description??null,body.is_active===false?0:1,body.default_max_submission_attempts??null,now).run();
  const row=await db.prepare(`SELECT id FROM company WHERE company_uuid=?1`).bind(uuid).first<{id:number}>();if(!row)throw new Error("company_create_failed");
  const result={company_id:row.id,company_uuid:uuid};await audit(db,eventType,"company",row.id,actor,key,result,now).run();return result;
}

export async function updateCompany(db:D1Database,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.company.update";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const now=new Date().toISOString();const active=body.is_active===undefined?null:(body.is_active?1:0);
  const result=await db.prepare(
    `UPDATE company SET company_website_url=COALESCE(?2,company_website_url),company_linkedin_url=COALESCE(?3,company_linkedin_url),
     company_description=COALESCE(?4,company_description),is_active=COALESCE(?5,is_active),
     default_max_submission_attempts=COALESCE(?6,default_max_submission_attempts),updated_at=?7 WHERE id=?1 RETURNING id`,
  ).bind(id,body.company_website_url??null,body.company_linkedin_url??null,body.company_description??null,active,
    body.default_max_submission_attempts??null,now).first<{id:number}>();if(!result)throw new Error("company_not_found");
  const metadata={company_id:id};await audit(db,eventType,"company",id,actor,key,metadata,now).run();return metadata;
}

export async function createCompanyWorkMode(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.company_work_mode.create";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const companyId=requirePositiveInteger(body.company_id,"company_id");const workModeId=requirePositiveInteger(body.work_mode_id,"work_mode_id");const now=new Date().toISOString();
  await db.prepare(`INSERT INTO company_work_mode (company_id,work_mode_id,is_active,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)`)
    .bind(companyId,workModeId,body.is_active===false?0:1,now).run();
  const row=await db.prepare(`SELECT id FROM company_work_mode WHERE company_id=?1 AND work_mode_id=?2`).bind(companyId,workModeId).first<{id:number}>();if(!row)throw new Error("company_work_mode_create_failed");
  const result={company_work_mode_id:row.id};await audit(db,eventType,"company_work_mode",row.id,actor,key,result,now).run();return result;
}

export async function createPosition(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.position.create";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const companyId=requirePositiveInteger(body.company_id,"company_id");const name=String(body.position_name??"").trim();if(!name)throw new Error("position_name_required");
  const uuid=String(body.position_uuid??crypto.randomUUID());const now=new Date().toISOString();const status=String(body.position_status??"draft");
  await db.prepare(
    `INSERT INTO position (position_uuid,company_id,position_name,normalized_position_name,position_jd,
     occupational_type_id,employment_type_id,function_id,seniority_id,location_id,work_duration,
     position_status,openings_count,posted_date,offers_relocation_assistance,local_candidates_only,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)`,
  ).bind(uuid,companyId,name,normalize(name),body.position_jd??null,body.occupational_type_id??null,
    body.employment_type_id??null,body.function_id??null,body.seniority_id??null,body.location_id??null,
    body.work_duration??null,status,body.openings_count??null,body.posted_date??null,
    body.offers_relocation_assistance??null,body.local_candidates_only??null,now).run();
  const row=await db.prepare(`SELECT id FROM position WHERE position_uuid=?1`).bind(uuid).first<{id:number}>();if(!row)throw new Error("position_create_failed");
  const result={position_id:row.id,position_uuid:uuid};await audit(db,eventType,"position",row.id,actor,key,result,now).run();return result;
}

export async function updatePosition(db:D1Database,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.position.update";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const now=new Date().toISOString();
  const row=await db.prepare(
    `UPDATE position SET position_jd=COALESCE(?2,position_jd),work_duration=COALESCE(?3,work_duration),
     position_status=COALESCE(?4,position_status),openings_count=COALESCE(?5,openings_count),
     posted_date=COALESCE(?6,posted_date),updated_at=?7 WHERE id=?1 RETURNING id`,
  ).bind(id,body.position_jd??null,body.work_duration??null,body.position_status??null,body.openings_count??null,body.posted_date??null,now).first<{id:number}>();
  if(!row)throw new Error("position_not_found");const result={position_id:id};await audit(db,eventType,"position",id,actor,key,result,now).run();return result;
}

export async function catalogOptions(db:D1Database):Promise<Record<string,unknown>>{
  const companies=(await db.prepare(`SELECT id,company_uuid,company_name FROM company WHERE is_active=1 ORDER BY company_name,id`).all()).results;
  const workModes=(await db.prepare(`SELECT cwm.id company_work_mode_id,cwm.company_id,wm.work_mode_code,wm.work_mode_name FROM company_work_mode cwm JOIN work_mode wm ON wm.id=cwm.work_mode_id WHERE cwm.is_active=1 AND wm.is_active=1 ORDER BY cwm.company_id,wm.work_mode_name`).all()).results;
  const positions=(await db.prepare(`SELECT id,position_uuid,company_id,position_name FROM position WHERE position_status='active' ORDER BY company_id,position_name,id`).all()).results;
  const revision=await db.prepare(`SELECT id,revision_number,snapshot_sha256,created_at FROM catalog_revision ORDER BY revision_number DESC LIMIT 1`).first();
  return{revision,companies,company_work_modes:workModes,positions};
}

export async function publishCatalogRevision(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.revision.publish";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const snapshot=await catalogOptions(db);delete snapshot.revision;const snapshotJson=JSON.stringify(snapshot);const snapshotHash=await sha256(snapshotJson);
  const existing=await db.prepare(`SELECT id,revision_number FROM catalog_revision WHERE snapshot_sha256=?1`).bind(snapshotHash).first<{id:number;revision_number:number}>();
  if(existing)return{catalog_revision_id:existing.id,revision_number:existing.revision_number,unchanged:true};
  const next=await db.prepare(`SELECT COALESCE(MAX(revision_number),0)+1 revision_number FROM catalog_revision`).first<{revision_number:number}>();
  const uuid=crypto.randomUUID();const now=new Date().toISOString();
  await db.prepare(`INSERT INTO catalog_revision (catalog_revision_uuid,revision_number,catalog_snapshot_json,snapshot_sha256,change_reason,created_by_actor,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)`)
    .bind(uuid,next?.revision_number??1,snapshotJson,snapshotHash,body.change_reason??null,actor,now).run();
  const revision=await db.prepare(`SELECT id,revision_number FROM catalog_revision WHERE catalog_revision_uuid=?1`).bind(uuid).first<{id:number;revision_number:number}>();if(!revision)throw new Error("catalog_revision_create_failed");
  const result={catalog_revision_id:revision.id,revision_number:revision.revision_number,snapshot_sha256:snapshotHash};
  await audit(db,eventType,"catalog_revision",revision.id,actor,key,result,now).run();return result;
}
