# HireBeat D1 全表约束与默认值矩阵

> 此文档由 `scripts/generate_constraint_matrix.py` 从全部 migration 实际执行后的 SQLite schema 自动生成。不要手工编辑。逐字段详情见同目录 CSV。

## 冻结规则

- 数据库原生 `NOT NULL`、`CHECK`、FK、`UNIQUE` 是最后防线。
- 仅在存在唯一且安全的初始值时使用 `DEFAULT`。
- 关键业务值缺失时拒绝写入，不使用空字符串、`unknown` 或占位 ID 猜测。
- Trigger 只处理普通单列约束无法表达的跨字段不变量。
- 正式 importer 负责友好错误代码、标准化、稳定标识和业务推导。
- 手写 SQL 必须采用审核过的表级模板。

## 表级摘要

### G01 — shared_reference

#### `certification`

- 无默认值必填字段：`certification_uuid`, `certification_name`, `normalized_certification_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`certification_type_id`, `issuing_organization_id`, `certification_url`, `typical_validity_months`
- 推导/状态规则：
  - normalized_certification_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `certification_type`

- 无默认值必填字段：`certification_type_code`, `certification_type_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `city`

- 无默认值必填字段：`city_uuid`, `country_id`, `city_name`, `normalized_city_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`state_id`
- 推导/状态规则：
  - normalized_city_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `contact_type`

- 无默认值必填字段：`contact_type_code`, `contact_type_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `country`

- 无默认值必填字段：`country_code`, `country_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `degree`

- 无默认值必填字段：`degree_code`, `degree_name`, `degree_level_rank`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `field_study`

- 无默认值必填字段：`field_study_uuid`, `field_study_name`, `normalized_field_study_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - normalized_field_study_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `function`

- 无默认值必填字段：`function_code`, `function_name`, `normalized_function_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - normalized_function_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `issuing_organization`

- 无默认值必填字段：`issuing_organization_uuid`, `organization_name`, `normalized_organization_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`organization_url`
- 推导/状态规则：
  - normalized_organization_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `location`

- 无默认值必填字段：`location_uuid`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`country_id`, `state_id`, `city_id`, `postal_code`, `location_name`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `major`

- 无默认值必填字段：`major_uuid`, `major_name`, `normalized_major_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`field_study_id`, `is_stem`
- 推导/状态规则：
  - normalized_major_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_employment_type`

- 无默认值必填字段：`employment_type_code`, `employment_type_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_occupational_type`

- 无默认值必填字段：`occupational_code`, `occupational_type_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `school`

- 无默认值必填字段：`school_uuid`, `school_name`, `normalized_school_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`school_url`, `school_type`, `school_category`
- 推导/状态规则：
  - normalized_school_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `seniority`

- 无默认值必填字段：`seniority_code`, `seniority_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`seniority_rank`, `typical_experience_months_min`, `typical_experience_months_max`
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `skill`

- 无默认值必填字段：`skill_uuid`, `skill_name`, `normalized_skill_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - normalized_skill_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `skill_proficiency_level`

- 无默认值必填字段：`proficiency_level_code`, `proficiency_level_name`, `proficiency_level_rank`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `skill_type`

- 无默认值必填字段：`skill_type_code`, `skill_type_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `skill_type_assignment`

- 无默认值必填字段：`skill_id`, `skill_type_id`, `created_at`
- Schema 默认值：无
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `state`

- 无默认值必填字段：`country_id`, `state_name`, `normalized_state_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`state_code`
- 推导/状态规则：
  - normalized_state_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `work_mode`

- 无默认值必填字段：`work_mode_code`, `work_mode_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New reviewed reference records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G02 — recruitment_catalog

#### `catalog_revision`

- 无默认值必填字段：`catalog_revision_uuid`, `revision_number`, `catalog_snapshot_json`, `snapshot_sha256`, `created_at`
- Schema 默认值：无
- 可为 NULL：`change_reason`, `created_by_actor`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `catalog_sync_run`

- 无默认值必填字段：`catalog_sync_run_uuid`, `catalog_revision_id`, `idempotency_key`, `created_at`, `updated_at`
- Schema 默认值：`sync_status=pending`, `expected_target_count=0`, `succeeded_target_count=0`, `failed_target_count=0`
- 可为 NULL：`triggering_outbox_event_id`, `started_at`, `completed_at`
- 推导/状态规则：
  - sync_status: A new catalog synchronization waits for its dispatcher.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `catalog_sync_target_run`

- 无默认值必填字段：`catalog_sync_run_id`, `target_type`, `target_key`, `created_at`, `updated_at`
- Schema 默认值：`target_status=pending`, `attempt_count=0`
- 可为 NULL：`external_revision_key`, `last_error_code`, `last_error_detail`, `next_attempt_at`, `started_at`, `completed_at`
- 推导/状态规则：
  - target_status: A new provider target waits for provider-specific delivery.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `company`

- 无默认值必填字段：`company_uuid`, `company_name`, `normalized_company_name`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`, `default_max_submission_attempts=5`
- 可为 NULL：`company_website_url`, `company_linkedin_url`, `company_description`, `default_max_submission_attempts`
- 推导/状态规则：
  - normalized_company_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - is_active: New catalog records are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `company_contact_info`

- 无默认值必填字段：`company_id`, `contact_value`, `created_at`, `updated_at`
- Schema 默认值：`is_primary=0`, `is_active=1`
- 可为 NULL：`contact_type_id`, `contact_name`, `contact_position_title`, `priority_rank`
- 推导/状态规则：
  - is_active: New company contacts are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `company_work_mode`

- 无默认值必填字段：`company_id`, `work_mode_id`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New company work modes are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position`

- 无默认值必填字段：`position_uuid`, `company_id`, `position_name`, `normalized_position_name`, `created_at`, `updated_at`
- Schema 默认值：`position_status=draft`
- 可为 NULL：`position_jd`, `occupational_type_id`, `employment_type_id`, `function_id`, `seniority_id`, `location_id`, `work_duration`, `openings_count`, `posted_date`, `offers_relocation_assistance`, `local_candidates_only`
- 推导/状态规则：
  - normalized_position_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - position_jd: May be NULL for draft Positions; active status requires trimmed JD length of at least 10 characters.
  - position_status: Importer writes active only when trimmed JD has at least 10 characters; otherwise draft; database triggers reject active with an invalid JD.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_certification_requirement`

- 无默认值必填字段：`position_id`, `certification_id`, `requirement_type`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：无
- 推导/状态规则：
  - is_active: New position requirements are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_education_requirement`

- 无默认值必填字段：`position_id`, `degree_id`, `requirement_type`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`field_study_id`
- 推导/状态规则：
  - is_active: New position requirements are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_salary_range`

- 无默认值必填字段：`position_id`, `currency_code`, `salary_period`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`salary_min_cents`, `salary_max_cents`
- 推导/状态规则：
  - is_active: New position salary ranges are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `position_skill`

- 无默认值必填字段：`position_id`, `skill_id`, `requirement_type`, `created_at`, `updated_at`
- Schema 默认值：`is_active=1`
- 可为 NULL：`minimum_proficiency_level_id`, `onet_importance_score`, `onet_dependence_score`, `onet_preparation_score`
- 推导/状态规则：
  - is_active: New position skill requirements are active unless the writer explicitly supplies 0.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G03 — submission_ingress

#### `raw_submission`

- 无默认值必填字段：`raw_submission_intake_run_id`, `submission_uuid`, `source_system`, `source_record_id`, `source_event_key`, `payload_hmac`, `payload_hmac_key_version`, `landed_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`source_schema_version`, `submitted_catalog_revision_id`, `submitted_company_id`, `submitted_company_name`, `submitted_company_work_mode_id`, `submitted_company_work_mode_name`, `submitted_position_id`, `submitted_position_name`, `raw_person_name`, `raw_email_address`, `raw_phone`, `raw_start_working_date`, `raw_end_working_date`, `raw_work_duration`, `source_submitted_at`, `retention_until`, `purged_at`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `raw_submission_intake_run`

- 无默认值必填字段：`intake_run_uuid`, `submission_uuid`, `source_system`, `source_record_id`, `source_event_key`, `first_received_at`, `last_received_at`, `created_at`, `updated_at`
- Schema 默认值：`intake_status=received`, `attempt_count=0`, `technical_redelivery_count=0`, `payload_conflict_count=0`
- 可为 NULL：`source_schema_version`, `accepted_payload_hmac`, `last_received_payload_hmac`, `payload_hmac_key_version`, `last_technical_redelivery_mechanism`, `last_technical_redelivery_cause_code`, `last_technical_redelivery_at`, `last_error_code`, `last_error_detail`, `last_attempt_started_at`, `completed_at`, `configuration_release_id`, `accepted_resume_file_sha256`
- 推导/状态规则：
  - intake_status: An intake coordinator records receipt before durable Raw persistence.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `raw_submission_resume`

- 无默认值必填字段：`raw_submission_id`, `resume_text_status`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`resume_text`, `resume_text_origin`, `resume_parser_version`, `resume_text_sha256`, `resume_parsed_at`, `resume_original_file_name`, `resume_source_url`, `resume_source_file_id`, `resume_mime_type`, `resume_file_size_bytes`, `resume_r2_object_key`, `resume_file_sha256`
- 推导/状态规则：
  - resume_text_status: The resolver must explicitly distinguish available failed no_resume and other terminal outcomes.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G04 — workflow_control

#### `audit_event`

- 无默认值必填字段：`event_uuid`, `event_type`, `entity_type`, `entity_id`, `actor_type`, `event_summary`, `occurred_at`, `recorded_at`
- Schema 默认值：无
- 可为 NULL：`actor_id`, `workflow_run_id`, `correlation_key`, `reason_code`, `event_metadata_json`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `etl_step_attempt`

- 无默认值必填字段：`step_run_id`, `attempt_uuid`, `attempt_number`, `started_at`, `created_at`
- Schema 默认值：`attempt_kind=execute`, `attempt_status=running`
- 可为 NULL：`worker_execution_id`, `error_class`, `error_code`, `error_detail`, `retry_scheduled_at`, `finished_at`, `duration_ms`
- 推导/状态规则：
  - attempt_status: An attempt row is created only when an execution attempt starts.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `etl_step_run`

- 无默认值必填字段：`workflow_run_id`, `step_key`, `step_name`, `step_version`, `idempotency_key`, `max_attempts`, `created_at`, `updated_at`
- Schema 默认值：`is_required=1`, `step_status=pending`, `attempt_count=0`
- 可为 NULL：`next_retry_at`, `last_error_code`, `last_error_detail`, `started_at`, `completed_at`
- 推导/状态规则：
  - step_status: A logical step is pending before its first attempt.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `etl_workflow_run`

- 无默认值必填字段：`workflow_run_uuid`, `workflow_type`, `workflow_version`, `idempotency_key`, `trigger_outbox_event_id`, `requested_at`, `created_at`, `updated_at`
- Schema 默认值：`workflow_status=requested`, `run_attempt_count=0`
- 可为 NULL：`cloudflare_instance_id`, `parent_workflow_run_id`, `raw_submission_id`, `application_id`, `subject_fence_token`, `current_step_key`, `last_error_code`, `last_error_detail`, `cancellation_reason_code`, `started_at`, `last_progressed_at`, `completed_at`, `configuration_release_id`
- 推导/状态规则：
  - workflow_status: A workflow ledger row begins as an accepted request.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `outbox_event`

- 无默认值必填字段：`event_uuid`, `deduplication_key`, `event_type`, `event_schema_version`, `aggregate_type`, `aggregate_id`, `destination_type`, `max_delivery_attempts`, `available_at`, `created_at`, `updated_at`
- Schema 默认值：`event_payload_json={}`, `dispatch_status=pending`, `delivery_attempt_count=0`
- 可为 NULL：`destination_key`, `producer_workflow_run_id`, `producer_step_run_id`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `last_error_code`, `last_error_detail`, `published_at`
- 推导/状态规则：
  - dispatch_status: A transactional outbox row is pending until leased by a dispatcher.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `system_configuration`

- 无默认值必填字段：`configuration_release_id`, `configuration_scope`, `configuration_key`, `configuration_value_json`, `created_at`
- Schema 默认值：无
- 可为 NULL：`description`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `system_configuration_release`

- 无默认值必填字段：`configuration_release_key`, `release_version`, `created_at`, `updated_at`
- Schema 默认值：`release_status=draft`
- 可为 NULL：`release_description`, `activated_at`, `superseded_at`, `created_by`, `activated_by`
- 推导/状态规则：
  - release_status: Configuration releases require explicit activation and only one may be active.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G05 — submission_processing

#### `normalization_run`

- 无默认值必填字段：`normalization_run_uuid`, `raw_submission_id`, `workflow_run_id`, `step_run_id`, `normalization_version`, `idempotency_key`, `started_at`, `created_at`, `updated_at`
- Schema 默认值：`normalization_status=running`, `warning_count=0`
- 可为 NULL：`warnings_json`, `last_error_code`, `last_error_detail`, `completed_at`
- 推导/状态规则：
  - normalization_status: A normalization run row is created when normalization starts.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `resume_education`

- 无默认值必填字段：`resume_extraction_id`, `source_entry_order`, `extraction_eligibility_status`, `created_at`
- Schema 默认值：无
- 可为 NULL：`raw_education_text`, `raw_school_name`, `normalized_school_name`, `school_id`, `raw_degree_name`, `normalized_degree_name`, `degree_id`, `raw_field_study_name`, `normalized_field_study_name`, `field_study_id`, `raw_major_name`, `normalized_major_name`, `major_id`, `gpa`, `education_start_date`, `education_end_date`, `is_current`, `rejection_reason_detail`
- 推导/状态规则：
  - normalized_school_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_degree_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_field_study_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_major_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - extraction_eligibility_status: The extractor must explicitly record whether each candidate row is publishable and why.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `resume_employment`

- 无默认值必填字段：`resume_extraction_id`, `source_entry_order`, `extraction_eligibility_status`, `created_at`
- Schema 默认值：无
- 可为 NULL：`raw_employment_text`, `raw_company_name`, `normalized_company_name`, `raw_position_name`, `normalized_position_name`, `employment_description`, `employment_start_date`, `employment_end_date`, `is_current`, `rejection_reason_detail`
- 推导/状态规则：
  - normalized_company_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_position_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - extraction_eligibility_status: The extractor must explicitly record whether each candidate row is publishable and why.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `resume_extraction`

- 无默认值必填字段：`resume_extraction_uuid`, `submission_normalized_id`, `raw_submission_resume_id`, `workflow_run_id`, `step_run_id`, `extraction_version`, `idempotency_key`, `input_resume_text_sha256`, `started_at`, `created_at`, `updated_at`
- Schema 默认值：`extraction_status=running`, `identity_record_count=0`, `education_record_count=0`, `employment_record_count=0`, `skill_record_count=0`, `project_record_count=0`, `warning_count=0`
- 可为 NULL：`warnings_json`, `last_error_code`, `last_error_detail`, `completed_at`
- 推导/状态规则：
  - extraction_status: A Resume extraction run begins when structured extraction starts.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `resume_project`

- 无默认值必填字段：`resume_extraction_id`, `source_entry_order`, `extraction_eligibility_status`, `created_at`
- Schema 默认值：无
- 可为 NULL：`raw_project_text`, `raw_project_name`, `normalized_project_name`, `project_description`, `project_start_date`, `project_end_date`, `project_url`, `rejection_reason_detail`
- 推导/状态规则：
  - normalized_project_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - extraction_eligibility_status: The extractor must explicitly record whether each candidate row is publishable and why.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `resume_skill`

- 无默认值必填字段：`resume_extraction_id`, `source_entry_order`, `raw_skill_text`, `match_method`, `extraction_eligibility_status`, `created_at`
- Schema 默认值：无
- 可为 NULL：`normalized_skill_name`, `skill_id`, `matched_context_text`, `rejection_reason_detail`
- 推导/状态规则：
  - normalized_skill_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - extraction_eligibility_status: The extractor must explicitly record whether each candidate row is publishable and why.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `submission_identity_feature`

- 无默认值必填字段：`submission_normalized_id`, `feature_type`, `feature_source`, `normalized_value`, `normalized_value_hmac`, `hmac_key_version`, `selection_status`, `created_at`
- Schema 默认值：`is_primary_candidate=0`
- 可为 NULL：`resume_extraction_id`, `account_handle`
- 推导/状态规则：
  - normalized_value: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_value_hmac: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - selection_status: Identity extraction must explicitly record selected ambiguous or rejected disposition.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `submission_normalized`

- 无默认值必填字段：`submission_normalized_uuid`, `raw_submission_id`, `normalization_run_id`, `normalization_version`, `company_id`, `position_id`, `normalized_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：`company_work_mode_id`, `normalized_person_name`, `normalized_first_name`, `normalized_middle_name`, `normalized_last_name`, `normalized_email_address`, `normalized_phone`, `requested_start_date`, `requested_end_date`, `requested_start_year_month`, `work_duration`
- 推导/状态规则：
  - normalized_person_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_first_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_middle_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_last_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_email_address: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_phone: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_at: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G06 — dedup_admission

#### `submission_dedup_match`

- 无默认值必填字段：`dedup_match_uuid`, `dedup_run_id`, `target_submission_normalized_id`, `matched_submission_normalized_id`, `primary_match_rule`, `total_evidence_count`, `has_strong_identity_match`, `has_resume_identity_match`, `final_match_score`, `matched_at`, `created_at`
- Schema 默认值：`is_selected_prior_submission=0`, `strong_evidence_count=0`, `resume_identity_evidence_count=0`
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `submission_dedup_run`

- 无默认值必填字段：`dedup_run_uuid`, `target_submission_normalized_id`, `workflow_run_id`, `step_run_id`, `dedup_rule_version`, `idempotency_key`, `dedup_company_id`, `dedup_position_id`, `rule_config_json`, `started_at`, `created_at`, `updated_at`
- Schema 默认值：`run_status=running`, `application_entry_decision=pending`, `scope_submission_count=0`, `evaluated_pair_count=0`, `matched_pair_count=0`
- 可为 NULL：`dedup_requested_start_year_month`, `dedup_group_key`, `dedup_decision`, `decision_reason_code`, `selected_prior_submission_normalized_id`, `canonical_submission_normalized_id`, `identity_component_key`, `submission_attempt_number`, `max_submission_attempts_snapshot`, `has_strong_identity_match`, `has_resume_identity_match`, `final_match_score`, `last_error_code`, `last_error_detail`, `completed_at`
- 推导/状态规则：
  - run_status: A dedup run begins when global comparison starts.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `submission_match_evidence`

- 无默认值必填字段：`evidence_uuid`, `dedup_match_id`, `evidence_type`, `evidence_strength`, `target_identity_feature_id`, `matched_identity_feature_id`, `matched_value_hmac`, `hmac_key_version`, `created_at`
- Schema 默认值：`is_primary_rule=0`, `evidence_score=1.0`
- 可为 NULL：`github_last_name_match`, `matched_normalized_last_name_hmac`, `evidence_metadata_json`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G07 — application_core

#### `application`

- 无默认值必填字段：`application_uuid`, `person_id`, `company_id`, `position_id`, `company_name_snapshot`, `position_name_snapshot`, `requested_start_year_month`, `application_group_key`, `submission_attempt_number`, `max_submission_attempts_snapshot`, `decision_fence_token`, `applied_at`, `created_at`, `updated_at`
- Schema 默认值：`application_lifecycle_status=processing`, `application_decision_status=pending`
- 可为 NULL：`company_work_mode_id`, `current_candidate_snapshot_id`, `previous_application_id`, `superseded_by_application_id`, `hiring_pipeline_id`, `current_stage_id`, `company_work_mode_name_snapshot`, `requested_start_date`, `requested_end_date`, `work_duration`, `decision_reason_code`, `current_stage_entered_at`, `decided_at`, `completed_at`, `superseded_at`, `cancelled_at`
- 推导/状态规则：
  - application_lifecycle_status: New admitted applications begin in processing; later changes require lifecycle commands.
  - application_decision_status: No hiring decision exists when an application is first published.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `application_source_lineage`

- 无默认值必填字段：`application_id`, `source_submission_normalized_id`, `source_raw_submission_id`, `source_dedup_run_id`, `source_resume_extraction_id`, `relation_role`, `source_snapshot_sha256`, `linked_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `candidate_snapshot`

- 无默认值必填字段：`candidate_snapshot_uuid`, `application_id`, `person_id`, `normalized_person_name`, `normalized_email_address`, `source_resume_text_sha256`, `source_extraction_version`, `profile_snapshot_sha256`, `snapshot_created_at`, `created_at`, `updated_at`
- Schema 默认值：`snapshot_status=core_published`
- 可为 NULL：`normalized_first_name`, `normalized_middle_name`, `normalized_last_name`, `normalized_phone`, `normalized_linkedin_url`, `normalized_github_url`, `enrichment_completed_at`, `superseded_at`, `cancelled_at`
- 推导/状态规则：
  - snapshot_status: Workflow A publishes the minimum candidate core before Workflow B enrichment.
  - normalized_person_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_first_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_middle_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_last_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_email_address: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_phone: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_linkedin_url: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_github_url: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person`

- 无默认值必填字段：`person_uuid`, `normalized_person_name`, `normalized_email_address`, `created_at`, `updated_at`
- Schema 默认值：`person_status=active`
- 可为 NULL：`normalized_first_name`, `normalized_middle_name`, `normalized_last_name`, `normalized_phone`, `merged_into_person_id`, `current_application_id`, `current_candidate_snapshot_id`, `highest_person_education_id`, `current_person_position_id`
- 推导/状态规则：
  - normalized_person_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_first_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_middle_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_last_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_email_address: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_phone: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - person_status: A newly created canonical person is active unless later merged or retired.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_contact`

- 无默认值必填字段：`person_id`, `contact_type_id`, `normalized_contact_value`, `contact_value_hmac`, `hmac_key_version`, `first_seen_at`, `last_seen_at`, `created_at`, `updated_at`
- Schema 默认值：`is_primary=0`, `is_verified=0`
- 可为 NULL：`source_candidate_snapshot_id`
- 推导/状态规则：
  - normalized_contact_value: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_link`

- 无默认值必填字段：`person_id`, `link_type`, `normalized_url`, `normalized_url_hmac`, `hmac_key_version`, `first_seen_at`, `last_seen_at`, `created_at`, `updated_at`
- Schema 默认值：`is_primary=0`
- 可为 NULL：`source_candidate_snapshot_id`, `account_handle`
- 推导/状态规则：
  - normalized_url: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_url_hmac: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_name`

- 无默认值必填字段：`person_id`, `display_name`, `normalized_name`, `name_source`, `first_seen_at`, `last_seen_at`, `created_at`, `updated_at`
- Schema 默认值：`is_primary=0`
- 可为 NULL：`source_candidate_snapshot_id`
- 推导/状态规则：
  - normalized_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G08 — candidate_profile

#### `candidate_certification`

- 无默认值必填字段：`candidate_snapshot_id`, `person_id`, `person_certification_id`, `certification_status_snapshot`, `created_at`
- Schema 默认值：无
- 可为 NULL：`issued_at_snapshot`, `expires_at_snapshot`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `candidate_education`

- 无默认值必填字段：`candidate_snapshot_id`, `person_id`, `person_education_id`, `source_resume_education_id`, `source_entry_order`, `created_at`
- Schema 默认值：`is_highest_degree=0`
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `candidate_position`

- 无默认值必填字段：`candidate_snapshot_id`, `person_id`, `person_position_id`, `source_resume_employment_id`, `source_entry_order`, `created_at`
- Schema 默认值：`is_primary_current_position=0`
- 可为 NULL：`is_current_at_snapshot`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `candidate_project`

- 无默认值必填字段：`candidate_snapshot_id`, `person_id`, `person_project_id`, `source_resume_project_id`, `source_entry_order`, `created_at`
- Schema 默认值：无
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `candidate_skill`

- 无默认值必填字段：`candidate_snapshot_id`, `person_id`, `person_skill_id`, `source_resume_skill_id`, `raw_skill_text`, `match_method`, `created_at`
- Schema 默认值：无
- 可为 NULL：`matched_context_text`, `proficiency_level_id_snapshot`, `proficiency_text_snapshot`, `years_experience_snapshot`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `education`

- 无默认值必填字段：`education_uuid`, `degree_id`, `raw_school_name`, `raw_degree_name`, `normalized_degree_name`, `education_description`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`school_id`, `field_study_id`, `major_id`, `normalized_school_name`, `raw_field_study_name`, `normalized_field_study_name`, `raw_major_name`, `normalized_major_name`, `gpa`, `education_start_date`, `education_end_date`, `is_current`
- 推导/状态规则：
  - normalized_school_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_degree_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_field_study_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_major_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_certification`

- 无默认值必填字段：`person_certification_uuid`, `person_id`, `certification_id`, `record_source`, `certification_instance_key`, `created_at`, `updated_at`
- Schema 默认值：`certification_status=unknown`
- 可为 NULL：`source_candidate_snapshot_id`, `credential_id`, `credential_url`, `issued_at`, `expires_at`
- 推导/状态规则：
  - certification_status: Certification status may be unavailable while the certification fact remains valid.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_education`

- 无默认值必填字段：`person_id`, `education_id`, `first_source_candidate_snapshot_id`, `first_source_resume_education_id`, `education_record_sha256`, `recorded_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_position`

- 无默认值必填字段：`person_position_uuid`, `person_id`, `first_source_candidate_snapshot_id`, `first_source_resume_employment_id`, `raw_company_name`, `raw_position_name`, `position_description`, `employment_record_sha256`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`company_id`, `position_id`, `function_id`, `seniority_id`, `location_id`, `employment_type_id`, `normalized_company_name`, `normalized_position_name`, `experience_type_text`, `position_start_date`, `position_end_date`, `is_current`
- 推导/状态规则：
  - normalized_company_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
  - normalized_position_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_project`

- 无默认值必填字段：`person_project_uuid`, `person_id`, `first_source_candidate_snapshot_id`, `project_name`, `project_description`, `project_record_sha256`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`normalized_project_name`, `project_role`, `project_url`, `project_start_date`, `project_end_date`
- 推导/状态规则：
  - normalized_project_name: Canonical importer must normalize the source value before INSERT; manual SQL must provide the reviewed normalized value.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `person_skill`

- 无默认值必填字段：`person_id`, `skill_id`, `first_source_candidate_snapshot_id`, `latest_source_candidate_snapshot_id`, `first_seen_at`, `last_seen_at`, `created_at`, `updated_at`
- Schema 默认值：无
- 可为 NULL：`current_proficiency_level_id`, `current_proficiency_text`, `current_years_experience`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G09 — machine_learning

#### `ml_analysis_run`

- 无默认值必填字段：`ml_analysis_run_uuid`, `application_id`, `candidate_snapshot_id`, `person_id`, `workflow_run_id`, `idempotency_key`, `application_fence_token`, `model_config_json`, `pipeline_code`, `pipeline_source_code_sha256`, `anomaly_rule_version`, `input_snapshot_sha256`, `resume_text_sha256`, `position_jd_sha256`, `input_feature_snapshot_json`, `started_at`, `created_at`, `updated_at`
- Schema 默认值：`model_name=all-MiniLM-L6-v2`, `model_provider=sentence_transformers`, `run_status=running`
- 可为 NULL：`model_revision`, `last_error_code`, `last_error_detail`, `completed_at`
- 推导/状态规则：
  - run_status: An ML analysis row is created when model processing starts.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `ml_anomaly_result`

- 无默认值必填字段：`ml_analysis_run_id`, `application_id`, `candidate_snapshot_id`, `has_any_anomaly`, `anomaly_flags_json`, `disposition`, `created_at`
- Schema 默认值：无
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `ml_recommendation_result`

- 无默认值必填字段：`recommendation_result_uuid`, `ml_analysis_run_id`, `application_id`, `candidate_snapshot_id`, `anomaly_result_id`, `recommendation_method`, `recommendation_decision`, `decision_reason_code`, `result_metadata_json`, `decided_at`, `published_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：`similarity_result_id`, `threshold_policy_id`, `match_score_snapshot`, `threshold_snapshot`, `passed_threshold`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `ml_similarity_result`

- 无默认值必填字段：`ml_analysis_run_id`, `application_id`, `candidate_snapshot_id`, `position_id`, `match_score`, `computed_at`, `created_at`
- Schema 默认值：`similarity_metric=cosine_similarity`
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `ml_threshold_policy`

- 无默认值必填字段：`threshold_policy_uuid`, `policy_family_code`, `policy_version`, `policy_name`, `policy_scope_type`, `match_score_threshold`, `policy_config_json`, `created_at`, `updated_at`
- Schema 默认值：`policy_status=draft`
- 可为 NULL：`policy_band_code`, `company_id`, `position_id`, `expected_retention_ratio`, `supersedes_policy_id`, `effective_at`, `retired_at`
- 推导/状态规则：
  - policy_status: Threshold policy versions require explicit activation.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G10 — hiring_pipeline

#### `application_stage_run`

- 无默认值必填字段：`application_stage_run_uuid`, `application_id`, `hiring_pipeline_id`, `pipeline_stage_id`, `workflow_run_id`, `idempotency_key`, `application_fence_token`, `actual_sequence_no`, `attempt_no`, `result_metadata_json`, `created_at`, `updated_at`
- Schema 默认值：`run_status=scheduled`
- 可为 NULL：`ml_recommendation_result_id`, `stage_outcome_code`, `score`, `maximum_score`, `passed_threshold`, `executor_type`, `executor_reference`, `result_summary`, `cancellation_reason_code`, `scheduled_at`, `started_at`, `waiting_since`, `completed_at`
- 推导/状态规则：
  - run_status: A newly created business stage run is scheduled before execution.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `application_stage_transition_event`

- 无默认值必填字段：`transition_event_uuid`, `application_id`, `hiring_pipeline_id`, `to_stage_run_id`, `to_stage_id`, `movement_type`, `reason_code`, `initiated_by_type`, `workflow_run_id`, `application_fence_token`, `idempotency_key`, `event_metadata_json`, `occurred_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：`configured_transition_id`, `from_stage_run_id`, `from_stage_id`, `initiated_by_reference`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `hiring_pipeline`

- 无默认值必填字段：`hiring_pipeline_uuid`, `pipeline_family_code`, `pipeline_version`, `hiring_pipeline_name`, `created_at`, `updated_at`
- Schema 默认值：`pipeline_status=draft`
- 可为 NULL：`pipeline_description`, `activated_at`, `retired_at`
- 推导/状态规则：
  - pipeline_status: Pipeline definitions require explicit publication before use.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `pipeline_stage`

- 无默认值必填字段：`pipeline_stage_uuid`, `hiring_pipeline_id`, `stage_code`, `pipeline_stage_name`, `stage_type`, `default_display_order`, `stage_config_json`, `created_at`, `updated_at`
- Schema 默认值：`is_initial=0`, `is_terminal=0`, `is_optional=1`, `is_repeatable=0`
- 可为 NULL：`max_business_attempts`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `pipeline_stage_transition`

- 无默认值必填字段：`pipeline_stage_transition_uuid`, `hiring_pipeline_id`, `from_stage_id`, `to_stage_id`, `transition_category`, `transition_condition_json`, `created_at`, `updated_at`
- Schema 默认值：`is_allowed=1`
- 可为 NULL：无
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

### G11 — offer

#### `offer`

- 无默认值必填字段：`offer_uuid`, `application_id`, `candidate_snapshot_id`, `creating_stage_run_id`, `decision_source`, `offer_fence_token`, `company_name_snapshot`, `position_title_snapshot`, `candidate_name_snapshot`, `candidate_email_snapshot`, `current_status_changed_at`, `created_at`, `updated_at`
- Schema 默认值：`current_status=draft`, `status_version=1`
- 可为 NULL：`ml_recommendation_result_id`, `current_offer_version_id`, `application_work_location_snapshot`, `application_work_mode_snapshot`, `requested_start_date_snapshot`, `requested_end_date_snapshot`, `work_duration_snapshot`
- 推导/状态规则：
  - current_status: An atomically created offer master begins as a draft.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `offer_status_history`

- 无默认值必填字段：`offer_status_history_uuid`, `offer_id`, `application_id`, `workflow_run_id`, `idempotency_key`, `to_status`, `initiated_by_type`, `reason_code`, `event_metadata_json`, `occurred_at`, `created_at`
- Schema 默认值：无
- 可为 NULL：`offer_version_id`, `stage_run_id`, `from_status`, `initiated_by_reference`, `note`
- 推导/状态规则：
  - from_status: The first offer transition has no preceding status; later transitions supply it explicitly.
  - to_status: Every history event must explicitly identify the resulting offer status.
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。

#### `offer_version`

- 无默认值必填字段：`offer_version_uuid`, `offer_id`, `version_no`, `terms_sha256`, `offer_title`, `offer_terms_json`, `prepared_by_type`, `created_at`
- Schema 默认值：无
- 可为 NULL：`employment_type_id`, `work_location`, `work_mode`, `employment_start_date`, `employment_end_date`, `work_duration`, `compensation_amount_minor_units`, `compensation_currency_code`, `compensation_period`, `signing_bonus_minor_units`, `target_bonus_description`, `equity_description`, `response_due_at`, `prepared_by_reference`
- 推导/状态规则：
  - 无特殊推导；使用正式 importer 或审核过的手写 SQL 模板。
- 常见失败：缺少必填值会触发 `NOT NULL`；无效父 ID 会触发 FK；重复业务键会触发 `UNIQUE`；非法状态或组合会触发 `CHECK`/Trigger。
