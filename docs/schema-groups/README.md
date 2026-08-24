# Active schema group design documentation

本目录集中保存当前仍在使用的 Schema 分组设计说明。

这些文件不是旧版 SQL、废弃 Schema 或归档资料。虽然可执行建表 SQL 已合并为一个完整文件，但这些文档描述的业务分组、表职责、边界、约束和设计理由仍然适用于当前 Schema。

- 可执行 Schema 的唯一权威来源：
  [`schema/HIREBEAT_D1_CREATE_2026-08-17.sql`](../../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)
- Schema 分组总览：
  [`00_master_table_groups.md`](../../00_master_table_groups.md)

## Group documentation

### Shared reference

- [`001_shared_reference_design.md`](shared_reference/001_shared_reference_design.md)

### Catalog

- [`001_company_design.md`](catalog/001_company_design.md)
- [`002_recruitment_catalog_design.md`](catalog/002_recruitment_catalog_design.md)

### Submission ingress

- [`003_submission_ingress_design.md`](submission_ingress/003_submission_ingress_design.md)

### Workflow control

- [`004_workflow_control_design.md`](workflow_control/004_workflow_control_design.md)
- [`004_workflow_control_beginner_guide.md`](workflow_control/004_workflow_control_beginner_guide.md)

### Submission processing

- [`005_submission_processing_design.md`](submission_processing/005_submission_processing_design.md)

### Dedup admission

- [`006_dedup_admission_design.md`](dedup_admission/006_dedup_admission_design.md)

### Application core

- [`007_application_core_design.md`](application_core/007_application_core_design.md)

### Candidate profile

- [`008_candidate_profile_design.md`](candidate_profile/008_candidate_profile_design.md)

### Machine learning

- [`009_machine_learning_design.md`](machine_learning/009_machine_learning_design.md)

### Hiring pipeline

- [`010_hiring_pipeline_design.md`](hiring_pipeline/010_hiring_pipeline_design.md)

### Offer lifecycle

- [`011_offer_lifecycle_design.md`](offer/011_offer_lifecycle_design.md)
