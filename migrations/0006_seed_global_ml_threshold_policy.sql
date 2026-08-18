-- HireBeat D1 migration 0006
-- Freeze the confirmed production global ML threshold policy.
-- Confirmed 2026-08-18: standard band, cosine similarity threshold 0.32.

PRAGMA foreign_keys = ON;

INSERT INTO ml_threshold_policy (
  threshold_policy_uuid,
  policy_family_code,
  policy_version,
  policy_name,
  policy_band_code,
  policy_scope_type,
  match_score_threshold,
  expected_retention_ratio,
  policy_status,
  policy_config_json,
  effective_at,
  created_at,
  updated_at
)
VALUES (
  'hirebeat-threshold-global-default-v1',
  'hirebeat_threshold_global_default',
  1,
  'Global default: standard fixed similarity threshold',
  'standard',
  'global_default',
  0.32,
  0.50,
  'active',
  json_object(
    'selection_mode', 'fixed_similarity_threshold',
    'source_reference_band', 'standard',
    'threshold_decision', 'confirmed_2026_08_18',
    'not_empirical_probability', 1
  ),
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
);

PRAGMA foreign_keys = ON;
