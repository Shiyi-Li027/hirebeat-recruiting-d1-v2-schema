-- Add versioned, non-secret runtime configuration for Ingress and Workflows.
-- This migration intentionally does not modify immutable migrations 0001/0002.
-- Secrets remain in Cloudflare Secrets and must never be inserted here.

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

CREATE UNIQUE INDEX uq_system_configuration_release_single_active
  ON system_configuration_release (release_status)
  WHERE release_status = 'active';

ALTER TABLE raw_submission_intake_run
  ADD COLUMN configuration_release_id INTEGER
    REFERENCES system_configuration_release(id) ON DELETE RESTRICT;

ALTER TABLE etl_workflow_run
  ADD COLUMN configuration_release_id INTEGER
    REFERENCES system_configuration_release(id) ON DELETE RESTRICT;

INSERT INTO system_configuration_release (
  configuration_release_key,
  release_version,
  release_status,
  release_description,
  activated_at,
  created_by,
  activated_by,
  created_at,
  updated_at
)
VALUES (
  'hirebeat-system-configuration-v1',
  1,
  'active',
  'Initial production bootstrap configuration for submission ingress, workflows, and outbox delivery.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'migration:0003',
  'migration:0003',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'submission_ingress',
  'parser_timeout_ms',
  '30000',
  'Maximum duration of one ordinary PDF-to-text parser request.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'submission_ingress',
  'active_stale_seconds',
  '300',
  'Age after which an active intake without progress can be reclaimed.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'submission_ingress',
  'max_attempts',
  '5',
  'Total Ingress processing attempts including the initial attempt.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'submission_ingress',
  'max_resume_file_size_bytes',
  '10485760',
  'Maximum accepted original Resume PDF size in bytes.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'workflow',
  'default_step_max_attempts',
  '5',
  'Default total execution attempts for retryable Workflow steps.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';

INSERT INTO system_configuration (
  configuration_release_id,
  configuration_scope,
  configuration_key,
  configuration_value_json,
  description,
  created_at
)
SELECT
  id,
  'outbox',
  'max_delivery_attempts',
  '8',
  'Maximum attempts to hand one committed Outbox event to its destination.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v1';
