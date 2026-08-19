-- HireBeat D1 new schema
-- Group G02: authoritative recruitment catalog and form synchronization
-- Confirmed G02 schema, revision 2, 2026-08-17
-- Requires confirmed G01 shared-reference tables.
-- The outbox_event foreign key is intentionally deferred until G04 is confirmed.

PRAGMA foreign_keys = ON;

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

CREATE TRIGGER trg_position_active_requires_jd_insert
BEFORE INSERT ON position
FOR EACH ROW
WHEN NEW.position_status = 'active'
 AND (NEW.position_jd IS NULL OR length(trim(NEW.position_jd)) < 10)
BEGIN
  SELECT RAISE(ABORT, 'position_jd_required_for_active');
END;

CREATE TRIGGER trg_position_active_requires_jd_update
BEFORE UPDATE OF position_status, position_jd ON position
FOR EACH ROW
WHEN NEW.position_status = 'active'
 AND (NEW.position_jd IS NULL OR length(trim(NEW.position_jd)) < 10)
BEGIN
  SELECT RAISE(ABORT, 'position_jd_required_for_active');
END;

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
  snapshot_sha256 TEXT NOT NULL,
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
