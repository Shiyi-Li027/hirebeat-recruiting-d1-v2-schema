-- HireBeat D1 new schema
-- Group G05: normalization and versioned Resume extraction results
-- Confirmed Revision 1, 2026-08-17
-- Requires G01/G02 reference/catalog, G03 raw submission, and G04 workflow.

PRAGMA foreign_keys = ON;

CREATE TABLE normalization_run (
  id INTEGER PRIMARY KEY,
  normalization_run_uuid TEXT NOT NULL UNIQUE,
  raw_submission_id INTEGER NOT NULL,
  workflow_run_id INTEGER NOT NULL,
  step_run_id INTEGER NOT NULL UNIQUE,
  normalization_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  normalization_status TEXT NOT NULL DEFAULT 'running'
    CHECK (
      normalization_status IN (
        'running',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  warnings_json TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (raw_submission_id)
    REFERENCES raw_submission(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id)
    REFERENCES etl_step_run(id) ON DELETE CASCADE,
  UNIQUE (raw_submission_id, normalization_version),
  CHECK (length(trim(normalization_run_uuid)) > 0),
  CHECK (length(trim(normalization_version)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (warnings_json IS NULL OR json_valid(warnings_json)),
  CHECK (
    (normalization_status = 'running' AND completed_at IS NULL)
    OR
    (normalization_status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE submission_normalized (
  id INTEGER PRIMARY KEY,
  submission_normalized_uuid TEXT NOT NULL UNIQUE,
  raw_submission_id INTEGER NOT NULL,
  normalization_run_id INTEGER NOT NULL UNIQUE,
  normalization_version TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  company_work_mode_id INTEGER,
  position_id INTEGER NOT NULL,
  normalized_person_name TEXT,
  normalized_first_name TEXT,
  normalized_middle_name TEXT,
  normalized_last_name TEXT,
  normalized_email_address TEXT,
  normalized_phone TEXT,
  requested_start_date TEXT,
  requested_end_date TEXT,
  requested_start_year_month TEXT,
  work_duration TEXT,
  normalized_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (raw_submission_id)
    REFERENCES raw_submission(id) ON DELETE RESTRICT,
  FOREIGN KEY (normalization_run_id)
    REFERENCES normalization_run(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id)
    REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_work_mode_id)
    REFERENCES company_work_mode(id) ON DELETE RESTRICT,
  FOREIGN KEY (position_id)
    REFERENCES position(id) ON DELETE RESTRICT,
  UNIQUE (raw_submission_id, normalization_version),
  CHECK (length(trim(submission_normalized_uuid)) > 0),
  CHECK (length(trim(normalization_version)) > 0),
  CHECK (
    normalized_email_address IS NULL
    OR (
      length(trim(normalized_email_address)) > 0
      AND length(normalized_email_address)
          - length(replace(normalized_email_address, '@', '')) = 1
    )
  ),
  CHECK (
    (
      requested_start_date IS NULL
      AND requested_start_year_month IS NULL
    )
    OR
    (
      requested_start_date IS NOT NULL
      AND requested_start_year_month IS NOT NULL
      AND requested_start_year_month = substr(requested_start_date, 1, 7)
      AND requested_start_year_month
          GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
      AND CAST(substr(requested_start_year_month, 6, 2) AS INTEGER)
          BETWEEN 1 AND 12
    )
  )
);

CREATE TABLE resume_extraction (
  id INTEGER PRIMARY KEY,
  resume_extraction_uuid TEXT NOT NULL UNIQUE,
  submission_normalized_id INTEGER NOT NULL,
  raw_submission_resume_id INTEGER NOT NULL,
  workflow_run_id INTEGER NOT NULL,
  step_run_id INTEGER NOT NULL UNIQUE,
  extraction_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_resume_text_sha256 TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'running'
    CHECK (
      extraction_status IN (
        'running',
        'succeeded',
        'succeeded_no_structured_entity',
        'failed_retryable',
        'failed_terminal',
        'cancelled',
        'superseded'
      )
    ),
  identity_record_count INTEGER NOT NULL DEFAULT 0 CHECK (identity_record_count >= 0),
  education_record_count INTEGER NOT NULL DEFAULT 0 CHECK (education_record_count >= 0),
  employment_record_count INTEGER NOT NULL DEFAULT 0 CHECK (employment_record_count >= 0),
  skill_record_count INTEGER NOT NULL DEFAULT 0 CHECK (skill_record_count >= 0),
  project_record_count INTEGER NOT NULL DEFAULT 0 CHECK (project_record_count >= 0),
  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  warnings_json TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE RESTRICT,
  FOREIGN KEY (raw_submission_resume_id)
    REFERENCES raw_submission_resume(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE CASCADE,
  FOREIGN KEY (step_run_id)
    REFERENCES etl_step_run(id) ON DELETE CASCADE,
  UNIQUE (
    submission_normalized_id,
    extraction_version,
    input_resume_text_sha256
  ),
  CHECK (length(trim(resume_extraction_uuid)) > 0),
  CHECK (length(trim(extraction_version)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (length(input_resume_text_sha256) = 64),
  CHECK (warnings_json IS NULL OR json_valid(warnings_json)),
  CHECK (
    (extraction_status = 'running' AND completed_at IS NULL)
    OR
    (extraction_status <> 'running' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE resume_education (
  id INTEGER PRIMARY KEY,
  resume_extraction_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  raw_education_text TEXT,
  raw_school_name TEXT,
  normalized_school_name TEXT,
  school_id INTEGER,
  raw_degree_name TEXT,
  normalized_degree_name TEXT,
  degree_id INTEGER,
  raw_field_study_name TEXT,
  normalized_field_study_name TEXT,
  field_study_id INTEGER,
  raw_major_name TEXT,
  normalized_major_name TEXT,
  major_id INTEGER,
  gpa TEXT,
  education_start_date TEXT,
  education_end_date TEXT,
  is_current INTEGER CHECK (is_current IS NULL OR is_current IN (0, 1)),
  extraction_eligibility_status TEXT NOT NULL
    CHECK (
      extraction_eligibility_status IN (
        'eligible',
        'rejected_missing_raw_text',
        'rejected_missing_school',
        'rejected_missing_degree',
        'rejected_unmapped_degree',
        'rejected_other_degree',
        'rejected_inconsistent_degree',
        'rejected_other_quality_reason'
      )
    ),
  rejection_reason_detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resume_extraction_id)
    REFERENCES resume_extraction(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES school(id) ON DELETE RESTRICT,
  FOREIGN KEY (degree_id) REFERENCES degree(id) ON DELETE RESTRICT,
  FOREIGN KEY (field_study_id) REFERENCES field_study(id) ON DELETE RESTRICT,
  FOREIGN KEY (major_id) REFERENCES major(id) ON DELETE RESTRICT,
  UNIQUE (resume_extraction_id, source_entry_order),
  CHECK (
    raw_education_text IS NULL
    OR length(trim(raw_education_text)) > 0
  ),
  CHECK (
    extraction_eligibility_status <> 'eligible'
    OR (
      raw_education_text IS NOT NULL
      AND raw_school_name IS NOT NULL
      AND length(trim(raw_school_name)) > 0
      AND raw_degree_name IS NOT NULL
      AND length(trim(raw_degree_name)) > 0
      AND degree_id IS NOT NULL
    )
  ),
  CHECK (
    extraction_eligibility_status <> 'rejected_missing_raw_text'
    OR raw_education_text IS NULL
  )
);

CREATE TABLE resume_employment (
  id INTEGER PRIMARY KEY,
  resume_extraction_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  raw_employment_text TEXT,
  raw_company_name TEXT,
  normalized_company_name TEXT,
  raw_position_name TEXT,
  normalized_position_name TEXT,
  employment_description TEXT,
  employment_start_date TEXT,
  employment_end_date TEXT,
  is_current INTEGER CHECK (is_current IS NULL OR is_current IN (0, 1)),
  extraction_eligibility_status TEXT NOT NULL
    CHECK (
      extraction_eligibility_status IN (
        'eligible',
        'rejected_missing_raw_text',
        'rejected_missing_company',
        'rejected_missing_position',
        'rejected_missing_date',
        'rejected_other_quality_reason'
      )
    ),
  rejection_reason_detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resume_extraction_id)
    REFERENCES resume_extraction(id) ON DELETE CASCADE,
  UNIQUE (resume_extraction_id, source_entry_order),
  CHECK (
    raw_employment_text IS NULL
    OR length(trim(raw_employment_text)) > 0
  ),
  CHECK (
    extraction_eligibility_status <> 'eligible'
    OR (
      raw_employment_text IS NOT NULL
      AND raw_company_name IS NOT NULL
      AND length(trim(raw_company_name)) > 0
      AND raw_position_name IS NOT NULL
      AND length(trim(raw_position_name)) > 0
      AND (
        employment_start_date IS NOT NULL
        OR employment_end_date IS NOT NULL
      )
    )
  ),
  CHECK (
    extraction_eligibility_status <> 'rejected_missing_raw_text'
    OR raw_employment_text IS NULL
  )
);

CREATE TABLE resume_skill (
  id INTEGER PRIMARY KEY,
  resume_extraction_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  raw_skill_text TEXT NOT NULL,
  normalized_skill_name TEXT,
  skill_id INTEGER,
  matched_context_text TEXT,
  match_method TEXT NOT NULL
    CHECK (match_method IN ('catalog_exact', 'catalog_rule_alias')),
  extraction_eligibility_status TEXT NOT NULL
    CHECK (
      extraction_eligibility_status IN (
        'eligible',
        'rejected_unmapped_skill',
        'rejected_other_quality_reason'
      )
    ),
  rejection_reason_detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resume_extraction_id)
    REFERENCES resume_extraction(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skill(id) ON DELETE RESTRICT,
  UNIQUE (resume_extraction_id, source_entry_order),
  CHECK (length(trim(raw_skill_text)) > 0),
  CHECK (
    extraction_eligibility_status <> 'eligible'
    OR skill_id IS NOT NULL
  )
);

CREATE TABLE resume_project (
  id INTEGER PRIMARY KEY,
  resume_extraction_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  raw_project_text TEXT,
  raw_project_name TEXT,
  normalized_project_name TEXT,
  project_description TEXT,
  project_start_date TEXT,
  project_end_date TEXT,
  project_url TEXT,
  extraction_eligibility_status TEXT NOT NULL
    CHECK (
      extraction_eligibility_status IN (
        'eligible',
        'rejected_missing_raw_text',
        'rejected_missing_project_name',
        'rejected_duplicate_raw_text',
        'rejected_other_quality_reason'
      )
    ),
  rejection_reason_detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resume_extraction_id)
    REFERENCES resume_extraction(id) ON DELETE CASCADE,
  UNIQUE (resume_extraction_id, source_entry_order),
  CHECK (
    raw_project_text IS NULL
    OR length(trim(raw_project_text)) > 0
  ),
  CHECK (
    extraction_eligibility_status <> 'eligible'
    OR (
      raw_project_text IS NOT NULL
      AND raw_project_name IS NOT NULL
      AND length(trim(raw_project_name)) > 0
    )
  ),
  CHECK (
    extraction_eligibility_status <> 'rejected_missing_raw_text'
    OR raw_project_text IS NULL
  )
);

CREATE TABLE submission_identity_feature (
  id INTEGER PRIMARY KEY,
  submission_normalized_id INTEGER NOT NULL,
  resume_extraction_id INTEGER,
  feature_type TEXT NOT NULL
    CHECK (
      feature_type IN (
        'email',
        'phone',
        'linkedin_url',
        'github_url'
      )
    ),
  feature_source TEXT NOT NULL
    CHECK (feature_source IN ('submitted_field', 'resume_text')),
  normalized_value TEXT NOT NULL,
  normalized_value_hmac TEXT NOT NULL,
  hmac_key_version TEXT NOT NULL,
  account_handle TEXT,
  is_primary_candidate INTEGER NOT NULL DEFAULT 0
    CHECK (is_primary_candidate IN (0, 1)),
  selection_status TEXT NOT NULL
    CHECK (
      selection_status IN (
        'selected',
        'additional_candidate',
        'ambiguous',
        'rejected_unreliable'
      )
    ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_normalized_id)
    REFERENCES submission_normalized(id) ON DELETE CASCADE,
  FOREIGN KEY (resume_extraction_id)
    REFERENCES resume_extraction(id) ON DELETE CASCADE,
  UNIQUE (
    submission_normalized_id,
    feature_type,
    normalized_value_hmac,
    feature_source
  ),
  CHECK (length(trim(normalized_value)) > 0),
  CHECK (length(normalized_value_hmac) = 64),
  CHECK (length(trim(hmac_key_version)) > 0),
  CHECK (
    feature_source = 'submitted_field'
    OR resume_extraction_id IS NOT NULL
  )
);

CREATE INDEX idx_normalization_raw_version
  ON normalization_run (raw_submission_id, normalization_version);

CREATE INDEX idx_normalization_workflow_status
  ON normalization_run (workflow_run_id, normalization_status);

CREATE INDEX idx_submission_normalized_catalog_cycle
  ON submission_normalized (
    company_id,
    position_id,
    requested_start_year_month
  );

CREATE INDEX idx_submission_normalized_email
  ON submission_normalized (normalized_email_address);

CREATE INDEX idx_submission_normalized_phone
  ON submission_normalized (normalized_phone);

CREATE INDEX idx_resume_extraction_submission_version
  ON resume_extraction (submission_normalized_id, extraction_version);

CREATE INDEX idx_resume_education_extraction_eligibility
  ON resume_education (resume_extraction_id, extraction_eligibility_status);

CREATE INDEX idx_resume_employment_extraction_eligibility
  ON resume_employment (resume_extraction_id, extraction_eligibility_status);

CREATE INDEX idx_resume_skill_extraction_eligibility
  ON resume_skill (resume_extraction_id, extraction_eligibility_status);

CREATE INDEX idx_resume_project_extraction_eligibility
  ON resume_project (resume_extraction_id, extraction_eligibility_status);

CREATE INDEX idx_identity_feature_dedup_lookup
  ON submission_identity_feature (
    feature_type,
    normalized_value_hmac,
    submission_normalized_id
  );
