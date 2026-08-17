-- HireBeat D1 new schema
-- Group G09: single-model anomaly, similarity, threshold, and recommendation
-- Confirmed G09 schema, revision 1, 2026-08-17
-- Requires confirmed G02, G04, G07, and G08 schemas.

PRAGMA foreign_keys = ON;

-- Threshold recalibration is a business-policy change, not a model version.
CREATE TABLE ml_threshold_policy (
  id INTEGER PRIMARY KEY,
  threshold_policy_uuid TEXT NOT NULL UNIQUE,
  policy_family_code TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
  policy_name TEXT NOT NULL,
  policy_band_code TEXT,
  policy_scope_type TEXT NOT NULL
    CHECK (
      policy_scope_type IN (
        'reference_band',
        'global_default',
        'company',
        'position'
      )
    ),
  company_id INTEGER,
  position_id INTEGER,
  match_score_threshold REAL NOT NULL
    CHECK (match_score_threshold BETWEEN -1.0 AND 1.0),
  expected_retention_ratio REAL
    CHECK (
      expected_retention_ratio IS NULL
      OR expected_retention_ratio BETWEEN 0.0 AND 1.0
    ),
  policy_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (policy_status IN ('draft', 'active', 'retired')),
  supersedes_policy_id INTEGER,
  policy_config_json TEXT NOT NULL,
  effective_at TEXT,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_policy_id)
    REFERENCES ml_threshold_policy(id) ON DELETE RESTRICT,
  UNIQUE (policy_family_code, policy_version),
  CHECK (length(trim(threshold_policy_uuid)) > 0),
  CHECK (length(trim(policy_family_code)) > 0),
  CHECK (length(trim(policy_name)) > 0),
  CHECK (
    policy_band_code IS NULL
    OR length(trim(policy_band_code)) > 0
  ),
  CHECK (json_valid(policy_config_json)),
  CHECK (supersedes_policy_id IS NULL OR supersedes_policy_id <> id),
  CHECK (
    (policy_scope_type = 'reference_band'
      AND policy_band_code IS NOT NULL
      AND company_id IS NULL
      AND position_id IS NULL)
    OR (policy_scope_type = 'global_default'
      AND company_id IS NULL
      AND position_id IS NULL)
    OR (policy_scope_type = 'company'
      AND company_id IS NOT NULL
      AND position_id IS NULL)
    OR (policy_scope_type = 'position'
      AND company_id IS NULL
      AND position_id IS NOT NULL)
  ),
  CHECK (
    (policy_status = 'active'
      AND effective_at IS NOT NULL
      AND retired_at IS NULL)
    OR (policy_status = 'retired'
      AND effective_at IS NOT NULL
      AND retired_at IS NOT NULL)
    OR (policy_status = 'draft'
      AND effective_at IS NULL
      AND retired_at IS NULL)
  )
);

-- One technical ML execution for one Application/Candidate input. Current
-- model and code identity are frozen as snapshots; multi-model tables are
-- intentionally deferred from release 1.
CREATE TABLE ml_analysis_run (
  id INTEGER PRIMARY KEY,
  ml_analysis_run_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  workflow_run_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  application_fence_token TEXT NOT NULL,
  model_name TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2'
    CHECK (model_name = 'all-MiniLM-L6-v2'),
  model_provider TEXT NOT NULL DEFAULT 'sentence_transformers'
    CHECK (model_provider = 'sentence_transformers'),
  model_revision TEXT,
  model_config_json TEXT NOT NULL,
  pipeline_code TEXT NOT NULL,
  pipeline_source_code_sha256 TEXT NOT NULL,
  anomaly_rule_version TEXT NOT NULL,
  input_snapshot_sha256 TEXT NOT NULL,
  resume_text_sha256 TEXT NOT NULL,
  position_jd_sha256 TEXT NOT NULL,
  input_feature_snapshot_json TEXT NOT NULL,
  run_status TEXT NOT NULL DEFAULT 'running'
    CHECK (
      run_status IN (
        'running',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  last_error_code TEXT,
  last_error_detail TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_snapshot_id, application_id, person_id)
    REFERENCES candidate_snapshot(id, application_id, person_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  UNIQUE (id, application_id, candidate_snapshot_id),
  UNIQUE (application_id, input_snapshot_sha256),
  CHECK (length(trim(ml_analysis_run_uuid)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (length(trim(application_fence_token)) > 0),
  CHECK (length(trim(pipeline_code)) > 0),
  CHECK (length(trim(anomaly_rule_version)) > 0),
  CHECK (length(pipeline_source_code_sha256) = 64),
  CHECK (length(input_snapshot_sha256) = 64),
  CHECK (length(resume_text_sha256) = 64),
  CHECK (length(position_jd_sha256) = 64),
  CHECK (json_valid(model_config_json)),
  CHECK (json_valid(input_feature_snapshot_json)),
  CHECK (
    (run_status = 'running' AND completed_at IS NULL)
    OR (run_status <> 'running' AND completed_at IS NOT NULL)
  )
);

-- Kept because an anomaly can directly cause the final no_offer decision.
CREATE TABLE ml_anomaly_result (
  id INTEGER PRIMARY KEY,
  ml_analysis_run_id INTEGER NOT NULL UNIQUE,
  application_id INTEGER NOT NULL,
  candidate_snapshot_id INTEGER NOT NULL,
  has_any_anomaly INTEGER NOT NULL CHECK (has_any_anomaly IN (0, 1)),
  anomaly_flags_json TEXT NOT NULL,
  disposition TEXT NOT NULL
    CHECK (disposition IN ('clean', 'excluded_no_offer')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (ml_analysis_run_id, application_id, candidate_snapshot_id)
    REFERENCES ml_analysis_run(id, application_id, candidate_snapshot_id)
    ON DELETE RESTRICT,
  UNIQUE (id, ml_analysis_run_id),
  CHECK (json_valid(anomaly_flags_json)),
  CHECK (
    (has_any_anomaly = 0 AND disposition = 'clean')
    OR (has_any_anomaly = 1 AND disposition = 'excluded_no_offer')
  )
);

-- Only clean Applications receive a similarity row. Parent analysis already
-- freezes input hashes and model identity, so they are not duplicated here.
CREATE TABLE ml_similarity_result (
  id INTEGER PRIMARY KEY,
  ml_analysis_run_id INTEGER NOT NULL UNIQUE,
  application_id INTEGER NOT NULL,
  candidate_snapshot_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  match_score REAL NOT NULL CHECK (match_score BETWEEN -1.0 AND 1.0),
  similarity_metric TEXT NOT NULL DEFAULT 'cosine_similarity'
    CHECK (similarity_metric = 'cosine_similarity'),
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ml_analysis_run_id, application_id, candidate_snapshot_id)
    REFERENCES ml_analysis_run(id, application_id, candidate_snapshot_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE RESTRICT,
  UNIQUE (id, ml_analysis_run_id)
);

-- One immutable final ML recommendation per Application. It is inserted in
-- the same short D1 batch that finalizes Application and conditionally creates
-- the single Offer draft.
CREATE TABLE ml_recommendation_result (
  id INTEGER PRIMARY KEY,
  recommendation_result_uuid TEXT NOT NULL UNIQUE,
  ml_analysis_run_id INTEGER NOT NULL UNIQUE,
  application_id INTEGER NOT NULL UNIQUE,
  candidate_snapshot_id INTEGER NOT NULL,
  anomaly_result_id INTEGER NOT NULL,
  similarity_result_id INTEGER,
  threshold_policy_id INTEGER,
  recommendation_method TEXT NOT NULL
    CHECK (
      recommendation_method IN (
        'anomaly_exclusion',
        'fixed_similarity_threshold'
      )
    ),
  recommendation_decision TEXT NOT NULL
    CHECK (recommendation_decision IN ('offer', 'no_offer')),
  decision_reason_code TEXT NOT NULL,
  match_score_snapshot REAL
    CHECK (
      match_score_snapshot IS NULL
      OR match_score_snapshot BETWEEN -1.0 AND 1.0
    ),
  threshold_snapshot REAL
    CHECK (
      threshold_snapshot IS NULL
      OR threshold_snapshot BETWEEN -1.0 AND 1.0
    ),
  passed_threshold INTEGER
    CHECK (passed_threshold IS NULL OR passed_threshold IN (0, 1)),
  result_metadata_json TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ml_analysis_run_id, application_id, candidate_snapshot_id)
    REFERENCES ml_analysis_run(id, application_id, candidate_snapshot_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (anomaly_result_id, ml_analysis_run_id)
    REFERENCES ml_anomaly_result(id, ml_analysis_run_id) ON DELETE RESTRICT,
  FOREIGN KEY (similarity_result_id, ml_analysis_run_id)
    REFERENCES ml_similarity_result(id, ml_analysis_run_id) ON DELETE RESTRICT,
  FOREIGN KEY (threshold_policy_id)
    REFERENCES ml_threshold_policy(id) ON DELETE RESTRICT,
  UNIQUE (id, application_id),
  CHECK (length(trim(recommendation_result_uuid)) > 0),
  CHECK (length(trim(decision_reason_code)) > 0),
  CHECK (json_valid(result_metadata_json)),
  CHECK (
    (recommendation_method = 'anomaly_exclusion'
      AND recommendation_decision = 'no_offer'
      AND similarity_result_id IS NULL
      AND threshold_policy_id IS NULL
      AND match_score_snapshot IS NULL
      AND threshold_snapshot IS NULL
      AND passed_threshold IS NULL)
    OR (recommendation_method = 'fixed_similarity_threshold'
      AND similarity_result_id IS NOT NULL
      AND threshold_policy_id IS NOT NULL
      AND match_score_snapshot IS NOT NULL
      AND threshold_snapshot IS NOT NULL
      AND passed_threshold IS NOT NULL)
  ),
  CHECK (
    passed_threshold IS NULL
    OR (passed_threshold = 1 AND recommendation_decision = 'offer')
    OR (passed_threshold = 0 AND recommendation_decision = 'no_offer')
  )
);

CREATE UNIQUE INDEX idx_ml_policy_one_active_reference_band
  ON ml_threshold_policy (policy_band_code)
  WHERE policy_status = 'active'
    AND policy_scope_type = 'reference_band';

CREATE UNIQUE INDEX idx_ml_policy_one_active_global_default
  ON ml_threshold_policy (policy_scope_type)
  WHERE policy_status = 'active'
    AND policy_scope_type = 'global_default';

CREATE UNIQUE INDEX idx_ml_policy_one_active_company
  ON ml_threshold_policy (company_id)
  WHERE policy_status = 'active'
    AND policy_scope_type = 'company';

CREATE UNIQUE INDEX idx_ml_policy_one_active_position
  ON ml_threshold_policy (position_id)
  WHERE policy_status = 'active'
    AND policy_scope_type = 'position';

CREATE INDEX idx_ml_analysis_application_status
  ON ml_analysis_run (application_id, run_status, created_at);

CREATE INDEX idx_ml_analysis_workflow
  ON ml_analysis_run (workflow_run_id);

CREATE INDEX idx_ml_anomaly_disposition
  ON ml_anomaly_result (disposition, application_id);

CREATE INDEX idx_ml_similarity_position_score
  ON ml_similarity_result (position_id, match_score);

CREATE INDEX idx_ml_recommendation_decision_time
  ON ml_recommendation_result (recommendation_decision, decided_at);
