# Group G12 / G99：Deferred 与 Removed 统一确认

版本日期：2026-08-17  
状态：`confirmed review`

## 1. 两种状态不是同一件事

| 状态 | 意义 | 是否进入首版 CREATE.sql | 将来如何恢复 |
|---|---|---:|---|
| `deferred` | 有合理未来用途，但当前没有数据、外部能力或已验证写入流程 | 否 | 满足明确触发条件后，通过独立 migration 增加 |
| `removed` | 旧设计已被替代、当前业务取消，或概念本身不再适合新版 | 否 | 不能直接照搬恢复；必须重新做完整业务建模审核 |

不为“以后也许会用”提前创建空表，可以减少首版外键、索引、迁移和维护负担，同时保留清楚的扩展路线。

## 2. G12：11 张延后表

| 表 | 首版为什么不创建 | 何时触发 migration |
|---|---|---|
| `recruiting_policy` | 当前只有 Company 默认最多提交 5 次，尚无可靠的复杂 policy 数据 | 出现 Company/Position override、有效期、审批或多项规则版本化需求 |
| `system_configuration` | 当前非敏感静态配置可使用 Worker vars，敏感配置使用 Secrets | 需要管理员在不部署代码时修改、版本化和审计运行配置 |
| `submission_form_session` | Airtable/Google Form 不能可靠表达每个用户独立冻结的目录 session | 建设自有网页或受控 session gateway |
| `form_draft` | 当前不保存跨会话草稿 | 自有网页需要自动保存、恢复和过期草稿 |
| `offer_document` | 当前只创建 Offer master/version，没有正式文件生成服务 | 开始生成、保存、签发或电子签名 Offer 文件 |
| `offer_approval` | G10 Stage 足以记录当前简单审批 | 出现预算、法务、多级审批、审批人和 SLA 的独立生命周期 |
| `position_work_mode` | 首版只采用 Company Work Mode，可为空并退化为 Company → Position | 获得可靠岗位级模式数据，或某 Position 不能继承 Company 模式 |
| `ml_model_version` | 首版固定 `all-MiniLM-L6-v2` | 支持多模型、champion/challenger、shadow 或模型部署治理 |
| `ml_feature_pipeline_version` | 首版只冻结当前代码/config hash | preprocessing/features 需要独立于模型进行正式版本治理 |
| `ml_profile_cluster_result` | 单条实时流程不使用 KMeans/PCA 决策 | 出现冻结 cohort 的离线群体分析，并验证真实业务价值 |
| `ml_scorecard_result` | 原主观 Scorecard 未参与最终决定且缺少验证 | 权重经招聘方、标签、人工评估和公平性验证后恢复 |

与 G12 同时记录、但不是当前表名的 deferred 字段能力：

- `company_contact_info.contact_label`：只有未知 contact type 需要分类/路由/UI 时再加；
- Resume/JD chunk embedding：先离线验证后再改 ML Schema；
- `group_top_ratio`、rank、selection ratio：只有冻结 cohort 相对选择恢复时再加；
- Offer legal entity/legal name：只有法律文件流程具备权威采集与验证后再加。

## 3. G99：22 张删除或替代表

### 参考与位置结构

```text
experience_level
region
timezone
school_location
company_industry_code
company_name_aliases
company_location
```

原因：当前没有可靠数据或已由更简洁的 `seniority`、country/state/city/location、Company 核心字段替代。不会创建全空表或 `unknown` 行。

### 旧岗位周期与窗口

```text
position_application_cycle
specific_open_window
```

原因：没有真实岗位周期数据；实时查重冻结 `requested_start_year_month` 和 group key。未来若真正取得岗位 opening/cycle 数据，应作为新业务重新建模，而不是恢复大量 `unknown`。

### 旧批次和运行记录

```text
ingestion_batch
dataset_type
submission_processing_run
```

原因：新版以每条来源事件、intake run、Workflow/Step/Attempt 为权威控制平面；批量 adapter 也把每行排队成独立事件，不恢复 CSV batch 依赖。

### 旧附件与身份表

```text
submission_attachment
resume_external_identifier
identity_identifier
person_identifier_claim
```

原因：Resume 文件 metadata/R2 pointer 进入 `raw_submission_resume`；Submission identity 合并进 `submission_identity_feature`；正式 Person 历史由 `person_contact` 和 `person_link` 表达。

### 旧跨层与 Application 附属表

```text
application_submission
application_document
application_cluster
person_relocation_preference
candidate_reference
application_stage_history
```

原因：

- `application_submission` → `application_source_lineage`；
- `application_document` → Raw Resume + deferred Offer document；
- `application_cluster` → Application group key 和 Dedup 运行快照；
- relocation/reference 当前无写入流程；
- stage history → G10 `application_stage_run` + immutable transition event。

## 4. 与组员项目的差异

组员项目采用较小的 `companies/roles/applicants/applications/application_submissions` 模型，没有上述大多数扩展表。新版没有因为需要更丰富业务能力就把旧版全部 81 张表照搬回来，而是：

- 真实首版能力进入 82 张确认表；
- 不成熟但合理的扩展进入 G12；
- 已替代或无业务价值的旧实体进入 G99；
- 不允许 adapter 的自由文本 `findOrCreateCompany/Role` 替代权威 Catalog；
- 保留组员的 Airtable/Google adapter、JWT/Drive 获取、PyMuPDF 文本保真等可复用实现，但重新接入新版 Ingress/Workflow。

## 5. 与原版数据库/Colab 的差异

原版先建立广泛 Schema，再逐 Cell 导入，导致部分表长期为空、Application Cycle 全是 unknown、运行状态散落在输出和 CSV。新版反向设计：只有存在明确 owner、输入、写入 step、幂等规则和查询用途的表进入 initial Schema。

因此“新版 82 张”不表示机械增加复杂度：它包含原版没有的生产控制面（Ingress、Workflow、Outbox、版本与历史），同时删除 22 张不再适合的旧表，并延后 11 张没有当前写入能力的扩展。

## 6. 最终确认

1. 11 张 G12 表全部不进入首版 `CREATE.sql`。
2. 22 张 G99 表全部不进入首版 `CREATE.sql`。
3. Deferred 只在明确触发条件出现后通过 migration 增加。
4. Removed 不允许未经重新审核直接恢复旧定义。
5. 首版 importer/Workflow 不得向不存在的 deferred/removed 表写入。
6. 测试 CSV 可以报告 deferred capability 为未启用，但不得生成假数据库记录。

