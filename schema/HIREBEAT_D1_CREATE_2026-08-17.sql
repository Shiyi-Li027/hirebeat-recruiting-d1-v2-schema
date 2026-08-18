-- HireBeat D1 complete current schema
-- Generated: 2026-08-17
-- Source: 11 confirmed G01-G11 schema modules
-- Contains schema only: 84 application tables and 118 explicit indexes.
-- Seed/reference rows must be deployed in later migrations.
-- Do not add BEGIN/COMMIT; D1 executes migrations transactionally.

PRAGMA defer_foreign_keys = on;

-- ============================================================
-- BEGIN SOURCE MODULE: shared_reference/001_shared_reference_schema.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G01: shared reference data and talent taxonomies
-- Confirmed 1, 2026-08-13
-- G01 design is frozen. Seed data and migrations are separate.
CREATE TABLE function (
  id INTEGER PRIMARY KEY,
  function_code TEXT NOT NULL UNIQUE,
  function_name TEXT NOT NULL,
  normalized_function_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE seniority (
  id INTEGER PRIMARY KEY,
  seniority_code TEXT NOT NULL UNIQUE,
  seniority_name TEXT NOT NULL,
  seniority_rank INTEGER,
  typical_experience_months_min INTEGER
    CHECK (typical_experience_months_min IS NULL OR typical_experience_months_min >= 0),
  typical_experience_months_max INTEGER
    CHECK (typical_experience_months_max IS NULL OR typical_experience_months_max >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    typical_experience_months_min IS NULL
    OR typical_experience_months_max IS NULL
    OR typical_experience_months_max >= typical_experience_months_min
  )
);

CREATE TABLE contact_type (
  id INTEGER PRIMARY KEY,
  contact_type_code TEXT NOT NULL UNIQUE,
  contact_type_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE skill_type (
  id INTEGER PRIMARY KEY,
  skill_type_code TEXT NOT NULL UNIQUE,
  skill_type_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE skill (
  id INTEGER PRIMARY KEY,
  skill_uuid TEXT NOT NULL UNIQUE,
  skill_name TEXT NOT NULL,
  normalized_skill_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE skill_type_assignment (
  id INTEGER PRIMARY KEY,
  skill_id INTEGER NOT NULL,
  skill_type_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skill(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_type_id) REFERENCES skill_type(id) ON DELETE RESTRICT,
  UNIQUE (skill_id, skill_type_id)
);

CREATE TABLE skill_proficiency_level (
  id INTEGER PRIMARY KEY,
  proficiency_level_code TEXT NOT NULL UNIQUE,
  proficiency_level_name TEXT NOT NULL UNIQUE,
  proficiency_level_rank INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE certification_type (
  id INTEGER PRIMARY KEY,
  certification_type_code TEXT NOT NULL UNIQUE,
  certification_type_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE issuing_organization (
  id INTEGER PRIMARY KEY,
  issuing_organization_uuid TEXT NOT NULL UNIQUE,
  organization_name TEXT NOT NULL,
  normalized_organization_name TEXT NOT NULL UNIQUE,
  organization_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE certification (
  id INTEGER PRIMARY KEY,
  certification_uuid TEXT NOT NULL UNIQUE,
  certification_name TEXT NOT NULL,
  normalized_certification_name TEXT NOT NULL,
  certification_type_id INTEGER,
  issuing_organization_id INTEGER,
  certification_url TEXT,
  typical_validity_months INTEGER
    CHECK (typical_validity_months IS NULL OR typical_validity_months >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (certification_type_id)
    REFERENCES certification_type(id) ON DELETE RESTRICT,
  FOREIGN KEY (issuing_organization_id)
    REFERENCES issuing_organization(id) ON DELETE RESTRICT
);

CREATE TABLE country (
  id INTEGER PRIMARY KEY,
  country_code TEXT NOT NULL UNIQUE,
  country_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE state (
  id INTEGER PRIMARY KEY,
  country_id INTEGER NOT NULL,
  state_code TEXT,
  state_name TEXT NOT NULL,
  normalized_state_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (country_id) REFERENCES country(id) ON DELETE RESTRICT,
  UNIQUE (country_id, normalized_state_name)
);

CREATE TABLE city (
  id INTEGER PRIMARY KEY,
  city_uuid TEXT NOT NULL UNIQUE,
  country_id INTEGER NOT NULL,
  state_id INTEGER,
  city_name TEXT NOT NULL,
  normalized_city_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (country_id) REFERENCES country(id) ON DELETE RESTRICT,
  FOREIGN KEY (state_id) REFERENCES state(id) ON DELETE RESTRICT
);

CREATE TABLE location (
  id INTEGER PRIMARY KEY,
  location_uuid TEXT NOT NULL UNIQUE,
  country_id INTEGER,
  state_id INTEGER,
  city_id INTEGER,
  postal_code TEXT,
  location_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (country_id) REFERENCES country(id) ON DELETE RESTRICT,
  FOREIGN KEY (state_id) REFERENCES state(id) ON DELETE RESTRICT,
  FOREIGN KEY (city_id) REFERENCES city(id) ON DELETE RESTRICT,
  CHECK (
    country_id IS NOT NULL
    OR state_id IS NOT NULL
    OR city_id IS NOT NULL
    OR postal_code IS NOT NULL
    OR location_name IS NOT NULL
  )
);

CREATE TABLE degree (
  id INTEGER PRIMARY KEY,
  degree_code TEXT NOT NULL UNIQUE,
  degree_name TEXT NOT NULL UNIQUE,
  degree_level_rank INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE field_study (
  id INTEGER PRIMARY KEY,
  field_study_uuid TEXT NOT NULL UNIQUE,
  field_study_name TEXT NOT NULL,
  normalized_field_study_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE major (
  id INTEGER PRIMARY KEY,
  major_uuid TEXT NOT NULL UNIQUE,
  field_study_id INTEGER,
  major_name TEXT NOT NULL,
  normalized_major_name TEXT NOT NULL,
  is_stem INTEGER CHECK (is_stem IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (field_study_id) REFERENCES field_study(id) ON DELETE RESTRICT
);

CREATE TABLE school (
  id INTEGER PRIMARY KEY,
  school_uuid TEXT NOT NULL UNIQUE,
  school_name TEXT NOT NULL,
  normalized_school_name TEXT NOT NULL UNIQUE,
  school_url TEXT,
  school_type TEXT,
  school_category TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE work_mode (
  id INTEGER PRIMARY KEY,
  work_mode_code TEXT NOT NULL UNIQUE,
  work_mode_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE position_employment_type (
  id INTEGER PRIMARY KEY,
  employment_type_code TEXT NOT NULL UNIQUE,
  employment_type_name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE position_occupational_type (
  id INTEGER PRIMARY KEY,
  occupational_code TEXT NOT NULL UNIQUE,
  occupational_type_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_skill_type_assignment_type
  ON skill_type_assignment (skill_type_id, skill_id);

CREATE INDEX idx_certification_type
  ON certification (certification_type_id);

CREATE INDEX idx_certification_issuer
  ON certification (issuing_organization_id);

CREATE INDEX idx_state_country
  ON state (country_id);

CREATE INDEX idx_city_country_state
  ON city (country_id, state_id);

CREATE INDEX idx_location_country_state_city
  ON location (country_id, state_id, city_id);

CREATE INDEX idx_major_field_study
  ON major (field_study_id);
-- END SOURCE MODULE: shared_reference/001_shared_reference_schema.sql

-- ============================================================
-- BEGIN SOURCE MODULE: catalog/002_recruitment_catalog_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G02: authoritative recruitment catalog and form synchronization
-- Confirmed G02 schema, revision 2, 2026-08-17
-- Requires confirmed G01 shared-reference tables.
-- The outbox_event foreign key is intentionally deferred until G04 is confirmed.
CREATE TABLE company (
  id INTEGER PRIMARY KEY,
  company_uuid TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  normalized_company_name TEXT NOT NULL,
  company_website_url TEXT,
  company_linkedin_url TEXT,
  company_description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  default_max_submission_attempts INTEGER DEFAULT 5
    CHECK (
      default_max_submission_attempts IS NULL
      OR default_max_submission_attempts >= 1
    ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(company_uuid)) > 0),
  CHECK (length(trim(company_name)) > 0),
  CHECK (length(trim(normalized_company_name)) > 0)
);

CREATE TABLE company_contact_info (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  contact_type_id INTEGER,
  contact_value TEXT NOT NULL,
  contact_name TEXT,
  contact_position_title TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  priority_rank INTEGER CHECK (priority_rank IS NULL OR priority_rank >= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_type_id) REFERENCES contact_type(id) ON DELETE RESTRICT,
  CHECK (length(trim(contact_value)) > 0)
);

CREATE TABLE company_work_mode (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  work_mode_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE CASCADE,
  FOREIGN KEY (work_mode_id) REFERENCES work_mode(id) ON DELETE RESTRICT,
  UNIQUE (company_id, work_mode_id)
);

CREATE TABLE position (
  id INTEGER PRIMARY KEY,
  position_uuid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL,
  position_name TEXT NOT NULL,
  normalized_position_name TEXT NOT NULL,
  position_jd TEXT,
  occupational_type_id INTEGER,
  employment_type_id INTEGER,
  function_id INTEGER,
  seniority_id INTEGER,
  location_id INTEGER,
  work_duration TEXT,
  position_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (position_status IN ('draft', 'active', 'paused', 'closed', 'archived')),
  openings_count INTEGER CHECK (openings_count IS NULL OR openings_count >= 0),
  posted_date TEXT,
  offers_relocation_assistance INTEGER
    CHECK (offers_relocation_assistance IN (0, 1) OR offers_relocation_assistance IS NULL),
  local_candidates_only INTEGER
    CHECK (local_candidates_only IN (0, 1) OR local_candidates_only IS NULL),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (occupational_type_id)
    REFERENCES position_occupational_type(id) ON DELETE RESTRICT,
  FOREIGN KEY (employment_type_id)
    REFERENCES position_employment_type(id) ON DELETE RESTRICT,
  FOREIGN KEY (function_id) REFERENCES function(id) ON DELETE RESTRICT,
  FOREIGN KEY (seniority_id) REFERENCES seniority(id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT,
  CHECK (length(trim(position_uuid)) > 0),
  CHECK (length(trim(position_name)) > 0),
  CHECK (length(trim(normalized_position_name)) > 0)
);

CREATE TABLE position_salary_range (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL,
  salary_min_cents INTEGER
    CHECK (salary_min_cents IS NULL OR salary_min_cents >= 0),
  salary_max_cents INTEGER
    CHECK (salary_max_cents IS NULL OR salary_max_cents >= 0),
  currency_code TEXT NOT NULL,
  salary_period TEXT NOT NULL
    CHECK (salary_period IN ('hour', 'day', 'week', 'month', 'year', 'project')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE CASCADE,
  UNIQUE (position_id, currency_code, salary_period),
  CHECK (salary_min_cents IS NOT NULL OR salary_max_cents IS NOT NULL),
  CHECK (
    salary_min_cents IS NULL
    OR salary_max_cents IS NULL
    OR salary_max_cents >= salary_min_cents
  )
);

CREATE TABLE position_skill (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL
    CHECK (requirement_type IN ('required', 'preferred')),
  minimum_proficiency_level_id INTEGER,
  onet_importance_score REAL,
  onet_dependence_score REAL,
  onet_preparation_score REAL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skill(id) ON DELETE RESTRICT,
  FOREIGN KEY (minimum_proficiency_level_id)
    REFERENCES skill_proficiency_level(id) ON DELETE RESTRICT,
  UNIQUE (position_id, skill_id)
);

CREATE TABLE position_education_requirement (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL,
  degree_id INTEGER NOT NULL,
  field_study_id INTEGER,
  requirement_type TEXT NOT NULL
    CHECK (requirement_type IN ('required', 'preferred')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE CASCADE,
  FOREIGN KEY (degree_id) REFERENCES degree(id) ON DELETE RESTRICT,
  FOREIGN KEY (field_study_id) REFERENCES field_study(id) ON DELETE RESTRICT
);

CREATE TABLE position_certification_requirement (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL,
  certification_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL
    CHECK (requirement_type IN ('required', 'preferred')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE CASCADE,
  FOREIGN KEY (certification_id) REFERENCES certification(id) ON DELETE RESTRICT,
  UNIQUE (position_id, certification_id)
);

CREATE TABLE catalog_revision (
  id INTEGER PRIMARY KEY,
  catalog_revision_uuid TEXT NOT NULL UNIQUE,
  revision_number INTEGER NOT NULL UNIQUE CHECK (revision_number >= 1),
  catalog_snapshot_json TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL UNIQUE,
  change_reason TEXT,
  created_by_actor TEXT,
  created_at TEXT NOT NULL,
  CHECK (length(trim(catalog_revision_uuid)) > 0),
  CHECK (length(trim(catalog_snapshot_json)) > 0),
  CHECK (length(snapshot_sha256) = 64)
);

CREATE TABLE catalog_sync_run (
  id INTEGER PRIMARY KEY,
  catalog_sync_run_uuid TEXT NOT NULL UNIQUE,
  catalog_revision_id INTEGER NOT NULL,
  triggering_outbox_event_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      sync_status IN (
        'pending',
        'running',
        'partially_succeeded',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  expected_target_count INTEGER NOT NULL DEFAULT 0
    CHECK (expected_target_count >= 0),
  succeeded_target_count INTEGER NOT NULL DEFAULT 0
    CHECK (succeeded_target_count >= 0),
  failed_target_count INTEGER NOT NULL DEFAULT 0
    CHECK (failed_target_count >= 0),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (catalog_revision_id) REFERENCES catalog_revision(id) ON DELETE RESTRICT,
  CHECK (succeeded_target_count + failed_target_count <= expected_target_count)
);

CREATE TABLE catalog_sync_target_run (
  id INTEGER PRIMARY KEY,
  catalog_sync_run_id INTEGER NOT NULL,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('airtable', 'google_form')),
  target_key TEXT NOT NULL,
  target_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      target_status IN (
        'pending',
        'running',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  external_revision_key TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  next_attempt_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (catalog_sync_run_id) REFERENCES catalog_sync_run(id) ON DELETE CASCADE,
  UNIQUE (catalog_sync_run_id, target_type, target_key),
  CHECK (length(trim(target_key)) > 0)
);

CREATE INDEX idx_company_normalized_name
  ON company (normalized_company_name);

CREATE INDEX idx_company_active_name
  ON company (is_active, company_name);

CREATE INDEX idx_company_contact_company_active
  ON company_contact_info (company_id, is_active);

CREATE INDEX idx_company_work_mode_active
  ON company_work_mode (company_id, is_active, work_mode_id);

CREATE INDEX idx_position_company_status_name
  ON position (company_id, position_status, position_name);

CREATE INDEX idx_position_skill_active
  ON position_skill (position_id, is_active, skill_id);

CREATE UNIQUE INDEX idx_position_education_requirement_identity
  ON position_education_requirement (
    position_id,
    degree_id,
    IFNULL(field_study_id, -1)
  );

CREATE INDEX idx_position_education_requirement_active
  ON position_education_requirement (position_id, is_active);

CREATE INDEX idx_position_certification_requirement_active
  ON position_certification_requirement (position_id, is_active);

CREATE INDEX idx_catalog_sync_run_revision_status
  ON catalog_sync_run (catalog_revision_id, sync_status);

CREATE INDEX idx_catalog_sync_target_pending
  ON catalog_sync_target_run (target_status, next_attempt_at);
-- END SOURCE MODULE: catalog/002_recruitment_catalog_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: submission_ingress/003_submission_ingress_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G03: submission ingress and faithful raw submission
-- Confirmed Revision 1, 2026-08-17
-- Requires confirmed G01 and G02 schemas.
-- Workflow/outbox foreign keys are intentionally deferred until G04 is confirmed.
CREATE TABLE raw_submission_intake_run (
  id INTEGER PRIMARY KEY,
  intake_run_uuid TEXT NOT NULL UNIQUE,
  submission_uuid TEXT NOT NULL UNIQUE,
  source_system TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL UNIQUE,
  source_schema_version TEXT,
  accepted_payload_hmac TEXT,
  last_received_payload_hmac TEXT,
  payload_hmac_key_version TEXT,
  intake_status TEXT NOT NULL DEFAULT 'received'
    CHECK (
      intake_status IN (
        'received',
        'resolving_resume_text',
        'persisting_raw',
        'succeeded',
        'failed_retryable',
        'failed_terminal',
        'cancelled'
      )
    ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  technical_redelivery_count INTEGER NOT NULL DEFAULT 0
    CHECK (technical_redelivery_count >= 0),
  last_technical_redelivery_mechanism TEXT,
  last_technical_redelivery_cause_code TEXT,
  last_technical_redelivery_at TEXT,
  payload_conflict_count INTEGER NOT NULL DEFAULT 0
    CHECK (payload_conflict_count >= 0),
  last_error_code TEXT,
  last_error_detail TEXT,
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  last_attempt_started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  configuration_release_id INTEGER,
  UNIQUE (source_system, source_record_id),
  UNIQUE (
    id,
    submission_uuid,
    source_system,
    source_record_id,
    source_event_key
  ),
  FOREIGN KEY (configuration_release_id)
    REFERENCES system_configuration_release(id) ON DELETE RESTRICT,
  CHECK (length(trim(intake_run_uuid)) > 0),
  CHECK (length(trim(submission_uuid)) > 0),
  CHECK (length(trim(source_system)) > 0),
  CHECK (length(trim(source_record_id)) > 0),
  CHECK (length(trim(source_event_key)) > 0),
  CHECK (
    accepted_payload_hmac IS NULL
    OR length(accepted_payload_hmac) = 64
  ),
  CHECK (
    last_received_payload_hmac IS NULL
    OR length(last_received_payload_hmac) = 64
  )
);

CREATE TABLE raw_submission (
  id INTEGER PRIMARY KEY,
  raw_submission_intake_run_id INTEGER NOT NULL UNIQUE,
  submission_uuid TEXT NOT NULL UNIQUE,
  source_system TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_event_key TEXT NOT NULL UNIQUE,
  source_schema_version TEXT,
  submitted_catalog_revision_id INTEGER,
  submitted_company_id INTEGER,
  submitted_company_name TEXT,
  submitted_company_work_mode_id INTEGER,
  submitted_company_work_mode_name TEXT,
  submitted_position_id INTEGER,
  submitted_position_name TEXT,
  raw_person_name TEXT,
  raw_email_address TEXT,
  raw_phone TEXT,
  raw_start_working_date TEXT,
  raw_end_working_date TEXT,
  raw_work_duration TEXT,
  payload_hmac TEXT NOT NULL,
  payload_hmac_key_version TEXT NOT NULL,
  source_submitted_at TEXT,
  landed_at TEXT NOT NULL,
  retention_until TEXT,
  purged_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (raw_submission_intake_run_id)
    REFERENCES raw_submission_intake_run(id) ON DELETE RESTRICT,
  FOREIGN KEY (
    raw_submission_intake_run_id,
    submission_uuid,
    source_system,
    source_record_id,
    source_event_key
  ) REFERENCES raw_submission_intake_run (
    id,
    submission_uuid,
    source_system,
    source_record_id,
    source_event_key
  ) ON DELETE RESTRICT,
  CHECK (length(trim(submission_uuid)) > 0),
  CHECK (length(trim(source_system)) > 0),
  CHECK (length(trim(source_record_id)) > 0),
  CHECK (length(trim(source_event_key)) > 0),
  CHECK (length(payload_hmac) = 64),
  CHECK (length(trim(payload_hmac_key_version)) > 0)
);

CREATE TABLE raw_submission_resume (
  id INTEGER PRIMARY KEY,
  raw_submission_id INTEGER NOT NULL UNIQUE,
  resume_text TEXT,
  resume_text_status TEXT NOT NULL
    CHECK (
      resume_text_status IN (
        'available',
        'no_resume',
        'parse_failed_terminal'
      )
    ),
  resume_text_origin TEXT
    CHECK (
      resume_text_origin IS NULL
      OR resume_text_origin IN (
        'source_provided',
        'pymupdf',
        'ocr',
        'upstream_parser'
      )
    ),
  resume_parser_version TEXT,
  resume_text_sha256 TEXT,
  resume_parsed_at TEXT,
  resume_original_file_name TEXT,
  resume_source_url TEXT,
  resume_source_file_id TEXT,
  resume_mime_type TEXT,
  resume_file_size_bytes INTEGER
    CHECK (resume_file_size_bytes IS NULL OR resume_file_size_bytes >= 0),
  resume_r2_object_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resume_file_sha256 TEXT
    CHECK (resume_file_sha256 IS NULL OR length(resume_file_sha256) = 64),
  FOREIGN KEY (raw_submission_id)
    REFERENCES raw_submission(id) ON DELETE CASCADE,
  CHECK (
    (
      resume_text_status = 'available'
      AND resume_text IS NOT NULL
      AND length(trim(resume_text)) > 0
      AND resume_text_origin IS NOT NULL
      AND resume_text_sha256 IS NOT NULL
      AND length(resume_text_sha256) = 64
    )
    OR
    (
      resume_text_status IN ('no_resume', 'parse_failed_terminal')
      AND resume_text IS NULL
      AND resume_text_sha256 IS NULL
    )
  ),
  CHECK (
    resume_parser_version IS NULL
    OR length(trim(resume_parser_version)) > 0
  )
);

CREATE INDEX idx_raw_submission_intake_status_retry
  ON raw_submission_intake_run (intake_status, updated_at);

CREATE INDEX idx_raw_submission_intake_source_received
  ON raw_submission_intake_run (source_system, first_received_at);

CREATE INDEX idx_raw_submission_landed
  ON raw_submission (landed_at);

CREATE INDEX idx_raw_submission_source
  ON raw_submission (source_system, source_record_id);

CREATE INDEX idx_raw_submission_submitted_catalog
  ON raw_submission (
    submitted_company_id,
    submitted_position_id,
    submitted_company_work_mode_id
  );

CREATE INDEX idx_raw_submission_retention
  ON raw_submission (retention_until, purged_at);

CREATE UNIQUE INDEX uq_raw_submission_resume_r2_object_key
  ON raw_submission_resume (resume_r2_object_key)
  WHERE resume_r2_object_key IS NOT NULL;
-- END SOURCE MODULE: submission_ingress/003_submission_ingress_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: workflow_control/004_workflow_control_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G04: versioned system configuration, workflow control, retry
-- attempts, outbox, and audit
-- Confirmed Revision 2, 2026-08-17
-- Requires G03 raw_submission. The application FK resolves when the complete
-- initial schema is assembled with G07.
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
-- END SOURCE MODULE: workflow_control/004_workflow_control_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: submission_processing/005_submission_processing_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G05: normalization and versioned Resume extraction results
-- Confirmed Revision 1, 2026-08-17
-- Requires G01/G02 reference/catalog, G03 raw submission, and G04 workflow.
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
-- END SOURCE MODULE: submission_processing/005_submission_processing_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: dedup_admission/006_dedup_admission_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G06: real-time deduplication and Application admission decision
-- Confirmed Revision 1, 2026-08-17
-- Requires G01/G02 catalog, G04 workflow, and G05 normalized/extraction data.
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
-- END SOURCE MODULE: dedup_admission/006_dedup_admission_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: application_core/007_application_core_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G07: Person, Application, Candidate snapshot, identity history, lineage
-- Confirmed G07 schema, revision 1, 2026-08-17
-- References G08/G10 tables that are created later in the assembled schema.
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
-- END SOURCE MODULE: application_core/007_application_core_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: candidate_profile/008_candidate_profile_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G08: published Person/Candidate education, employment, skill,
-- project, and certification profile
-- Confirmed G08 schema, revision 1, 2026-08-17
-- Requires confirmed G01, G02, and G07 schemas.
-- G05 source row IDs are intentionally plain INTEGER lineage values.
CREATE TABLE education (
  id INTEGER PRIMARY KEY,
  education_uuid TEXT NOT NULL UNIQUE,
  degree_id INTEGER NOT NULL,
  school_id INTEGER,
  field_study_id INTEGER,
  major_id INTEGER,
  raw_school_name TEXT NOT NULL,
  normalized_school_name TEXT,
  raw_degree_name TEXT NOT NULL,
  normalized_degree_name TEXT NOT NULL,
  raw_field_study_name TEXT,
  normalized_field_study_name TEXT,
  raw_major_name TEXT,
  normalized_major_name TEXT,
  gpa TEXT,
  education_description TEXT NOT NULL,
  education_start_date TEXT,
  education_end_date TEXT,
  is_current INTEGER CHECK (is_current IS NULL OR is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (degree_id) REFERENCES degree(id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id) REFERENCES school(id) ON DELETE RESTRICT,
  FOREIGN KEY (field_study_id) REFERENCES field_study(id) ON DELETE RESTRICT,
  FOREIGN KEY (major_id) REFERENCES major(id) ON DELETE RESTRICT,
  CHECK (length(trim(education_uuid)) > 0),
  CHECK (length(trim(raw_school_name)) > 0),
  CHECK (length(trim(raw_degree_name)) > 0),
  CHECK (length(trim(normalized_degree_name)) > 0),
  CHECK (length(trim(education_description)) > 0)
);

CREATE TABLE person_education (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  education_id INTEGER NOT NULL UNIQUE,
  first_source_candidate_snapshot_id INTEGER NOT NULL,
  first_source_resume_education_id INTEGER NOT NULL,
  education_record_sha256 TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (education_id) REFERENCES education(id) ON DELETE RESTRICT,
  FOREIGN KEY (first_source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (person_id, education_record_sha256),
  CHECK (length(education_record_sha256) = 64)
);

CREATE TABLE candidate_education (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_education_id INTEGER NOT NULL,
  source_resume_education_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  is_highest_degree INTEGER NOT NULL DEFAULT 0
    CHECK (is_highest_degree IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_education_id, person_id)
    REFERENCES person_education(id, person_id) ON DELETE RESTRICT,
  UNIQUE (candidate_snapshot_id, person_education_id),
  UNIQUE (candidate_snapshot_id, source_resume_education_id)
);

CREATE TABLE person_position (
  id INTEGER PRIMARY KEY,
  person_position_uuid TEXT NOT NULL UNIQUE,
  person_id INTEGER NOT NULL,
  first_source_candidate_snapshot_id INTEGER NOT NULL,
  first_source_resume_employment_id INTEGER NOT NULL,
  company_id INTEGER,
  position_id INTEGER,
  function_id INTEGER,
  seniority_id INTEGER,
  location_id INTEGER,
  employment_type_id INTEGER,
  raw_company_name TEXT NOT NULL,
  normalized_company_name TEXT,
  raw_position_name TEXT NOT NULL,
  normalized_position_name TEXT,
  experience_type_text TEXT,
  position_description TEXT NOT NULL,
  position_start_date TEXT,
  position_end_date TEXT,
  is_current INTEGER CHECK (is_current IS NULL OR is_current IN (0, 1)),
  employment_record_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (first_source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT,
  FOREIGN KEY (position_id) REFERENCES position(id) ON DELETE RESTRICT,
  FOREIGN KEY (function_id) REFERENCES function(id) ON DELETE RESTRICT,
  FOREIGN KEY (seniority_id) REFERENCES seniority(id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES location(id) ON DELETE RESTRICT,
  FOREIGN KEY (employment_type_id)
    REFERENCES position_employment_type(id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (person_id, employment_record_sha256),
  CHECK (length(trim(person_position_uuid)) > 0),
  CHECK (length(trim(raw_company_name)) > 0),
  CHECK (length(trim(raw_position_name)) > 0),
  CHECK (length(trim(position_description)) > 0),
  CHECK (position_start_date IS NOT NULL OR position_end_date IS NOT NULL),
  CHECK (length(employment_record_sha256) = 64)
);

CREATE TABLE candidate_position (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_position_id INTEGER NOT NULL,
  source_resume_employment_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  is_current_at_snapshot INTEGER
    CHECK (is_current_at_snapshot IS NULL OR is_current_at_snapshot IN (0, 1)),
  is_primary_current_position INTEGER NOT NULL DEFAULT 0
    CHECK (is_primary_current_position IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_position_id, person_id)
    REFERENCES person_position(id, person_id) ON DELETE RESTRICT,
  UNIQUE (candidate_snapshot_id, person_position_id),
  UNIQUE (candidate_snapshot_id, source_resume_employment_id),
  CHECK (
    is_primary_current_position = 0
    OR is_current_at_snapshot = 1
  )
);

CREATE TABLE person_skill (
  id INTEGER PRIMARY KEY,
  person_id INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  current_proficiency_level_id INTEGER,
  current_proficiency_text TEXT,
  current_years_experience REAL
    CHECK (current_years_experience IS NULL OR current_years_experience >= 0),
  first_source_candidate_snapshot_id INTEGER NOT NULL,
  latest_source_candidate_snapshot_id INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (skill_id) REFERENCES skill(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_proficiency_level_id)
    REFERENCES skill_proficiency_level(id) ON DELETE RESTRICT,
  FOREIGN KEY (first_source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (latest_source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (person_id, skill_id),
  CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE candidate_skill (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_skill_id INTEGER NOT NULL,
  source_resume_skill_id INTEGER NOT NULL,
  raw_skill_text TEXT NOT NULL,
  matched_context_text TEXT,
  match_method TEXT NOT NULL
    CHECK (match_method IN ('catalog_exact', 'catalog_rule_alias')),
  proficiency_level_id_snapshot INTEGER,
  proficiency_text_snapshot TEXT,
  years_experience_snapshot REAL
    CHECK (years_experience_snapshot IS NULL OR years_experience_snapshot >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_skill_id, person_id)
    REFERENCES person_skill(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (proficiency_level_id_snapshot)
    REFERENCES skill_proficiency_level(id) ON DELETE RESTRICT,
  UNIQUE (candidate_snapshot_id, person_skill_id),
  UNIQUE (candidate_snapshot_id, source_resume_skill_id),
  CHECK (length(trim(raw_skill_text)) > 0)
);

CREATE TABLE person_project (
  id INTEGER PRIMARY KEY,
  person_project_uuid TEXT NOT NULL UNIQUE,
  person_id INTEGER NOT NULL,
  first_source_candidate_snapshot_id INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  normalized_project_name TEXT,
  project_role TEXT,
  project_description TEXT NOT NULL,
  project_url TEXT,
  project_start_date TEXT,
  project_end_date TEXT,
  project_record_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (first_source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (person_id, project_record_sha256),
  CHECK (length(trim(person_project_uuid)) > 0),
  CHECK (length(trim(project_name)) > 0),
  CHECK (length(trim(project_description)) > 0),
  CHECK (length(project_record_sha256) = 64)
);

CREATE TABLE candidate_project (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_project_id INTEGER NOT NULL,
  source_resume_project_id INTEGER NOT NULL,
  source_entry_order INTEGER NOT NULL CHECK (source_entry_order >= 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_project_id, person_id)
    REFERENCES person_project(id, person_id) ON DELETE RESTRICT,
  UNIQUE (candidate_snapshot_id, person_project_id),
  UNIQUE (candidate_snapshot_id, source_resume_project_id)
);

CREATE TABLE person_certification (
  id INTEGER PRIMARY KEY,
  person_certification_uuid TEXT NOT NULL UNIQUE,
  person_id INTEGER NOT NULL,
  certification_id INTEGER NOT NULL,
  source_candidate_snapshot_id INTEGER,
  record_source TEXT NOT NULL
    CHECK (record_source IN ('resume_extraction', 'administrative', 'integration')),
  credential_id TEXT,
  credential_url TEXT,
  issued_at TEXT,
  expires_at TEXT,
  certification_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (certification_status IN ('unknown', 'active', 'expired', 'revoked')),
  certification_instance_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES person(id) ON DELETE RESTRICT,
  FOREIGN KEY (certification_id) REFERENCES certification(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  UNIQUE (id, person_id),
  UNIQUE (person_id, certification_instance_key),
  CHECK (length(trim(person_certification_uuid)) > 0),
  CHECK (length(trim(certification_instance_key)) > 0)
);

CREATE TABLE candidate_certification (
  id INTEGER PRIMARY KEY,
  candidate_snapshot_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  person_certification_id INTEGER NOT NULL,
  certification_status_snapshot TEXT NOT NULL
    CHECK (certification_status_snapshot IN ('unknown', 'active', 'expired', 'revoked')),
  issued_at_snapshot TEXT,
  expires_at_snapshot TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (candidate_snapshot_id, person_id)
    REFERENCES candidate_snapshot(id, person_id) ON DELETE RESTRICT,
  FOREIGN KEY (person_certification_id, person_id)
    REFERENCES person_certification(id, person_id) ON DELETE RESTRICT,
  UNIQUE (candidate_snapshot_id, person_certification_id)
);

CREATE UNIQUE INDEX idx_candidate_education_one_highest
  ON candidate_education (candidate_snapshot_id)
  WHERE is_highest_degree = 1;

CREATE UNIQUE INDEX idx_candidate_position_one_primary_current
  ON candidate_position (candidate_snapshot_id)
  WHERE is_primary_current_position = 1;

CREATE INDEX idx_person_education_person
  ON person_education (person_id, recorded_at);

CREATE INDEX idx_person_education_source
  ON person_education (first_source_resume_education_id);

CREATE INDEX idx_candidate_education_candidate
  ON candidate_education (candidate_snapshot_id, is_highest_degree);

CREATE INDEX idx_person_position_person_dates
  ON person_position (person_id, is_current, position_end_date, position_start_date);

CREATE INDEX idx_person_position_catalog
  ON person_position (company_id, position_id);

CREATE INDEX idx_candidate_position_candidate
  ON candidate_position (candidate_snapshot_id, source_entry_order);

CREATE INDEX idx_person_skill_skill
  ON person_skill (skill_id, person_id);

CREATE INDEX idx_candidate_skill_candidate
  ON candidate_skill (candidate_snapshot_id, person_skill_id);

CREATE INDEX idx_person_project_person_dates
  ON person_project (person_id, project_end_date, project_start_date);

CREATE INDEX idx_candidate_project_candidate
  ON candidate_project (candidate_snapshot_id, source_entry_order);

CREATE INDEX idx_person_certification_person_status
  ON person_certification (person_id, certification_status, expires_at);

CREATE INDEX idx_candidate_certification_candidate
  ON candidate_certification (candidate_snapshot_id, person_certification_id);
-- END SOURCE MODULE: candidate_profile/008_candidate_profile_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: machine_learning/009_machine_learning_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G09: single-model anomaly, similarity, threshold, and recommendation
-- Confirmed G09 schema, revision 1, 2026-08-17
-- Requires confirmed G02, G04, G07, and G08 schemas.
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
-- END SOURCE MODULE: machine_learning/009_machine_learning_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: hiring_pipeline/010_hiring_pipeline_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G10: hiring pipeline templates and per-Application stage execution
-- Confirmed Revision 1, 2026-08-17
-- Requires G04, G07, and G09. G11 Offer is created later.
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
-- END SOURCE MODULE: hiring_pipeline/010_hiring_pipeline_draft.sql

-- ============================================================
-- BEGIN SOURCE MODULE: offer/011_offer_lifecycle_draft.sql
-- ============================================================
-- HireBeat D1 new schema
-- Group G11: Offer master, immutable terms versions, and lifecycle history
-- Confirmed Revision 1, 2026-08-17
-- Requires G01, G04, G07, G09, and G10.
-- One row is the single Offer master for one admitted Application. It stores
-- current lifecycle state plus immutable snapshots of the decision context.
-- Negotiable employment terms belong to offer_version, not this master row.
CREATE TABLE offer (
  id INTEGER PRIMARY KEY,
  offer_uuid TEXT NOT NULL UNIQUE,
  application_id INTEGER NOT NULL UNIQUE,
  candidate_snapshot_id INTEGER NOT NULL UNIQUE,
  creating_stage_run_id INTEGER NOT NULL UNIQUE,
  ml_recommendation_result_id INTEGER UNIQUE,
  current_offer_version_id INTEGER,
  decision_source TEXT NOT NULL
    CHECK (
      decision_source IN (
        'ml_recommendation',
        'manual_hiring_decision',
        'offer_approval'
      )
    ),
  current_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      current_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  status_version INTEGER NOT NULL DEFAULT 1 CHECK (status_version >= 1),
  offer_fence_token TEXT NOT NULL,
  company_name_snapshot TEXT NOT NULL,
  position_title_snapshot TEXT NOT NULL,
  candidate_name_snapshot TEXT NOT NULL,
  candidate_email_snapshot TEXT NOT NULL,
  application_work_location_snapshot TEXT,
  application_work_mode_snapshot TEXT,
  requested_start_date_snapshot TEXT,
  requested_end_date_snapshot TEXT,
  work_duration_snapshot TEXT,
  current_status_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (application_id)
    REFERENCES application(id) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_snapshot_id, application_id)
    REFERENCES candidate_snapshot(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (creating_stage_run_id, application_id)
    REFERENCES application_stage_run(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (ml_recommendation_result_id, application_id)
    REFERENCES ml_recommendation_result(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (current_offer_version_id, id)
    REFERENCES offer_version(id, offer_id) ON DELETE RESTRICT,
  UNIQUE (id, application_id),
  CHECK (length(trim(offer_uuid)) > 0),
  CHECK (length(trim(offer_fence_token)) > 0),
  CHECK (length(trim(company_name_snapshot)) > 0),
  CHECK (length(trim(position_title_snapshot)) > 0),
  CHECK (length(trim(candidate_name_snapshot)) > 0),
  CHECK (
    length(trim(candidate_email_snapshot)) > 0
    AND length(candidate_email_snapshot)
        - length(replace(candidate_email_snapshot, '@', '')) = 1
  ),
  CHECK (
    decision_source <> 'ml_recommendation'
    OR ml_recommendation_result_id IS NOT NULL
  ),
  CHECK (
    current_status NOT IN (
      'ready_to_send', 'sent', 'viewed', 'accepted',
      'declined', 'expired', 'withdrawn'
    )
    OR current_offer_version_id IS NOT NULL
  )
);

-- One row is one immutable version of the actual Offer terms. A correction or
-- negotiation creates version_no + 1; historical versions are not overwritten.
CREATE TABLE offer_version (
  id INTEGER PRIMARY KEY,
  offer_version_uuid TEXT NOT NULL UNIQUE,
  offer_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  terms_sha256 TEXT NOT NULL,
  offer_title TEXT NOT NULL,
  employment_type_id INTEGER,
  work_location TEXT,
  work_mode TEXT,
  employment_start_date TEXT,
  employment_end_date TEXT,
  work_duration TEXT,
  compensation_amount_minor_units INTEGER
    CHECK (
      compensation_amount_minor_units IS NULL
      OR compensation_amount_minor_units >= 0
    ),
  compensation_currency_code TEXT,
  compensation_period TEXT
    CHECK (
      compensation_period IS NULL
      OR compensation_period IN ('hour', 'day', 'week', 'month', 'year', 'project')
    ),
  signing_bonus_minor_units INTEGER
    CHECK (signing_bonus_minor_units IS NULL OR signing_bonus_minor_units >= 0),
  target_bonus_description TEXT,
  equity_description TEXT,
  response_due_at TEXT,
  offer_terms_json TEXT NOT NULL,
  prepared_by_type TEXT NOT NULL
    CHECK (prepared_by_type IN ('system_ml', 'recruiter', 'external_system')),
  prepared_by_reference TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES offer(id) ON DELETE RESTRICT,
  FOREIGN KEY (employment_type_id)
    REFERENCES position_employment_type(id) ON DELETE RESTRICT,
  UNIQUE (id, offer_id),
  UNIQUE (offer_id, version_no),
  UNIQUE (offer_id, terms_sha256),
  CHECK (length(trim(offer_version_uuid)) > 0),
  CHECK (length(terms_sha256) = 64),
  CHECK (length(trim(offer_title)) > 0),
  CHECK (json_valid(offer_terms_json)),
  CHECK (
    (compensation_amount_minor_units IS NULL
      AND compensation_currency_code IS NULL
      AND compensation_period IS NULL)
    OR
    (compensation_amount_minor_units IS NOT NULL
      AND compensation_currency_code IS NOT NULL
      AND compensation_period IS NOT NULL)
  ),
  CHECK (
    compensation_currency_code IS NULL
    OR (
      length(compensation_currency_code) = 3
      AND compensation_currency_code = upper(compensation_currency_code)
    )
  ),
  CHECK (
    employment_start_date IS NULL
    OR employment_end_date IS NULL
    OR employment_end_date >= employment_start_date
  )
);

-- One immutable row per lifecycle transition. offer.current_status is a query
-- cache; this history is the auditable record of how that state changed.
CREATE TABLE offer_status_history (
  id INTEGER PRIMARY KEY,
  offer_status_history_uuid TEXT NOT NULL UNIQUE,
  offer_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  offer_version_id INTEGER,
  workflow_run_id INTEGER NOT NULL,
  stage_run_id INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_status TEXT
    CHECK (
      from_status IS NULL
      OR from_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  to_status TEXT NOT NULL
    CHECK (
      to_status IN (
        'draft', 'preparing', 'ready_to_send', 'sent', 'viewed',
        'accepted', 'declined', 'expired', 'withdrawn', 'cancelled'
      )
    ),
  initiated_by_type TEXT NOT NULL
    CHECK (
      initiated_by_type IN (
        'system_rule', 'ml', 'recruiter', 'candidate', 'external_system'
      )
    ),
  initiated_by_reference TEXT,
  reason_code TEXT NOT NULL,
  note TEXT,
  event_metadata_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (offer_id, application_id)
    REFERENCES offer(id, application_id) ON DELETE RESTRICT,
  FOREIGN KEY (offer_version_id, offer_id)
    REFERENCES offer_version(id, offer_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id)
    REFERENCES etl_workflow_run(id) ON DELETE RESTRICT,
  FOREIGN KEY (stage_run_id, application_id)
    REFERENCES application_stage_run(id, application_id) ON DELETE RESTRICT,
  CHECK (length(trim(offer_status_history_uuid)) > 0),
  CHECK (length(trim(idempotency_key)) > 0),
  CHECK (length(trim(reason_code)) > 0),
  CHECK (json_valid(event_metadata_json)),
  CHECK (
    (from_status IS NULL AND to_status = 'draft')
    OR (from_status IS NOT NULL AND from_status <> to_status)
  ),
  CHECK (
    to_status NOT IN (
      'ready_to_send', 'sent', 'viewed', 'accepted',
      'declined', 'expired', 'withdrawn'
    )
    OR offer_version_id IS NOT NULL
  )
);

CREATE INDEX idx_offer_current_status
  ON offer (current_status, current_status_changed_at);

CREATE INDEX idx_offer_candidate_snapshot
  ON offer (candidate_snapshot_id);

CREATE INDEX idx_offer_ml_recommendation
  ON offer (ml_recommendation_result_id);

CREATE INDEX idx_offer_version_offer_created
  ON offer_version (offer_id, created_at);

CREATE INDEX idx_offer_history_offer_occurred
  ON offer_status_history (offer_id, occurred_at, id);

CREATE INDEX idx_offer_history_workflow
  ON offer_status_history (workflow_run_id);
-- END SOURCE MODULE: offer/011_offer_lifecycle_draft.sql

PRAGMA defer_foreign_keys = off;
PRAGMA optimize;
