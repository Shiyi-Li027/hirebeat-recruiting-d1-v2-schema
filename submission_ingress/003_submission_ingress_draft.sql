-- HireBeat D1 new schema
-- Group G03: submission ingress and faithful raw submission
-- Confirmed Revision 1, 2026-08-17
-- Requires confirmed G01 and G02 schemas.
-- Workflow/outbox foreign keys are intentionally deferred until G04 is confirmed.

PRAGMA foreign_keys = ON;

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
  accepted_resume_file_sha256 TEXT,
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
  ),
  CHECK (
    accepted_resume_file_sha256 IS NULL
    OR length(accepted_resume_file_sha256) = 64
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
