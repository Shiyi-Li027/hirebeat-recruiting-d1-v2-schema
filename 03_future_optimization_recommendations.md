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
