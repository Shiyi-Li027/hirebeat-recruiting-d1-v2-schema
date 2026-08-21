# HireBeat 新 D1 数据库与 Workflow 未来优化建议

版本日期：2026-08-19
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

当前 provider-native 阶段已经提供 Airtable、Google Form 的申请入口桥接和 G02 Catalog 选项写入模板，但没有把外部系统升级为 G01 Reference 或 G02 Company/Position 的权威管理来源。因此仍不创建 `company_source_identity`、`position_source_identity`，也不实现通用 source-aware upsert。当前受控管理路径继续使用 Operations API 的显式 `POST`/`PATCH`、内部稳定 UUID、命令幂等键、`audit_event` 和 `catalog_revision`；provider 只消费已发布的目录快照并投递申请。

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

正式启用 Airtable、Google Form 或其他 Catalog external sync 时，应为每个实际同步目标建立独立 Queue 或 Outbox 投递记录，而不是用一条全局成功状态代表全部渠道。初始 Schema 已有 `catalog_sync_run` 与 `catalog_sync_target_run`，可冻结 `catalog_revision_id`、目标系统与表单/视图身份、attempt、next attempt 和最终状态。Operations API 的幂等 start/result commands、目标级状态聚合、审计证据和 Google Form 结果回报已实现，并已在 staging 通过真实 Google Form Catalog Sync 验证。自动消费 `failed_retryable` / `next_attempt_at` 的 Queue/Outbox dispatcher 仍属于后续能力。Airtable 成功但 Google 失败时只应重试 Google；429、5xx 和网络错误应自动退避，权限、字段映射、目标删除等永久错误应直接 terminal/DLQ。只有在现有列不足以表达 lease、逐目标幂等键或 DLQ 关联时才增加 migration，不能错误地重复创建已经存在的目标表。

该未来能力还必须遵守当前自动恢复策略的共同语义：`max_attempts`
表示包括首次在内的总尝试次数；每个目标独立幂等、独立 lease、独立退避、
独立 terminal 状态；不能因为一个目标失败而回滚已经成功的其他目标，也不能
通过删除 `catalog_revision` 来“回滚”外部系统。恢复方式应是重试失败目标或发布
新的 revision/补偿事件。当前 command 与 Google Form 结果报告已落地；自动 dispatcher、失败目标
独立重试和相应验收用例仍须在需要自动恢复的 production 外部同步渠道启用前完成；
是否需要 migration 由现有字段差距决定。

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

## 14. 独立 Company、Position、Mode 的任意顺序联动申请页（未来优化）

当前 Google Form 首版继续使用已经通过 staging 端到端验收的单一组合选项：

```text
Company — Position — Work Mode [HB:r<revision>:p<position_id>:w<company_work_mode_id>]
```

这个方案只向申请人展示数据库当前发布的有效组合，冻结 Catalog revision 和稳定
关系 ID，不允许生成非法的 Company、Position、Mode 组合，也不会因为多个申请人
同时填写而互相改写原生 Form 的全局下拉选项。首版不把三个维度拆成原生 Google
Form 的独立问题。

如果未来产品明确要求 Company、Position、Mode 三个字段可以按任意顺序选择，并且
每次选择都实时缩小其余一个或两个字段的候选范围，应改为自定义申请页面，例如
Apps Script HTML Web App 或 Cloudflare Pages/Worker 页面，而不是继续扩展原生 Google
Form。页面应读取受控发布的 Catalog options，把每个有效组合维护为一个不可拆分的
tuple；任一字段变化后先筛选兼容 tuple 集合，再从集合中重新计算另外字段的去重
候选项。提交时仍必须由服务端重新校验组合、当前状态和 Catalog revision，不能信任
浏览器筛选结果。

该未来页面还必须单独设计：

- Catalog revision 更新时的 stale-page 提示、重新加载和已选值失效策略；
- Resume 的安全上传路径、大小和类型校验、hash、R2/Drive 身份与最小权限；
- Google 身份授权或其他申请人身份边界，以及不登录提交时的滥用防护；
- 服务端生成稳定 source identity、幂等键、提交时间和审计记录；
- 键盘操作、屏幕阅读器、移动端和错误恢复等可访问性要求；
- 多申请人并发下每个浏览器会话的独立筛选状态。

这是一项 Provider/UI 层的未来增强，不是当前 D1 Schema、Migration、历史记录、
Workflow 数据模型或 Application/Candidate/Person 表结构的缺口。只有将来新的持久化、
上传会话或审计需求无法由现有结构表达时，才另行评估 migration。
## 15. Operations 业务访问模型与内部管理页面（未来优化）

### 当前能力与边界

当前 Operations API 已实现以下基础安全能力：

- 使用 Cloudflare Access JWT 验证请求身份；
- 从 Access claims 中保留 member 或 service actor provenance；
- 对业务命令执行输入验证和幂等控制；
- 将关键操作及其执行身份写入 `audit_event`；
- 通过受控命令修改 D1，并在需要时衔接 Outbox 或 Workflow。

这些能力完成了身份认证和审计基础，但不等于完整的业务授权。
有效的 Access JWT 只能证明请求者是谁以及其可以进入受保护应用，不能被解释为
该请求者可以调用 Operations API 的所有路由。

面向普通业务人员的内部 Operations Console、应用级角色映射以及路由级 RBAC
目前明确延期，不属于当前 production 基础设施部署阶段。在这些能力实现之前，
production Operations API 的 Cloudflare Access policy 必须仅允许经过审核的少量
管理员或操作人员，不得直接向广泛业务用户开放。

### 目标访问链路

```text
业务人员浏览器
  -> 公司 Google / SSO 登录
  -> Cloudflare Access 身份验证
  -> HireBeat Operations Console
  -> HTTPS JSON 请求
  -> Operations API
       -> 验证 Access 身份
       -> 映射业务角色
       -> 执行路由级权限检查
       -> 验证输入和幂等键
       -> 修改 D1
       -> 写入 audit_event
       -> 必要时触发 Outbox / Workflow
```

业务人员不应因此获得以下权限：

- Cloudflare Dashboard 或 D1 Console 权限；
- Cloudflare API Token；
- GitHub repository 写入权限；
- Workers、R2、Queues 或 DLQ 的基础设施访问权限；
- 绕过 Operations API 直接修改生产数据的权限。

### 推荐的权限划分

| 主体 | 推荐权限 |
| --- | --- |
| 业务人员 | 仅通过内部页面和 Operations API 执行明确授权的业务操作 |
| 普通开发人员 | GitHub Write；Cloudflare 仅授予工作需要范围内的只读权限 |
| 部署开发人员 | 可以启动 GitHub Actions，但 production job 仍须经过受保护 Environment approval |
| GitHub Actions | 使用限定到目标 Cloudflare account、且仅具有所需 D1 Edit 能力的最小权限 Token |
| 系统管理员 | 保留 Cloudflare 管理权限、production approval 和紧急恢复权限 |

GitHub 合并权限、production 部署审批权、Cloudflare 基础设施管理权和业务数据操作权
应当分别管理，不能因为某人拥有其中一种权限，就自动获得其他权限。

### 建议的业务角色

| 角色 | 允许的业务能力 |
| --- | --- |
| HR Viewer | 只读查看职位、候选人、Application 和流程状态 |
| Recruiting Operator | 创建或更新 Company、Position、Catalog 等招聘配置 |
| Hiring Manager | 查看受管辖候选人，并执行经过限制的阶段或 Offer 操作 |
| Operations Admin | 处理失败 Intake、恢复、重试和运行异常 |
| Deployment Admin | 管理 GitHub、迁移和部署；不自动拥有所有业务 API 权限 |

### 路由级权限示例

权限检查必须按具体路由执行。例如：

```text
HR Viewer
  GET /v1/...
  allowed

HR Viewer
  POST /v1/catalog/positions
  denied with 403

Recruiting Operator
  POST /v1/catalog/positions
  allowed

Recruiting Operator
  POST /v1/intake-runs/{id}/recover
  denied with 403
```

### 实现要求

未来实现时必须满足：

1. 默认拒绝；只有明确映射的角色和权限才能访问对应路由。
2. 从已验证的 Access claims 提取 email、subject、service identity 或受信任 group。
3. 身份映射与路由授权必须在 Operations API 内执行，不能只依赖前端隐藏按钮。
4. 所有敏感写操作继续要求幂等键、输入验证和 `audit_event`。
5. `audit_event` 必须保留 actor type、actor ID、操作、实体、时间和结果。
6. service token 与人工 member identity 必须保持可区分。
7. 权限不足返回 `403 Forbidden`；身份无效返回 `401 Unauthorized`。
8. 禁止把 D1、R2、Queue 或 Cloudflare 管理凭据发送给业务浏览器。
9. 为每个角色建立 allow/deny 测试，并覆盖越权访问、空身份和伪造 claims。
10. 内部页面不得成为绕过 API 验证、审计或状态机约束的第二写入通道。

### 建议实施顺序

1. 冻结角色与路由 permission matrix。
2. 在 Operations API 增加默认拒绝的 RBAC middleware。
3. 为所有现有 Operations 路由声明所需权限。
4. 添加角色 allow/deny、身份缺失和越权测试。
5. 补充业务页面需要的安全只读查询接口。
6. 构建 Access 保护的内部 Operations Console。
7. 在 staging 完成业务用户验收与审计核对。
8. 验收通过后，再把 production Access policy 扩展到对应业务用户或群组。

在此阶段之前，内部管理页面和广泛业务用户接入保持延期；该延期不阻止隔离的
production D1、R2、Queues、Workers 和迁移审批基础设施继续建设。
