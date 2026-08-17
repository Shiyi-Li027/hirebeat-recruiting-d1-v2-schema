-- HireBeat D1 new schema
-- Group G07: Person, Application, Candidate snapshot, identity history, lineage
-- Confirmed G07 schema, revision 1, 2026-08-17
-- References G08/G10 tables that are created later in the assembled schema.

PRAGMA foreign_keys = ON;

CREATE TABLE person (
  id INTEGER PRIMARY KEY,
  person_uuid TEXT NOT NULL UNIQUE,
  normalized_person_name TEXT NOT NULL,
  normalized_first_name TEXT,
  normalized_middle_name TEXT,
  normalized_last_name TEXT,
  normalized_email_address TEXT NOT NULL,
  normalized_phone TEXT,
  person_status TEXT NOT NULL DEFAULT 'active'
    CHECK (person_status IN ('active', 'inactive', 'merged')),
  merged_into_person_id INTEGER,
  current_application_id INTEGER,
  current_candidate_snapshot_id INTEGER,
  highest_person_education_id INTEGER,
  current_person_position_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merged_into_person_id)
    REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_application_id)
    REFERENCES application(id) ON DELETE SET NULL,
  FOREIGN KEY (current_candidate_snapshot_id)
    REFERENCES candidate_snapshot(id) ON DELETE SET NULL,
  FOREIGN KEY (highest_person_education_id)
    REFERENCES person_education(id) ON DELETE SET NULL,
  FOREIGN KEY (current_person_position_id)
    REFERENCES person_position(id) ON DELETE SET NULL,
  CHECK (length(trim(person_uuid)) > 0),
  CHECK (length(trim(normalized_person_name)) > 0),
  CHECK (
    length(trim(normalized_email_address)) > 0
    AND length(normalized_email_address)
        - length(replace(normalized_email_address, '@', '')) = 1
  ),
  CHECK (
    (person_status = 'merged' AND merged_into_person_id IS NOT NULL)
    OR
    (person_status <> 'merged' AND merged_into_person_id IS NULL)
  ),
  CHECK (merged_into_person_id IS NULL OR merged_into_person_id <> id)
);

CREATE TABLE application (
  id INTEGER PRIMARY KEY,
  application_uuid TEXT NOT NULL UNIQUE,
  person_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  company_work_mode_id INTEGER,
  position_id INTEGER NOT NULL,
  current_candidate_snapshot_id INTEGER,
  previous_application_id INTEGER,
  superseded_by_application_id INTEGER,
  hiring_pipeline_id INTEGER,
  current_stage_id INTEGER,

  company_name_snapshot TEXT NOT NULL,
  company_work_mode_name_snapshot TEXT,
  position_name_snapshot TEXT NOT NULL,
  requested_start_date TEXT,
  requested_end_date TEXT,
  requested_start_year_month TEXT NOT NULL,
  work_duration TEXT,
  application_group_key TEXT NOT NULL,

  submission_attempt_number INTEGER NOT NULL
    CHECK (submission_attempt_number >= 1),
  max_submission_attempts_snapshot INTEGER NOT NULL
    CHECK (max_submission_attempts_snapshot >= 1),

  application_lifecycle_status TEXT NOT NULL DEFAULT 'processing'
    CHECK (
      application_lifecycle_status IN (
        'processing',
        'completed',
        'superseded',
        'cancelled'
      )
    ),
  application_decision_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      application_decision_status IN (
        'pending',
        'rejected',
        'offer_created'
      )
    ),
  decision_reason_code TEXT,
  decision_fence_token TEXT NOT NULL,

  applied_at TEXT NOT NULL,
  current_stage_entered_at TEXT,
  decided_at TEXT,
  completed_at TEXT,
  superseded_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_work_mode_id)
    REFERENCES company_work_mode(id) ON DELETE RESTRICT,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_candidate_snapshot_id)
    REFERENCES candidate_snapshot(id) ON DELETE SET NULL,
  FOREIGN KEY (previous_application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (superseded_by_application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (hiring_pipeline_id)
    REFERENCES hiring_pipeline(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_stage_id, hiring_pipeline_id)
    REFERENCES pipeline_stage(id, hiring_pipeline_id) ON DELETE RESTRICT,

  UNIQUE (id, person_id),
  UNIQUE (id, hiring_pipeline_id),
  UNIQUE (
    person_id,
    company_id,
    position_id,
    requested_start_year_month,
    submission_attempt_number
  ),
  CHECK (length(trim(application_uuid)) > 0),
  CHECK (length(trim(company_name_snapshot)) > 0),
  CHECK (length(trim(position_name_snapshot)) > 0),
  CHECK (length(trim(application_group_key)) > 0),
  CHECK (length(trim(decision_fence_token)) > 0),
  CHECK (submission_attempt_number <= max_submission_attempts_snapshot),
  CHECK (
    (hiring_pipeline_id IS NULL AND current_stage_id IS NULL)
    OR (hiring_pipeline_id IS NOT NULL AND current_stage_id IS NOT NULL)
  ),
  CHECK (
    requested_start_year_month
        GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
    AND CAST(substr(requested_start_year_month, 6, 2) AS INTEGER)
        BETWEEN 1 AND 12
  ),
  CHECK (
    requested_start_date IS NULL
    OR requested_start_year_month = substr(requested_start_date, 1, 7)
  ),
  CHECK (
    (submission_attempt_number = 1 AND previous_application_id IS NULL)
    OR
    (submission_attempt_number >= 2 AND previous_application_id IS NOT NULL)
  ),
  CHECK (
    previous_application_id IS NULL
    OR previous_application_id <> id
  ),
  CHECK (
    superseded_by_application_id IS NULL
    OR superseded_by_application_id <> id
  ),
  CHECK (
    (application_lifecycle_status = 'superseded'
      AND superseded_by_application_id IS NOT NULL
      AND superseded_at IS NOT NULL)
    OR
    (application_lifecycle_status <> 'superseded'
      AND superseded_by_application_id IS NULL
      AND superseded_at IS NULL)
  ),
  CHECK (
    (application_lifecycle_status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR
    (application_lifecycle_status <> 'cancelled' AND cancelled_at IS NULL)
  ),
  CHECK (
    (application_lifecycle_status = 'completed' AND completed_at IS NOT NULL)
    OR
    application_lifecycle_status <> 'completed'
  ),
  CHECK (
    (application_decision_status = 'pending' AND decided_at IS NULL)
    OR
    (application_decision_status <> 'pending' AND decided_at IS NOT NULL)
  ),
  CHECK (
    application_lifecycle_status <> 'processing'
    OR application_decision_status = 'pending'
  ),
  CHECK (
    application_lifecycle_status <> 'completed'
    OR application_decision_status IN ('rejected', 'offer_created')
  ),
  CHECK (
    application_lifecycle_status <> 'superseded'
    OR application_decision_status IN ('pending', 'rejected')
  ),
  CHECK (
    application_lifecycle_status <> 'cancelled'
    OR application_decision_status = 'pending'
  ),
  CHECK (
    application_decision_status <> 'offer_created'
    OR application_lifecycle_status = 'completed'
  )
);

CREATE TABLE candidate_snapshot (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL UNIQUE,
  person_id INTEGER NOT NULL,
  snapshot_status TEXT NOT NULL DEFAULT 'core_published'
    CHECK (
      snapshot_status IN (
        'core_published',
        'enrichment_running',
        'enriched',
        'superseded',
        'cancelled'
      )
    ),
  normalized_person_name TEXT NOT NULL,
  normalized_first_name TEXT,
  normalized_middle_name TEXT,
  normalized_last_name TEXT,
  normalized_email_address TEXT NOT NULL,
  normalized_phone TEXT,
  normalized_linkedin_url TEXT,
  normalized_github_url TEXT,
  source_resume_text_sha256 TEXT NOT NULL,
  source_extraction_version TEXT NOT NULL,
  profile_snapshot_sha256 TEXT NOT NULL,
  snapshot_created_at TEXT NOT NULL,
  enrichment_completed_at TEXT,
  superseded_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (application_id, person_id)
    REFERENCES application(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (id, application_id),
  UNIQUE (id, application_id, person_id),
  CHECK (length(trim(candidate_snapshot_uuid)) > 0),
  CHECK (length(trim(normalized_person_name)) > 0),
  CHECK (
    length(trim(normalized_email_address)) > 0
    AND length(normalized_email_address)
        - length(replace(normalized_email_address, '@', '')) = 1
  ),
  CHECK (length(source_resume_text_sha256) = 64),
  CHECK (length(trim(source_extraction_version)) > 0),
  CHECK (length(profile_snapshot_sha256) = 64),
  CHECK (
    (snapshot_status = 'enriched' AND enrichment_completed_at IS NOT NULL)
    OR
    snapshot_status <> 'enriched'
  ),
  CHECK (
    (snapshot_status = 'superseded' AND superseded_at IS NOT NULL)
    OR
    (snapshot_status <> 'superseded' AND superseded_at IS NULL)
  ),
  CHECK (
    (snapshot_status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR
    (snapshot_status <> 'cancelled' AND cancelled_at IS NULL)
  )
);

CREATE TABLE application_source_lineage (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL,
  source_submission_normalized_id INTEGER NOT NULL,
  source_raw_submission_id INTEGER NOT NULL,
  source_dedup_run_id INTEGER NOT NULL,
  source_resume_extraction_id INTEGER NOT NULL,
  relation_role TEXT NOT NULL
    CHECK (
      relation_role IN (
        'primary_decision_input',
        'selected_prior_submission',
        'supporting_duplicate_match'
      )
    ),
  source_snapshot_sha256 TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  UNIQUE (
    application_id,
    source_submission_normalized_id,
    relation_role
  ),
  CHECK (length(source_snapshot_sha256) = 64)
);

CREATE TABLE person_name (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  source_candidate_snapshot_id INTEGER,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  name_source TEXT NOT NULL
    CHECK (name_source IN ('submitted_field', 'resume_selected', 'administrative')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE,
  FOREIGN KEY (source_candidate_snapshot_id)
    REFERENCES candidate_snapshot(id) ON DELETE SET NULL,
  UNIQUE (person_id, normalized_name),
  CHECK (length(trim(display_name)) > 0),
  CHECK (length(trim(normalized_name)) > 0)
);

CREATE TABLE person_contact (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  contact_type_id INTEGER NOT NULL,
  source_candidate_snapshot_id INTEGER,
  normalized_contact_value TEXT NOT NULL,
  contact_value_hmac TEXT NOT NULL,
  hmac_key_version TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_type_id)
    REFERENCES contact_type(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_candidate_snapshot_id)
    REFERENCES candidate_snapshot(id) ON DELETE SET NULL,
  UNIQUE (person_id, contact_type_id, contact_value_hmac),
  CHECK (length(trim(normalized_contact_value)) > 0),
  CHECK (length(contact_value_hmac) = 64),
  CHECK (length(trim(hmac_key_version)) > 0)
);

CREATE TABLE person_link (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  source_candidate_snapshot_id INTEGER,
  link_type TEXT NOT NULL
    CHECK (link_type IN ('linkedin', 'github', 'portfolio', 'other')),
  normalized_url TEXT NOT NULL,
  normalized_url_hmac TEXT NOT NULL,
  hmac_key_version TEXT NOT NULL,
  account_handle TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE CASCADE,
  FOREIGN KEY (source_candidate_snapshot_id)
    REFERENCES candidate_snapshot(id) ON DELETE SET NULL,
  UNIQUE (person_id, link_type, normalized_url_hmac),
  CHECK (length(trim(normalized_url)) > 0),
  CHECK (length(normalized_url_hmac) = 64),
  CHECK (length(trim(hmac_key_version)) > 0)
);

CREATE UNIQUE INDEX idx_person_name_one_primary
  ON person_name (person_id)
  WHERE is_primary = 1;

CREATE UNIQUE INDEX idx_person_contact_one_primary_per_type
  ON person_contact (person_id, contact_type_id)
  WHERE is_primary = 1;

CREATE UNIQUE INDEX idx_person_link_one_primary_per_type
  ON person_link (person_id, link_type)
  WHERE is_primary = 1;

CREATE INDEX idx_person_current_application
  ON person (current_application_id);

CREATE INDEX idx_person_current_candidate
  ON person (current_candidate_snapshot_id);

CREATE UNIQUE INDEX idx_person_canonical_email_unique
  ON person (normalized_email_address)
  WHERE person_status <> 'merged';

CREATE INDEX idx_application_person_group
  ON application (
    person_id,
    company_id,
    position_id,
    requested_start_year_month,
    submission_attempt_number
  );

CREATE INDEX idx_application_lifecycle_decision
  ON application (application_lifecycle_status, application_decision_status, updated_at);

CREATE INDEX idx_application_previous
  ON application (previous_application_id);

CREATE INDEX idx_application_superseded_by
  ON application (superseded_by_application_id);

CREATE INDEX idx_candidate_person_status
  ON candidate_snapshot (person_id, snapshot_status, snapshot_created_at);

CREATE UNIQUE INDEX idx_lineage_one_primary_decision_input
  ON application_source_lineage (application_id)
  WHERE relation_role = 'primary_decision_input';

CREATE INDEX idx_lineage_source_submission
  ON application_source_lineage (source_submission_normalized_id, relation_role);

CREATE INDEX idx_lineage_source_raw
  ON application_source_lineage (source_raw_submission_id, relation_role);

CREATE INDEX idx_lineage_source_dedup
  ON application_source_lineage (source_dedup_run_id);

CREATE INDEX idx_lineage_source_extraction
  ON application_source_lineage (source_resume_extraction_id);

CREATE INDEX idx_person_name_lookup
  ON person_name (normalized_name, person_id);

CREATE INDEX idx_person_contact_hmac_lookup
  ON person_contact (contact_type_id, contact_value_hmac, person_id);

CREATE INDEX idx_person_link_hmac_lookup
  ON person_link (link_type, normalized_url_hmac, person_id);
