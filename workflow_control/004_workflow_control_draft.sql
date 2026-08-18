-- HireBeat D1 new schema
-- Group G04: versioned system configuration, workflow control, retry
-- attempts, outbox, and audit
-- Confirmed Revision 2, 2026-08-17
-- Requires G03 raw_submission. The application FK resolves when the complete
-- initial schema is assembled with G07.

PRAGMA foreign_keys = ON;

CREATE TABLE system_configuration_release (
  id INTEGER PRIMARY KEY,
  configuration_release_key TEXT NOT NULL UNIQUE,
  release_version INTEGER NOT NULL,
  release_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      release_status IN (
        'draft',
        'active',
        'superseded',
        'retired'
      )
    ),
  release_description TEXT,
  activated_at TEXT,
  superseded_at TEXT,
  created_by TEXT,
  activated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (release_version)
);

CREATE TABLE system_configuration (
  id INTEGER PRIMARY KEY,
  configuration_release_id INTEGER NOT NULL,
  configuration_scope TEXT NOT NULL,
  configuration_key TEXT NOT NULL,
  configuration_value_json TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (configuration_release_id)
    REFERENCES system_configuration_release(id) ON DELETE RESTRICT,
  UNIQUE (
    configuration_release_id,
    configuration_scope,
    configuration_key
  ),
  CHECK (json_valid(configuration_value_json))
);

CREATE TABLE etl_workflow_run (
  id INTEGER PRIMARY KEY,
  workflow_run_uuid TEXT NOT NULL UNIQUE,
  workflow_type TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  cloudflare_instance_id TEXT UNIQUE,
  parent_workflow_run_id INTEGER,
  raw_submission_id INTEGER,
  application_id INTEGER,
  trigger_outbox_event_id INTEGER NOT NULL UNIQUE,
  subject_fence_token TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'requested'
    CHECK (
      workflow_status IN (
        'requested',
        'running',
        'waiting',
        'succeeded',
        'compensating',
        'compensated',
        'failed_terminal',
        'cancelled'
      )
    ),
  current_step_key TEXT,
  run_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (run_attempt_count >= 0),
  last_error_code TEXT,
  last_error_detail TEXT,
  cancellation_reason_code TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  last_progressed_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  configuration_release_id INTEGER,
  FOREIGN KEY (parent_workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  FOREIGN KEY (raw_submission_id)
    REFERENCES raw_submission(id) ON DELETE RESTRICT,
  FOREIGN KEY (application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (trigger_outbox_event_id)
    REFERENCES outbox_event(id) ON DELETE RESTRICT,
  FOREIGN KEY (configuration_release_id)
    REFERENCES system_configuration_release(id) ON DELETE RESTRICT,
  CHECK (length(trim(workflow_run_uuid)) > 0),
  CHECK (length(trim(workflow_type)) > 0),
  CHECK (length(trim(workflow_version)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (
    subject_fence_token IS NULL
    OR length(trim(subject_fence_token)) > 0
  ),
  CHECK (
    (raw_submission_id IS NOT NULL AND application_id IS NULL)
    OR
    (raw_submission_id IS NULL AND application_id IS NOT NULL)
  )
);

CREATE TABLE etl_step_run (
  id INTEGER PRIMARY KEY,
  workflow_run_id INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  is_required INTEGER NOT NULL DEFAULT 1
    CHECK (is_required IN (0, 1)),
  step_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      step_status IN (
        'pending',
        'running',
        'waiting',
        'succeeded',
        'skipped',
        'failed_retryable',
        'failed_terminal',
        'compensating',
        'compensated',
        'compensation_failed',
        'cancelled'
      )
    ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  next_retry_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE CASCADE,
  UNIQUE (workflow_run_id, step_key),
  CHECK (length(trim(step_key)) > 0),
  CHECK (length(trim(step_name)) > 0),
  CHECK (length(trim(step_version)) > 0),
  CHECK (length(trim(idempotency_key)) > 0)
);

CREATE TABLE etl_step_attempt (
  id INTEGER PRIMARY KEY,
  step_run_id INTEGER NOT NULL,
  attempt_uuid TEXT NOT NULL UNIQUE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  attempt_kind TEXT NOT NULL DEFAULT 'execute'
    CHECK (attempt_kind IN ('execute', 'compensate')),
  worker_execution_id TEXT,
  attempt_status TEXT NOT NULL DEFAULT 'running'
    CHECK (
      attempt_status IN (
        'running',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'timed_out',
        'cancelled'
      )
    ),
  error_class TEXT
    CHECK (
      error_class IS NULL
      OR error_class IN ('transient', 'terminal', 'timeout', 'cancelled')
    ),
  error_code TEXT,
  error_detail TEXT,
  retry_scheduled_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (step_run_id)
    REFERENCES etl_step_run(id) ON DELETE CASCADE,
  UNIQUE (step_run_id, attempt_number),
  CHECK (length(trim(attempt_uuid)) > 0),
  CHECK (
    (attempt_status = 'running' AND finished_at IS NULL)
    OR
    (attempt_status <> 'running' AND finished_at IS NOT NULL)
  )
);

CREATE TABLE outbox_event (
  id INTEGER PRIMARY KEY,
  event_uuid TEXT NOT NULL UNIQUE,
  deduplication_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_schema_version TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id INTEGER NOT NULL,
  destination_type TEXT NOT NULL,
  destination_key TEXT,
  producer_workflow_run_id INTEGER,
  producer_step_run_id INTEGER,
  event_payload_json TEXT NOT NULL DEFAULT '{}',
  dispatch_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      dispatch_status IN (
        'pending',
        'dispatching',
        'published',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count >= 0),
  max_delivery_attempts INTEGER NOT NULL CHECK (max_delivery_attempts > 0),
  available_at TEXT NOT NULL,
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (producer_workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE SET NULL,
  FOREIGN KEY (producer_step_run_id)
    REFERENCES etl_step_run(id) ON DELETE SET NULL,
  CHECK (length(trim(event_uuid)) > 0),
  CHECK (length(trim(deduplication_key)) > 0),
  CHECK (length(trim(event_type)) > 0),
  CHECK (length(trim(event_schema_version)) > 0),
  CHECK (length(trim(aggregate_type)) > 0),
  CHECK (length(trim(destination_type)) > 0),
  CHECK (json_valid(event_payload_json)),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE TABLE audit_event (
  id INTEGER PRIMARY KEY,
  event_uuid TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  workflow_run_id INTEGER,
  correlation_key TEXT,
  reason_code TEXT,
  event_summary TEXT NOT NULL,
  event_metadata_json TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE SET NULL,
  CHECK (length(trim(event_uuid)) > 0),
  CHECK (length(trim(event_type)) > 0),
  CHECK (length(trim(entity_type)) > 0),
  CHECK (length(trim(actor_type)) > 0),
  CHECK (length(trim(event_summary)) > 0),
  CHECK (event_metadata_json IS NULL OR json_valid(event_metadata_json))
);

CREATE UNIQUE INDEX uq_system_configuration_release_single_active
  ON system_configuration_release (release_status)
  WHERE release_status = 'active';

CREATE INDEX idx_etl_workflow_status_progress
  ON etl_workflow_run (workflow_status, last_progressed_at);

CREATE INDEX idx_etl_workflow_raw_submission
  ON etl_workflow_run (raw_submission_id, workflow_type, created_at);

CREATE INDEX idx_etl_workflow_application
  ON etl_workflow_run (application_id, workflow_type, created_at);

CREATE INDEX idx_etl_workflow_parent
  ON etl_workflow_run (parent_workflow_run_id);

CREATE INDEX idx_etl_step_workflow_status
  ON etl_step_run (workflow_run_id, step_status);

CREATE INDEX idx_etl_step_retry
  ON etl_step_run (step_status, next_retry_at);

CREATE INDEX idx_etl_attempt_step_started
  ON etl_step_attempt (step_run_id, started_at);

CREATE INDEX idx_outbox_dispatch_ready
  ON outbox_event (dispatch_status, available_at, next_attempt_at);

CREATE INDEX idx_outbox_expired_lease
  ON outbox_event (dispatch_status, lease_expires_at);

CREATE INDEX idx_outbox_aggregate
  ON outbox_event (aggregate_type, aggregate_id, created_at);

CREATE INDEX idx_outbox_producer_workflow
  ON outbox_event (producer_workflow_run_id, created_at);

CREATE INDEX idx_audit_entity_time
  ON audit_event (entity_type, entity_id, occurred_at);

CREATE INDEX idx_audit_workflow_time
  ON audit_event (workflow_run_id, occurred_at);

CREATE INDEX idx_audit_correlation
  ON audit_event (correlation_key, occurred_at);

-- Authenticated operational commands use correlation_key as their caller-
-- supplied idempotency key. This partial index does not constrain ordinary
-- audit rows and prevents a command replay from applying the mutation twice.
CREATE UNIQUE INDEX uq_audit_event_command_idempotency
  ON audit_event (event_type, correlation_key)
  WHERE event_type LIKE 'command.%' AND correlation_key IS NOT NULL;
