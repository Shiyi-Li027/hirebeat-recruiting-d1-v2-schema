import { safeErrorCode } from "./crypto";
import { classifyWorkflowError } from "./workflow-errors";

export interface WorkflowRunIdentity {
  id: number;
  workflowRunUuid: string;
}

interface StepIdentity {
  stepRunId: number;
  attemptId: number;
  attemptNumber: number;
  startedAtMs: number;
}

export class WorkflowLedger {
  constructor(private readonly db: D1Database,private readonly defaultStepMaxAttempts=5) {}

  async ensureWorkflow(options: {
    type: "workflow_a" | "workflow_b";
    version: string;
    outboxEventId: number;
    rawSubmissionId?: number;
    applicationId?: number;
    fenceToken?: string;
    configurationReleaseId: number;
  }): Promise<WorkflowRunIdentity> {
    const now = new Date().toISOString();
    const key = `${options.type}:${options.rawSubmissionId ?? options.applicationId}:outbox:${options.outboxEventId}`;
    await this.db.prepare(
      `INSERT OR IGNORE INTO etl_workflow_run (
         workflow_run_uuid, workflow_type, workflow_version, idempotency_key,
         raw_submission_id, application_id, trigger_outbox_event_id,
         subject_fence_token, workflow_status, run_attempt_count,
         requested_at, created_at, updated_at, configuration_release_id
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'requested', 0,
                 ?9, ?9, ?9, ?10)`,
    ).bind(
      crypto.randomUUID(), options.type, options.version, key,
      options.rawSubmissionId ?? null, options.applicationId ?? null,
      options.outboxEventId, options.fenceToken ?? null, now,
      options.configurationReleaseId,
    ).run();
    const row = await this.db.prepare(
      `UPDATE etl_workflow_run
       SET workflow_status = CASE WHEN workflow_status = 'requested' THEN 'running' ELSE workflow_status END,
           run_attempt_count = run_attempt_count + 1,
           started_at = COALESCE(started_at, ?2), last_progressed_at = ?2,
           updated_at = ?2
       WHERE trigger_outbox_event_id = ?1
       RETURNING id, workflow_run_uuid`,
    ).bind(options.outboxEventId, now).first<{id:number;workflow_run_uuid:string}>();
    if (!row) throw new Error("workflow_run_registration_failed");
    return { id: row.id, workflowRunUuid: row.workflow_run_uuid };
  }

  async startStep(options: {
    workflowRunId: number;
    key: string;
    name: string;
    version: string;
    maxAttempts?: number;
  }): Promise<StepIdentity> {
    const now = new Date().toISOString();
    const idempotencyKey = `workflow-step:${options.workflowRunId}:${options.key}`;
    await this.db.prepare(
      `INSERT OR IGNORE INTO etl_step_run (
         workflow_run_id, step_key, step_name, step_version, idempotency_key,
         is_required, step_status, attempt_count, max_attempts, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, 1, 'pending', 0, ?6, ?7, ?7)`,
    ).bind(
      options.workflowRunId, options.key, options.name, options.version,
      idempotencyKey, options.maxAttempts ?? this.defaultStepMaxAttempts, now,
    ).run();
    await this.db.prepare(
      `UPDATE etl_step_attempt
       SET attempt_status = 'timed_out', error_class = 'timeout',
           error_code = 'superseded_running_attempt', finished_at = ?2,
           duration_ms = CAST((julianday(?2)-julianday(started_at))*86400000 AS INTEGER)
       WHERE step_run_id = (SELECT id FROM etl_step_run WHERE idempotency_key = ?1)
         AND attempt_status = 'running'`,
    ).bind(idempotencyKey, now).run();
    const stepRow = await this.db.prepare(
      `UPDATE etl_step_run
       SET step_status = 'running', attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, ?2), completed_at = NULL,
           last_error_code = NULL, last_error_detail = NULL, updated_at = ?2
       WHERE idempotency_key = ?1 AND attempt_count < max_attempts
       RETURNING id, attempt_count`,
    ).bind(idempotencyKey, now).first<{id:number;attempt_count:number}>();
    if (!stepRow) throw new Error(`step_attempt_limit_exhausted:${options.key}`);
    const attempt = await this.db.prepare(
      `INSERT INTO etl_step_attempt (
         step_run_id, attempt_uuid, attempt_number, attempt_kind,
         attempt_status, started_at, created_at
       ) VALUES (?1, ?2, ?3, 'execute', 'running', ?4, ?4)
       RETURNING id`,
    ).bind(stepRow.id, crypto.randomUUID(), stepRow.attempt_count, now)
      .first<{id:number}>();
    if (!attempt) throw new Error("step_attempt_registration_failed");
    await this.db.prepare(
      `UPDATE etl_workflow_run SET current_step_key=?2,last_progressed_at=?3,updated_at=?3
       WHERE id=?1`,
    ).bind(options.workflowRunId, options.key, now).run();
    return {
      stepRunId: stepRow.id,
      attemptId: attempt.id,
      attemptNumber: stepRow.attempt_count,
      startedAtMs: Date.now(),
    };
  }

  async finishStep(identity: StepIdentity): Promise<void> {
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(
        `UPDATE etl_step_attempt SET attempt_status='succeeded',finished_at=?2,duration_ms=?3
         WHERE id=?1 AND attempt_status='running'`,
      ).bind(identity.attemptId, now, Math.max(0, Date.now()-identity.startedAtMs)),
      this.db.prepare(
        `UPDATE etl_step_run SET step_status='succeeded',completed_at=?2,updated_at=?2
         WHERE id=?1`,
      ).bind(identity.stepRunId, now),
    ]);
  }

  async failStep(identity: StepIdentity, error: unknown): Promise<void> {
    const now = new Date().toISOString();
    const code = safeErrorCode(error);
    const terminal = classifyWorkflowError(error) === "terminal";
    await this.db.batch([
      this.db.prepare(
        `UPDATE etl_step_attempt SET attempt_status=?2,error_class=?3,
         error_code=?4,error_detail=?4,finished_at=?5,duration_ms=?6
         WHERE id=?1 AND attempt_status='running'`,
      ).bind(
        identity.attemptId,
        terminal ? "failed_terminal" : "failed_retryable",
        terminal ? "terminal" : "transient",
        code,
        now,
        Math.max(0, Date.now()-identity.startedAtMs),
      ),
      this.db.prepare(
        `UPDATE etl_step_run SET step_status=?2,last_error_code=?3,
         last_error_detail=?3,updated_at=?4 WHERE id=?1`,
      ).bind(
        identity.stepRunId,
        terminal ? "failed_terminal" : "failed_retryable",
        code,
        now,
      ),
    ]);
  }

  async completeWorkflow(workflowRunId: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(
      `UPDATE etl_workflow_run SET workflow_status='succeeded',current_step_key=NULL,
       completed_at=?2,last_progressed_at=?2,updated_at=?2 WHERE id=?1`,
    ).bind(workflowRunId, now).run();
  }

  async waitWorkflow(workflowRunId:number,reasonCode:string):Promise<void>{
    const now=new Date().toISOString();
    await this.db.prepare(
      `UPDATE etl_workflow_run SET workflow_status='waiting',current_step_key=?2,
       last_error_code=?2,last_error_detail=?2,completed_at=NULL,
       last_progressed_at=?3,updated_at=?3 WHERE id=?1`,
    ).bind(workflowRunId,reasonCode,now).run();
  }

  async cancelWorkflow(workflowRunId:number,reasonCode:string):Promise<void>{
    const now=new Date().toISOString();
    await this.db.prepare(
      `UPDATE etl_workflow_run SET workflow_status='cancelled',current_step_key=NULL,
       cancellation_reason_code=?2,completed_at=?3,last_progressed_at=?3,updated_at=?3
       WHERE id=?1 AND workflow_status IN ('requested','running','waiting')`,
    ).bind(workflowRunId,reasonCode,now).run();
  }

  async failWorkflow(workflowRunId: number, error: unknown): Promise<void> {
    const now = new Date().toISOString();
    const code = safeErrorCode(error);
    await this.db.prepare(
      `UPDATE etl_workflow_run SET workflow_status='failed_terminal',last_error_code=?2,
       last_error_detail=?2,completed_at=?3,last_progressed_at=?3,updated_at=?3 WHERE id=?1`,
    ).bind(workflowRunId, code, now).run();
  }
}

export async function tracked<T>(
  ledger: WorkflowLedger,
  workflowRunId: number,
  key: string,
  name: string,
  operation: (stepRunId: number) => Promise<T>,
): Promise<T> {
  const identity = await ledger.startStep({ workflowRunId, key, name, version: "v1" });
  try {
    const result = await operation(identity.stepRunId);
    await ledger.finishStep(identity);
    return result;
  } catch (error) {
    await ledger.failStep(identity, error);
    throw error;
  }
}
