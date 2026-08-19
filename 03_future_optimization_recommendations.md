# HireBeat 新 D1 数据库与 Workflow 未来优化建议

版本日期：2026-08-17  
用途：记录已讨论但明确不进入首版 Schema/Workflow 的能力。只有出现真实数据、业务需求和验证结果后，才通过 migration 与新版 Workflow 引入。

## 1. ML 多模型版本与部署治理

首版固定使用 `all-MiniLM-L6-v2`，不创建 `ml_model_version` 或 `ml_feature_pipeline_version`。

未来出现多 embedding model、shadow evaluation、历史回测、champion/challenger，或 artifact/feature/preprocessing 需要正式版本治理时再增加。未来实现必须保证：终态 Application 不因模型升级自动重新决策；shadow/回测结果只能 advisory；一个 Application 最多一个正式决定和一条 Offer；已启动 Workflow 使用冻结版本。

## 2. KMeans Candidate Profile Clustering 与 PCA

首版实时每次处理一条 Application，KMeans/PCA 不参与 Offer 决策，因此不运行也不入库。

未来只有在存在明确冻结 cohort、招聘方需要群体分析、且聚类被证明支持真实业务时，才增加离线 analytics workflow 和 `ml_profile_cluster_result`。PCA 只作为可视化，不作为录取依据。

## 3. Rule-based Scorecard

旧版加权 Scorecard 具有主观权重且最终未参与 Offer 判断，因此首版删除 `ml_scorecard_result`。

未来只有在权重经招聘方正式确认、有标签或人工评估验证、完成公平性与稳定性检查，并明确 advisory/正式权限后才恢复。

## 4. Group Top Ratio、排名与冻结 Cohort

首版实时决策只使用 fixed similarity threshold，不保存：

```text
group_top_ratio
selection_ratio
round_up_selection
group_size
selected_count_in_group
rank_within_group
selection_ratio_snapshot
```

未来若恢复，必须定义 cohort 开始/关闭/冻结时间、统一决策时点、取整和最低人数、后到申请影响，以及禁止相对排名覆盖已创建 Offer。旧版 CSV 只作为历史实验材料。

## 5. Resume/JD 长文本分块 Embedding

当前继续使用原版完整 Resume/JD 输入。未来建议把 Resume 按 Education/Employment/Skills/Projects 分块，把 JD 按 Responsibilities/Requirements/Skills 分块，分别 embedding 后按经过验证的业务权重合成。

当前 Cloudflare Worker 调用私有 Cloud Run 使用专用、最小权限的 Google
service-account key 换取短期 audience-bound ID Token。未来如果 Cloudflare
运行环境能够提供适合本项目的受信 OIDC workload identity，应迁移到 Google
Workload Identity Federation，并删除长期 service-account private key。

该方案必须先与当前基线做离线比较，确认准确性、成本和延迟收益后再进入生产。

## 6. OCR 与大模型 PDF 解析采用独立异步步骤

首版继续使用面向普通 Resume PDF 的 Parser，并采用独立的单次请求超时。未来如果加入耗时明显更长的 OCR、版面分析、多模态模型或大语言模型 PDF 解析，不应为了兼容慢任务而直接扩大所有 Parser 的统一超时。

未来更合理的演进方式是：

- 将 OCR 或大模型解析建立为独立异步 Workflow step；
- 为不同 parser class 分别设置 timeout、最大尝试次数和 retry policy；
- 保存 parser name、parser version、输入文件 hash 和结果状态；
- 让普通 PDF-to-text 请求继续保持较短、可预测的 timeout；
- 长任务通过 Queue/Workflow 调度，不在同步 HTTP 请求中长时间等待；
- 技术失败与“成功解析但没有文本”必须保持不同状态。

只有真实 OCR/LLM parser、延迟数据和成本数据出现后，才增加对应步骤、状态或配置，不能提前把所有解析请求统一变慢。

## 7. Versioned System Configuration 的后续治理

早期方案曾计划等管理员需要“不重新部署 Worker 即可修改参数”时再创建 `system_configuration`。当前决定已更新并冻结为：在生产 Ingress/Workflow 正式上线前建立 `system_configuration_release` 与 `system_configuration` 两张版本化配置表，而不是一张允许随意原地覆盖的 current-value 键值表。首版不创建 `environment_name` 字段。

首版只管理非敏感技术参数，例如 parser timeout、active intake stale、最大尝试次数、文件大小限制和 Outbox 投递参数。HMAC、API token、service-account private key 等仍必须使用 Cloudflare Secrets；招聘政策、ML threshold 和 Offer policy 仍保存在各自的业务表中。

未来可进一步增加：

- 管理员配置界面；
- draft、validation、activation、supersede 和 rollback 操作；
- 配置发布审批；
- 配置变更的独立 audit event；
- Worker 短时缓存和失效通知；
- 不同 environment 的配置发布；
- 将每次 intake/workflow 采用的 configuration release 冻结到运行记录中。

配置表首版采用最小必要数据库约束；可选说明、操作者、激活时间和终止时间允许 `NULL`。不可缺少的身份、归属、状态和值字段保留 `NOT NULL`，避免数据库产生无法读取或无法归属的配置行。首版删除 `value_type` 和 `is_sensitive`；Secret 不进入配置表，只使用 Cloudflare Secrets。已确认建立 partial unique index，确保同一时间最多只有一个 `active` release；该索引以后可以直接 `DROP INDEX`，不需要重建配置表。

## 8. 暂不建立的 Retry/Timeout 扩展表

首版不建议：

- 新建独立 `timeout` 表；
- 新建通用 `retry_policy` 表；
- 新建 `raw_submission_intake_attempt`；
- 把所有技术错误复制到 `audit_event`；
- 修改已经部署的 `0001_initial_schema.sql` 或 `0002_add_resume_file_integrity.sql`。

`raw_submission_intake_attempt` 继续保留在 deferred 清单。当前 `raw_submission_intake_run` 保存汇总状态、总尝试次数和最后一次安全错误摘要；只有将来确实需要逐次回答“Ingress 第 1 至第 5 次分别在什么时间、由哪个 Worker 执行、因为什么失败”时，才通过新 migration 增加 immutable attempt history。

`audit_event` 仍只记录重要业务或管理事件，不充当完整技术日志副本。详细 Worker exception、stack trace 和高频诊断信息应进入 Cloudflare Logs/Observability；D1 只保存安全、可查询、与业务审计有关的摘要。

## 9. 用生产指标重新校准 Timeout 与 Retry

首版 timeout、stale window 和最大重试次数只是合理的 bootstrap defaults。生产运行后至少收集：

- PDF 文件大小分布；
- Parser p50、p95、p99 延迟；
- Parser timeout 比例；
- 每种错误代码的数量和占比；
- 平均处理尝试次数；
- 最终成功发生在第几次尝试；
- stale takeover 数量；
- 同一 Submission 的并发请求数量；
- Outbox 投递延迟；
- `failed_terminal` 比例。

来源 PDF 下载与 Parser 是两个不同的网络阶段。首版代码已把 source
download timeout 作为显式依赖传入，但尚未偷用 `parser_timeout_ms`。接通
生产 orchestration 前应发布独立的 `submission_ingress.pdf_download_timeout_ms`
配置；生产指标成熟后，分别按来源下载延迟与 Parser 延迟校准，不能用一个
timeout 同时掩盖两种故障。

建议累计至少数百至一千份真实 Resume，或连续运行两至四周后进行第一次校准。Parser timeout 可采用以下经验基线：

```text
Parser timeout = 正常成功请求的 p99 延迟 + 安全余量
```

如果大量正常请求在 25 至 30 秒之间成功，应评估提高 timeout 或拆分慢 parser；如果 99.9% 请求在 3 秒内完成，则 30 秒可能过长。每次调整必须发布新的 configuration release，并保留旧 release 以支持历史解释和安全回滚，不能静默修改历史 Workflow 已冻结的参数。

## 10. Versioned Reference Data Release

首版不为全部 G01 Reference tables 创建逐行版本表。当前使用稳定 ID/code/UUID、`is_active` 软停用、重要变更 `audit_event`、Application/ML/Offer 快照和 G02 `catalog_revision` 已足以保护首版业务历史。

如果未来出现以下真实需求，再通过新 migration 增加统一 `reference_data_release`：

- Skill、Degree、School、Certification 等 Reference 数据开始频繁发布；
- 需要严格复现某次 normalization、extraction 或 ML 当时看到的完整 Reference 集合；
- 管理员需要 draft、审核、发布、回滚整套 Reference 数据；
- 同一 Workflow 的 retry 必须保证始终使用完全相同的 Reference release；
- 多个 Worker 或管理工具需要原子切换到同一版 Reference 数据。

未来设计应优先采用“一次发布对应一个不可变 release”，并在 `etl_workflow_run` 或具体 extraction run 冻结 `reference_data_release_id`，而不是为 21 张表分别建立互不协调的版本号。旧 release 保留用于审计和复现；新业务只读取 active release。Reference release 不替代 G02 的 `catalog_revision`：前者管理共享分类和人才词汇，后者管理可提交的 Company、Company Work Mode 与 Position 选项快照。

## 11. 外部 Reference/Catalog 来源身份与 Source-aware Upsert

首版暂不建设 Airtable、Google Form/Sheets 或其他外部系统的 G01 Reference、G02 Company/Position 管理提交窗口和自动同步流程，因此不提前创建 `company_source_identity`、`position_source_identity`，也不实现通用 source-aware upsert。当前受控管理路径继续使用 Operations API 的显式 `POST`/`PATCH`、内部稳定 UUID、命令幂等键、`audit_event` 和 `catalog_revision`。

只有未来确认外部 Catalog/Reference 同步渠道、能够取得可靠的来源记录身份，并明确字段所有权后，才通过新 migration 增加来源映射。建议的核心信息包括：

```text
source_system
source_record_id
company_id / position_id
first_seen_at
last_seen_at
source_payload_hmac
```

来源映射必须至少具有：

```text
UNIQUE(source_system, source_record_id)
```

未来 importer 的固定处理顺序应为：

```text
使用 source_system + source_record_id 查询来源映射
→ 不存在：创建正式实体，并在同一短事务建立来源映射
→ 已存在：读取正式实体并比较规范化字段
    → 无变化：返回 unchanged，只更新必要的 last_seen 信息
    → 有变化：按字段所有权和业务规则 PATCH 原实体
→ 写入重要更新 audit_event
→ 只有有效 Catalog 选项快照变化时发布 catalog_revision
```

并发首次导入必须依赖来源唯一约束：两个 writer 同时创建同一来源映射时，只允许一个成功；另一个捕获唯一冲突后重新查询并转为复用或更新，不能创建重复实体。

`normalized_company_name`、`normalized_position_name` 只用于检索、候选匹配和人工排重，不能代替来源身份。公司可能改名，同一公司可能存在同名岗位，名称的拼写与标点也可能变化。接入前还必须明确“同一来源记录发生名称变化”究竟是原实体重命名，还是来源错误地复用了记录；不能让数据库仅凭内容相似度自行覆盖。

该 deferred 能力不适用于 `raw_submission` 的静默覆盖。Submission Ingress 已使用 `submission_uuid`、`source_event_key` 和 `source_system + source_record_id` 识别同一来源事件；同一来源身份携带不同 payload 时应记录冲突或显式产生新修订/事件，不能重写原始申请证据。

### 外部 Catalog 同步的目标级 Queue / Outbox

将来正式启用 Airtable、Google Form 或其他 Catalog external sync 时，应为每个实际同步目标建立独立 Queue 或 Outbox 投递记录，而不是用一条全局成功状态代表全部渠道。每条目标记录冻结 `catalog_revision_id`、目标系统与表单/视图身份、幂等键、attempt、lease、next attempt 和最终状态。Airtable 成功但 Google 失败时只重试 Google；429、5xx 和网络错误自动退避，权限、字段映射、目标删除等永久错误直接 terminal/DLQ。该能力届时通过新 migration 增加，当前版本不提前创建来源窗口或目标表。

该未来能力还必须遵守当前自动恢复策略的共同语义：`max_attempts`
表示包括首次在内的总尝试次数；每个目标独立幂等、独立 lease、独立退避、
独立 terminal 状态；不能因为一个目标失败而回滚已经成功的其他目标，也不能
通过删除 `catalog_revision` 来“回滚”外部系统。恢复方式应是重试失败目标或发布
新的 revision/补偿事件。具体设计在外部同步渠道真正启用时再通过新 migration
与独立验收用例落地。

## 12. Offer 回复期限治理与自动过期门禁

首版继续保留 `offer_version.response_due_at` 为 nullable，不设置数据库
`DEFAULT`，也不使用硬编码的固定回复期限。Draft Offer 在条款尚未确定时可以
没有回复截止时间；当前 scheduled reconciler 只会自动过期当前版本具有
`response_due_at`、且状态为 `sent` 或 `viewed` 的 Offer。`response_due_at IS
NULL` 的 Offer 不会被自动变为 `expired`。

以下增强明确延期，不作为当前数据库、Ingress、Workflow A/B、ML、Offer draft
或其他日常流程成功运行的前置条件：

- Offer 进入 `sent` 前，要求当前 Offer version 具有合法的
  `response_due_at`；
- Operations API 严格验证该值为 RFC 3339 UTC timestamp，并要求它晚于实际
  发送时间；
- 回复期限优先由授权招聘人员明确选择；
- 未显式选择时，根据已激活且已冻结的 Offer policy/configuration 自动计算，
  例如 `sent_at + default_offer_response_window_days`；
- 默认天数进入版本化业务政策或 `system_configuration`，不得硬编码在 Worker，
  也不得设置成 Schema 的固定日期默认值；
- 截止时间发生变化时创建新的 immutable `offer_version`，并更新
  `offer.current_offer_version_id`，不得 UPDATE 已发布的旧版本；
- 增加发送门禁、无截止时间 Offer 的监控指标，以及合法/非法/过去时间/时区边界
  的自动化验收用例。

在上述增强落地前，业务和操作边界必须明确：创建或发送 Offer 的调用方负责提供
正确的绝对截止时间；未提供时系统不会自动过期；当前 API 尚不能把任意非空字符串
完全证明为合法时间，因此只有受控调用方应写入该字段。此延期不会破坏当前数据库
事务、状态机或 Workflow 的正常执行，但会留下“已发送且没有截止时间的 Offer
长期保持 `sent`/`viewed`”以及格式错误导致自动过期不可靠的业务治理风险。该风险
属于 Offer 生命周期完整性问题，不应被解释为 Candidate、Application 或 ML 处理
失败。

## 13. Position JD 全文历史版本（按需增加）

首版继续把 `position.position_jd` 作为当前权威岗位 JD，允许受控更新，并通过
Position 更新审计、Catalog revision、Application/ML 输入快照和不可变结果保留
首版所需的业务解释能力。暂时不增加 `position_revision`，也不改变现有 Position
表、Workflow A/B、Catalog 或 ML 设计。

如果将来出现“必须精确保留每一次历史 JD 全文，并能够证明某个时间点招聘方发布
给申请人或提供给 ML 的完整 JD 内容”的真实要求，再通过新 migration 增加
`position_revision`。建议届时至少考虑：

```text
position_id
revision_number
position_jd
position_jd_sha256
revision_status
effective_from / effective_to
change_reason
created_by
created_at
```

每个 revision 应 append-only，并由 Position 或发布记录指向当前 revision；已经被
Application、ML run 或表单 Catalog 发布使用的 revision 不允许原地修改。JD 更新
创建新 revision，旧 revision 保留用于审计、重放和争议解释。只有当全文历史查询、
法律审计、模型可复现或多版本岗位发布成为明确需求时才引入该复杂度。

因此最终决策是：如果将来要求精确保留每个历史 JD 全文版本，可以再增加
`position_revision`；首版暂时不需要增加，不改变现有设计。
