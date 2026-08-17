-- HireBeat D1 new schema
-- Group G01: shared reference data and talent taxonomies
-- Confirmed 1, 2026-08-13
-- G01 design is frozen. Seed data and migrations are separate.

PRAGMA foreign_keys = ON;

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
