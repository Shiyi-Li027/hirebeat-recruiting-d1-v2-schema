# HireBeat 新版 D1：Master Table Groups（Confirmed Revision 1）

版本日期：2026-08-17

## 1. 使用方式

新版数据库不再按原版81张表的顺序逐张复制，而是按业务边界和依赖关系分组确认。每确认一个 Group，都必须完成：

1. 表是否真的需要；
2. 每张表的粒度和所有权；
3. 字段、NULL、默认值、CHECK；
4. 主键、UUID、外键、`ON DELETE`；
5. 唯一约束与必要索引；
6. 写入它的 Workflow/step；
7. 幂等键和并发保护；
8. 状态机、Outbox、Trigger 判断；
9. 失败重试和补偿；
10. 与组员版和原版的逐项差异；
11. 旧数据迁移方式；
12. 只读测试 CSV 的输出内容。

状态定义：

- `confirmed`：字段和职责已确认，可进入最终 Schema。
- `draft`：已形成草案，仍需本组确认。
- `proposed`：建议首版创建，但尚未逐表确认。
- `deferred`：有明确未来用途，首版暂不创建。
- `removed`：新版明确不创建，由其他表/流程替代或业务已取消。

## 2. Group 00 — 全局规范

这不是数据库表，而是全部表共同遵守的设计规则：命名、主键、UUID、时间、NULL、外键、删除行为、状态机、Outbox、幂等、历史和迁移规则。

当前状态：`confirmed`，Revision 1（2026-08-17）。

## 3. Group 01 — 共享参考数据与人才分类字典

这些表是多个业务模块共享的低频参考数据，不属于某一次申请。

当前状态：`confirmed`（2026-08-13）。

### 首版建议创建

```text
function
seniority
contact_type
skill_type
skill
skill_type_assignment
skill_proficiency_level
certification_type
issuing_organization
certification
country
state
city
location
degree
field_study
major
school
work_mode
position_employment_type
position_occupational_type
```

### 已确认不创建

```text
experience_level
region
timezone
school_location
```

主要变化：

- 原版把很多参考表提前建好，但部分从未导入数据；新版只保留已确认会被 Catalog、Candidate 或 Certification 使用的参考实体。
- 原版 `skill.skill_type_id` 强制一条 Skill 只能属于一种类型；新版用 `skill_type_assignment` 支持一条规范 Skill 同时属于多个类型。
- 组员版没有完整参考字典，Company/Role/work mode 主要以字符串处理。

## 4. Group 02 — 招聘 Catalog 与表单目录同步

这是 Airtable、Google Form 和未来网页选择列表的权威来源。

### 首版建议创建

```text
company
company_contact_info
company_work_mode
position
position_salary_range
position_skill
position_education_requirement
position_certification_requirement
catalog_revision
catalog_sync_run
catalog_sync_target_run
```

### 已确认不创建

```text
company_industry_code
company_name_aliases
company_location
position_application_cycle
specific_open_window
```

当前状态：`confirmed`，Revision 2（2026-08-17）；首版共 11 张 G02 表。已确认删除 `company_domain`、`company_logo_url`、`company_legal_name`，并将 `position_work_mode` 延后。

主要变化：

- 组员 Worker 的 `findOrCreateCompany`/`findOrCreateRole` 将表单字符串直接升级成正式目录；新版禁止这样做。
- 原版 Company/Position 主要服务一次性导入与 ML 映射；新版 Catalog 直接驱动可申请选项和 active 验证。
- 不建立 Application cycle 表；查重使用申请人 requested start year-month 代理分组。

## 5. Group 03 — Ingress 与原始提交

负责 Airtable/Google Form 的一条来源事件可靠落入 D1。Ingress 不属于 Workflow A。

### 首版建议创建

```text
raw_submission_intake_run
raw_submission
raw_submission_resume
```

职责：

- `raw_submission_intake_run`：记录 Raw 接收、技术 envelope 校验、幂等复用、失败和技术重送；不保存完整敏感 payload，也不表示申请人业务重复申请。
- `raw_submission`：忠实保存成功接收的原始结构化业务字段和来源身份；简历文本、parser provenance 与 R2 引用垂直拆入一对一 `raw_submission_resume`。

当前状态：`confirmed`，Revision 1（2026-08-17）。终结性 NULL Resume 仍允许 Raw/Resume 落地；由 Workflow A Initial Cleaning 阻止继续发布，不再使用 Ingress `rejected_input` 状态。

### 已确认不创建

```text
ingestion_batch
dataset_type
submission_attachment
```

主要变化：

- 原版按文件批次、来源行号和 CSV 驱动；新版默认一条实时事件一个 intake/run，也允许 adapter 排队逐条处理批量来源。
- 组员版把 raw 与 parsed/status 都集中在 `application_submissions`；新版分离 raw、运行控制、normalized 和 extraction。

## 6. Group 04 — Workflow、重试、补偿、Outbox 与审计

这是整套生产流程的控制平面。

### 首版建议创建

```text
etl_workflow_run
etl_step_run
etl_step_attempt
outbox_event
audit_event
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

主要变化：

- 组员版没有持久化 Workflow/step/attempt/Outbox；失败主要由一次 Worker 调用结果体现。
- 原版依赖 Colab cell output、CSV 和人工继续运行；新版所有权威运行状态进入 D1。
- `outbox_event` 不替代错误日志；它只负责可靠交接已提交的业务事件。
- 第一版业务 SQL Trigger 为0。

## 7. Group 05 — Submission 标准化与简历结构化提取

这些表属于 Workflow A 的可重试派生结果，在 Application 发布前仍属于 Submission 层。

### 首版建议创建

```text
normalization_run
submission_normalized
resume_extraction
resume_education
resume_employment
resume_skill
resume_project
submission_identity_feature
```

当前状态：`confirmed`（2026-08-17；7 项关键边界全部确认，SQL 已通过本地结构验证）。

对应文件：

```text
submission_processing/005_submission_processing_design.md
submission_processing/005_submission_processing_draft.sql
```

### 被替代或合并

```text
submission_processing_run → etl_workflow_run / etl_step_run / etl_step_attempt
resume_external_identifier → submission_identity_feature
```

主要变化：

- 原版 Education/Employment 提取 CSV 再导入 Candidate；新版首先把每一步的权威提取结果存进 D1。
- 新增 `resume_skill` 和 `resume_project`，避免这两类提取只存在覆盖式 CSV。
- 组员版只把完整 `resume_text` 和 parse status 写回 Submission，没有学历、工作、技能和项目的结构化持久层。

## 8. Group 06 — 查重与 Application 准入

### 首版建议创建

```text
submission_dedup_run
submission_dedup_match
submission_match_evidence
```

当前状态：`confirmed`（2026-08-17；9 项业务边界全部确认，SQL 已通过本地结构验证）。

对应文件：

```text
dedup_admission/006_dedup_admission_design.md
dedup_admission/006_dedup_admission_draft.sql
```

### 已确认不创建

```text
submission_cluster
application_cluster
identity_identifier
person_identifier_claim
```

主要变化：

- 一条 `submission_dedup_run` 表示目标 Submission 的一次规则运行。
- 一个 run 可以对应多个 `submission_dedup_match`。
- 每个候选配对的具体邮箱、电话、LinkedIn、GitHub 等证据进入 `submission_match_evidence`。
- 不把多个 matched Submission ID 塞进 dedup run 的单个字段。
- 组员版只使用 applicant + role + 提交自然月；新版使用 Company + Position + requested start year-month 分组，再使用身份特征证据匹配。
- 原版显式 Application cluster/Position cycle 表删除，分组键以运行快照字段保存。

## 9. Group 07 — Person、Application、Candidate 核心

这是 Workflow A 成功发布后的干净业务层。

### 首版建议创建

```text
person
person_name
person_contact
person_link
application
application_source_lineage
candidate_snapshot
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

对应文件：

- `application_core/007_application_core_design.md`
- `application_core/007_application_core_draft.sql`

主要变化：

- 合法重申复用 Person，但创建新的 Application 和 Candidate snapshot。
- 首版以 exact normalized email 作为 Person identity key；未合并 Person 的当前 normalized email 唯一。
- 同邮箱不同姓名追加 `person_name` 历史，不增加 `blocked_identity_conflict`。
- 旧 Application 变为 `superseded`，保存替代关系，并撤销旧 Workflow 决策资格。
- `application_source_lineage` 保存所有来源历史；Application 不再重复保存当前来源性能指针。
- 组员版文档声称一条 Application 可有多个 Submission，但实际代码每条来源记录创建新的 Application，且没有正式 lineage/supersede。
- 原版 `Application_submission` 被职责更清晰的 `application_source_lineage` 替代。

## 10. Group 08 — Candidate/Person 人才档案

### 首版建议创建

```text
education
person_education
candidate_education
person_position
candidate_position
person_skill
candidate_skill
person_project
candidate_project
person_certification
candidate_certification
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

对应文件：

- `candidate_profile/008_candidate_profile_design.md`
- `candidate_profile/008_candidate_profile_draft.sql`

### 已确认不创建

```text
person_relocation_preference
candidate_reference
```

主要变化：

- Person 表示长期主档；Candidate 表示某次 Application 的不可变快照。
- 新重申追加新 profile records/snapshot association，不改写旧 Candidate 当时使用的数据。
- 组员版只有 applicants/applicant_emails，没有教育、工作、技能、项目、证书的长期档案和申请快照双层模型。

## 11. Group 09 — 实时 ML 分析与推荐

### 首版建议创建

```text
ml_threshold_policy
ml_analysis_run
ml_anomaly_result
ml_similarity_result
ml_recommendation_result
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

对应文件：

- `machine_learning/009_machine_learning_design.md`
- `machine_learning/009_machine_learning_draft.sql`

主要变化：

- 首版固定使用 `all-MiniLM-L6-v2`，不创建多模型或 feature-pipeline version 表；当前模型、配置和代码 hash 冻结在每次 analysis run。
- 生产 Workflow 只保留 anomaly、embedding、cosine similarity 和 fixed-threshold recommendation。
- KMeans、PCA、主观 Scorecard、group-top-ratio 和候选人排名退出实时生产流程并移入未来优化清单。
- Threshold policy 仍可按 Position、Company、Global 版本化更新，因为业务阈值调整不等于模型版本升级。
- 每个 Application 只允许一条正式 Recommendation；Recommendation、Application decision 和条件性 Offer draft 在最终短事务共同发布。
- 组员版没有 ML 层。
- 原版 ML 主要输出 CSV；新版只持久化真正参与生产决策的依据，不保存未使用的实验结果。

## 12. Group 10 — Hiring Pipeline 与招聘阶段运行

### 首版建议创建

```text
hiring_pipeline
pipeline_stage
pipeline_stage_transition
application_stage_run
application_stage_transition_event
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

对应文件：

- `hiring_pipeline/010_hiring_pipeline_design.md`
- `hiring_pipeline/010_hiring_pipeline_draft.sql`

### 被替代

```text
application_stage_history → application_stage_run + application_stage_transition_event
```

主要变化：

- Pipeline 是流程模板；Stage 是模板节点；Stage run 是某个 Application 的实际尝试；transition event 保存实际跳转路径。
- `default_display_order` 只表示模板顺序；`actual_sequence_no` 保存每个 Application 的真实顺序，因此个别跳过、返回或重复不需要创建新 Pipeline。
- Stage `attempt_no` 是业务上的重复面试/笔试次数；网络或 Worker 技术 retry 继续存 G04。
- 支持跳过、返回、重复笔试/面试、ML recommendation 直接决策。
- 新重申必须终止/栅栏旧 Application 的运行，防止它继续创建 Offer。
- 组员版没有招聘阶段模型。
- 原版已有 Pipeline/Stage/transition/run/history，但新版移除功能重叠并增加实时并发保护。

## 13. Group 11 — Offer 生命周期

### 首版建议创建

```text
offer
offer_version
offer_status_history
```

### 延后创建

```text
offer_document
offer_approval
position_work_mode
```

当前状态：`confirmed`，Revision 1（2026-08-17）。

对应文件：

- `offer/011_offer_lifecycle_design.md`
- `offer/011_offer_lifecycle_draft.sql`

主要变化：

- `offer.application_id` 和 `offer.candidate_snapshot_id` 使用正式外键，删除行为 `RESTRICT`。
- Workflow B 最后一次 D1 batch 同时提交 ML result、stage result、Application decision/status、Offer draft 和 Outbox。
- Offer master 保存作出决定时的公司、岗位、候选人和 Application 输入快照；最终日期、work mode 和 compensation 条款保存在不可变 `offer_version`。
- `offer_created` 只在 Offer row 确实成功创建后成立。
- Draft 条款未知时允许暂时没有 Version；进入 ready-to-send 及之后必须有 Version。
- Offer 生命周期使用 current state cache + immutable status history + optimistic status version + fence。
- 组员版没有 Offer 层。
- 原版已有 Offer/version/history，但新版权限、状态机、原子创建和 Outbox 交接更明确。

## 14. Group 12 — 当前明确延后的扩展

以下不是删除，而是当前没有真实写入流程或外部能力时不提前建表：

```text
recruiting_policy
system_configuration
submission_form_session
form_draft
offer_document
offer_approval
position_work_mode
ml_model_version
ml_feature_pipeline_version
ml_profile_cluster_result
ml_scorecard_result
```

触发建立条件：

- `recruiting_policy`：Company/Position submission limit、ML authority 或其他政策需要版本化。
- `system_configuration`：可变系统配置不能继续安全地使用 Worker vars 时。
- `submission_form_session`/`form_draft`：开始建设自有申请入口或可控 session gateway 时。
- `offer_document`：正式生成、保存或签发 Offer 文件时。
- `offer_approval`：需要独立预算/人工审批记录，而不只是 stage decision 时。
- `position_work_mode`：取得真实岗位级 Work Mode 数据，或 Company Work Mode 不能再默认适用于该公司全部 Position 时。
- `company_contact_info.contact_label`：出现按未知联系方式类型分类、路由、格式校验或 UI 展示的真实需求时，再通过 migration 增加，并回填历史 `contact_type_id IS NULL` 记录。
- `ml_model_version` / `ml_feature_pipeline_version`：开始支持多个模型、shadow evaluation、历史回测或正式 deployment governance 时增加。
- `ml_profile_cluster_result`：出现冻结 cohort 的真实群体分析需求，并证明 KMeans 结果有业务价值时增加；PCA 仍只作为可视化。
- `ml_scorecard_result`：主观权重经过招聘方确认、标签或人工评估验证及公平性检查后再增加。
- `group_top_ratio` 及排名字段：只有恢复冻结 cohort 的相对比例选择时才通过 migration 增加，不能用于实时单条 Offer 决策。

当前状态：`confirmed deferred review`（2026-08-17）。以上对象全部不进入首版 `CREATE.sql`；只有对应触发条件真实出现后，才通过独立 migration 建立。

## 15. Group 99 — 已删除或替代的旧表

当前状态：`confirmed removed review`（2026-08-17）。

以下 22 张旧表不会进入首版 Schema：

```text
experience_level
region
timezone
school_location
company_industry_code
company_name_aliases
company_location
position_application_cycle
specific_open_window
ingestion_batch
dataset_type
submission_processing_run
submission_attachment
resume_external_identifier
identity_identifier
person_identifier_claim
application_submission
application_document
application_cluster
person_relocation_preference
candidate_reference
application_stage_history
```

它们由更明确的 reference 层级、实时 intake/workflow、`submission_identity_feature`、`application_source_lineage`、稳定 group key、G10 stage run/transition event 等结构替代，或因为当前没有可靠数据和真实写入流程而明确删除。`removed` 与 `deferred` 不同：removed 不等待某个简单触发条件恢复；未来若重新需要，必须重新进行完整业务建模审核。

## 16. 完整确认顺序

建议严格按以下顺序确认：

```text
00 全局规范
01 共享参考数据
02 Catalog 与目录同步
03 Ingress/raw submission
04 Workflow/Outbox/audit
05 Normalization/extraction
06 Dedup/admission
07 Person/Application/Candidate core
08 Candidate profile
09 ML
10 Hiring pipeline
11 Offer
12 Deferred review
13 全库外键、索引、状态和迁移总审计
```

G00–G11 已全部确认；G12 deferred 和 G99 removed 已完成统一审核。`position_work_mode` 留在 deferred，首版只使用 Company Work Mode。

## 17. 最终数量说明

Master Inventory 中：

- `initial` 表表示已确认进入首版 Schema；
- `deferred` 表不会进入第一版 `CREATE.sql`；
- `removed` 表只留在迁移/差异台账，不会创建。

本轮确认后的首版初始表数量冻结为 82 张；deferred 11 张、removed 22 张均不进入首版 `CREATE.sql`。最终组装文件仍需执行全库依赖顺序、空库创建、外键、索引和关键插入路径审计。
