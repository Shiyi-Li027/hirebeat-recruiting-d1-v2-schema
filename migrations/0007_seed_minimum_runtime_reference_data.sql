-- Minimum runtime reference rows required by Workflow A/B.
-- Catalog business rows (Company/Position/Company Work Mode) are intentionally
-- not seeded here and must enter through the authenticated Catalog command API.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO contact_type (
  contact_type_code, contact_type_name, is_active, created_at, updated_at
) VALUES
  ('email', 'Email', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('phone', 'Phone', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO work_mode (
  work_mode_code, work_mode_name, is_active, created_at, updated_at
) VALUES
  ('onsite', 'On-site', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('hybrid', 'Hybrid', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('remote', 'Remote', 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO degree (
  degree_code, degree_name, degree_level_rank, is_active, created_at, updated_at
) VALUES
  ('high_school', 'High School', 1, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('associate', 'Associate Degree', 2, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('bachelor', 'Bachelor Degree', 3, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('master', 'Master Degree', 4, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'),
  ('doctorate', 'Doctorate', 5, 1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z');

INSERT OR IGNORE INTO system_configuration (
  configuration_release_id, configuration_scope, configuration_key,
  configuration_value_json, description, created_at
)
SELECT id, 'ml_inference', 'request_timeout_ms', '30000',
       'Maximum duration of one all-MiniLM-L6-v2 similarity request.',
       '2026-08-18T00:00:00Z'
FROM system_configuration_release
WHERE configuration_release_key='hirebeat-system-configuration-v1';

PRAGMA foreign_keys = ON;
