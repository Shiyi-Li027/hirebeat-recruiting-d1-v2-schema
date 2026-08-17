-- HireBeat D1 destructive application-table cleanup script
-- Generated: 2026-08-17
-- WARNING: permanently drops all 82 HireBeat application tables and their data.
-- This intentionally does NOT drop Cloudflare/SQLite internal tables or d1_migrations.
-- Never add this file to migrations/ or an automatic GitHub Actions workflow.
-- Prefer deleting/recreating a disposable D1 database for a completely clean reset.

PRAGMA defer_foreign_keys = on;

DROP TABLE IF EXISTS "offer_status_history";
DROP TABLE IF EXISTS "offer_version";
DROP TABLE IF EXISTS "offer";
DROP TABLE IF EXISTS "application_stage_transition_event";
DROP TABLE IF EXISTS "application_stage_run";
DROP TABLE IF EXISTS "pipeline_stage_transition";
DROP TABLE IF EXISTS "pipeline_stage";
DROP TABLE IF EXISTS "hiring_pipeline";
DROP TABLE IF EXISTS "ml_recommendation_result";
DROP TABLE IF EXISTS "ml_similarity_result";
DROP TABLE IF EXISTS "ml_anomaly_result";
DROP TABLE IF EXISTS "ml_analysis_run";
DROP TABLE IF EXISTS "ml_threshold_policy";
DROP TABLE IF EXISTS "candidate_certification";
DROP TABLE IF EXISTS "person_certification";
DROP TABLE IF EXISTS "candidate_project";
DROP TABLE IF EXISTS "person_project";
DROP TABLE IF EXISTS "candidate_skill";
DROP TABLE IF EXISTS "person_skill";
DROP TABLE IF EXISTS "candidate_position";
DROP TABLE IF EXISTS "person_position";
DROP TABLE IF EXISTS "candidate_education";
DROP TABLE IF EXISTS "person_education";
DROP TABLE IF EXISTS "education";
DROP TABLE IF EXISTS "person_link";
DROP TABLE IF EXISTS "person_contact";
DROP TABLE IF EXISTS "person_name";
DROP TABLE IF EXISTS "application_source_lineage";
DROP TABLE IF EXISTS "candidate_snapshot";
DROP TABLE IF EXISTS "application";
DROP TABLE IF EXISTS "person";
DROP TABLE IF EXISTS "submission_match_evidence";
DROP TABLE IF EXISTS "submission_dedup_match";
DROP TABLE IF EXISTS "submission_dedup_run";
DROP TABLE IF EXISTS "submission_identity_feature";
DROP TABLE IF EXISTS "resume_project";
DROP TABLE IF EXISTS "resume_skill";
DROP TABLE IF EXISTS "resume_employment";
DROP TABLE IF EXISTS "resume_education";
DROP TABLE IF EXISTS "resume_extraction";
DROP TABLE IF EXISTS "submission_normalized";
DROP TABLE IF EXISTS "normalization_run";
DROP TABLE IF EXISTS "audit_event";
DROP TABLE IF EXISTS "outbox_event";
DROP TABLE IF EXISTS "etl_step_attempt";
DROP TABLE IF EXISTS "etl_step_run";
DROP TABLE IF EXISTS "etl_workflow_run";
DROP TABLE IF EXISTS "raw_submission_resume";
DROP TABLE IF EXISTS "raw_submission";
DROP TABLE IF EXISTS "raw_submission_intake_run";
DROP TABLE IF EXISTS "catalog_sync_target_run";
DROP TABLE IF EXISTS "catalog_sync_run";
DROP TABLE IF EXISTS "catalog_revision";
DROP TABLE IF EXISTS "position_certification_requirement";
DROP TABLE IF EXISTS "position_education_requirement";
DROP TABLE IF EXISTS "position_skill";
DROP TABLE IF EXISTS "position_salary_range";
DROP TABLE IF EXISTS "position";
DROP TABLE IF EXISTS "company_work_mode";
DROP TABLE IF EXISTS "company_contact_info";
DROP TABLE IF EXISTS "company";
DROP TABLE IF EXISTS "position_occupational_type";
DROP TABLE IF EXISTS "position_employment_type";
DROP TABLE IF EXISTS "work_mode";
DROP TABLE IF EXISTS "school";
DROP TABLE IF EXISTS "major";
DROP TABLE IF EXISTS "field_study";
DROP TABLE IF EXISTS "degree";
DROP TABLE IF EXISTS "location";
DROP TABLE IF EXISTS "city";
DROP TABLE IF EXISTS "state";
DROP TABLE IF EXISTS "country";
DROP TABLE IF EXISTS "certification";
DROP TABLE IF EXISTS "issuing_organization";
DROP TABLE IF EXISTS "certification_type";
DROP TABLE IF EXISTS "skill_proficiency_level";
DROP TABLE IF EXISTS "skill_type_assignment";
DROP TABLE IF EXISTS "skill";
DROP TABLE IF EXISTS "skill_type";
DROP TABLE IF EXISTS "contact_type";
DROP TABLE IF EXISTS "seniority";
DROP TABLE IF EXISTS "function";

PRAGMA defer_foreign_keys = off;
