-- HireBeat D1 new schema
-- Group G06: real-time deduplication and Application admission decision
-- Confirmed Revision 1, 2026-08-17
-- Requires G01/G02 catalog, G04 workflow, and G05 normalized/extraction data.

PRAGMA foreign_keys = ON;

CREATE TABLE submission_dedup_run (
  id INTEGER PRIMARY KEY,
  dedup_run_uuid TEXT NOT NULL UNIQUE,
  target_submission_normalized_id INTEGER NOT NULL,
  workflow_run_id INTEGER NOT NULL,
  step_run_id INTEGER NOT NULL UNIQUE,
  dedup_rule_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,

  dedup_company_id INTEGER NOT NULL,
  dedup_position_id INTEGER NOT NULL,
  dedup_requested_start_year_month TEXT,
  dedup_group_key TEXT,

  run_status TEXT NOT NULL DEFAULT 'running'
    CHECK (
      run_status IN (
        'running',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled',
        'superseded'
      )
    ),
  dedup_decision TEXT
    CHECK (
      dedup_decision IS NULL
      OR dedup_decision IN (
        'no_duplicate',
        'duplicate_detected',
        'not_evaluated_missing_group_key'
      )
    ),
  application_entry_decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      application_entry_decision IN (
        'pending',
        'admitted_new_application',
        'admitted_resubmission',
        'blocked_missing_dedup_group',
        'blocked_resubmission_limit',
        'blocked_offer_in_progress',
        'blocked_offer_finalized',
        'blocked_prior_application_state'
      )
    ),
  decision_reason_code TEXT,

  selected_prior_submission_normalized_id INTEGER,
  canonical_submission_normalized_id INTEGER,
  identity_component_key TEXT,
  submission_attempt_number INTEGER
    CHECK (submission_attempt_number IS NULL OR submission_attempt_number >= 1),
  max_submission_attempts_snapshot INTEGER
    CHECK (
      max_submission_attempts_snapshot IS NULL
      OR max_submission_attempts_snapshot >= 1
    ),

  scope_submission_count INTEGER NOT NULL DEFAULT 0
    CHECK (scope_submission_count >= 0),
  evaluated_pair_count INTEGER NOT NULL DEFAULT 0
    CHECK (evaluated_pair_count >= 0),
  matched_pair_count INTEGER NOT NULL DEFAULT 0
    CHECK (matched_pair_count >= 0),
  has_strong_identity_match INTEGER
    CHECK (has_strong_identity_match IS NULL OR has_strong_identity_match IN (0, 1)),
  has_resume_identity_match INTEGER
    CHECK (has_resume_identity_match IS NULL OR has_resume_identity_match IN (0, 1)),
  final_match_score REAL
    CHECK (final_match_score IS NULL OR final_match_score BETWEEN 0.0 AND 1.0),

  rule_config_json TEXT NOT NULL,
  last_error_code TEXT,
  last_error_detail TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (target_submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id)
    REFERENCES etl_step_run(id) ON DELETE CASCADE,
  FOREIGN KEY (dedup_company_id)
    REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (dedup_position_id)
    REFERENCES position(id) ON DELETE RESTRICT,
  FOREIGN KEY (selected_prior_submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,
  FOREIGN KEY (canonical_submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,

  UNIQUE (target_submission_normalized_id, dedup_rule_version),
  UNIQUE (id, target_submission_normalized_id),
  CHECK (length(trim(dedup_run_uuid)) > 0),
  CHECK (length(trim(dedup_rule_version)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (json_valid(rule_config_json)),
  CHECK (
    selected_prior_submission_normalized_id IS NULL
    OR selected_prior_submission_normalized_id <> target_submission_normalized_id
  ),
  CHECK (matched_pair_count <= evaluated_pair_count),
  CHECK (evaluated_pair_count <= scope_submission_count),
  CHECK (
    (
      dedup_requested_start_year_month IS NULL
      AND dedup_group_key IS NULL
    )
    OR
    (
      dedup_requested_start_year_month IS NOT NULL
      AND dedup_group_key IS NOT NULL
      AND dedup_requested_start_year_month
          GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
      AND CAST(substr(dedup_requested_start_year_month, 6, 2) AS INTEGER)
          BETWEEN 1 AND 12
      AND length(trim(dedup_group_key)) > 0
    )
  ),
  CHECK (
    (run_status = 'running' AND completed_at IS NULL)
    OR
    (run_status <> 'running' AND completed_at IS NOT NULL)
  ),
  CHECK (
    run_status <> 'succeeded'
    OR (
      dedup_decision IS NOT NULL
      AND application_entry_decision <> 'pending'
    )
  ),
  CHECK (
    application_entry_decision <> 'admitted_new_application'
    OR (
      dedup_decision = 'no_duplicate'
      AND submission_attempt_number = 1
    )
  ),
  CHECK (
    application_entry_decision <> 'admitted_resubmission'
    OR (
      dedup_decision = 'duplicate_detected'
      AND selected_prior_submission_normalized_id IS NOT NULL
      AND submission_attempt_number IS NOT NULL
      AND submission_attempt_number >= 2
      AND max_submission_attempts_snapshot IS NOT NULL
      AND submission_attempt_number <= max_submission_attempts_snapshot
    )
  )
);

CREATE TABLE submission_dedup_match (
  id INTEGER PRIMARY KEY,
  dedup_match_uuid TEXT NOT NULL UNIQUE,
  dedup_run_id INTEGER NOT NULL,
  target_submission_normalized_id INTEGER NOT NULL,
  matched_submission_normalized_id INTEGER NOT NULL,
  primary_match_rule TEXT NOT NULL
    CHECK (
      primary_match_rule IN (
        'email_exact_match',
        'phone_last_10_exact_match',
        'linkedin_exact_match',
        'github_exact_match_with_same_normalized_last_name'
      )
    ),
  is_selected_prior_submission INTEGER NOT NULL DEFAULT 0
    CHECK (is_selected_prior_submission IN (0, 1)),
  strong_evidence_count INTEGER NOT NULL DEFAULT 0
    CHECK (strong_evidence_count >= 0),
  resume_identity_evidence_count INTEGER NOT NULL DEFAULT 0
    CHECK (resume_identity_evidence_count >= 0),
  total_evidence_count INTEGER NOT NULL CHECK (total_evidence_count >= 1),
  has_strong_identity_match INTEGER NOT NULL
    CHECK (has_strong_identity_match IN (0, 1)),
  has_resume_identity_match INTEGER NOT NULL
    CHECK (has_resume_identity_match IN (0, 1)),
  final_match_score REAL NOT NULL CHECK (final_match_score BETWEEN 0.0 AND 1.0),
  matched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,

  FOREIGN KEY (dedup_run_id)
    REFERENCES submission_dedup_run(id) ON DELETE CASCADE,
  FOREIGN KEY (dedup_run_id, target_submission_normalized_id)
    REFERENCES submission_dedup_run(id, target_submission_normalized_id)
      ON DELETE CASCADE,
  FOREIGN KEY (target_submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,
  FOREIGN KEY (matched_submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,

  UNIQUE (dedup_run_id, matched_submission_normalized_id),
  CHECK (length(trim(dedup_match_uuid)) > 0),
  CHECK (target_submission_normalized_id <> matched_submission_normalized_id),
  CHECK (strong_evidence_count <= total_evidence_count),
  CHECK (resume_identity_evidence_count <= total_evidence_count),
  CHECK (
    (has_strong_identity_match = 0 AND strong_evidence_count = 0)
    OR
    (has_strong_identity_match = 1 AND strong_evidence_count >= 1)
  ),
  CHECK (
    (has_resume_identity_match = 0 AND resume_identity_evidence_count = 0)
    OR
    (has_resume_identity_match = 1 AND resume_identity_evidence_count >= 1)
  )
);

CREATE TABLE submission_match_evidence (
  id INTEGER PRIMARY KEY,
  evidence_uuid TEXT NOT NULL UNIQUE,
  dedup_match_id INTEGER NOT NULL,
  evidence_type TEXT NOT NULL
    CHECK (
      evidence_type IN (
        'email_exact_match',
        'phone_last_10_exact_match',
        'linkedin_exact_match',
        'github_exact_match_with_same_normalized_last_name'
      )
    ),
  evidence_strength TEXT NOT NULL
    CHECK (evidence_strength IN ('strong', 'medium')),
  target_identity_feature_id INTEGER NOT NULL,
  matched_identity_feature_id INTEGER NOT NULL,
  matched_value_hmac TEXT NOT NULL,
  hmac_key_version TEXT NOT NULL,
  is_primary_rule INTEGER NOT NULL DEFAULT 0
    CHECK (is_primary_rule IN (0, 1)),
  evidence_score REAL NOT NULL DEFAULT 1.0
    CHECK (evidence_score BETWEEN 0.0 AND 1.0),
  github_last_name_match INTEGER
    CHECK (github_last_name_match IS NULL OR github_last_name_match IN (0, 1)),
  matched_normalized_last_name_hmac TEXT,
  evidence_metadata_json TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (dedup_match_id)
    REFERENCES submission_dedup_match(id) ON DELETE CASCADE,
  FOREIGN KEY (target_identity_feature_id)
    REFERENCES submission_identity_feature(id) ON DELETE RESTRICT,
  FOREIGN KEY (matched_identity_feature_id)
    REFERENCES submission_identity_feature(id) ON DELETE RESTRICT,

  UNIQUE (
    dedup_match_id,
    evidence_type,
    matched_value_hmac
  ),
  CHECK (length(trim(evidence_uuid)) > 0),
  CHECK (length(matched_value_hmac) = 64),
  CHECK (length(trim(hmac_key_version)) > 0),
  CHECK (
    matched_normalized_last_name_hmac IS NULL
    OR length(matched_normalized_last_name_hmac) = 64
  ),
  CHECK (
    evidence_metadata_json IS NULL
    OR json_valid(evidence_metadata_json)
  ),
  CHECK (
    evidence_type <> 'github_exact_match_with_same_normalized_last_name'
    OR (
      evidence_strength = 'medium'
      AND github_last_name_match = 1
      AND matched_normalized_last_name_hmac IS NOT NULL
    )
  ),
  CHECK (
    evidence_type = 'github_exact_match_with_same_normalized_last_name'
    OR (
      github_last_name_match IS NULL
      AND matched_normalized_last_name_hmac IS NULL
    )
  )
);

CREATE INDEX idx_dedup_run_target_version
  ON submission_dedup_run (
    target_submission_normalized_id,
    dedup_rule_version
  );

CREATE INDEX idx_dedup_run_group_status
  ON submission_dedup_run (
    dedup_company_id,
    dedup_position_id,
    dedup_requested_start_year_month,
    run_status
  );

CREATE INDEX idx_dedup_run_entry_decision
  ON submission_dedup_run (application_entry_decision, completed_at);

CREATE INDEX idx_dedup_run_workflow_status
  ON submission_dedup_run (workflow_run_id, run_status);

CREATE INDEX idx_dedup_match_target
  ON submission_dedup_match (target_submission_normalized_id, matched_at);

CREATE INDEX idx_dedup_match_historical
  ON submission_dedup_match (matched_submission_normalized_id, matched_at);

CREATE UNIQUE INDEX idx_dedup_match_one_selected_prior
  ON submission_dedup_match (dedup_run_id)
  WHERE is_selected_prior_submission = 1;

CREATE INDEX idx_match_evidence_match_type
  ON submission_match_evidence (dedup_match_id, evidence_type);

CREATE INDEX idx_match_evidence_target_feature
  ON submission_match_evidence (target_identity_feature_id);

CREATE INDEX idx_match_evidence_matched_feature
  ON submission_match_evidence (matched_identity_feature_id);
