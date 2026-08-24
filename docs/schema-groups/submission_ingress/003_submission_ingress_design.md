# Group G03：Submission Ingress 与 Raw Submission（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G03）
状态：`confirmed`

## 1. 本组边界

G03 当前建议首版创建三张表：

```text
raw_submission_intake_run
raw_submission
raw_submission_resume
```

Ingress 是 Workflow A 之前的独立短事务边界，只负责：

1. 接收 Airtable 或 Google Form adapter 送来的一个来源事件；
2. 验证最小技术 envelope，而不是验证申请业务资格；
3. 幂等识别同一个来源事件；
4. 在最终 Raw 落地前调用已适配的来源文本/PDF parser，取得终结性 Resume text 可用性结果；暂时性错误留在 intake run 重试；
5. 在同一个最终短事务中忠实保存 Raw 主记录和一对一 Resume child；
6. 在 G04 确认后，与 Raw 成功落地一起创建启动 Workflow A 的 Outbox event；
7. 返回 accepted、reused、retryable failure 或 terminal failure。

Ingress 不负责：

```text
姓名/邮箱标准化
Catalog active/ownership 验证
查重
Person/Application/Candidate 创建
ML 或 Offer
```

这里的 Resume PDF→text 是 Ingress adapter 在最终 Raw 发布前完成的技术准备，不是 Workflow A 内的结构化 Resume extraction。Workflow A 仍负责 Initial Cleaning、normalization，以及 identity/education/employment/skill/project 等结构化提取。R2 与 D1 不能组成同一个跨产品 ACID 事务。生产 Ingress 必须采用幂等 object key、文件 SHA-256、可重试的 R2 PUT，以及最终 D1 短事务来避免重复对象和半完成业务发布。

## 2. 为什么需要 `raw_submission_intake_run`

D1 `batch()` 可以保证同一次 Raw publish 中的 SQL 共同成功或回滚，但无法记录“这次请求在执行 batch 前或 batch 内为什么失败”。因此保留一个可变的操作运行摘要：

- 即使 Raw 没有成功插入，也能保留来源身份和失败原因；
- 同一个来源事件重试时复用同一 run；
- `attempt_count` 记录真正尝试持久化 Raw 的次数；
- `technical_redelivery_count` 只统计同一个来源事件因为网络重试、Webhook 重送、Queue retry 或轮询重复读取而再次到达，与申请人的业务重复申请严格分开；
- `last_technical_redelivery_mechanism`、`last_technical_redelivery_cause_code` 和 `last_technical_redelivery_at` 分别保存最近一次技术重送采用的机制、触发它的根因以及时间，避免把“Queue 如何重送”和“为什么需要重送”混成一个值；
- `payload_conflict_count` 记录同一个来源 ID 携带不同 payload 的冲突；
- 只保存 HMAC 和非敏感错误，不在运行日志复制完整 PII payload。
- `configuration_release_id` 冻结该 logical intake 首次开始处理时采用的非敏感系统配置版本；migration 前历史记录允许 NULL，新生产运行必须填写且 retry 不得静默换版。

一条 `raw_submission_intake_run` 表示一个逻辑来源事件，不是每次网络请求都创建新行。首版只保存最后一次技术错误摘要；如果未来确实需要数据库内完整保存每一次 ingress retry，再延后增加 `raw_submission_intake_attempt`，而不是现在提前增加第三张表。

这里的 technical redelivery 绝不包括：

```text
申请人第二天再次点击提交
申请人同一天误点两次但来源系统生成了两个独立 response/record
申请人有意重申同一公司、岗位和周期
查重阶段判断为同一个人的两条相似申请
```

这些情况具有不同的 `submission_uuid`、`source_record_id` 和 `source_event_key`，必须分别进入两条 Raw，再由 G06 业务查重判断。只有“同一个已经存在的来源事件被技术基础设施再次送达”才增加 `technical_redelivery_count`。

技术重送机制建议值：

```text
direct_client_retry
webhook_redelivery
queue_retry
poller_replay
worker_restart_recovery
unknown_technical_redelivery
```

触发根因建议值：

```text
d1_unavailable
d1_timeout
network_timeout
cloudflare_rate_limited
worker_crash
upstream_timeout
delivery_ack_lost
scheduled_repoll
unknown
```

例如 D1 暂时不可用导致 Queue 重新发送：

```text
last_technical_redelivery_mechanism = queue_retry
last_technical_redelivery_cause_code = d1_unavailable
```

如果当前 Worker 自己直接重试 D1，而没有新的外部 delivery，则只增加 `attempt_count`，不增加 `technical_redelivery_count`；其失败根因保存在 `last_error_code = d1_unavailable`。

## 3. 来源身份与幂等

同时保留三种值：

| 字段 | 作用 |
|---|---|
| `submission_uuid` | 全局业务提交 ID；跨 D1、Workflow、R2 和 API 使用 |
| `source_system + source_record_id` | 来源系统自身的稳定身份 |
| `source_event_key` | Adapter 根据来源系统和不可变来源事件身份构造的单字段幂等键；识别事件，不识别内容相似性 |

当前建议：

```text
airtable source_record_id = base/table identity + Airtable record ID
google_form source_record_id = form/spreadsheet identity + 持久化 response UUID 或其他不可变 response identity

source_event_key = source_system + ':' + source_record_id
```

示例：

```text
airtable:base_123:table_applications:recABC123
google_form:form_456:response_789
```

`source_event_key` 不是 payload hash、姓名邮箱组合、业务查重 key，也不是 Company + Position + Cycle。它只回答：

> 本次到达是不是来源系统中已经接收过的同一个提交事件？

Google Sheet 的裸 `rowNumber` 不够稳定，插入、删除或重新排序行后可能变化。首选是在第一次提交时取得或生成并持久化 response UUID。如果当前 Google Sheet 暂时只能提供行号，至少组合 spreadsheet ID、sheet identity 和 row number，并把它列为 Adapter 技术债务。

数据库同时使用：

```text
UNIQUE(submission_uuid)
UNIQUE(source_event_key)
UNIQUE(source_system, source_record_id)
```

三者不是为了表示三个业务实体，而是防御不同错误：

- 相同 UUID 重试：复用原记录；
- Adapter 错误生成新 UUID、但来源记录相同：来源唯一约束仍阻止重复；
- source event key 构造错误但 source tuple 相同：复合唯一约束继续保护。

如果 Airtable/Google Form 无法在提交端生成 UUID，Adapter 不能在每次轮询时重新生成随机 UUID。它必须先按 source tuple 查询/创建 `raw_submission_intake_run`，然后复用数据库里第一次生成的 `submission_uuid`。未来自建网页可在首次点击提交时生成 `crypto.randomUUID()`。

## 4. HMAC 与重复投递

`payload_hmac` 使用服务端 keyed HMAC-SHA-256；Secret 不进入 D1、Git、CSV 或日志。保存 `payload_hmac_key_version` 以支持将来轮换密钥。建议 HMAC 输入包含稳定的 `submission_uuid`、source identity 和规范化序列化后的来源 payload，但排除 `received_at`、网络 request ID 等每次 delivery 都会变化的技术元数据。

HMAC 没有唯一约束，也绝不跨不同 source identity 做去重。两个申请人事件即使业务字段逐字相同，只要它们是两个不同的来源 response/record，就会分别落入 Raw。

同一个 source identity 再次到达时：

```text
HMAC 相同
→ 不新建 Raw
→ technical_redelivery_count + 1
→ 返回原 raw_submission_id

HMAC 不同
→ 不覆盖已经接受的 Raw
→ payload_conflict_count + 1
→ 写非敏感 conflict audit/error
→ 返回 409/source_payload_conflict
```

如果申请人在前后两天提交两次一模一样的表单：

```text
第一次：source_event_key = ...response_A
第二次：source_event_key = ...response_B
```

它们是两个独立来源事件。即使因为 HMAC 计算范围的选择而得到相同 HMAC，也不会合并，因为 HMAC 不唯一且只在“同一个 source identity 再次送达”时用于核对；如果 HMAC 按建议包含 submission UUID/source identity，两次的 HMAC 通常也会不同。两条记录都会先进入 Raw，再由 G06 判断是否属于业务重复申请。

## 5. `raw_submission_intake_run` 字段职责

| 字段组 | 说明 |
|---|---|
| run/submission/source identifiers | 失败时仍能定位来源事件 |
| accepted/last HMAC | 区分相同重投和同 ID 内容冲突 |
| `intake_status` | 当前 ingress 生命周期状态 |
| 三个 count | 持久化尝试、技术重送、payload conflict 分开计数；不包含 G06 业务查重 |
| last technical redelivery mechanism/cause/time | 最近一次技术重送的传输机制、根因和发生时间；不是申请人的重复申请原因 |
| `recovery_fence_token` | 首次 Intake 为 NULL；每次经过授权的技术恢复生成新 UUID，只允许当前恢复周期的 Queue 消息继续处理，旧周期消息自动 no-op |
| `last_error_*` | 只保存非敏感最后错误，不保存 token、payload、简历正文 |
| received/attempt/completed timestamps | 运行摘要与重试调度依据 |

状态的精确定义：

| 状态 | 具体含义 | 此时是否已有 Raw |
|---|---|---:|
| `received` | 已通过调用认证并取得可信 source identity；已创建/复用 intake run，但尚未开始 Resume text 获取 | 否 |
| `resolving_resume_text` | 正在验证来源文本，或通过组员 parser adapter 执行 PDF/URL/Google Drive → text；这是 Raw 落库前的技术处理阶段 | 否 |
| `persisting_raw` | 正在执行本次短 D1 写入：准备共同提交 Raw、intake success 和未来 G04 Outbox | 尚不能假设有；对外仍不可发布 |
| `succeeded` | Raw 与本次必须共同提交的记录已经完整成功；可以返回/复用原 Raw ID，并允许 Workflow A 被请求 | 是 |
| `failed_retryable` | 由于网络、D1 暂时不可用、429、5xx、超时等瞬态技术错误而失败；本次没有半条 Raw，可以按退避策略安全重试 | 否；若历史已 succeeded 则不应退回该状态 |
| `failed_terminal` | 非瞬态 Schema/代码/配置错误，或 retryable 错误超过上限；停止自动重试，等待修复后显式重新排队 | 否 |
| `cancelled` | 在成功落地前被可信上游或管理员主动取消，不再自动尝试 | 否 |

补充边界：已经 `succeeded` 的 run 不允许转换回 `persisting_raw`、`failed_*` 或 `cancelled`。后续同事件技术重送只增加计数并返回原 Raw；如果需要停止后续招聘流程，应取消 G04 Workflow，而不是把已经成功发生的 Raw intake 改成 cancelled。

技术重试耗尽后不得重新提交完整申请来“碰运气”。管理员先修复 Secret、
权限、映射、依赖或代码，再通过 Access 保护的 Operations API 请求受控恢复。
该命令只接受尚未发布 Raw 的技术耗尽 `failed_terminal` run，并在同一短事务
中旋转 `recovery_fence_token`、清理本周期错误摘要、把本周期
`attempt_count` 重置为 0、写入 Queue 目标 Outbox 和审计事件。它不改变
`submission_uuid`、accepted payload HMAC、来源身份或 R2 replay envelope。
Orchestrator 转发 Outbox 后，Queue 自动执行新的有限重试周期；所有带旧 fence
的延迟消息均被确认但不执行。

状态代码：

```text
received
resolving_resume_text
persisting_raw
succeeded
failed_retryable
failed_terminal
cancelled
```

允许的主要转换：

```text
received → resolving_resume_text → persisting_raw → succeeded
received/resolving_resume_text/persisting_raw → failed_retryable
failed_retryable → resolving_resume_text 或 persisting_raw（按失败步骤恢复）
received/resolving_resume_text/persisting_raw/failed_retryable → failed_terminal
received/failed_retryable → cancelled
```

已经 `succeeded` 的同源技术重送不改变主状态；它复用成功结果并只增加 `technical_redelivery_count`。

## 6. `raw_submission` 字段分组

### 身份与来源

```text
raw_submission_intake_run_id
submission_uuid
source_system
source_record_id
source_event_key
source_schema_version
```

### 当时提交的 Catalog 快照值

```text
submitted_catalog_revision_id
submitted_company_id
submitted_company_name
submitted_company_work_mode_id
submitted_company_work_mode_name
submitted_position_id
submitted_position_name
```

这些 ID 全部是普通 INTEGER，不对 G02 建外键。原因是 Raw 必须能够保存不存在、过期、inactive 或归属错误的 ID，让 Initial Cleaning 在 Workflow A 中记录真实失败。名称与 ID 同时保存，用于证明来源当时实际发送的显示值。

因此 Company name、Company Work Mode name 和 Position name 并没有缺失；它们在 Schema 中分别是：

```text
submitted_company_name
submitted_company_work_mode_name
submitted_position_name
```

使用 `submitted_` 前缀是为了明确：这些是来源在本次提交时发送的名称快照，不是 G02 当前权威名称，也不是标准化名称。

### 申请人和工作偏好原始字段

```text
raw_person_name
raw_email_address
raw_phone
raw_start_working_date
raw_end_working_date
raw_work_duration
```

这些字段在 Raw 不 trim、不 lower、不标准化，不用占位值替换缺失。

### Resume

```text
raw_submission_resume.resume_text
raw_submission_resume.resume_text_status
raw_submission_resume.resume_text_origin
raw_submission_resume.resume_parser_version
raw_submission_resume.resume_text_sha256
raw_submission_resume.resume_parsed_at
resume_original_file_name
resume_source_url
resume_source_file_id
resume_mime_type
resume_file_size_bytes
resume_file_sha256
resume_r2_object_key
```

已确认把 Resume 长文本与文件 metadata 从 `raw_submission` 垂直拆到一对一 Raw 子表 `raw_submission_resume`。两张表仍属于同一个 Raw layer，并与 intake succeeded、Workflow A Outbox 在同一个最终短事务中共同落地；拆表不表示 Resume 晚于 Raw 主记录发布。

`resume_text_origin` 表示稳定来源类别，例如 `source_provided`、`pymupdf`、`ocr`、`upstream_parser`；`resume_parser_version` 保存能够唯一说明具体实现及版本的快照字符串，因此首版不再增加单独 `resume_parser_name`。例如 `resume_parser_version = pymupdf-fastapi@v2-sort-true` 已同时表达 parser 名称和版本，而 origin 仍用于不随实现名称变化的业务分类。

`resume_text_status` 保存终结性文本可用性：`available`、`no_resume`、`parse_failed_terminal`。`pending`、`running` 和 `failed_retryable` 属于 `raw_submission_intake_run`/attempt 的技术执行状态，不在 Resume 结果行重复保存。暂时性 parser 错误必须先重试，不能仅因文本为 NULL 形成永久业务 Block。

Raw 与 Resume child 允许在文本为 NULL 时完整落地。Workflow A Initial Cleaning 根据终结状态、有效字符长度和其他业务验证决定是否继续；`no_resume`、终结性不可解析或有效文本不足会保留 Raw/Resume 和清理结果，但不创建 `submission_normalized`。

`resume_r2_object_key` 是已创建的私有 Cloudflare R2 Bucket 中原始 Resume PDF 的对象键。当前 Bucket 为 `hirebeat-hr-raw-resumes-pdf-r2-v1`，Worker binding 为 `hirebeat_hr_raw_resumes_pdf_r2_v1`。D1 不保存 PDF BLOB；`raw_submission_resume` 只保存 object key、文件 metadata、`resume_file_sha256` 和解析后的 UTF-8 Resume 文本。

当前基础设施状态为：R2 Bucket 已创建、Wrangler binding 已配置、D1 文件完整性字段和唯一 object-key 索引已定义。独立的 `workers/submission-ingress/` 已将 Airtable HTTPS attachment、Google service-account Drive read-only download、双重大小限制、PDF magic/content-type 校验、SHA-256、稳定 R2 key、conditional create、Parser、D1 fencing 和 Raw 原子发布接入认证 HTTP route。合成单元测试不调用任何远程系统；远程启用前仍必须配置真实 Parser URL、Secrets 并完成 staging 端到端验证。`resume_r2_object_key` 保持 nullable，因为无 Resume 等合法情况可能不存在对应对象。

已接入的幂等协调层包含：稳定 keyed HMAC、三组身份键联合检查、并发 INSERT 竞态后的重新读取、technical redelivery 计数、payload conflict 记录、最大尝试次数判断和 stale takeover eligibility。HMAC 明确不包含技术投递时间/原因、临时 Airtable URL、`source_event_key` 或 provider envelope；它只用于判断“同一个来源身份是否带着不同的业务 payload 重送”，绝不用于判定两个不同 `submission_uuid` 的申请是否为招聘业务重复。

`attempt_count` 同时作为处理 fencing token。每次成功 claim 都原子加一，后续处理和发布必须携带 claim 得到的 attempt number；stale takeover 后旧 Worker 的条件更新必须返回零行。stale 时间依据 `last_attempt_started_at`，而不是会被技术重送更新的接收时间，避免技术重送错误刷新旧处理任务的存活状态。R2、Parser、Raw 短事务和失败收尾现已作为一个完整 service 接入正式内部 endpoint。

新 intake 使用当时 active release；已有 intake 的重试必须按它已经冻结的 `configuration_release_id` 读取历史配置，即使该 release 后来已经成为 `superseded` 或 `retired`。coordinator 对传入错误 release 的调用返回配置错误，防止旧任务静默套用新的 timeout 或最大尝试次数。

### 首版 PDF 获取与 Parser 顺序

首版继续沿用组员已经验证过的两条来源逻辑，不增加 PDF 失效后自动切换到来源 Resume 长文本的 fallback：

```text
Airtable attachment URL
→ Ingress 下载 PDF bytes
→ 校验 MIME、PDF magic bytes 和配置中的最大文件大小
→ 计算 PDF SHA-256
→ 幂等写入私有 R2
→ 将同一份 PDF bytes 发送给 Parser
→ 原样保存 Parser 返回的 UTF-8 文本和换行
```

```text
Google Drive file ID
→ 使用 Google access token 下载 PDF bytes
→ 校验 MIME、PDF magic bytes 和配置中的最大文件大小
→ 计算 PDF SHA-256
→ 幂等写入私有 R2
→ 将同一份 PDF bytes 发送给 Parser
→ 原样保存 Parser 返回的 UTF-8 文本和换行
```

Airtable 路径不再让 Ingress 和 Parser 分别下载同一个临时 URL。Ingress 只下载一次，并把同一份 bytes 依次用于 R2 PUT 和 `/parse-pdf`，从而保留组员原有 PyMuPDF 解析逻辑，同时减少重复网络请求和来源 URL 在第二次下载前失效的窗口。

首版稳定 object key 已冻结为：

```text
raw-resumes/v1/{submission_uuid}/{resume_file_sha256}.pdf
```

写入采用 `If-None-Match: *` 条件创建。同一技术事件重送时，如果对象已存在，只有在 size 与 custom metadata 中的 SHA-256 均一致时才复用；不一致返回 conflict，不覆盖旧对象。下载同时检查响应声明大小和实际流式累计大小，避免来源省略或伪造 `Content-Length` 时绕过 10 MiB 配置限制。

R2 成功是调用 Parser 之前的必要步骤：R2 暂时失败时不得绕过对象存储继续发布 Raw，应该把 intake 标记为 `failed_retryable` 并按已经冻结的 configuration release 重试。PDF 已经成功保存到 R2、但 Parser 在重试耗尽后仍失败时，Raw 仍可忠实发布，`raw_submission_resume` 使用：

```text
resume_text_status = parse_failed_terminal
resume_text = NULL
resume_r2_object_key = 已保存的 object key
resume_file_sha256 = 已保存 PDF 的 SHA-256
```

来源本来没有 Resume 时使用 `resume_text_status = no_resume`；PDF 和 Parser 均成功时使用 `resume_text_status = available` 与 `resume_text_origin = pymupdf`。Worker 不对 Parser 返回文本执行合并换行、压缩空白、删除标题或其他业务清洗。

首版明确暂不实现：失效 PDF URL 后自动使用来源 Resume 长文本、PDF/文本质量比较、多来源自动选择和 `resume_text_fallback_used` 事件。将来如果重新评估该能力，必须通过新版本设计显式增加，不能在首版 Worker 中隐式 fallback。

### 内容完整性

```text
payload_hmac
payload_hmac_key_version
```

已确认首版不创建 `source_payload_json`。已知 Raw 业务值全部保存为独立结构化字段，避免在 JSON 中再次复制姓名、邮箱、电话、简历等 PII，也避免下游绕过正式字段重新解析 payload。`payload_hmac` 和 `payload_hmac_key_version` 只用于完整性与同来源重送冲突判断，不保存或还原原 payload。

如果未来产生保留完整来源 envelope 的合规或重放需求，应先过滤 token、临时签名 URL 和无关技术 metadata，再优先保存到 R2，并在经过独立确认后增加 object key，而不是重新把完整 payload 复制进 D1。

### 时间与隐私保留

```text
source_submitted_at
landed_at
retention_until
purged_at
updated_at
```

`source_submitted_at` 是 Airtable、Google Form 或其他来源创建该提交的时间，允许 NULL；`landed_at` 是 Raw 完整成功写入 D1 的时间，必须存在。两者可以计算从来源提交到数据库落地的延迟。

已确认 `raw_submission` 不再保存通用 `created_at`，因为在当前原子落地模型中它与 `landed_at` 表示同一个时点。Raw 业务内容原则上不可改；`updated_at` 只服务受控 PII purge、R2 引用回填等少数维护动作。`retention_until`、`purged_at` 当前 nullable，是否首版保留仍需在本组确认。`raw_submission_intake_run.created_at` 不受此决定影响，因为它记录的是可变 intake run 的创建时间，不等于 Raw 成功落地时间。

### 为什么只拆 Resume，不机械拆分其他 Raw 字段

已确认 G03 首版使用三张表：`raw_submission_intake_run`、`raw_submission`、`raw_submission_resume`。Company/Work Mode/Position、日期和联系信息仍是同一来源事件的标量快照，继续保留在 Raw 主表；不按字段组机械创建更多 1:1 子表。

Resume 单独拆分的原因不是普通列数超过 SQLite 能力，而是 Resume 同时具有长文本、集中 PII、独立 parser provenance、未来 R2 迁移和可能独立 retention/purge 的特点。`raw_submission_resume.raw_submission_id` 使用 `UNIQUE` 和同层 FK；Raw 与 Resume child 在同一个 D1 短事务中共同成功或回滚，因此不会产生已发布的半条 Submission。

拆表不能替代授权。Worker/API 仍必须禁止无关调用读取 Resume，生产查询禁止无目的 `SELECT *`。

## 7. 技术 envelope 验证与 Raw 最低准入条件

“Envelope”是包住申请业务字段的传输外壳。它描述谁发送、这是来源中的哪一个事件、采用什么格式、内容有多大、是否能完整读取和安全写入；它不判断姓名、学历、Company 或 Position 在业务上是否合格。

Ingress 的技术 envelope 验证建议包括：

| 类别 | 验证内容 | 失败处理 |
|---|---|---|
| 调用认证 | Worker/API token、签名或内部服务身份有效；来源有权调用 ingress | 不信任 payload，不创建 Raw；只写安全日志 |
| Content type | JSON/form 类型受支持，字符编码可处理 | 有可信 source identity 时可记 terminal；否则直接 4xx |
| 请求完整性 | Body 能完整读取，不是截断数据；JSON 能解析 | 不创建半条 Raw |
| 大小限制 | Payload、文本和文件 metadata 不超过限制；PDF binary 不直接写 D1 | 返回 413，要求改走 R2 或修正来源 |
| 来源身份 | `source_system`、`source_record_id`、`source_event_key` 非空且可稳定重建 | 无法保证幂等时拒绝 Raw |
| Submission 身份 | 能取得或首次稳定生成 `submission_uuid`，后续 delivery 能复用 | 禁止每次重试生成新 UUID |
| Schema version | Adapter 能理解来源版本；未知业务字段可进 JSON，但必要 envelope 必须可识别 | 不支持版本时 terminal |
| HMAC | 能用当前 Secret/key version 对稳定 identity + canonical payload 计算 HMAC | 计算失败不写 Raw |
| 参数安全 | 所有值通过绑定参数写 D1，不拼接动态 SQL | 防止注入和转义错误 |
| 幂等查询 | 先按 UUID、source tuple 和 event key 查询已有 run | 同事件复用；冲突返回 409 |

“技术有效”只表示系统能够可靠识别、保存和重试本次来源事件，不表示申请业务数据正确。

Ingress 不因以下业务问题拒绝 Raw：

```text
姓名为空
邮箱为空或格式错误
Company/Position/Work Mode ID 不存在或 inactive
Position 不属于 Company
日期不可解析
没有简历
```

这些问题由 Workflow A Initial Cleaning 处理。这样 Raw 才能忠实保存失败输入并支持审计。

## 8. 第一次接收的短事务流程

推荐实现：

```text
1. 验证调用认证和 envelope
2. 构造 source identity、submission UUID、payload HMAC
3. INSERT OR REUSE raw_submission_intake_run
4. 将 run 标记 persisting_raw，attempt_count + 1
5. 一个短 D1 batch：
   - INSERT raw_submission
   - INSERT raw_submission_resume；终结性 `no_resume` 或 `parse_failed_terminal` 也必须忠实落地，文本为 NULL
   - UPDATE intake run → succeeded
   - INSERT workflow_a_requested Outbox（G04 确认后补入）
6. 返回 202/accepted + submission_uuid + raw_submission_id
```

第 5 步共同成功或共同回滚。若 batch 失败，catch handler 用单独调用把既有 run 更新为 `failed_retryable` 或 `failed_terminal`；Raw 和 Outbox 都不会留下半条记录。

## 9. 失败分类

| 情况 | 是否重试 | 数据结果 |
|---|---:|---|
| 同 source + 同 HMAC | 否 | 复用成功 Raw；technical redelivery count + 1 |
| 同 source + 不同 HMAC | 否/人工或上游修正 | 不覆盖 Raw；conflict count + 1；返回 409 |
| D1 网络/暂时服务错误 | 是 | 无半条 Raw；run 记 failed_retryable |
| Cloudflare 限流/超时 | 是，指数退避 | 同上 |
| SQL/Schema/programming error | 自动重试有限次后否 | run 记 failed_terminal；无半条 Raw |
| 鉴权失败 | 否 | 通常不信任 payload；可仅写安全日志，不创建 Raw |

Google OAuth token 获取的异常日志只允许输出失败阶段、粗粒度失败类型、异常
名称和 timeout。禁止输出 service-account JSON、private key、JWT assertion、
access token 或原始异常 message。只有根因确实已修复后才允许发起受控恢复；
未修复便重放只会形成另一个有上限的失败周期。
| 请求超出允许大小 | 否，要求来源修正 | run 能否创建取决于是否已取得可信 source identity |
| 业务字段缺失或 Catalog stale | Ingress 不重试 | Raw 成功；由 Workflow A 判为 rejected/blocked |

## 10. 为什么 Raw 不保存 Workflow A 当前 step

`raw_submission` 不保存“当前跑到哪个 Workflow step”。权威位置是 G04：

```text
etl_workflow_run
etl_step_run
etl_step_attempt
```

否则同一个状态会同时存在 Raw 和 Workflow 表，容易不一致。Raw 只通过 Outbox/Workflow 关系参与流程；查询当前进度时 JOIN G04。`raw_submission_intake_run.intake_status` 只表示 Ingress 是否成功，不表示 normalization/dedup/application 进度。

## 11. 与组员项目的差异

| 维度 | 新版 | 组员 Worker |
|---|---|---|
| 幂等 | UUID + source event + source tuple + HMAC | `wasAlreadySynced()` 只查 `airtable_record_id`；Google 也复用该列 |
| Raw 落地 | 先忠实保存，再启动 Workflow A | 先验证必填并创建 Applicant/Company/Role/Application |
| Catalog | 只保存提交 ID/名称，Workflow A 再验证 | 根据提交名称 `findOrCreateCompany/Role` |
| Resume | Raw 保存来源引用；parser 结果进入 extraction | parser 结果直接 UPDATE `application_submissions` |
| 运行日志 | 独立 intake run | 主要依赖 Worker summary/console 与 submission status |
| 事务 | Raw + workflow Outbox 原子发布 | 多个独立 INSERT/UPDATE，失败可留下部分实体 |
| Google identity | 明确 source system/record/key | `google:<spreadsheetId>:<rowNumber>` 塞入 airtable_record_id |

可沿用的组员逻辑：Airtable pagination、Google API/JWT adapter、Google Drive file ID 提取、失败时不向 resume text 写占位内容。不能沿用入口直接创建业务实体和多次独立写入。

### `wasAlreadySynced()` 能否直接实现幂等

不能单独作为生产级幂等保证。组员代码中的 `wasAlreadySynced()` 本质是：

```text
SELECT submission_id
FROM application_submissions
WHERE airtable_record_id = ?
LIMIT 1
```

查到便跳过，查不到再继续写入。它可以保留成廉价的 early-return 优化，但存在以下边界：

1. **并发竞态**：两个 Worker 可以同时查到“不存在”，随后都执行 INSERT；只有数据库 UNIQUE 才能在最终写入点阻止重复。
2. **缺少来源命名空间**：Google 来源也写入名为 `airtable_record_id` 的列；单列 ID 不能清楚表达 `source_system + source_record_id`。
3. **查和写不原子**：SELECT 与后续多个 INSERT/UPDATE 是独立调用，中途失败可能已创建 Applicant、Company、Role 或 Application，却尚未创建 Submission。
4. **部分成功后的错误跳过**：如果 Submission 已写入而 Resume parser 失败，下一轮可能因为 `wasAlreadySynced()` 直接跳过，无法自动恢复 parser step。
5. **同 ID 内容改变无法识别**：只有来源 ID，没有 accepted/last HMAC，无法区分“完全相同的技术重送”和“相同 ID 携带不同 payload 的冲突”。
6. **没有证明数据库约束**：应用层先查不是约束；即使所有正常代码都调用它，其他 Worker、管理脚本或并发请求仍可绕过。

新版应当采用两层设计：

```text
快速路径：先查现有 submission UUID/source identity，存在则复用
最终正确性：数据库 UNIQUE + 原子 INSERT/UPDATE/Outbox + ON CONFLICT/唯一冲突处理
```

对应的正式幂等身份为：

```text
UNIQUE(submission_uuid)
UNIQUE(source_event_key)
UNIQUE(source_system, source_record_id)
```

`wasAlreadySynced()` 的思想可以沿用，但应改造成 `findExistingIntakeResult()`：先按这些稳定身份定位已有 run；如果已 `succeeded`，返回原 `raw_submission_id`；如果同 identity 的 HMAC 不同，记录 conflict 并拒绝静默覆盖；如果是 `failed_retryable`，复用同一 run 重试。无论预查结果如何，最终 INSERT 仍必须依赖数据库唯一约束处理竞态。

## 12. 与原版数据库/Colab 的差异

| 维度 | 新版 | 原版 |
|---|---|---|
| 输入粒度 | 一条事件一个 logical intake run | `ingestion_batch` + CSV/source row |
| 幂等 | UUID/source identity/HMAC | batch ID + source record number + file SHA |
| Raw 结构 | 明确业务列 + 可选 JSON + Resume 引用 | UTF-8 `raw_record_jsonb` 长文本封装 |
| 状态 | 独立 ingress run | `raw_submission.processing_status/error` |
| 后续触发 | Outbox → Workflow A | 人工按 Colab Cell 顺序运行 |
| Catalog ID | 原样普通字段，后续验证 | normalization 中按名称精确/模糊匹配 |
| batch/dataset tables | 不创建 | 必需 |

原版批量数据仍可导入：batch adapter 为每一行构造独立 source identity，排队逐条进入同一 G03 接口；不恢复 `ingestion_batch` 表。

## 13. 安全提醒

附件 `variables.md` 中含有明文 Airtable token。该 token 应立即在 Airtable 撤销/轮换，并改存 Cloudflare Secret；不要复制到新仓库、Schema、测试 CSV 或错误日志。Google service-account private key 和 HMAC key 同样只放 Secrets。

## 14. 已确认边界

1. 已确认 G03 首版创建 `raw_submission_intake_run`、`raw_submission`、`raw_submission_resume` 三张表；暂不增加 `raw_submission_intake_attempt`。
2. 同一个 logical source event 的技术重试复用同一 intake run，只更新 attempt count 和最后错误。
3. Raw 保存 submitted Company/Work Mode/Position 的 ID 与名称，但都不设 Catalog FK。
4. 已确认 Raw 主记录和一对一 Resume child 允许以终结性 NULL 文本结果落地；暂时性 parser 错误先重试，`no_resume`、终结性解析失败或有效文本不足由 Workflow A Initial Cleaning Block，不创建 `submission_normalized`。
5. 已确认首版删除 `source_payload_json`；Raw 值使用独立结构化字段保存。
6. 已确认 `raw_submission` 保留 `source_submitted_at`、`landed_at`、`updated_at`，删除与 `landed_at` 重复的 `created_at`。
7. 保留 nullable `retention_until`、`purged_at`，作为未来 PII retention/purge 基础字段；未启用政策时保持 NULL。
8. Raw 不保存 Workflow A 当前 step/status，权威状态只在 G04。
9. Technical redelivery 不创建新 run/Raw，不改变已成功 run 的主状态，只增加计数并返回原 ID；申请人重复提交仍创建独立 Raw。
10. 同 source identity + 不同 HMAC 视为 payload conflict，禁止静默覆盖。
11. 组员附件中暴露的 Airtable token 必须在继续部署前立即轮换；凭据不进入 Schema、Git、CSV 或日志。
12. 已确认 `submission_normalized` 不复制 Resume 长文本；后续 extraction 从精确 `submission_normalized_id` 经 `raw_submission_id` 读取 `raw_submission_resume.resume_text`。
13. 已确认首版不在 Initial Cleaning 设置英语/非英语语言门禁。
14. 已确认 Initial Cleaning 的 Resume 技术长度底线为清理后的有效非空白 Unicode 字符数至少 100；该规则只检测严重缺失/解析残片，不判断语言或 Resume 业务质量。
15. `raw_submission_intake_run.configuration_release_id` 为 nullable G04 FK；nullable 只用于兼容 migration 前历史，生产 Ingress 必须冻结当次 active release，并在所有技术 retry 中复用。

特别修正：终结性 `no_resume`、`parse_failed_terminal` 或短文本不是 Ingress 拒绝 Raw 的理由。Raw 与一对一 Resume 结果仍完整落地并把 intake 标为 `succeeded`；Workflow A Initial Cleaning 负责记录业务 Block，并且不创建 `submission_normalized`。因此首版不再使用 `rejected_input` intake 状态。
