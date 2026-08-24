# Group G04：System Configuration、Workflow、Step、Attempt、Outbox 与 Audit（Confirmed Revision 2）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G04）
状态：`confirmed`

面向初学者的完整启动流程和逐字段字典见：`004_workflow_control_beginner_guide.md`。

## 1. 本组为什么需要七张表

```text
system_configuration_release
system_configuration
etl_workflow_run
etl_step_run
etl_step_attempt
outbox_event
audit_event
```

七张表不是重复日志：

| 表 | 回答的问题 |
|---|---|
| `system_configuration_release` | 这次运行采用的是哪一整套已发布技术参数？ |
| `system_configuration` | 该 release 中每个非敏感参数的具体 JSON 值是什么？ |
| `etl_workflow_run` | 这条 Raw/Application 的整段 Workflow 最终怎么样了？ |
| `etl_step_run` | normalization、resume extraction、dedup、publish 等逻辑步骤各自怎么样了？ |
| `etl_step_attempt` | 某一步因网络、限流、超时或代码错误实际执行了几次？ |
| `outbox_event` | 已提交的业务事实是否可靠交给下一个 Workflow、Queue、同步器或 Offer 生命周期？ |
| `audit_event` | 哪个系统/管理员在何时做了重要业务变更，为什么？ |

`D1 batch()` 只解决一次短数据库调用内共同成功/回滚。G04 解决跨秒、跨分钟、跨 Worker、跨外部 API 的持久状态、重试与补偿；两者不能互相替代。

### 1.1 版本化 System Configuration

`system_configuration_release` 是一整套配置的发布版本；`system_configuration` 是该版本下的参数明细。首版不创建 `environment_name`、`value_type` 或 `is_sensitive`，也绝不保存 Secret。

核心约束：

```text
configuration_release_key         NOT NULL UNIQUE
release_version                   NOT NULL UNIQUE
release_status                    NOT NULL
configuration_release_id          NOT NULL FK
configuration_scope/key/value     NOT NULL
description/actor/lifecycle time  nullable
```

Partial unique index 保证同一时间最多一个 `active` release，同时允许多个 draft/superseded/retired。激活新版时必须在同一个短 D1 `batch()` 中先 supersede 旧 active、再 activate 新版；任一步失败则共同回滚。

`raw_submission_intake_run.configuration_release_id` 与 `etl_workflow_run.configuration_release_id` 均允许 NULL，以兼容 migration 前历史记录；新生产运行必须由代码写入启动时选定的 release，后续 retry 继续使用同一个被冻结版本。

#### `system_configuration_release` 字段

| 字段 | 可空 | 作用 |
|---|---:|---|
| `id` | 否 | D1 内部主键 |
| `configuration_release_key` | 否 | 稳定、人可读且全库唯一的 release 身份 |
| `release_version` | 否 | 单调增加的整数版本；全库唯一 |
| `release_status` | 否 | `draft`、`active`、`superseded` 或 `retired` |
| `release_description` | 是 | 本次参数变化的非敏感说明 |
| `activated_at` | 是 | 进入 active 的 UTC 时间；draft 时为空 |
| `superseded_at` | 是 | 被新版替代的 UTC 时间 |
| `created_by` | 是 | 创建者/服务标识；无法确定时允许 NULL |
| `activated_by` | 是 | 激活者/服务标识；未激活时允许 NULL |
| `created_at` | 否 | release 行创建时间 |
| `updated_at` | 否 | 状态或可变元数据最后更新时间 |

#### `system_configuration` 字段

| 字段 | 可空 | 作用 |
|---|---:|---|
| `id` | 否 | D1 内部主键 |
| `configuration_release_id` | 否 | 所属 release 的正式 FK；删除行为 RESTRICT |
| `configuration_scope` | 否 | 参数所属模块，例如 `submission_ingress`、`workflow`、`outbox` |
| `configuration_key` | 否 | scope 内参数名 |
| `configuration_value_json` | 否 | 合法 JSON 标量或对象；Worker 按已知 key 验证业务类型和范围 |
| `description` | 是 | 参数用途和单位说明 |
| `created_at` | 否 | 参数行创建时间；发布后参数行按不可变版本使用 |

首个 release 为 `hirebeat-system-configuration-v1`。Migration 0011 发布 `hirebeat-system-configuration-v2` 并将 v1 标记为 `superseded`；v2 保留原有 Parser timeout 30000 ms、Intake stale 300 秒、Ingress 总尝试 5 次、Resume PDF 最大 10485760 bytes、Workflow step 默认 5 次和 Outbox 最大投递 8 次，并增加 `offer.default_response_window_days = 7`。历史 Intake/Workflow 仍读取其冻结的旧 release，新业务命令读取唯一 active release。

## 2. 顶层 Workflow 边界

首版主要存在：

```text
Workflow A
Raw → cleaning → normalization → extraction → dedup/admission
→ Application/Person/Candidate publish

Workflow B
Application/Candidate core → Candidate/Person enrichment → ML
→ hiring stage/final Application decision
→ rejected 或在同一短事务中创建 Offer draft
```

`core` 与完整 Profile 必须区分：Workflow A 创建可被 B 稳定引用的 Person identity/Application/Candidate snapshot 主记录；G05 在 Submission 层保存带来源和版本的提取结果；Workflow B 再将通过发布准入的 Education、Employment、Skill、Project、Certification 等写入 Person/Candidate 业务子表。Dispatcher 只负责 Outbox 交接，不执行简历提取或 Profile 生成。

Offer 创建后的长期状态由 G11 Offer 状态机维护，首版不再创建第三条顶层 Offer Workflow。Catalog sync 自己使用 G02 sync run/target run，并通过 Outbox 触发，不冒充 ETL Workflow。

一条 `etl_workflow_run` 只能拥有一个直接 subject：

```text
Workflow A → raw_submission_id
Workflow B → application_id
```

数据库 `CHECK` 保证二者恰有一个非 NULL。Workflow B 可以通过 `parent_workflow_run_id` 指向发布该 Application 的 Workflow A，但不能据此删除或改写 A 的历史。

## 3. `etl_workflow_run`

### 身份

```text
workflow_run_uuid
workflow_type
workflow_version
idempotency_key
cloudflare_instance_id
trigger_outbox_event_id
```

- `workflow_run_uuid`：数据库/API 全局运行身份。
- `workflow_type`：例如 `workflow_a_submission_to_application`、`workflow_b_candidate_enrichment_to_application_decision`。后者明确包含 Candidate/Person enrichment、ML、招聘决策及条件性 Offer draft，而不是只有 ML。
- `workflow_version`：本段业务 Workflow 定义版本，不是 Hiring Pipeline version，也不是 ML model version。
- `idempotency_key`：同一 subject、同一 workflow type/version 的同一逻辑运行只创建一次。
- `cloudflare_instance_id`：映射 Cloudflare Workflow 实例；在实例尚未创建时允许 NULL。
- `trigger_outbox_event_id`：启动本 run 的唯一 Outbox FK，`NOT NULL + UNIQUE + ON DELETE RESTRICT`。所有正式 Workflow A/B 包括人工重排都必须先创建可审计 Outbox；同一事件技术重送复用原 run，不能创建第二个 run。
- `subject_fence_token`：可空的业务对象版本栅栏。Workflow A 不需要填写；Workflow B 启动时冻结当时 `application.decision_fence_token`。每个会写 enrichment、ML、招聘决定或 Offer 的 step 都必须再次比较；不一致说明该 Application 已被合法重申取代，旧 run 必须停止，不能继续写业务结果。

### 状态

```text
requested
running
waiting
succeeded
compensating
compensated
failed_terminal
cancelled
```

| 状态 | 含义 |
|---|---|
| `requested` | Outbox/服务已经请求，但实例尚未正式执行 |
| `running` | 至少一个逻辑步骤正在执行或重试 |
| `waiting` | 正在等待计划时间、外部事件或可重试条件，不占用持续数据库事务 |
| `succeeded` | 本 Workflow 所有 required steps 已成功，业务结果已发布 |
| `compensating` | terminal failure 后正在执行跨步骤补偿 |
| `compensated` | 未发布或本次专属派生结果已被安全撤销/作废，历史日志保留 |
| `failed_terminal` | 不能自动继续且补偿没有适用、尚未完成或失败，需要修复/重排 |
| `cancelled` | 在允许取消的边界由可信系统或管理员停止 |

更具体的进入、退出和业务含义：

| 状态 | 典型进入条件 | 允许的主要下一状态 | 关键语义 |
|---|---|---|---|
| `requested` | Outbox consumer 已幂等创建 run，但 Cloudflare instance 尚未开始，或请求已登记等待调度 | `running`、`cancelled`、`failed_terminal` | 只表示“运行请求存在”，不表示任何业务 step 已执行 |
| `running` | Cloudflare instance 已开始；至少一个 required step 正在执行、立即重试或推进 | `waiting`、`succeeded`、`compensating`、`failed_terminal`、`cancelled` | Workflow 的正常活动状态；不能据此判断当前具体 step，需看 `etl_step_run` |
| `waiting` | 等待退避时间、外部 callback、人工阶段结果、资源恢复或计划唤醒时间 | `running`、`cancelled`、`failed_terminal` | 是持久等待，不保持长 D1 事务，也不等于失败；唤醒后继续同一 logical run |
| `succeeded` | 所有 required steps 成功，允许跳过的 optional steps 已明确 skipped，最终发布 batch 已提交 | 终结状态 | 表示本 Workflow 的承诺已全部完成；后续新业务通过 Outbox/新 Workflow，而不是把本 run 改回 running |
| `compensating` | terminal error/cancellation 发生前已有本 Workflow 专属、尚未正式发布的跨步骤副作用，需要反向处理 | `compensated`、`failed_terminal` | 正在执行业务补偿，不是数据库自动 rollback，也不是重跑原 step |
| `compensated` | 应撤销的 staging/专属派生结果已删除或标记作废，引用/指针已恢复，补偿审计已写入 | 终结状态 | Workflow 没有成功，但失败影响已经被安全收敛；日志和 Raw 仍保留 |
| `failed_terminal` | 非瞬态代码/Schema/配置错误、重试耗尽、补偿不适用或补偿失败 | 显式创建/恢复新执行；不能自动回 running | 需要修复、人工/受控自动重排；绝不无限自动重试 |
| `cancelled` | 在没有待补偿副作用的安全边界，由可信上游或管理员明确停止 | 终结状态 | 不是技术失败；如果已经产生需撤销副作用，应先进入 compensating，而不能直接 cancelled |

重要边界：

```text
succeeded ≠ compensated
```

`succeeded` 表示业务目标完成；`compensated` 表示业务目标没有完成，但本次失败产生的可撤销影响已处理干净。二者都可以是终结状态，但含义完全相反。

`failed_retryable` 不放在 Workflow 主状态中：某 step 瞬态失败并等待重试时，Workflow 保持 `running` 或 `waiting`；真正的 retryable 状态记录在 step/attempt。

`current_step_key` 只是查询缓存，权威状态仍是 `etl_step_run`。代码必须在同一个短 `batch()` 中同步更新缓存和 step 状态。

`run_attempt_count` 统计同一个逻辑 Workflow 被调度/恢复执行的技术次数，不是申请人的 resubmission count。

## 4. `etl_step_run`

一行代表一个逻辑步骤，而不是一次网络调用：

```text
workflow_run_id + step_key UNIQUE
```

示例 `step_key`：

```text
initial_cleaning
normalization
resume_extraction
identity_feature_generation
deduplication
application_publish
ml_analysis
application_decision_publish
```

`step_version` 冻结本次使用的步骤代码/规则版本。`is_required = 0` 只表示该步骤对当前 Workflow 可以合法跳过，不表示发生错误后可以静默忽略。

状态：

```text
pending
running
waiting
succeeded
skipped
failed_retryable
failed_terminal
compensating
compensated
compensation_failed
cancelled
```

`attempt_count` 是缓存；真实每次执行记录来自 `etl_step_attempt`。`max_attempts` 是本次运行采用的重试上限快照，避免部署配置改变后无法解释历史行为。

## 5. `etl_step_attempt`

一行代表某个 step 的一次技术执行：

```text
UNIQUE(step_run_id, attempt_number)
```

`attempt_kind`：

```text
execute
compensate
```

这张表严格区分：

```text
技术 retry attempt
≠ 申请人重新提交
≠ 新 Application attempt
≠ Hiring stage attempt
```

每次 attempt 开始时插入 `running` 行；完成时只允许一次受控终结更新为 succeeded/failed/timed_out/cancelled。进入终结状态后不再改写；因此它是“每次尝试一行、终结后不可变”，而不是在失败时覆盖上一条 attempt。

若 Worker 崩溃留下长期 `running`，reconciler 根据超时边界将它终结为 `timed_out`，再由 step retry policy 决定是否创建下一条 attempt。

`error_detail` 只能保存非敏感、截断后的技术说明，不保存 Resume、email、token、完整请求或第三方响应正文。

## 6. `outbox_event`

Outbox 解决以下窗口：

```text
D1 已经提交 Raw
但是启动 Workflow A 的网络调用失败
```

如果不使用 Outbox，Raw 已存在却可能永远没有后续 Workflow。正确做法是在同一个 D1 `batch()` 中：

```text
INSERT raw_submission
UPDATE raw_submission_intake_run → succeeded
INSERT outbox_event(workflow_a_requested)
```

三条语句共同成功或共同回滚。随后独立 dispatcher 领取 Outbox，并调用目标 Workflow/Queue/API。

状态：

```text
pending
dispatching
published
failed_retryable
failed_terminal
cancelled
```

`deduplication_key UNIQUE` 防止同一业务事实发布多个事件。Consumer 自己也必须按 event UUID/deduplication key 幂等，不能假设网络只投递一次。

Outbox 不只启动 Workflow。Migration 0012 后，技术重试耗尽且根因已经修复的
Intake 可以由 Operations API 原子写入
`raw_submission.intake_recovery_requested`，目标为
`cloudflare_queue/submission_intake`。Dispatcher 将该事件转换成带当前
`recovery_fence_token` 的 Queue v2 消息。Outbox 负责“恢复批准已提交但 Queue
发送失败”的窗口；Queue 负责发送成功后的有限自动重试；Ingress 在每次处理
前检查 fence，阻止上一个恢复周期的旧消息继续写入。

`aggregate_type + aggregate_id` 表示事件属于哪个业务实体，例如：

```text
raw_submission + 123
catalog_revision + 27
application + 1049
offer + 88
```

这是有意的多态引用，不设置动态外键；由创建事件的同一事务保证 aggregate 已存在。`producer_workflow_run_id` 和 `producer_step_run_id` 只在事件由 Workflow step 产生时填写；Ingress 和 Catalog 发布事件允许 NULL。

`event_payload_json` 与已经删除的 `raw_submission.source_payload_json` 不是一回事：Outbox 只保存最小路由 payload，例如 subject ID、event UUID 和 version，不复制姓名、邮箱、简历或完整业务记录。

“最小”表示 Consumer 只凭 payload 中的标识即可回到 D1 权威表读取最新且被允许的业务数据；不把该业务实体复制成第二份快照。很多事件甚至可以使用 `{}`，因为行本身已有 `event_type`、`aggregate_type`、`aggregate_id` 和 `event_schema_version`。

示例：

```json
{
  "raw_submission_id": 123,
  "workflow_type": "workflow_a_submission_to_application",
  "workflow_version": "v1"
}
```

```json
{
  "application_id": 1049,
  "candidate_snapshot_id": 1049,
  "workflow_type": "workflow_b_ml_hiring_decision"
}
```

```json
{
  "catalog_revision_id": 27,
  "target_type": "google_form",
  "target_key": "internship_form_2026"
}
```

```json
{
  "offer_id": 88,
  "offer_version_id": 101
}
```

允许放入 payload：

```text
业务主键/UUID
目标 Workflow 或 Consumer 类型
Schema/Workflow/version 标识
correlation/dedup key
必要的非敏感路由参数
```

禁止放入 payload：

```text
姓名、邮箱、电话
raw_resume_text、JD 全文
完整 Application/Candidate/Offer 内容
API token、Service Account、HMAC secret
临时签名下载 URL
可以通过 aggregate ID 从 D1 读取的大段重复数据
```

最小 payload 的意义是：降低 PII 复制和事件大小、避免业务数据在主表与 Outbox 之间不一致、让 Consumer 始终以权威表为准，并通过 `event_schema_version` 支持向后兼容。

`lease_owner + lease_expires_at` 用于多个 dispatcher 安全抢占。只有持有未过期 lease 的 dispatcher 可以更新该事件；崩溃后其他 dispatcher 可在 lease 到期后重新领取。

### Lease 领取机制

多个 dispatcher 可能同时查询到同一条 pending event。不能只执行“SELECT 后发送”，否则多个实例会同时投递。领取过程必须使用带条件的原子 UPDATE：

```text
UPDATE outbox_event
SET dispatch_status = dispatching,
    lease_owner = 本 dispatcher UUID,
    lease_expires_at = 当前时间 + lease 时长
WHERE id = ?
  AND event 仍可领取
  AND lease 不存在或已经过期
```

只有实际更新成功的 dispatcher 获得处理权。其他实例发现更新行数为 0 后跳过。

正常流程：

```text
pending/failed_retryable
→ 原子取得 lease
→ dispatching
→ 调用目标 Consumer
→ published
→ 清除 lease
```

崩溃恢复：

```text
Dispatcher A 取得 lease
→ A 崩溃
→ lease 到期
→ Dispatcher B 重新领取
→ 再次投递
```

Lease 是有期限的技术租约/临时处理权，不是招聘业务锁，也不是长时间保持的 D1 transaction lock。

这里的 Lease 仅表示某个 Dispatcher invocation 对一条 `outbox_event` 的临时投递处理权；它不是 Workflow、Application、Candidate 或招聘业务锁。Lease 到期后的重领仍处理同一 event type/aggregate/destination，不会跳过 Workflow A 或擅自启动 Workflow B。

### 为什么是“至少一次投递”

存在一个无法用单个 D1 事务覆盖的网络窗口：

```text
1. Consumer 已经成功接收并处理事件
2. Dispatcher 在把 Outbox 更新为 published 之前崩溃
3. lease 到期后事件再次发送
```

系统无法可靠区分“Consumer 没收到”和“Consumer 收到了但确认丢失”。为了不丢事件，只能允许再次发送，因此保证是：

```text
至少一次：成功事件不会永久漏掉，但可能重复送达
```

Consumer 必须以 `event_uuid` 或 `deduplication_key` 实现幂等：

```text
第一次收到 event-123
→ 创建/复用目标记录
→ 保存 event-123 已处理

再次收到 event-123
→ 查询到已处理
→ 返回原结果
→ 不重复创建 Workflow、Offer、通知或同步任务
```

生产目标是“至少一次传输 + 幂等副作用”，得到接近 exactly-once 的业务效果，而不是声称网络层绝对只传输一次。

## 7. `audit_event`

Audit 只记录重要业务/管理事实，例如：

```text
Catalog revision published
Application superseded
resubmission blocked by limit
manual retry requested
terminal workflow manually requeued
Application decision overridden
Offer status changed
compensation completed/failed
source payload conflict detected
```

建议记录的完整事件类别：

| 类别 | 典型 Audit 事件 |
|---|---|
| Catalog 管理 | Company/Position/Company Work Mode 被启用或停用；Catalog revision 发布；管理员改变可申请目录 |
| Ingress 与隐私 | 相同 source identity 出现 payload conflict；Raw PII purge 完成；retention 被管理员延长或缩短 |
| Dedup/admission | dedup 结果被人工 override；因达到重申上限而阻止进入 Application；管理员允许例外重申 |
| Person/Application | Person 合并/拆分；Application 创建、superseded、取消；current pointer 被受控更正 |
| ML 治理 | ML model/feature pipeline/threshold policy 版本被启用；自动 recommendation 被人工 override |
| Hiring | 跳过/返回招聘 stage；招聘 decision 被修改；Pipeline assignment 被管理员改变 |
| Offer | Offer draft 创建；条款版本发布；Offer 撤回；关键状态由人工或系统改变 |
| Workflow 运维 | terminal run 被显式 requeue；管理员取消 Workflow；补偿开始、完成或失败；人工强制解除等待 |
| 安全与权限 | 未授权管理操作被拒绝；权限角色改变；敏感导出被批准或执行 |

不是所有领域状态都要在 Audit 中复制一遍。例如 `offer_status_history` 保存 Offer 状态的完整领域历史，Audit 只需要在涉及人工操作、override、法律/财务关键动作或跨领域影响时记录 actor、reason 和对应记录 ID。这样 Audit 提供“谁、为什么”，领域历史提供“业务状态是什么”。

建议 actor：

```text
system
workflow
admin
recruiter
applicant
external_service
```

`event_metadata_json` 只保存非敏感差异摘要或相关 ID，例如：

```json
{
  "previous_status": "processing",
  "new_status": "superseded",
  "replacement_application_id": 1050
}
```

不应把完整被修改行、Resume 或错误 stack trace 写入 Audit。

它不复制：

```text
每一个 step 的技术错误
每一次网络 retry
完整 PII payload
Resume 文本
```

这些分别属于 step/attempt 或业务源表。Audit 使用 `occurred_at` 表示业务事实发生时间，`recorded_at` 表示审计行写入时间；没有 `updated_at`，写入后不可修改。

## 8. 短事务、重试与补偿的关系

```text
短 D1 batch rollback
→ 撤销本次 batch 内全部 SQL

Step retry
→ 同一逻辑 step 创建新 attempt，再次幂等执行

Workflow compensation
→ 对此前已经提交、但本 Workflow 尚未正式发布的专属结果执行反向操作或标记作废
```

补偿不删除：

```text
raw_submission
intake/workflow/step/attempt 日志
历史成功 Workflow 的数据
共享 Company、Position、Skill、School
已正式发布且被其他业务引用的 Application/Person/Candidate
```

补偿只能处理本 workflow 拥有且可证明未发布的 staging/派生结果。具体每一步的补偿动作在 G05、G06、G07、G09、G10 确认时逐项定义。

## 9. 第一版为什么不使用业务 SQL Trigger

第一版 SQL Trigger 数量保持为 0：

- Trigger 隐式执行，生产错误更难追踪到明确 Workflow step；
- 不适合调用 Queue、Workflow、R2 或外部 API；
- Trigger 失败会影响原 SQL，但不能替代跨步骤补偿；
- 业务状态转换应由显式 service + `batch()` + Outbox 执行。

数据库仍使用 FK、UNIQUE、CHECK 保护不变量；“不用 Trigger”不等于不用数据库约束。

## 10. 三方差异

### 与组员项目

| 维度 | 新版 | 组员 Worker |
|---|---|---|
| 总运行 | D1 持久化 workflow run | 一次 Worker `runSync()` 与 console summary |
| Step | 每个逻辑步骤独立状态/版本/幂等 | 多个函数顺序调用，没有统一 step record |
| Retry | 每次技术 attempt 独立记录 | 顶层捕获错误，缺少统一 attempt model |
| 部分成功 | 短 batch + Outbox + compensation | 多次独立 INSERT/UPDATE，可能留下部分实体 |
| 交接 | Transactional Outbox | 函数内直接调用 parser/下一操作 |
| 审计 | 独立 append-only business audit | 主要依赖状态字段与 console |

可沿用组员的 adapter/parser 技术实现，但它们必须成为明确 step 或外部 consumer，不能继续把全部业务写入藏在一个同步循环里。

### 与原版数据库/Colab

| 维度 | 新版 | 原版 |
|---|---|---|
| 通用运行表 | workflow/step/attempt 三层 | `Submission_processing_run` 一层 |
| 输入所有者 | Raw 或 Application | 只 FK 到 `Submission_normalized` |
| 重试 | attempt 与逻辑 step 分离 | `run_number` 混合运行版本和尝试概念 |
| 状态来源 | D1 权威状态 | Colab output + CSV +部分运行表 |
| 可靠触发 | Outbox | 人工运行下一个 Cell |
| 补偿 | workflow ownership + step status | 没有统一补偿控制面 |
| 审计 | 独立 `audit_event` | 没有统一不可变业务审计表 |

原版 `Application_stage_run` 不由 G04 替代。它是招聘业务阶段事实，继续在 G10；`etl_step_attempt` 是系统执行 retry，两者语义不同。

## 11. 本轮已经确认的决定

- Outbox 成功状态暂时保留标准术语 `published`，对应时间字段保留 `published_at`。它只表示事件已经成功交付给目标，不表示下游 Workflow 已经执行完成。
- `etl_workflow_run.trigger_event_key` 已替换为 `trigger_outbox_event_id INTEGER NOT NULL UNIQUE`。
- `trigger_outbox_event_id` 外键关联 `outbox_event.id`，删除行为为 `ON DELETE RESTRICT`；每个正式 Workflow A/B run 必须且只能对应一个触发它的 Outbox event。
- 人工重新运行 terminal workflow 时，也必须先创建新的可审计 Outbox event，再由该 event 触发新的 workflow run。
- Workflow A 发布 Person/Application/Candidate 的最小 core；Workflow B 发布 Education、Employment、Skill、Project、Certification 等完整 enrichment，并继续执行 ML、招聘决策和条件性的 Offer draft 创建。
- Raw 落库前已经完成一次 Resume text 获取尝试并形成终结性 `raw_submission_resume` 结果，但不保证文本非空；Workflow A 不负责 PDF→text。只有 `resume_text_status = available` 且有效非空白字符不少于 100 的记录才继续 normalization/结构化提取；`no_resume`、终结性解析失败或严重短文本由 Initial Cleaning 记录 Block。“成功但没有某类 Education/Employment/Skill/Project 实体”以零子记录表达，不创建 `unknown`、空字符串或 placeholder 假实体，结构化提取技术失败由 step/attempt 状态单独表达。
- Application 生命周期状态与招聘决定状态分开建模，`superseded` 不覆盖旧记录原有的 `pending/rejected/offer_created` 决定事实；具体字段和值在 G07 冻结。
- 合法重申的旧 Application supersede/fence 必须在 Workflow A 最终发布边界内完成，先于新 Workflow B 获得决策资格；Dispatcher 和 Workflow B 的有副作用步骤仍必须重复验证状态/fence，以防排队延迟与并发更新。
- A 到 B 的 Resume 数据交接使用 D1 中带来源与解析/规则版本的持久化 extraction 记录，不使用 CSV、Cell 变量或默认重复解析。跨层来源只通过 `application_source_lineage` 表达；不在 `application` 或 `candidate_snapshot` 复制完整 Resume 长文本。
- `application_source_lineage.lineage_role` 中，被本次 Application/ML 正式采用的主要来源使用已确认术语 `primary_decision_input`；不改名为 `primary_application_source`。
- 暂时性 parser、网络、限流或外部服务错误不能仅因 `resume_text IS NULL` 被永久业务 Block；必须先按 retryable 技术错误处理，只有 `no_resume`、终结性不可解析或成功但有效文本为空等终结结果才进入 Initial cleaning 的 Block 决定。
- `submission_normalized` 不复制 Resume 长文本；后续结构化 extraction 必须从精确的 `submission_normalized_id` 出发，经其 `raw_submission_id` 读取本次被冻结的来源文本，不能只按 `raw_submission_id` 猜测某个 normalization version。
- Initial Cleaning 与 ML 首版均不增加语言识别、翻译或多语言分流。ML 严格沿用现有 Colab 逻辑；只有原代码已有的文本长度/anomaly、结构化特征和 `all-MiniLM-L6-v2` 相似度流程继续保留。

## 12. 已确认边界

1. G04 当前创建七张表：两张版本化非敏感配置表，以及五张不能合并的 Workflow、Step、Attempt、Outbox 和业务审计表。
2. `etl_workflow_run` 一次只能直接属于 Raw 或 Application 之一。
3. Workflow 主状态不增加 `failed_retryable`；瞬态失败由 step/attempt 表达，Workflow 保持 running/waiting，耗尽后才进入 terminal/compensation 状态。
4. Step attempt 开始时插入，终结时只完成一次，终结后不可改写；新的技术 retry 创建下一条 attempt。
5. `max_attempts`、`max_delivery_attempts` 为 NOT NULL，并冻结该次运行采用的配置。
6. Outbox 仅保存最小合法 JSON，不复制 Raw PII、Resume 长文本、token 或完整 payload。
7. Outbox 使用 lease 领取和至少一次投递；lease 过期可由其他 dispatcher 重新领取，因此 Consumer 必须幂等。
8. Audit 只保存重要业务/管理事实；技术错误详情留在 step/attempt，不进行双份复制。
9. 第一版业务 SQL Trigger 数量为 0；状态机由显式服务命令、短 D1 batch 和 Outbox 实现。
10. Workflow A/B 的具体 step 列表随对应业务组冻结；每个实现文件仍必须逐步定义错误分类、重试上限、幂等结果和补偿策略。
