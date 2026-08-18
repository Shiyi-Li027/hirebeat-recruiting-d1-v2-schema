/**
 * Remove only unpublished, workflow-owned derivations. Raw source evidence,
 * the workflow/step ledger and any already-published Application are retained.
 */
export async function compensateWorkflowAStaging(
  db:D1Database,workflowRunId:number,
):Promise<{skippedBecausePublished:boolean}> {
  const published=await db.prepare(
    `SELECT 1 published FROM application_source_lineage lineage
     JOIN submission_dedup_run dedup ON dedup.id=lineage.source_dedup_run_id
     WHERE dedup.workflow_run_id=?1 LIMIT 1`,
  ).bind(workflowRunId).first();
  if(published)return{skippedBecausePublished:true};

  const now=new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM submission_dedup_run WHERE workflow_run_id=?1`).bind(workflowRunId),
    db.prepare(`DELETE FROM resume_extraction WHERE workflow_run_id=?1`).bind(workflowRunId),
    db.prepare(`DELETE FROM normalization_run WHERE workflow_run_id=?1`).bind(workflowRunId),
    db.prepare(`INSERT INTO audit_event (
      event_uuid,event_type,entity_type,entity_id,actor_type,workflow_run_id,
      reason_code,event_summary,event_metadata_json,occurred_at,recorded_at
    ) VALUES (?1,'workflow_a.staging_compensated','etl_workflow_run',?2,'system',?2,
      'workflow_a_failed','Unpublished Workflow A staging derivations removed','{}',?3,?3)`)
      .bind(crypto.randomUUID(),workflowRunId,now),
  ]);
  return{skippedBecausePublished:false};
}
