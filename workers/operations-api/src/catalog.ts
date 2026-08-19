import { commandKey, normalize, requirePositiveInteger, sha256 } from "./helpers";
import { shouldCreateCatalogRevision } from "./catalog-revision";
import { CURRENT_POSITION_JD_WAITER_PREDICATE } from "../../shared/src/position-jd-waiter-policy";

function activeFlag(value:unknown,defaultValue=1):number{
  if(value===undefined||value===null)return defaultValue;
  if(value===true||value===1)return 1;if(value===false||value===0)return 0;
  throw new Error("is_active_invalid");
}

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

async function resumePositionJdWaiters(db:D1Database,positionId:number):Promise<number>{
  const waiting=(await db.prepare(
    `SELECT app.id application_id,app.current_candidate_snapshot_id candidate_snapshot_id,
            app.decision_fence_token,w.id workflow_run_id,w.configuration_release_id,
            CAST(config.configuration_value_json AS INTEGER) max_delivery_attempts
     FROM application app
     JOIN etl_workflow_run w ON w.application_id=app.id
       AND w.workflow_type='workflow_b' AND w.workflow_status='waiting'
       AND w.current_step_key='waiting_position_jd'
     JOIN system_configuration config ON config.configuration_release_id=w.configuration_release_id
       AND config.configuration_scope='outbox' AND config.configuration_key='max_delivery_attempts'
     WHERE app.position_id=?1
       AND ${CURRENT_POSITION_JD_WAITER_PREDICATE}`,
  ).bind(positionId).all<{
    application_id:number;candidate_snapshot_id:number;decision_fence_token:string;
    workflow_run_id:number;configuration_release_id:number;max_delivery_attempts:number;
  }>()).results;
  let resumed=0;
  for(const item of waiting){
    const now=new Date().toISOString();const fence=crypto.randomUUID();const eventUuid=crypto.randomUUID();
    const results=await db.batch([
      db.prepare(`UPDATE application SET decision_fence_token=?2,updated_at=?3
                  WHERE id=?1 AND decision_fence_token=?4
                    AND application_lifecycle_status='processing' AND application_decision_status='pending'`)
        .bind(item.application_id,fence,now,item.decision_fence_token),
      db.prepare(`UPDATE etl_workflow_run SET workflow_status='cancelled',
                  cancellation_reason_code='position_jd_ready_requeued',completed_at=?2,updated_at=?2
                  WHERE id=?1 AND workflow_status='waiting'
                    AND EXISTS (SELECT 1 FROM application WHERE id=?3 AND decision_fence_token=?4)`)
        .bind(item.workflow_run_id,now,item.application_id,fence),
      db.prepare(`INSERT INTO outbox_event (
                    event_uuid,deduplication_key,event_type,event_schema_version,
                    aggregate_type,aggregate_id,destination_type,destination_key,
                    event_payload_json,dispatch_status,delivery_attempt_count,
                    max_delivery_attempts,available_at,created_at,updated_at)
                  SELECT ?1,?2,'application.position_jd_ready','application-position-jd-ready-v1',
                         'application',id,'cloudflare_workflow','workflow_b',
                         json_object('applicationId',id,'candidateSnapshotId',current_candidate_snapshot_id,
                                     'configurationReleaseId',?3,'decisionFenceToken',?4),
                         'pending',0,?5,?6,?6,?6 FROM application
                  WHERE id=?7 AND decision_fence_token=?4`)
        .bind(eventUuid,`workflow_b_jd_ready:${item.application_id}:${item.workflow_run_id}`,
          item.configuration_release_id,fence,item.max_delivery_attempts,now,item.application_id),
    ]);
    if(Number(results[2].meta.changes)===1)resumed+=1;
  }
  return resumed;
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
    body.company_description??null,activeFlag(body.is_active),body.default_max_submission_attempts??null,now).run();
  const row=await db.prepare(`SELECT id FROM company WHERE company_uuid=?1`).bind(uuid).first<{id:number}>();if(!row)throw new Error("company_create_failed");
  const result={company_id:row.id,company_uuid:uuid};await audit(db,eventType,"company",row.id,actor,key,result,now).run();return result;
}

export async function updateCompany(db:D1Database,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.company.update";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const now=new Date().toISOString();const active=body.is_active===undefined?null:activeFlag(body.is_active);
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
    .bind(companyId,workModeId,activeFlag(body.is_active),now).run();
  const row=await db.prepare(`SELECT id FROM company_work_mode WHERE company_id=?1 AND work_mode_id=?2`).bind(companyId,workModeId).first<{id:number}>();if(!row)throw new Error("company_work_mode_create_failed");
  const result={company_work_mode_id:row.id};await audit(db,eventType,"company_work_mode",row.id,actor,key,result,now).run();return result;
}

export async function createPosition(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.position.create";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const companyId=requirePositiveInteger(body.company_id,"company_id");const name=String(body.position_name??"").trim();if(!name)throw new Error("position_name_required");
  const positionJd=body.position_jd==null?null:String(body.position_jd);
  const uuid=String(body.position_uuid??crypto.randomUUID());const now=new Date().toISOString();
  const status=body.position_status==null?(positionJd&&positionJd.trim().length>=10?"active":"draft"):String(body.position_status);
  if(status==="active"&&(!positionJd||positionJd.trim().length<10))throw new Error("position_jd_required_for_active");
  await db.prepare(
    `INSERT INTO position (position_uuid,company_id,position_name,normalized_position_name,position_jd,
     occupational_type_id,employment_type_id,function_id,seniority_id,location_id,work_duration,
     position_status,openings_count,posted_date,offers_relocation_assistance,local_candidates_only,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)`,
  ).bind(uuid,companyId,name,normalize(name),positionJd,body.occupational_type_id??null,
    body.employment_type_id??null,body.function_id??null,body.seniority_id??null,body.location_id??null,
    body.work_duration??null,status,body.openings_count??null,body.posted_date??null,
    body.offers_relocation_assistance??null,body.local_candidates_only??null,now).run();
  const row=await db.prepare(`SELECT id FROM position WHERE position_uuid=?1`).bind(uuid).first<{id:number}>();if(!row)throw new Error("position_create_failed");
  const result={position_id:row.id,position_uuid:uuid};await audit(db,eventType,"position",row.id,actor,key,result,now).run();return result;
}

export async function updatePosition(db:D1Database,id:number,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.position.update";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const now=new Date().toISOString();
  const current=await db.prepare(`SELECT position_jd,position_status FROM position WHERE id=?1`).bind(id)
    .first<{position_jd:string|null;position_status:string}>();
  if(!current)throw new Error("position_not_found");
  const hasJd=Object.prototype.hasOwnProperty.call(body,"position_jd");
  const effectiveJd=hasJd?(body.position_jd==null?null:String(body.position_jd)):current.position_jd;
  const effectiveStatus=body.position_status==null?current.position_status:String(body.position_status);
  if(effectiveStatus==="active"&&(!effectiveJd||effectiveJd.trim().length<10))throw new Error("position_jd_required_for_active");
  const row=await db.prepare(
    `UPDATE position SET position_jd=?2,work_duration=COALESCE(?3,work_duration),
     position_status=?4,openings_count=COALESCE(?5,openings_count),
     posted_date=COALESCE(?6,posted_date),updated_at=?7 WHERE id=?1 RETURNING id`,
  ).bind(id,effectiveJd,body.work_duration??null,effectiveStatus,body.openings_count??null,body.posted_date??null,now).first<{id:number}>();
  if(!row)throw new Error("position_not_found");
  const resumedWorkflowCount=effectiveStatus==="active"&&effectiveJd&&effectiveJd.trim().length>=10
    ?await resumePositionJdWaiters(db,id):0;
  const result={position_id:id,resumed_waiting_workflow_count:resumedWorkflowCount};
  await audit(db,eventType,"position",id,actor,key,result,now).run();return result;
}

export async function catalogOptions(db:D1Database):Promise<Record<string,unknown>>{
  const companies=(await db.prepare(`SELECT id,company_uuid,company_name FROM company WHERE is_active=1 ORDER BY company_name,id`).all()).results;
  const workModes=(await db.prepare(`SELECT cwm.id company_work_mode_id,cwm.company_id,wm.work_mode_code,wm.work_mode_name FROM company_work_mode cwm JOIN work_mode wm ON wm.id=cwm.work_mode_id WHERE cwm.is_active=1 AND wm.is_active=1 ORDER BY cwm.company_id,wm.work_mode_name`).all()).results;
  const positions=(await db.prepare(`SELECT id,position_uuid,company_id,position_name FROM position WHERE position_status='active' AND position_jd IS NOT NULL AND length(trim(position_jd))>=10 ORDER BY company_id,position_name,id`).all()).results;
  const revision=await db.prepare(`SELECT id,revision_number,snapshot_sha256,created_at FROM catalog_revision ORDER BY revision_number DESC LIMIT 1`).first();
  return{revision,companies,company_work_modes:workModes,positions};
}

export async function catalogRevisionOptions(db:D1Database,revisionNumber:number):Promise<Record<string,unknown>>{
  const revision=await db.prepare(
    `SELECT id,revision_number,snapshot_sha256,catalog_snapshot_json,created_at
     FROM catalog_revision WHERE revision_number=?1`,
  ).bind(revisionNumber).first<{
    id:number;revision_number:number;snapshot_sha256:string;
    catalog_snapshot_json:string;created_at:string;
  }>();
  if(!revision)throw new Error("catalog_revision_not_found");
  let snapshot:unknown;
  try{snapshot=JSON.parse(revision.catalog_snapshot_json);}catch{throw new Error("catalog_revision_snapshot_invalid");}
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot))throw new Error("catalog_revision_snapshot_invalid");
  return{
    revision:{
      id:revision.id,
      revision_number:revision.revision_number,
      snapshot_sha256:revision.snapshot_sha256,
      created_at:revision.created_at,
    },
    ...(snapshot as Record<string,unknown>),
  };
}

export async function publishCatalogRevision(db:D1Database,body:Record<string,unknown>,actor:string):Promise<Record<string,unknown>>{
  const key=commandKey(body);const eventType="command.catalog.revision.publish";const prior=await replay(db,eventType,key);if(prior)return{...prior,idempotent_reuse:true};
  const snapshot=await catalogOptions(db);delete snapshot.revision;const snapshotJson=JSON.stringify(snapshot);const snapshotHash=await sha256(snapshotJson);
  const latest=await db.prepare(`SELECT id,revision_number,snapshot_sha256 FROM catalog_revision ORDER BY revision_number DESC LIMIT 1`)
    .first<{id:number;revision_number:number;snapshot_sha256:string}>();
  if(!shouldCreateCatalogRevision(latest?.snapshot_sha256??null,snapshotHash)&&latest)
    return{catalog_revision_id:latest.id,revision_number:latest.revision_number,unchanged:true};
  const next=await db.prepare(`SELECT COALESCE(MAX(revision_number),0)+1 revision_number FROM catalog_revision`).first<{revision_number:number}>();
  const uuid=crypto.randomUUID();const now=new Date().toISOString();
  await db.prepare(`INSERT INTO catalog_revision (catalog_revision_uuid,revision_number,catalog_snapshot_json,snapshot_sha256,change_reason,created_by_actor,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)`)
    .bind(uuid,next?.revision_number??1,snapshotJson,snapshotHash,body.change_reason??null,actor,now).run();
  const revision=await db.prepare(`SELECT id,revision_number FROM catalog_revision WHERE catalog_revision_uuid=?1`).bind(uuid).first<{id:number;revision_number:number}>();if(!revision)throw new Error("catalog_revision_create_failed");
  const result={catalog_revision_id:revision.id,revision_number:revision.revision_number,snapshot_sha256:snapshotHash};
  await audit(db,eventType,"catalog_revision",revision.id,actor,key,result,now).run();return result;
}
