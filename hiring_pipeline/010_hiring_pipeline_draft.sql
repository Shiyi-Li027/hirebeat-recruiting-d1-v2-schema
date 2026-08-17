-- HireBeat D1 new schema
-- Group G10: hiring pipeline templates and per-Application stage execution
-- Confirmed Revision 1, 2026-08-17
-- Requires G04, G07, and G09. G11 Offer is created later.

PRAGMA foreign_keys = ON;

-- Each row is one immutable published version of a hiring-process template.
CREATE TABLE hiring_pipeline (
  id INTEGER PRIMARY KEY,
  hiring_pipeline_uuid TEXT NOT NULL UNIQUE,
  pipeline_family_code TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL CHECK (pipeline_version >= 1),
  hiring_pipeline_name TEXT NOT NULL,
  pipeline_description TEXT,
  pipeline_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (pipeline_status IN ('draft', 'active', 'retired')),
  activated_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (pipeline_family_code, pipeline_version),
  CHECK (length(trim(hiring_pipeline_uuid)) > 0),
  CHECK (length(trim(pipeline_family_code)) > 0),
  CHECK (length(trim(hiring_pipeline_name)) > 0),
  CHECK (
    (pipeline_status = 'active'
      AND activated_at IS NOT NULL
      AND retired_at IS NULL)
    OR (pipeline_status = 'retired'
      AND activated_at IS NOT NULL
      AND retired_at IS NOT NULL)
    OR (pipeline_status = 'draft'
      AND activated_at IS NULL
      AND retired_at IS NULL)
  )
);

-- A stage is a reusable node inside one pipeline template. The display order
-- is not a Candidate's actual execution order.
CREATE TABLE pipeline_stage (
  id INTEGER PRIMARY KEY,
  pipeline_stage_uuid TEXT NOT NULL UNIQUE,
  hiring_pipeline_id INTEGER NOT NULL,
  stage_code TEXT NOT NULL,
  pipeline_stage_name TEXT NOT NULL,
  stage_type TEXT NOT NULL
    CHECK (
      stage_type IN (
        'application_received',
        'resume_screening',
        'ml_recommendation',
        'written_assessment',
        'interview',
        'offer_approval',
        'offer_process',
        'hired',
        'rejected',
        'withdrawn'
      )
    ),
  default_display_order INTEGER NOT NULL
    CHECK (default_display_order >= 1),
  is_initial INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0, 1)),
  is_terminal INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0, 1)),
  is_optional INTEGER NOT NULL DEFAULT 1 CHECK (is_optional IN (0, 1)),
  is_repeatable INTEGER NOT NULL DEFAULT 0 CHECK (is_repeatable IN (0, 1)),
  max_business_attempts INTEGER
    CHECK (max_business_attempts IS NULL OR max_business_attempts >= 1),
  stage_config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (hiring_pipeline_id)
    REFERENCES hiring_pipeline(id) ON DELETE RESTRICT,
  UNIQUE (id, hiring_pipeline_id),
  UNIQUE (hiring_pipeline_id, stage_code),
  UNIQUE (hiring_pipeline_id, pipeline_stage_name),
  UNIQUE (hiring_pipeline_id, default_display_order),
  CHECK (length(trim(stage_code)) > 0),
  CHECK (length(trim(pipeline_stage_name)) > 0),
  CHECK (json_valid(stage_config_json)),
  CHECK (
    (is_repeatable = 0
      AND (max_business_attempts IS NULL OR max_business_attempts = 1))
    OR (is_repeatable = 1
      AND (max_business_attempts IS NULL OR max_business_attempts >= 2))
  ),
  CHECK (
    (stage_type IN ('hired', 'rejected', 'withdrawn') AND is_terminal = 1)
    OR (stage_type NOT IN ('hired', 'rejected', 'withdrawn') AND is_terminal = 0)
  ),
  CHECK (
    (stage_type = 'application_received' AND is_initial = 1)
    OR (stage_type <> 'application_received' AND is_initial = 0)
  )
);

-- An allowed directed edge in a pipeline template. Active pipeline versions
-- are frozen; changing stages or edges creates a new pipeline version.
CREATE TABLE pipeline_stage_transition (
  id INTEGER PRIMARY KEY,
  pipeline_stage_transition_uuid TEXT NOT NULL UNIQUE,
  hiring_pipeline_id INTEGER NOT NULL,
  from_stage_id INTEGER NOT NULL,
  to_stage_id INTEGER NOT NULL,
  transition_category TEXT NOT NULL
    CHECK (
      transition_category IN (
        'forward',
        'skip_forward',
        'return',
        'direct_terminal'
      )
    ),
  transition_condition_json TEXT NOT NULL,
  is_allowed INTEGER NOT NULL DEFAULT 1 CHECK (is_allowed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (from_stage_id, hiring_pipeline_id)
    REFERENCES pipeline_stage(id, hiring_pipeline_id) ON DELETE RESTRICT,
  FOREIGN KEY (to_stage_id, hiring_pipeline_id)
    REFERENCES pipeline_stage(id, hiring_pipeline_id) ON DELETE RESTRICT,
  UNIQUE (id, hiring_pipeline_id, from_stage_id, to_stage_id),
  UNIQUE (hiring_pipeline_id, from_stage_id, to_stage_id),
  CHECK (from_stage_id <> to_stage_id),
  CHECK (json_valid(transition_condition_json))
);

-- One row is one actual business-stage attempt for one Application. Technical
-- retries remain in G04 etl_step_attempt and do not increment attempt_no.
CREATE TABLE application_stage_run (
  id INTEGER PRIMARY KEY,
  application_stage_run_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL,
  hiring_pipeline_id INTEGER NOT NULL,
  pipeline_stage_id INTEGER NOT NULL,
  workflow_run_id INTEGER NOT NULL,
  ml_recommendation_result_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  application_fence_token TEXT NOT NULL,
  actual_sequence_no INTEGER NOT NULL CHECK (actual_sequence_no >= 1),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  run_status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (
      run_status IN (
        'scheduled',
        'in_progress',
        'waiting',
        'completed',
        'skipped',
        'cancelled'
      )
    ),
  stage_outcome_code TEXT,
  score REAL,
  maximum_score REAL CHECK (maximum_score IS NULL OR maximum_score > 0),
  passed_threshold INTEGER
    CHECK (passed_threshold IS NULL OR passed_threshold IN (0, 1)),
  executor_type TEXT
    CHECK (
      executor_type IS NULL
      OR executor_type IN (
        'system_rule',
        'ml',
        'recruiter',
        'candidate',
        'external_system'
      )
    ),
  executor_reference TEXT,
  result_summary TEXT,
  result_metadata_json TEXT NOT NULL,
  cancellation_reason_code TEXT,
  scheduled_at TEXT,
  started_at TEXT,
  waiting_since TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id, hiring_pipeline_id)
    REFERENCES application(id, hiring_pipeline_id) ON DELETE RESTRICT,
  FOREIGN KEY (pipeline_stage_id, hiring_pipeline_id)
    REFERENCES pipeline_stage(id, hiring_pipeline_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  FOREIGN KEY (ml_recommendation_result_id)
    REFERENCES ml_recommendation_result(id) ON DELETE RESTRICT,
  UNIQUE (id, application_id),
  UNIQUE (id, application_id, hiring_pipeline_id, pipeline_stage_id),
  UNIQUE (ml_recommendation_result_id),
  UNIQUE (application_id, actual_sequence_no),
  UNIQUE (application_id, pipeline_stage_id, attempt_no),
  CHECK (length(trim(application_stage_run_uuid)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (length(trim(application_fence_token)) > 0),
  CHECK (json_valid(result_metadata_json)),
  CHECK (
    (score IS NULL AND maximum_score IS NULL)
    OR (score IS NOT NULL
      AND maximum_score IS NOT NULL
      AND score BETWEEN 0 AND maximum_score)
  ),
  CHECK (
    (run_status IN ('scheduled', 'in_progress', 'waiting')
      AND completed_at IS NULL)
    OR (run_status IN ('completed', 'skipped', 'cancelled')
      AND completed_at IS NOT NULL)
  ),
  CHECK (
    (run_status = 'completed' AND stage_outcome_code IS NOT NULL)
    OR (run_status = 'skipped' AND stage_outcome_code = 'skipped')
    OR (run_status = 'cancelled'
      AND stage_outcome_code = 'cancelled'
      AND cancellation_reason_code IS NOT NULL)
    OR (run_status IN ('scheduled', 'in_progress', 'waiting')
      AND stage_outcome_code IS NULL)
  ),
  CHECK (
    (run_status IN ('in_progress', 'waiting', 'completed')
      AND started_at IS NOT NULL)
    OR run_status IN ('scheduled', 'skipped', 'cancelled')
  ),
  CHECK (
    ml_recommendation_result_id IS NULL
    OR executor_type = 'ml'
  )
);

-- Immutable actual movement between stage-run attempts. It records the real
-- path even when the Application skips, returns, repeats, or ends early.
CREATE TABLE application_stage_transition_event (
  id INTEGER PRIMARY KEY,
  transition_event_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL,
  hiring_pipeline_id INTEGER NOT NULL,
  configured_transition_id INTEGER,
  from_stage_run_id INTEGER,
  from_stage_id INTEGER,
  to_stage_run_id INTEGER NOT NULL UNIQUE,
  to_stage_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL
    CHECK (
      movement_type IN (
        'initial_entry',
        'forward',
        'skip_forward',
        'return',
        'repeat',
        'direct_terminal'
      )
    ),
  reason_code TEXT NOT NULL,
  initiated_by_type TEXT NOT NULL
    CHECK (
      initiated_by_type IN (
        'system_rule',
        'ml',
        'recruiter',
        'candidate',
        'external_system'
      )
    ),
  initiated_by_reference TEXT,
  workflow_run_id INTEGER NOT NULL,
  application_fence_token TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id, hiring_pipeline_id)
    REFERENCES application(id, hiring_pipeline_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    configured_transition_id,
    hiring_pipeline_id,
    from_stage_id,
    to_stage_id
  ) REFERENCES pipeline_stage_transition(
    id,
    hiring_pipeline_id,
    from_stage_id,
    to_stage_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    from_stage_run_id,
    application_id,
    hiring_pipeline_id,
    from_stage_id
  ) REFERENCES application_stage_run(
    id,
    application_id,
    hiring_pipeline_id,
    pipeline_stage_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    to_stage_run_id,
    application_id,
    hiring_pipeline_id,
    to_stage_id
  ) REFERENCES application_stage_run(
    id,
    application_id,
    hiring_pipeline_id,
    pipeline_stage_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  CHECK (length(trim(transition_event_uuid)) > 0),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (length(trim(application_fence_token)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (json_valid(event_metadata_json)),
  CHECK (
    (movement_type = 'initial_entry'
      AND configured_transition_id IS NULL
      AND from_stage_run_id IS NULL
      AND from_stage_id IS NULL)
    OR (movement_type = 'repeat'
      AND configured_transition_id IS NULL
      AND from_stage_run_id IS NOT NULL
      AND from_stage_id = to_stage_id)
    OR (movement_type NOT IN ('initial_entry', 'repeat')
      AND configured_transition_id IS NOT NULL
      AND from_stage_run_id IS NOT NULL
      AND from_stage_id IS NOT NULL
      AND from_stage_id <> to_stage_id)
  )
);

CREATE UNIQUE INDEX idx_hiring_pipeline_one_active_family
  ON hiring_pipeline (pipeline_family_code)
  WHERE pipeline_status = 'active';

CREATE UNIQUE INDEX idx_pipeline_stage_one_initial
  ON pipeline_stage (hiring_pipeline_id)
  WHERE is_initial = 1;

CREATE INDEX idx_pipeline_stage_type
  ON pipeline_stage (hiring_pipeline_id, stage_type, default_display_order);

CREATE INDEX idx_pipeline_transition_from_allowed
  ON pipeline_stage_transition (
    hiring_pipeline_id,
    from_stage_id,
    is_allowed
  );

CREATE INDEX idx_application_stage_run_status
  ON application_stage_run (application_id, run_status, actual_sequence_no);

CREATE INDEX idx_application_stage_run_stage_outcome
  ON application_stage_run (pipeline_stage_id, stage_outcome_code, completed_at);

CREATE INDEX idx_application_stage_run_workflow
  ON application_stage_run (workflow_run_id);

CREATE INDEX idx_stage_transition_event_application_time
  ON application_stage_transition_event (application_id, occurred_at);

CREATE INDEX idx_stage_transition_event_workflow
  ON application_stage_transition_event (workflow_run_id);
