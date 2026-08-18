-- HireBeat D1 canonical manual INSERT templates
-- Generated from the fully migrated schema. Review values before execution.
-- These templates intentionally do not guess identities, parent IDs, evidence, or timestamps.
-- Prefer the protected production importers. Manual SQL is a privileged repair/admin path.
-- :column_name tokens are review placeholders, not literal values; bind or replace every token safely.
-- Each template is the minimum insert shape. Add reviewed nullable columns only when real values exist.

-- ============================================================
-- G01 certification
-- Nullable optional columns: certification_type_id, issuing_organization_id, certification_url, typical_validity_months
-- Schema defaults when omitted: is_active=1
INSERT INTO "certification" (
  "certification_uuid",
  "certification_name",
  "normalized_certification_name",
  "created_at",
  "updated_at"
) VALUES (
  :certification_uuid,
  :certification_name,
  :normalized_certification_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 certification_type
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "certification_type" (
  "certification_type_code",
  "certification_type_name",
  "created_at",
  "updated_at"
) VALUES (
  :certification_type_code,
  :certification_type_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 city
-- Nullable optional columns: state_id
-- Schema defaults when omitted: is_active=1
INSERT INTO "city" (
  "city_uuid",
  "country_id",
  "city_name",
  "normalized_city_name",
  "created_at",
  "updated_at"
) VALUES (
  :city_uuid,
  :country_id,
  :city_name,
  :normalized_city_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 contact_type
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "contact_type" (
  "contact_type_code",
  "contact_type_name",
  "created_at",
  "updated_at"
) VALUES (
  :contact_type_code,
  :contact_type_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 country
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "country" (
  "country_code",
  "country_name",
  "created_at",
  "updated_at"
) VALUES (
  :country_code,
  :country_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 degree
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "degree" (
  "degree_code",
  "degree_name",
  "degree_level_rank",
  "created_at",
  "updated_at"
) VALUES (
  :degree_code,
  :degree_name,
  :degree_level_rank,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 field_study
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "field_study" (
  "field_study_uuid",
  "field_study_name",
  "normalized_field_study_name",
  "created_at",
  "updated_at"
) VALUES (
  :field_study_uuid,
  :field_study_name,
  :normalized_field_study_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 function
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "function" (
  "function_code",
  "function_name",
  "normalized_function_name",
  "created_at",
  "updated_at"
) VALUES (
  :function_code,
  :function_name,
  :normalized_function_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 issuing_organization
-- Nullable optional columns: organization_url
-- Schema defaults when omitted: is_active=1
INSERT INTO "issuing_organization" (
  "issuing_organization_uuid",
  "organization_name",
  "normalized_organization_name",
  "created_at",
  "updated_at"
) VALUES (
  :issuing_organization_uuid,
  :organization_name,
  :normalized_organization_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 location
-- Nullable optional columns: country_id, state_id, city_id, postal_code, location_name
-- Schema defaults when omitted: none
INSERT INTO "location" (
  "location_uuid",
  "created_at",
  "updated_at"
) VALUES (
  :location_uuid,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 major
-- Nullable optional columns: field_study_id, is_stem
-- Schema defaults when omitted: is_active=1
INSERT INTO "major" (
  "major_uuid",
  "major_name",
  "normalized_major_name",
  "created_at",
  "updated_at"
) VALUES (
  :major_uuid,
  :major_name,
  :normalized_major_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 position_employment_type
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_employment_type" (
  "employment_type_code",
  "employment_type_name",
  "created_at",
  "updated_at"
) VALUES (
  :employment_type_code,
  :employment_type_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 position_occupational_type
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_occupational_type" (
  "occupational_code",
  "occupational_type_name",
  "created_at",
  "updated_at"
) VALUES (
  :occupational_code,
  :occupational_type_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 school
-- Nullable optional columns: school_url, school_type, school_category
-- Schema defaults when omitted: is_active=1
INSERT INTO "school" (
  "school_uuid",
  "school_name",
  "normalized_school_name",
  "created_at",
  "updated_at"
) VALUES (
  :school_uuid,
  :school_name,
  :normalized_school_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 seniority
-- Nullable optional columns: seniority_rank, typical_experience_months_min, typical_experience_months_max
-- Schema defaults when omitted: is_active=1
INSERT INTO "seniority" (
  "seniority_code",
  "seniority_name",
  "created_at",
  "updated_at"
) VALUES (
  :seniority_code,
  :seniority_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 skill
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "skill" (
  "skill_uuid",
  "skill_name",
  "normalized_skill_name",
  "created_at",
  "updated_at"
) VALUES (
  :skill_uuid,
  :skill_name,
  :normalized_skill_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 skill_proficiency_level
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "skill_proficiency_level" (
  "proficiency_level_code",
  "proficiency_level_name",
  "proficiency_level_rank",
  "created_at",
  "updated_at"
) VALUES (
  :proficiency_level_code,
  :proficiency_level_name,
  :proficiency_level_rank,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 skill_type
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "skill_type" (
  "skill_type_code",
  "skill_type_name",
  "created_at",
  "updated_at"
) VALUES (
  :skill_type_code,
  :skill_type_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 skill_type_assignment
-- Nullable optional columns: none
-- Schema defaults when omitted: none
INSERT INTO "skill_type_assignment" (
  "skill_id",
  "skill_type_id",
  "created_at"
) VALUES (
  :skill_id,
  :skill_type_id,
  :created_at
);

-- ============================================================
-- G01 state
-- Nullable optional columns: state_code
-- Schema defaults when omitted: is_active=1
INSERT INTO "state" (
  "country_id",
  "state_name",
  "normalized_state_name",
  "created_at",
  "updated_at"
) VALUES (
  :country_id,
  :state_name,
  :normalized_state_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G01 work_mode
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "work_mode" (
  "work_mode_code",
  "work_mode_name",
  "created_at",
  "updated_at"
) VALUES (
  :work_mode_code,
  :work_mode_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 catalog_revision
-- Nullable optional columns: change_reason, created_by_actor
-- Schema defaults when omitted: none
INSERT INTO "catalog_revision" (
  "catalog_revision_uuid",
  "revision_number",
  "catalog_snapshot_json",
  "snapshot_sha256",
  "created_at"
) VALUES (
  :catalog_revision_uuid,
  :revision_number,
  :catalog_snapshot_json,
  :snapshot_sha256,
  :created_at
);

-- ============================================================
-- G02 catalog_sync_run
-- Nullable optional columns: triggering_outbox_event_id, started_at, completed_at
-- Schema defaults when omitted: sync_status=pending, expected_target_count=0, succeeded_target_count=0, failed_target_count=0
INSERT INTO "catalog_sync_run" (
  "catalog_sync_run_uuid",
  "catalog_revision_id",
  "idempotency_key",
  "created_at",
  "updated_at"
) VALUES (
  :catalog_sync_run_uuid,
  :catalog_revision_id,
  :idempotency_key,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 catalog_sync_target_run
-- Nullable optional columns: external_revision_key, last_error_code, last_error_detail, next_attempt_at, started_at, completed_at
-- Schema defaults when omitted: target_status=pending, attempt_count=0
INSERT INTO "catalog_sync_target_run" (
  "catalog_sync_run_id",
  "target_type",
  "target_key",
  "created_at",
  "updated_at"
) VALUES (
  :catalog_sync_run_id,
  :target_type,
  :target_key,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 company
-- Nullable optional columns: company_website_url, company_linkedin_url, company_description, default_max_submission_attempts
-- Schema defaults when omitted: is_active=1, default_max_submission_attempts=5
INSERT INTO "company" (
  "company_uuid",
  "company_name",
  "normalized_company_name",
  "created_at",
  "updated_at"
) VALUES (
  :company_uuid,
  :company_name,
  :normalized_company_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 company_contact_info
-- Nullable optional columns: contact_type_id, contact_name, contact_position_title, priority_rank
-- Schema defaults when omitted: is_primary=0, is_active=1
INSERT INTO "company_contact_info" (
  "company_id",
  "contact_value",
  "created_at",
  "updated_at"
) VALUES (
  :company_id,
  :contact_value,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 company_work_mode
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "company_work_mode" (
  "company_id",
  "work_mode_id",
  "created_at",
  "updated_at"
) VALUES (
  :company_id,
  :work_mode_id,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 position
-- Nullable optional columns: position_jd, occupational_type_id, employment_type_id, function_id, seniority_id, location_id, work_duration, openings_count, posted_date, offers_relocation_assistance, local_candidates_only
-- Schema defaults when omitted: position_status=draft
INSERT INTO "position" (
  "position_uuid",
  "company_id",
  "position_name",
  "normalized_position_name",
  "created_at",
  "updated_at",
  "position_jd",
  "position_status"
) VALUES (
  :position_uuid,
  :company_id,
  :position_name,
  :normalized_position_name,
  :created_at,
  :updated_at,
  :position_jd,
  CASE WHEN :position_status IS NOT NULL THEN :position_status WHEN length(trim(COALESCE(:position_jd, ''))) >= 10 THEN 'active' ELSE 'draft' END
);

-- ============================================================
-- G02 position_certification_requirement
-- Nullable optional columns: none
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_certification_requirement" (
  "position_id",
  "certification_id",
  "requirement_type",
  "created_at",
  "updated_at"
) VALUES (
  :position_id,
  :certification_id,
  :requirement_type,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 position_education_requirement
-- Nullable optional columns: field_study_id
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_education_requirement" (
  "position_id",
  "degree_id",
  "requirement_type",
  "created_at",
  "updated_at"
) VALUES (
  :position_id,
  :degree_id,
  :requirement_type,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 position_salary_range
-- Nullable optional columns: salary_min_cents, salary_max_cents
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_salary_range" (
  "position_id",
  "currency_code",
  "salary_period",
  "created_at",
  "updated_at"
) VALUES (
  :position_id,
  :currency_code,
  :salary_period,
  :created_at,
  :updated_at
);

-- ============================================================
-- G02 position_skill
-- Nullable optional columns: minimum_proficiency_level_id, onet_importance_score, onet_dependence_score, onet_preparation_score
-- Schema defaults when omitted: is_active=1
INSERT INTO "position_skill" (
  "position_id",
  "skill_id",
  "requirement_type",
  "created_at",
  "updated_at"
) VALUES (
  :position_id,
  :skill_id,
  :requirement_type,
  :created_at,
  :updated_at
);

-- ============================================================
-- G03 raw_submission
-- Nullable optional columns: source_schema_version, submitted_catalog_revision_id, submitted_company_id, submitted_company_name, submitted_company_work_mode_id, submitted_company_work_mode_name, submitted_position_id, submitted_position_name, raw_person_name, raw_email_address, raw_phone, raw_start_working_date, raw_end_working_date, raw_work_duration, source_submitted_at, retention_until, purged_at
-- Schema defaults when omitted: none
INSERT INTO "raw_submission" (
  "raw_submission_intake_run_id",
  "submission_uuid",
  "source_system",
  "source_record_id",
  "source_event_key",
  "payload_hmac",
  "payload_hmac_key_version",
  "landed_at",
  "updated_at"
) VALUES (
  :raw_submission_intake_run_id,
  :submission_uuid,
  :source_system,
  :source_record_id,
  :source_event_key,
  :payload_hmac,
  :payload_hmac_key_version,
  :landed_at,
  :updated_at
);

-- ============================================================
-- G03 raw_submission_intake_run
-- Nullable optional columns: source_schema_version, accepted_payload_hmac, last_received_payload_hmac, payload_hmac_key_version, last_technical_redelivery_mechanism, last_technical_redelivery_cause_code, last_technical_redelivery_at, last_error_code, last_error_detail, last_attempt_started_at, completed_at, configuration_release_id, accepted_resume_file_sha256
-- Schema defaults when omitted: intake_status=received, attempt_count=0, technical_redelivery_count=0, payload_conflict_count=0
INSERT INTO "raw_submission_intake_run" (
  "intake_run_uuid",
  "submission_uuid",
  "source_system",
  "source_record_id",
  "source_event_key",
  "first_received_at",
  "last_received_at",
  "created_at",
  "updated_at"
) VALUES (
  :intake_run_uuid,
  :submission_uuid,
  :source_system,
  :source_record_id,
  :source_event_key,
  :first_received_at,
  :last_received_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G03 raw_submission_resume
-- Nullable optional columns: resume_text, resume_text_origin, resume_parser_version, resume_text_sha256, resume_parsed_at, resume_original_file_name, resume_source_url, resume_source_file_id, resume_mime_type, resume_file_size_bytes, resume_r2_object_key, resume_file_sha256
-- Schema defaults when omitted: none
INSERT INTO "raw_submission_resume" (
  "raw_submission_id",
  "resume_text_status",
  "created_at",
  "updated_at"
) VALUES (
  :raw_submission_id,
  :resume_text_status,
  :created_at,
  :updated_at
);

-- ============================================================
-- G04 audit_event
-- Nullable optional columns: actor_id, workflow_run_id, correlation_key, reason_code, event_metadata_json
-- Schema defaults when omitted: none
INSERT INTO "audit_event" (
  "event_uuid",
  "event_type",
  "entity_type",
  "entity_id",
  "actor_type",
  "event_summary",
  "occurred_at",
  "recorded_at"
) VALUES (
  :event_uuid,
  :event_type,
  :entity_type,
  :entity_id,
  :actor_type,
  :event_summary,
  :occurred_at,
  :recorded_at
);

-- ============================================================
-- G04 etl_step_attempt
-- Nullable optional columns: worker_execution_id, error_class, error_code, error_detail, retry_scheduled_at, finished_at, duration_ms
-- Schema defaults when omitted: attempt_kind=execute, attempt_status=running
INSERT INTO "etl_step_attempt" (
  "step_run_id",
  "attempt_uuid",
  "attempt_number",
  "started_at",
  "created_at"
) VALUES (
  :step_run_id,
  :attempt_uuid,
  :attempt_number,
  :started_at,
  :created_at
);

-- ============================================================
-- G04 etl_step_run
-- Nullable optional columns: next_retry_at, last_error_code, last_error_detail, started_at, completed_at
-- Schema defaults when omitted: is_required=1, step_status=pending, attempt_count=0
INSERT INTO "etl_step_run" (
  "workflow_run_id",
  "step_key",
  "step_name",
  "step_version",
  "idempotency_key",
  "max_attempts",
  "created_at",
  "updated_at"
) VALUES (
  :workflow_run_id,
  :step_key,
  :step_name,
  :step_version,
  :idempotency_key,
  :max_attempts,
  :created_at,
  :updated_at
);

-- ============================================================
-- G04 etl_workflow_run
-- Nullable optional columns: cloudflare_instance_id, parent_workflow_run_id, raw_submission_id, application_id, subject_fence_token, current_step_key, last_error_code, last_error_detail, cancellation_reason_code, started_at, last_progressed_at, completed_at, configuration_release_id
-- Schema defaults when omitted: workflow_status=requested, run_attempt_count=0
INSERT INTO "etl_workflow_run" (
  "workflow_run_uuid",
  "workflow_type",
  "workflow_version",
  "idempotency_key",
  "trigger_outbox_event_id",
  "requested_at",
  "created_at",
  "updated_at"
) VALUES (
  :workflow_run_uuid,
  :workflow_type,
  :workflow_version,
  :idempotency_key,
  :trigger_outbox_event_id,
  :requested_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G04 outbox_event
-- Nullable optional columns: destination_key, producer_workflow_run_id, producer_step_run_id, next_attempt_at, lease_owner, lease_expires_at, last_error_code, last_error_detail, published_at
-- Schema defaults when omitted: event_payload_json={}, dispatch_status=pending, delivery_attempt_count=0
INSERT INTO "outbox_event" (
  "event_uuid",
  "deduplication_key",
  "event_type",
  "event_schema_version",
  "aggregate_type",
  "aggregate_id",
  "destination_type",
  "max_delivery_attempts",
  "available_at",
  "created_at",
  "updated_at"
) VALUES (
  :event_uuid,
  :deduplication_key,
  :event_type,
  :event_schema_version,
  :aggregate_type,
  :aggregate_id,
  :destination_type,
  :max_delivery_attempts,
  :available_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G04 system_configuration
-- Nullable optional columns: description
-- Schema defaults when omitted: none
INSERT INTO "system_configuration" (
  "configuration_release_id",
  "configuration_scope",
  "configuration_key",
  "configuration_value_json",
  "created_at"
) VALUES (
  :configuration_release_id,
  :configuration_scope,
  :configuration_key,
  :configuration_value_json,
  :created_at
);

-- ============================================================
-- G04 system_configuration_release
-- Nullable optional columns: release_description, activated_at, superseded_at, created_by, activated_by
-- Schema defaults when omitted: release_status=draft
INSERT INTO "system_configuration_release" (
  "configuration_release_key",
  "release_version",
  "created_at",
  "updated_at"
) VALUES (
  :configuration_release_key,
  :release_version,
  :created_at,
  :updated_at
);

-- ============================================================
-- G05 normalization_run
-- Nullable optional columns: warnings_json, last_error_code, last_error_detail, completed_at
-- Schema defaults when omitted: normalization_status=running, warning_count=0
INSERT INTO "normalization_run" (
  "normalization_run_uuid",
  "raw_submission_id",
  "workflow_run_id",
  "step_run_id",
  "normalization_version",
  "idempotency_key",
  "started_at",
  "created_at",
  "updated_at"
) VALUES (
  :normalization_run_uuid,
  :raw_submission_id,
  :workflow_run_id,
  :step_run_id,
  :normalization_version,
  :idempotency_key,
  :started_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G05 resume_education
-- Nullable optional columns: raw_education_text, raw_school_name, normalized_school_name, school_id, raw_degree_name, normalized_degree_name, degree_id, raw_field_study_name, normalized_field_study_name, field_study_id, raw_major_name, normalized_major_name, major_id, gpa, education_start_date, education_end_date, is_current, rejection_reason_detail
-- Schema defaults when omitted: none
INSERT INTO "resume_education" (
  "resume_extraction_id",
  "source_entry_order",
  "extraction_eligibility_status",
  "created_at"
) VALUES (
  :resume_extraction_id,
  :source_entry_order,
  :extraction_eligibility_status,
  :created_at
);

-- ============================================================
-- G05 resume_employment
-- Nullable optional columns: raw_employment_text, raw_company_name, normalized_company_name, raw_position_name, normalized_position_name, employment_description, employment_start_date, employment_end_date, is_current, rejection_reason_detail
-- Schema defaults when omitted: none
INSERT INTO "resume_employment" (
  "resume_extraction_id",
  "source_entry_order",
  "extraction_eligibility_status",
  "created_at"
) VALUES (
  :resume_extraction_id,
  :source_entry_order,
  :extraction_eligibility_status,
  :created_at
);

-- ============================================================
-- G05 resume_extraction
-- Nullable optional columns: warnings_json, last_error_code, last_error_detail, completed_at
-- Schema defaults when omitted: extraction_status=running, identity_record_count=0, education_record_count=0, employment_record_count=0, skill_record_count=0, project_record_count=0, warning_count=0
INSERT INTO "resume_extraction" (
  "resume_extraction_uuid",
  "submission_normalized_id",
  "raw_submission_resume_id",
  "workflow_run_id",
  "step_run_id",
  "extraction_version",
  "idempotency_key",
  "input_resume_text_sha256",
  "started_at",
  "created_at",
  "updated_at"
) VALUES (
  :resume_extraction_uuid,
  :submission_normalized_id,
  :raw_submission_resume_id,
  :workflow_run_id,
  :step_run_id,
  :extraction_version,
  :idempotency_key,
  :input_resume_text_sha256,
  :started_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G05 resume_project
-- Nullable optional columns: raw_project_text, raw_project_name, normalized_project_name, project_description, project_start_date, project_end_date, project_url, rejection_reason_detail
-- Schema defaults when omitted: none
INSERT INTO "resume_project" (
  "resume_extraction_id",
  "source_entry_order",
  "extraction_eligibility_status",
  "created_at"
) VALUES (
  :resume_extraction_id,
  :source_entry_order,
  :extraction_eligibility_status,
  :created_at
);

-- ============================================================
-- G05 resume_skill
-- Nullable optional columns: normalized_skill_name, skill_id, matched_context_text, rejection_reason_detail
-- Schema defaults when omitted: none
INSERT INTO "resume_skill" (
  "resume_extraction_id",
  "source_entry_order",
  "raw_skill_text",
  "match_method",
  "extraction_eligibility_status",
  "created_at"
) VALUES (
  :resume_extraction_id,
  :source_entry_order,
  :raw_skill_text,
  :match_method,
  :extraction_eligibility_status,
  :created_at
);

-- ============================================================
-- G05 submission_identity_feature
-- Nullable optional columns: resume_extraction_id, account_handle
-- Schema defaults when omitted: is_primary_candidate=0
INSERT INTO "submission_identity_feature" (
  "submission_normalized_id",
  "feature_type",
  "feature_source",
  "normalized_value",
  "normalized_value_hmac",
  "hmac_key_version",
  "selection_status",
  "created_at"
) VALUES (
  :submission_normalized_id,
  :feature_type,
  :feature_source,
  :normalized_value,
  :normalized_value_hmac,
  :hmac_key_version,
  :selection_status,
  :created_at
);

-- ============================================================
-- G05 submission_normalized
-- Nullable optional columns: company_work_mode_id, normalized_person_name, normalized_first_name, normalized_middle_name, normalized_last_name, normalized_email_address, normalized_phone, requested_start_date, requested_end_date, requested_start_year_month, work_duration
-- Schema defaults when omitted: none
INSERT INTO "submission_normalized" (
  "submission_normalized_uuid",
  "raw_submission_id",
  "normalization_run_id",
  "normalization_version",
  "company_id",
  "position_id",
  "normalized_at",
  "created_at"
) VALUES (
  :submission_normalized_uuid,
  :raw_submission_id,
  :normalization_run_id,
  :normalization_version,
  :company_id,
  :position_id,
  :normalized_at,
  :created_at
);

-- ============================================================
-- G06 submission_dedup_match
-- Nullable optional columns: none
-- Schema defaults when omitted: is_selected_prior_submission=0, strong_evidence_count=0, resume_identity_evidence_count=0
INSERT INTO "submission_dedup_match" (
  "dedup_match_uuid",
  "dedup_run_id",
  "target_submission_normalized_id",
  "matched_submission_normalized_id",
  "primary_match_rule",
  "total_evidence_count",
  "has_strong_identity_match",
  "has_resume_identity_match",
  "final_match_score",
  "matched_at",
  "created_at"
) VALUES (
  :dedup_match_uuid,
  :dedup_run_id,
  :target_submission_normalized_id,
  :matched_submission_normalized_id,
  :primary_match_rule,
  :total_evidence_count,
  :has_strong_identity_match,
  :has_resume_identity_match,
  :final_match_score,
  :matched_at,
  :created_at
);

-- ============================================================
-- G06 submission_dedup_run
-- Nullable optional columns: dedup_requested_start_year_month, dedup_group_key, dedup_decision, decision_reason_code, selected_prior_submission_normalized_id, canonical_submission_normalized_id, identity_component_key, submission_attempt_number, max_submission_attempts_snapshot, has_strong_identity_match, has_resume_identity_match, final_match_score, last_error_code, last_error_detail, completed_at
-- Schema defaults when omitted: run_status=running, application_entry_decision=pending, scope_submission_count=0, evaluated_pair_count=0, matched_pair_count=0
INSERT INTO "submission_dedup_run" (
  "dedup_run_uuid",
  "target_submission_normalized_id",
  "workflow_run_id",
  "step_run_id",
  "dedup_rule_version",
  "idempotency_key",
  "dedup_company_id",
  "dedup_position_id",
  "rule_config_json",
  "started_at",
  "created_at",
  "updated_at"
) VALUES (
  :dedup_run_uuid,
  :target_submission_normalized_id,
  :workflow_run_id,
  :step_run_id,
  :dedup_rule_version,
  :idempotency_key,
  :dedup_company_id,
  :dedup_position_id,
  :rule_config_json,
  :started_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G06 submission_match_evidence
-- Nullable optional columns: github_last_name_match, matched_normalized_last_name_hmac, evidence_metadata_json
-- Schema defaults when omitted: is_primary_rule=0, evidence_score=1.0
INSERT INTO "submission_match_evidence" (
  "evidence_uuid",
  "dedup_match_id",
  "evidence_type",
  "evidence_strength",
  "target_identity_feature_id",
  "matched_identity_feature_id",
  "matched_value_hmac",
  "hmac_key_version",
  "created_at"
) VALUES (
  :evidence_uuid,
  :dedup_match_id,
  :evidence_type,
  :evidence_strength,
  :target_identity_feature_id,
  :matched_identity_feature_id,
  :matched_value_hmac,
  :hmac_key_version,
  :created_at
);

-- ============================================================
-- G07 application
-- Nullable optional columns: company_work_mode_id, current_candidate_snapshot_id, previous_application_id, superseded_by_application_id, hiring_pipeline_id, current_stage_id, company_work_mode_name_snapshot, requested_start_date, requested_end_date, work_duration, decision_reason_code, current_stage_entered_at, decided_at, completed_at, superseded_at, cancelled_at
-- Schema defaults when omitted: application_lifecycle_status=processing, application_decision_status=pending
INSERT INTO "application" (
  "application_uuid",
  "person_id",
  "company_id",
  "position_id",
  "company_name_snapshot",
  "position_name_snapshot",
  "requested_start_year_month",
  "application_group_key",
  "submission_attempt_number",
  "max_submission_attempts_snapshot",
  "decision_fence_token",
  "applied_at",
  "created_at",
  "updated_at"
) VALUES (
  :application_uuid,
  :person_id,
  :company_id,
  :position_id,
  :company_name_snapshot,
  :position_name_snapshot,
  :requested_start_year_month,
  :application_group_key,
  :submission_attempt_number,
  :max_submission_attempts_snapshot,
  :decision_fence_token,
  :applied_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G07 application_source_lineage
-- Nullable optional columns: none
-- Schema defaults when omitted: none
INSERT INTO "application_source_lineage" (
  "application_id",
  "source_submission_normalized_id",
  "source_raw_submission_id",
  "source_dedup_run_id",
  "source_resume_extraction_id",
  "relation_role",
  "source_snapshot_sha256",
  "linked_at",
  "created_at"
) VALUES (
  :application_id,
  :source_submission_normalized_id,
  :source_raw_submission_id,
  :source_dedup_run_id,
  :source_resume_extraction_id,
  :relation_role,
  :source_snapshot_sha256,
  :linked_at,
  :created_at
);

-- ============================================================
-- G07 candidate_snapshot
-- Nullable optional columns: normalized_first_name, normalized_middle_name, normalized_last_name, normalized_phone, normalized_linkedin_url, normalized_github_url, enrichment_completed_at, superseded_at, cancelled_at
-- Schema defaults when omitted: snapshot_status=core_published
INSERT INTO "candidate_snapshot" (
  "candidate_snapshot_uuid",
  "application_id",
  "person_id",
  "normalized_person_name",
  "normalized_email_address",
  "source_resume_text_sha256",
  "source_extraction_version",
  "profile_snapshot_sha256",
  "snapshot_created_at",
  "created_at",
  "updated_at"
) VALUES (
  :candidate_snapshot_uuid,
  :application_id,
  :person_id,
  :normalized_person_name,
  :normalized_email_address,
  :source_resume_text_sha256,
  :source_extraction_version,
  :profile_snapshot_sha256,
  :snapshot_created_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G07 person
-- Nullable optional columns: normalized_first_name, normalized_middle_name, normalized_last_name, normalized_phone, merged_into_person_id, current_application_id, current_candidate_snapshot_id, highest_person_education_id, current_person_position_id
-- Schema defaults when omitted: person_status=active
INSERT INTO "person" (
  "person_uuid",
  "normalized_person_name",
  "normalized_email_address",
  "created_at",
  "updated_at"
) VALUES (
  :person_uuid,
  :normalized_person_name,
  :normalized_email_address,
  :created_at,
  :updated_at
);

-- ============================================================
-- G07 person_contact
-- Nullable optional columns: source_candidate_snapshot_id
-- Schema defaults when omitted: is_primary=0, is_verified=0
INSERT INTO "person_contact" (
  "person_id",
  "contact_type_id",
  "normalized_contact_value",
  "contact_value_hmac",
  "hmac_key_version",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at"
) VALUES (
  :person_id,
  :contact_type_id,
  :normalized_contact_value,
  :contact_value_hmac,
  :hmac_key_version,
  :first_seen_at,
  :last_seen_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G07 person_link
-- Nullable optional columns: source_candidate_snapshot_id, account_handle
-- Schema defaults when omitted: is_primary=0
INSERT INTO "person_link" (
  "person_id",
  "link_type",
  "normalized_url",
  "normalized_url_hmac",
  "hmac_key_version",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at"
) VALUES (
  :person_id,
  :link_type,
  :normalized_url,
  :normalized_url_hmac,
  :hmac_key_version,
  :first_seen_at,
  :last_seen_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G07 person_name
-- Nullable optional columns: source_candidate_snapshot_id
-- Schema defaults when omitted: is_primary=0
INSERT INTO "person_name" (
  "person_id",
  "display_name",
  "normalized_name",
  "name_source",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at"
) VALUES (
  :person_id,
  :display_name,
  :normalized_name,
  :name_source,
  :first_seen_at,
  :last_seen_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G08 candidate_certification
-- Nullable optional columns: issued_at_snapshot, expires_at_snapshot
-- Schema defaults when omitted: none
INSERT INTO "candidate_certification" (
  "candidate_snapshot_id",
  "person_id",
  "person_certification_id",
  "certification_status_snapshot",
  "created_at"
) VALUES (
  :candidate_snapshot_id,
  :person_id,
  :person_certification_id,
  :certification_status_snapshot,
  :created_at
);

-- ============================================================
-- G08 candidate_education
-- Nullable optional columns: none
-- Schema defaults when omitted: is_highest_degree=0
INSERT INTO "candidate_education" (
  "candidate_snapshot_id",
  "person_id",
  "person_education_id",
  "source_resume_education_id",
  "source_entry_order",
  "created_at"
) VALUES (
  :candidate_snapshot_id,
  :person_id,
  :person_education_id,
  :source_resume_education_id,
  :source_entry_order,
  :created_at
);

-- ============================================================
-- G08 candidate_position
-- Nullable optional columns: is_current_at_snapshot
-- Schema defaults when omitted: is_primary_current_position=0
INSERT INTO "candidate_position" (
  "candidate_snapshot_id",
  "person_id",
  "person_position_id",
  "source_resume_employment_id",
  "source_entry_order",
  "created_at"
) VALUES (
  :candidate_snapshot_id,
  :person_id,
  :person_position_id,
  :source_resume_employment_id,
  :source_entry_order,
  :created_at
);

-- ============================================================
-- G08 candidate_project
-- Nullable optional columns: none
-- Schema defaults when omitted: none
INSERT INTO "candidate_project" (
  "candidate_snapshot_id",
  "person_id",
  "person_project_id",
  "source_resume_project_id",
  "source_entry_order",
  "created_at"
) VALUES (
  :candidate_snapshot_id,
  :person_id,
  :person_project_id,
  :source_resume_project_id,
  :source_entry_order,
  :created_at
);

-- ============================================================
-- G08 candidate_skill
-- Nullable optional columns: matched_context_text, proficiency_level_id_snapshot, proficiency_text_snapshot, years_experience_snapshot
-- Schema defaults when omitted: none
INSERT INTO "candidate_skill" (
  "candidate_snapshot_id",
  "person_id",
  "person_skill_id",
  "source_resume_skill_id",
  "raw_skill_text",
  "match_method",
  "created_at"
) VALUES (
  :candidate_snapshot_id,
  :person_id,
  :person_skill_id,
  :source_resume_skill_id,
  :raw_skill_text,
  :match_method,
  :created_at
);

-- ============================================================
-- G08 education
-- Nullable optional columns: school_id, field_study_id, major_id, normalized_school_name, raw_field_study_name, normalized_field_study_name, raw_major_name, normalized_major_name, gpa, education_start_date, education_end_date, is_current
-- Schema defaults when omitted: none
INSERT INTO "education" (
  "education_uuid",
  "degree_id",
  "raw_school_name",
  "raw_degree_name",
  "normalized_degree_name",
  "education_description",
  "created_at",
  "updated_at"
) VALUES (
  :education_uuid,
  :degree_id,
  :raw_school_name,
  :raw_degree_name,
  :normalized_degree_name,
  :education_description,
  :created_at,
  :updated_at
);

-- ============================================================
-- G08 person_certification
-- Nullable optional columns: source_candidate_snapshot_id, credential_id, credential_url, issued_at, expires_at
-- Schema defaults when omitted: certification_status=unknown
INSERT INTO "person_certification" (
  "person_certification_uuid",
  "person_id",
  "certification_id",
  "record_source",
  "certification_instance_key",
  "created_at",
  "updated_at"
) VALUES (
  :person_certification_uuid,
  :person_id,
  :certification_id,
  :record_source,
  :certification_instance_key,
  :created_at,
  :updated_at
);

-- ============================================================
-- G08 person_education
-- Nullable optional columns: none
-- Schema defaults when omitted: none
INSERT INTO "person_education" (
  "person_id",
  "education_id",
  "first_source_candidate_snapshot_id",
  "first_source_resume_education_id",
  "education_record_sha256",
  "recorded_at",
  "created_at"
) VALUES (
  :person_id,
  :education_id,
  :first_source_candidate_snapshot_id,
  :first_source_resume_education_id,
  :education_record_sha256,
  :recorded_at,
  :created_at
);

-- ============================================================
-- G08 person_position
-- Nullable optional columns: company_id, position_id, function_id, seniority_id, location_id, employment_type_id, normalized_company_name, normalized_position_name, experience_type_text, position_start_date, position_end_date, is_current
-- Schema defaults when omitted: none
INSERT INTO "person_position" (
  "person_position_uuid",
  "person_id",
  "first_source_candidate_snapshot_id",
  "first_source_resume_employment_id",
  "raw_company_name",
  "raw_position_name",
  "position_description",
  "employment_record_sha256",
  "created_at",
  "updated_at"
) VALUES (
  :person_position_uuid,
  :person_id,
  :first_source_candidate_snapshot_id,
  :first_source_resume_employment_id,
  :raw_company_name,
  :raw_position_name,
  :position_description,
  :employment_record_sha256,
  :created_at,
  :updated_at
);

-- ============================================================
-- G08 person_project
-- Nullable optional columns: normalized_project_name, project_role, project_url, project_start_date, project_end_date
-- Schema defaults when omitted: none
INSERT INTO "person_project" (
  "person_project_uuid",
  "person_id",
  "first_source_candidate_snapshot_id",
  "project_name",
  "project_description",
  "project_record_sha256",
  "created_at",
  "updated_at"
) VALUES (
  :person_project_uuid,
  :person_id,
  :first_source_candidate_snapshot_id,
  :project_name,
  :project_description,
  :project_record_sha256,
  :created_at,
  :updated_at
);

-- ============================================================
-- G08 person_skill
-- Nullable optional columns: current_proficiency_level_id, current_proficiency_text, current_years_experience
-- Schema defaults when omitted: none
INSERT INTO "person_skill" (
  "person_id",
  "skill_id",
  "first_source_candidate_snapshot_id",
  "latest_source_candidate_snapshot_id",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at"
) VALUES (
  :person_id,
  :skill_id,
  :first_source_candidate_snapshot_id,
  :latest_source_candidate_snapshot_id,
  :first_seen_at,
  :last_seen_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G09 ml_analysis_run
-- Nullable optional columns: model_revision, last_error_code, last_error_detail, completed_at
-- Schema defaults when omitted: model_name=all-MiniLM-L6-v2, model_provider=sentence_transformers, run_status=running
INSERT INTO "ml_analysis_run" (
  "ml_analysis_run_uuid",
  "application_id",
  "candidate_snapshot_id",
  "person_id",
  "workflow_run_id",
  "idempotency_key",
  "application_fence_token",
  "model_config_json",
  "pipeline_code",
  "pipeline_source_code_sha256",
  "anomaly_rule_version",
  "input_snapshot_sha256",
  "resume_text_sha256",
  "position_jd_sha256",
  "input_feature_snapshot_json",
  "started_at",
  "created_at",
  "updated_at"
) VALUES (
  :ml_analysis_run_uuid,
  :application_id,
  :candidate_snapshot_id,
  :person_id,
  :workflow_run_id,
  :idempotency_key,
  :application_fence_token,
  :model_config_json,
  :pipeline_code,
  :pipeline_source_code_sha256,
  :anomaly_rule_version,
  :input_snapshot_sha256,
  :resume_text_sha256,
  :position_jd_sha256,
  :input_feature_snapshot_json,
  :started_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G09 ml_anomaly_result
-- Nullable optional columns: none
-- Schema defaults when omitted: none
INSERT INTO "ml_anomaly_result" (
  "ml_analysis_run_id",
  "application_id",
  "candidate_snapshot_id",
  "has_any_anomaly",
  "anomaly_flags_json",
  "disposition",
  "created_at"
) VALUES (
  :ml_analysis_run_id,
  :application_id,
  :candidate_snapshot_id,
  :has_any_anomaly,
  :anomaly_flags_json,
  :disposition,
  :created_at
);

-- ============================================================
-- G09 ml_recommendation_result
-- Nullable optional columns: similarity_result_id, threshold_policy_id, match_score_snapshot, threshold_snapshot, passed_threshold
-- Schema defaults when omitted: none
INSERT INTO "ml_recommendation_result" (
  "recommendation_result_uuid",
  "ml_analysis_run_id",
  "application_id",
  "candidate_snapshot_id",
  "anomaly_result_id",
  "recommendation_method",
  "recommendation_decision",
  "decision_reason_code",
  "result_metadata_json",
  "decided_at",
  "published_at",
  "created_at"
) VALUES (
  :recommendation_result_uuid,
  :ml_analysis_run_id,
  :application_id,
  :candidate_snapshot_id,
  :anomaly_result_id,
  :recommendation_method,
  :recommendation_decision,
  :decision_reason_code,
  :result_metadata_json,
  :decided_at,
  :published_at,
  :created_at
);

-- ============================================================
-- G09 ml_similarity_result
-- Nullable optional columns: none
-- Schema defaults when omitted: similarity_metric=cosine_similarity
INSERT INTO "ml_similarity_result" (
  "ml_analysis_run_id",
  "application_id",
  "candidate_snapshot_id",
  "position_id",
  "match_score",
  "computed_at",
  "created_at"
) VALUES (
  :ml_analysis_run_id,
  :application_id,
  :candidate_snapshot_id,
  :position_id,
  :match_score,
  :computed_at,
  :created_at
);

-- ============================================================
-- G09 ml_threshold_policy
-- Nullable optional columns: policy_band_code, company_id, position_id, expected_retention_ratio, supersedes_policy_id, effective_at, retired_at
-- Schema defaults when omitted: policy_status=draft
INSERT INTO "ml_threshold_policy" (
  "threshold_policy_uuid",
  "policy_family_code",
  "policy_version",
  "policy_name",
  "policy_scope_type",
  "match_score_threshold",
  "policy_config_json",
  "created_at",
  "updated_at"
) VALUES (
  :threshold_policy_uuid,
  :policy_family_code,
  :policy_version,
  :policy_name,
  :policy_scope_type,
  :match_score_threshold,
  :policy_config_json,
  :created_at,
  :updated_at
);

-- ============================================================
-- G10 application_stage_run
-- Nullable optional columns: ml_recommendation_result_id, stage_outcome_code, score, maximum_score, passed_threshold, executor_type, executor_reference, result_summary, cancellation_reason_code, scheduled_at, started_at, waiting_since, completed_at
-- Schema defaults when omitted: run_status=scheduled
INSERT INTO "application_stage_run" (
  "application_stage_run_uuid",
  "application_id",
  "hiring_pipeline_id",
  "pipeline_stage_id",
  "workflow_run_id",
  "idempotency_key",
  "application_fence_token",
  "actual_sequence_no",
  "attempt_no",
  "result_metadata_json",
  "created_at",
  "updated_at"
) VALUES (
  :application_stage_run_uuid,
  :application_id,
  :hiring_pipeline_id,
  :pipeline_stage_id,
  :workflow_run_id,
  :idempotency_key,
  :application_fence_token,
  :actual_sequence_no,
  :attempt_no,
  :result_metadata_json,
  :created_at,
  :updated_at
);

-- ============================================================
-- G10 application_stage_transition_event
-- Nullable optional columns: configured_transition_id, from_stage_run_id, from_stage_id, initiated_by_reference
-- Schema defaults when omitted: none
INSERT INTO "application_stage_transition_event" (
  "transition_event_uuid",
  "application_id",
  "hiring_pipeline_id",
  "to_stage_run_id",
  "to_stage_id",
  "movement_type",
  "reason_code",
  "initiated_by_type",
  "workflow_run_id",
  "application_fence_token",
  "idempotency_key",
  "event_metadata_json",
  "occurred_at",
  "created_at"
) VALUES (
  :transition_event_uuid,
  :application_id,
  :hiring_pipeline_id,
  :to_stage_run_id,
  :to_stage_id,
  :movement_type,
  :reason_code,
  :initiated_by_type,
  :workflow_run_id,
  :application_fence_token,
  :idempotency_key,
  :event_metadata_json,
  :occurred_at,
  :created_at
);

-- ============================================================
-- G10 hiring_pipeline
-- Nullable optional columns: pipeline_description, activated_at, retired_at
-- Schema defaults when omitted: pipeline_status=draft
INSERT INTO "hiring_pipeline" (
  "hiring_pipeline_uuid",
  "pipeline_family_code",
  "pipeline_version",
  "hiring_pipeline_name",
  "created_at",
  "updated_at"
) VALUES (
  :hiring_pipeline_uuid,
  :pipeline_family_code,
  :pipeline_version,
  :hiring_pipeline_name,
  :created_at,
  :updated_at
);

-- ============================================================
-- G10 pipeline_stage
-- Nullable optional columns: max_business_attempts
-- Schema defaults when omitted: is_initial=0, is_terminal=0, is_optional=1, is_repeatable=0
INSERT INTO "pipeline_stage" (
  "pipeline_stage_uuid",
  "hiring_pipeline_id",
  "stage_code",
  "pipeline_stage_name",
  "stage_type",
  "default_display_order",
  "stage_config_json",
  "created_at",
  "updated_at"
) VALUES (
  :pipeline_stage_uuid,
  :hiring_pipeline_id,
  :stage_code,
  :pipeline_stage_name,
  :stage_type,
  :default_display_order,
  :stage_config_json,
  :created_at,
  :updated_at
);

-- ============================================================
-- G10 pipeline_stage_transition
-- Nullable optional columns: none
-- Schema defaults when omitted: is_allowed=1
INSERT INTO "pipeline_stage_transition" (
  "pipeline_stage_transition_uuid",
  "hiring_pipeline_id",
  "from_stage_id",
  "to_stage_id",
  "transition_category",
  "transition_condition_json",
  "created_at",
  "updated_at"
) VALUES (
  :pipeline_stage_transition_uuid,
  :hiring_pipeline_id,
  :from_stage_id,
  :to_stage_id,
  :transition_category,
  :transition_condition_json,
  :created_at,
  :updated_at
);

-- ============================================================
-- G11 offer
-- Nullable optional columns: ml_recommendation_result_id, current_offer_version_id, application_work_location_snapshot, application_work_mode_snapshot, requested_start_date_snapshot, requested_end_date_snapshot, work_duration_snapshot
-- Schema defaults when omitted: current_status=draft, status_version=1
INSERT INTO "offer" (
  "offer_uuid",
  "application_id",
  "candidate_snapshot_id",
  "creating_stage_run_id",
  "decision_source",
  "offer_fence_token",
  "company_name_snapshot",
  "position_title_snapshot",
  "candidate_name_snapshot",
  "candidate_email_snapshot",
  "current_status_changed_at",
  "created_at",
  "updated_at"
) VALUES (
  :offer_uuid,
  :application_id,
  :candidate_snapshot_id,
  :creating_stage_run_id,
  :decision_source,
  :offer_fence_token,
  :company_name_snapshot,
  :position_title_snapshot,
  :candidate_name_snapshot,
  :candidate_email_snapshot,
  :current_status_changed_at,
  :created_at,
  :updated_at
);

-- ============================================================
-- G11 offer_status_history
-- Nullable optional columns: offer_version_id, stage_run_id, from_status, initiated_by_reference, note
-- Schema defaults when omitted: none
INSERT INTO "offer_status_history" (
  "offer_status_history_uuid",
  "offer_id",
  "application_id",
  "workflow_run_id",
  "idempotency_key",
  "to_status",
  "initiated_by_type",
  "reason_code",
  "event_metadata_json",
  "occurred_at",
  "created_at"
) VALUES (
  :offer_status_history_uuid,
  :offer_id,
  :application_id,
  :workflow_run_id,
  :idempotency_key,
  :to_status,
  :initiated_by_type,
  :reason_code,
  :event_metadata_json,
  :occurred_at,
  :created_at
);

-- ============================================================
-- G11 offer_version
-- Nullable optional columns: employment_type_id, work_location, work_mode, employment_start_date, employment_end_date, work_duration, compensation_amount_minor_units, compensation_currency_code, compensation_period, signing_bonus_minor_units, target_bonus_description, equity_description, response_due_at, prepared_by_reference
-- Schema defaults when omitted: none
INSERT INTO "offer_version" (
  "offer_version_uuid",
  "offer_id",
  "version_no",
  "terms_sha256",
  "offer_title",
  "offer_terms_json",
  "prepared_by_type",
  "created_at"
) VALUES (
  :offer_version_uuid,
  :offer_id,
  :version_no,
  :terms_sha256,
  :offer_title,
  :offer_terms_json,
  :prepared_by_type,
  :created_at
);
