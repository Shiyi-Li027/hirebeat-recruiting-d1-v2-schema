-- HireBeat v2 bootstrap business configuration.
-- This migration contains no legacy-database data.
-- It seeds the confirmed 13-stage flexible pipeline and the seven published
-- threshold reference bands. The global production threshold remains absent
-- until decision D11 is explicitly confirmed.

PRAGMA defer_foreign_keys = on;

INSERT INTO hiring_pipeline (
  hiring_pipeline_uuid,
  pipeline_family_code,
  pipeline_version,
  hiring_pipeline_name,
  pipeline_description,
  pipeline_status,
  activated_at,
  created_at,
  updated_at
) VALUES (
  'hirebeat-flexible-hiring-pipeline-v1',
  'hirebeat_flexible_hiring',
  1,
  'HireBeat Flexible Hiring Pipeline',
  'Flexible Application-to-Offer pipeline with optional assessments, interviews, ML recommendation, returns, skips, and direct decisions.',
  'active',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
);

WITH pipeline AS (
  SELECT id FROM hiring_pipeline
  WHERE pipeline_family_code = 'hirebeat_flexible_hiring'
    AND pipeline_version = 1
), stages(
  stage_code, stage_name, stage_type, display_order,
  is_initial, is_terminal, is_optional, is_repeatable,
  max_business_attempts
) AS (
  VALUES
    ('application_received', 'Application received', 'application_received', 1, 1, 0, 0, 0, 1),
    ('resume_screening', 'Resume screening', 'resume_screening', 2, 0, 0, 1, 0, 1),
    ('ml_recommendation', 'ML recommendation', 'ml_recommendation', 3, 0, 0, 1, 0, 1),
    ('written_assessment_1', 'Written assessment 1', 'written_assessment', 4, 0, 0, 1, 1, NULL),
    ('written_assessment_2', 'Written assessment 2', 'written_assessment', 5, 0, 0, 1, 1, NULL),
    ('hr_interview', 'HR interview', 'interview', 6, 0, 0, 1, 1, NULL),
    ('technical_interview', 'Technical interview', 'interview', 7, 0, 0, 1, 1, NULL),
    ('final_interview', 'Final interview', 'interview', 8, 0, 0, 1, 1, NULL),
    ('offer_approval', 'Offer approval', 'offer_approval', 9, 0, 0, 1, 0, 1),
    ('offer_process', 'Offer process', 'offer_process', 10, 0, 0, 1, 0, 1),
    ('hired', 'Hired', 'hired', 11, 0, 1, 1, 0, 1),
    ('rejected', 'Rejected', 'rejected', 12, 0, 1, 1, 0, 1),
    ('withdrawn', 'Withdrawn', 'withdrawn', 13, 0, 1, 1, 0, 1)
)
INSERT INTO pipeline_stage (
  pipeline_stage_uuid,
  hiring_pipeline_id,
  stage_code,
  pipeline_stage_name,
  stage_type,
  default_display_order,
  is_initial,
  is_terminal,
  is_optional,
  is_repeatable,
  max_business_attempts,
  stage_config_json,
  created_at,
  updated_at
)
SELECT
  'hirebeat-flexible-v1-stage-' || stage_code,
  pipeline.id,
  stage_code,
  stage_name,
  stage_type,
  display_order,
  is_initial,
  is_terminal,
  is_optional,
  is_repeatable,
  max_business_attempts,
  '{}',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
FROM stages CROSS JOIN pipeline;

WITH pipeline AS (
  SELECT id FROM hiring_pipeline
  WHERE pipeline_family_code = 'hirebeat_flexible_hiring'
    AND pipeline_version = 1
), edge(from_code, to_code, category, condition_json) AS (
  VALUES
    ('application_received', 'resume_screening', 'forward', '{}'),
    ('resume_screening', 'ml_recommendation', 'forward', '{}'),
    ('ml_recommendation', 'written_assessment_1', 'forward', '{"outcome":"continue"}'),
    ('written_assessment_1', 'written_assessment_2', 'forward', '{}'),
    ('written_assessment_2', 'hr_interview', 'forward', '{}'),
    ('hr_interview', 'technical_interview', 'forward', '{}'),
    ('technical_interview', 'final_interview', 'forward', '{}'),
    ('final_interview', 'offer_approval', 'forward', '{"outcome":"recommend_offer"}'),
    ('offer_approval', 'offer_process', 'forward', '{"outcome":"approved"}'),
    ('offer_process', 'hired', 'forward', '{"outcome":"accepted"}'),

    ('application_received', 'ml_recommendation', 'skip_forward', '{}'),
    ('application_received', 'written_assessment_1', 'skip_forward', '{}'),
    ('application_received', 'hr_interview', 'skip_forward', '{}'),
    ('application_received', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('resume_screening', 'written_assessment_1', 'skip_forward', '{}'),
    ('resume_screening', 'hr_interview', 'skip_forward', '{}'),
    ('resume_screening', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('ml_recommendation', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('written_assessment_1', 'hr_interview', 'skip_forward', '{}'),
    ('written_assessment_1', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('written_assessment_2', 'technical_interview', 'skip_forward', '{}'),
    ('written_assessment_2', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('hr_interview', 'final_interview', 'skip_forward', '{}'),
    ('hr_interview', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('technical_interview', 'offer_process', 'skip_forward', '{"decision":"offer"}'),
    ('final_interview', 'offer_process', 'skip_forward', '{"decision":"offer"}'),

    ('hr_interview', 'resume_screening', 'return', '{}'),
    ('hr_interview', 'ml_recommendation', 'return', '{}'),
    ('hr_interview', 'written_assessment_1', 'return', '{}'),
    ('hr_interview', 'written_assessment_2', 'return', '{}'),
    ('technical_interview', 'resume_screening', 'return', '{}'),
    ('technical_interview', 'ml_recommendation', 'return', '{}'),
    ('technical_interview', 'written_assessment_1', 'return', '{}'),
    ('technical_interview', 'written_assessment_2', 'return', '{}'),
    ('technical_interview', 'hr_interview', 'return', '{}'),
    ('final_interview', 'resume_screening', 'return', '{}'),
    ('final_interview', 'ml_recommendation', 'return', '{}'),
    ('final_interview', 'written_assessment_1', 'return', '{}'),
    ('final_interview', 'written_assessment_2', 'return', '{}'),
    ('final_interview', 'hr_interview', 'return', '{}'),
    ('final_interview', 'technical_interview', 'return', '{}'),

    ('application_received', 'rejected', 'direct_terminal', '{}'),
    ('application_received', 'withdrawn', 'direct_terminal', '{}'),
    ('resume_screening', 'rejected', 'direct_terminal', '{}'),
    ('resume_screening', 'withdrawn', 'direct_terminal', '{}'),
    ('ml_recommendation', 'rejected', 'direct_terminal', '{"decision":"no_offer"}'),
    ('ml_recommendation', 'withdrawn', 'direct_terminal', '{}'),
    ('written_assessment_1', 'rejected', 'direct_terminal', '{}'),
    ('written_assessment_1', 'withdrawn', 'direct_terminal', '{}'),
    ('written_assessment_2', 'rejected', 'direct_terminal', '{}'),
    ('written_assessment_2', 'withdrawn', 'direct_terminal', '{}'),
    ('hr_interview', 'rejected', 'direct_terminal', '{}'),
    ('hr_interview', 'withdrawn', 'direct_terminal', '{}'),
    ('technical_interview', 'rejected', 'direct_terminal', '{}'),
    ('technical_interview', 'withdrawn', 'direct_terminal', '{}'),
    ('final_interview', 'rejected', 'direct_terminal', '{"outcome":"no_offer"}'),
    ('final_interview', 'withdrawn', 'direct_terminal', '{}'),
    ('offer_approval', 'rejected', 'direct_terminal', '{"outcome":"rejected"}'),
    ('offer_approval', 'withdrawn', 'direct_terminal', '{}'),
    ('offer_process', 'rejected', 'direct_terminal', '{}'),
    ('offer_process', 'withdrawn', 'direct_terminal', '{}')
)
INSERT INTO pipeline_stage_transition (
  pipeline_stage_transition_uuid,
  hiring_pipeline_id,
  from_stage_id,
  to_stage_id,
  transition_category,
  transition_condition_json,
  is_allowed,
  created_at,
  updated_at
)
SELECT
  'hirebeat-flexible-v1-edge-' || edge.from_code || '-to-' || edge.to_code,
  pipeline.id,
  source_stage.id,
  target_stage.id,
  edge.category,
  edge.condition_json,
  1,
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
FROM edge
CROSS JOIN pipeline
JOIN pipeline_stage AS source_stage
  ON source_stage.hiring_pipeline_id = pipeline.id
 AND source_stage.stage_code = edge.from_code
JOIN pipeline_stage AS target_stage
  ON target_stage.hiring_pipeline_id = pipeline.id
 AND target_stage.stage_code = edge.to_code;

WITH band(code, name, threshold, retention_ratio) AS (
  VALUES
    ('very_loose', 'Very loose (approximately top 70%)', 0.24, 0.70),
    ('loose', 'Loose (approximately top 60%)', 0.28, 0.60),
    ('standard', 'Standard (approximately top 50%)', 0.32, 0.50),
    ('moderate', 'Moderate (approximately top 40%)', 0.35, 0.40),
    ('strict', 'Strict (approximately top 30%)', 0.38, 0.30),
    ('very_strict', 'Very strict (approximately top 20%)', 0.42, 0.20),
    ('highly_selective', 'Highly selective (approximately top 10%)', 0.47, 0.10)
)
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
SELECT
  'hirebeat-threshold-reference-' || code || '-v1',
  'hirebeat_threshold_reference_' || code,
  1,
  name,
  code,
  'reference_band',
  threshold,
  retention_ratio,
  'active',
  json_object(
    'selection_mode', 'fixed_similarity_threshold',
    'mapping_purpose', 'publisher_reference',
    'not_empirical_probability', 1
  ),
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z',
  '2026-08-18T00:00:00Z'
FROM band;

PRAGMA defer_foreign_keys = off;
