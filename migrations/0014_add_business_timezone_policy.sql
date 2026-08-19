-- Publish the canonical storage and human-display time-zone policy.
-- Instants remain RFC 3339 UTC in D1; America/New_York is presentation/input
-- context only and must never be used to rewrite historical timestamps.

INSERT INTO system_configuration_release (
  configuration_release_key, release_version, release_status,
  release_description, created_by, created_at, updated_at
)
VALUES (
  'hirebeat-system-configuration-v3', 3, 'draft',
  'Adds canonical UTC storage and America/New_York business-display time-zone policy while preserving all v2 runtime settings.',
  'migration:0014',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT
  target.id, source.configuration_scope, source.configuration_key,
  source.configuration_value_json, source.description,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release AS target
JOIN system_configuration_release AS prior
  ON prior.configuration_release_key = 'hirebeat-system-configuration-v2'
JOIN system_configuration AS source
  ON source.configuration_release_id = prior.id
WHERE target.configuration_release_key = 'hirebeat-system-configuration-v3';

INSERT INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT
  id, 'localization', 'storage_timezone', '"UTC"',
  'Canonical time zone for persisted instants, ordering, leases, retries, deadlines, and audit history.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v3';

INSERT INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT
  id, 'localization', 'business_timezone', '"America/New_York"',
  'IANA time zone for recruiter input context and human-facing pages, reports, and inspection exports.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM system_configuration_release
WHERE configuration_release_key = 'hirebeat-system-configuration-v3';

UPDATE system_configuration_release
SET release_status = 'superseded',
    superseded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE configuration_release_key = 'hirebeat-system-configuration-v2'
  AND release_status = 'active';

UPDATE system_configuration_release
SET release_status = 'active',
    activated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    activated_by = 'migration:0014',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE configuration_release_key = 'hirebeat-system-configuration-v3'
  AND release_status = 'draft';
