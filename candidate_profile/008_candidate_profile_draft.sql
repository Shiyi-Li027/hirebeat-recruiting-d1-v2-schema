-- HireBeat D1 new schema
-- Group G08: published Person/Candidate education, employment, skill,
-- project, and certification profile
-- Confirmed G08 schema, revision 1, 2026-08-17
-- Requires confirmed G01, G02, and G07 schemas.
-- G05 source row IDs are intentionally plain INTEGER lineage values.

PRAGMA foreign_keys = ON;

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
