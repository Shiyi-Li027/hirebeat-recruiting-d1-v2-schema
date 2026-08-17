# G04 Workflow Control 新手完整指南（Confirmed Revision 1）

版本日期：2026-08-17  
对应 Schema：`004_workflow_control_draft.sql`  
读者：第一次接触数据工程、异步任务、Workflow、Outbox 的开发者

## 1. 先用一个生活例子理解五张表

把一条岗位申请想成一份需要经过多个部门处理的文件：

```text
总工单            = etl_workflow_run
工单中的每道工序  = etl_step_run
某道工序第几次尝试 = etl_step_attempt
送往下一部门的待办信封 = outbox_event
重要管理操作记录簿 = audit_event
```

例如：

```text
Workflow A 总工单
├── Initial Cleaning
├── Normalization
├── Resume Extraction
├── Deduplication
└── Application Publish
```

Resume Extraction 第一次遇到 parser 503，第二次成功：

```text
1 条 etl_workflow_run
5 条 etl_step_run
Resume Extraction 对应 2 条 etl_step_attempt
```

Application Publish 完成后需要启动 Workflow B：

```text
写入 1 条 outbox_event(workflow_b_requested)
```

招聘管理员后来人工覆盖 ML decision：

```text
写入 1 条 audit_event(application_decision_overridden)
```

## 2. Outbox 为什么能够启动 Workflow

### 2.1 Outbox 表自己不会运行代码

D1 是数据库。往 `outbox_event` 插入一行，只表示数据库里出现了一项“必须可靠交付的待办”。它不会自动调用 Cloudflare Workflow。

真正执行启动动作的是一个 Worker 程序，本文称为：

```text
Outbox Dispatcher
```

Dispatcher 的工作只有：

```text
从 D1 找到可投递 Outbox
→ 安全领取
→ 根据 event_type 选择目标
→ 调用 Cloudflare Workflow/Queue/Service
→ 记录 published 或失败
```

### 2.2 Dispatcher 是什么

Dispatcher 不是一个人，不是一张表，也不是 Workflow A/B。它是一段部署在 Cloudflare Worker 上的 TypeScript/JavaScript 程序，例如：

```text
dispatchOutboxEvents(env)
```

同一段代码可以被以下入口调用：

1. Raw 成功提交后，通过 `ctx.waitUntil()` 尽快尝试一次；
2. Cron Trigger 的 `scheduled()` handler 定期扫描尚未成功的 Outbox；
3. 未来也可以由 Queue consumer 触发。

首版建议：

```text
立即尝试 dispatcher
+
定时 recovery dispatcher
```

立即尝试降低延迟；定时扫描保证立即尝试崩溃后事件仍不会永久丢失。Cloudflare 官方允许 Worker 通过 Workflow binding 的 `create({id, params})` 创建 Workflow instance，也允许从 HTTP、Queue 或 scheduled handler 触发。

### 2.3 “Dispatcher X”和“Dispatcher Y”到底是什么

它们不是两套不同代码，只是同一段 Dispatcher 代码的两个并发运行实例。

可能出现的真实场景：

```text
14:00:00.000 申请提交 Worker 完成 Raw batch
14:00:00.010 ctx.waitUntil() 启动一次 Dispatcher（实例 X）
14:00:00.020 定时 recovery 恰好也启动 Dispatcher（实例 Y）
```

或者：

```text
同时有很多申请
→ Cloudflare 同时运行多个 Worker invocation
→ 多个 invocation 都在扫描 Outbox
```

“X/Y”只是为了讲解而给两个同时执行的 Dispatcher invocation 起的临时名字。它们没有固定身份，也和 Workflow A/Workflow B 没有任何对应关系；实际代码会为每次 invocation 生成一个 `lease_owner` UUID。

### 2.4 Workflow A 的完整启动过程

第一步，Ingress 在一个 D1 `batch()` 中共同写入：

```text
INSERT raw_submission
UPDATE raw_submission_intake_run → succeeded
INSERT outbox_event
```

Outbox 示例：

```text
event_type = workflow_a_requested
aggregate_type = raw_submission
aggregate_id = 123
destination_type = cloudflare_workflow
destination_key = workflow_a
event_payload_json = {
  "raw_submission_id": 123,
  "workflow_type": "workflow_a_submission_to_application",
  "workflow_version": "v1"
}
```

第二步，Dispatcher 原子领取该事件。

第三步，Dispatcher 根据 `event_type = workflow_a_requested` 选择 Worker binding：

```text
env.WORKFLOW_A
```

第四步，Dispatcher 幂等创建或复用 `etl_workflow_run`：

```text
workflow_type = workflow_a_submission_to_application
raw_submission_id = 123
workflow_status = requested
```

第五步，Dispatcher 使用确定性的 Cloudflare instance ID 调用：

```ts
await env.WORKFLOW_A.create({
  id: cloudflareInstanceId,
  params: {
    workflowRunId: workflowRunId,
    rawSubmissionId: 123
  }
});
```

第六步，确认 instance 已创建或已经存在后：

```text
etl_workflow_run.cloudflare_instance_id = ...
outbox_event.dispatch_status = published
outbox_event.published_at = now
```

这里的 `published` 只表示“启动请求已被目标系统接受”，不表示 Workflow A 已经完成。Workflow A 是否完成必须看 `etl_workflow_run.workflow_status`。

### 2.5 Workflow B 的完整启动过程

Workflow A 最后的 Application publish 短事务共同完成：

```text
创建 Application/Person/Candidate/lineage
更新 Workflow A/step 成功状态
插入 workflow_b_requested Outbox
```

Outbox 示例：

```text
event_type = workflow_b_requested
aggregate_type = application
aggregate_id = 1049
destination_type = cloudflare_workflow
destination_key = workflow_b
event_payload_json = {
  "application_id": 1049,
  "candidate_snapshot_id": 1049,
  "workflow_type": "workflow_b_candidate_enrichment_to_application_decision",
  "workflow_version": "v1"
}
```

Dispatcher 根据 event type 调用：

```ts
await env.WORKFLOW_B.create({
  id: cloudflareInstanceId,
  params: {
    workflowRunId: workflowRunId,
    applicationId: 1049,
    candidateSnapshotId: 1049
  }
});
```

Workflow B 读取 D1 权威 Application/Candidate 数据，而不是相信 Outbox 中复制的大段资料。

严格门禁：`workflow_b_requested` 只能在 Workflow A 的最终 Application publish batch 中创建。该 batch 必须共同完成 Application/Person identity core/Candidate snapshot core 发布、Workflow A succeeded，以及 Workflow B Outbox 插入；任一语句失败则全部回滚。因此 Workflow A 没有成功时不会存在合法的 Workflow B 请求。Dispatcher 在启动 B 前还应防御性验证 Application 存在、父 Workflow A 为 succeeded、B Outbox 与 Application 一致。

如果这是一次允许进入 Application 层的合法重申，旧 Application 的 supersede/fence 处理也必须发生在上述最终发布边界内，并且先于新 Workflow B 获得决策资格。推荐的原子业务结果是：旧 Application 失去继续决策资格、新 Application 与 Candidate core 发布、来源 lineage 写入、旧 Workflow 终止请求和新 `workflow_b_requested` Outbox 一起成功或一起失败。Dispatcher 仍要检查新 Application 没有被 `superseded` 或 `cancelled`，因为 Outbox 可能排队延迟，Application 可能在“事件写入以后、真正派发以前”再次被更新；已经运行的 Workflow B 也必须在每个有副作用的 step 和最终 Offer batch 前重新检查状态/fence。

Workflow B 的范围不是只有 ML。当前更准确的边界是：写入 Candidate/Person 的 Education、Employment、Skill、Project 等 enrichment，生成 ML 结果，执行招聘阶段/最终 Application decision；如果最终结果为 offer，则在最终短事务中同时创建 Offer draft。Workflow A 只发布 B 所必需的 identity/core 主记录和稳定 ID。

这里的 `Person identity core` 和 `Candidate snapshot core` 不是完整 Profile：

```text
Workflow A 创建的最小 core
├── person：稳定 person_id 与最小规范化身份
├── application：本次合法进入 Application 层的申请
├── candidate_snapshot：application_id 对应的最小快照容器，不复制 Resume 或跨层来源 ID
└── application_source_lineage：唯一负责 Submission/extraction 跨层来源追溯

Workflow B 发布的完整 enrichment
├── person_name / person_contact / person_link 历史
├── education / person_education / candidate_education
├── person_position / candidate_position
├── person_skill / candidate_skill
├── person_project / candidate_project
└── certification 关系（有可靠结果时）
```

提取不是在 Dispatcher 中完成。按照最新已确认边界，PDF/URL/Google Drive file → 非空 Resume text 在 Raw 落库之前由 intake adapter 完成；没有文本的事件只保留 intake 结果，不创建 Raw，也不会请求 Workflow A。Workflow A 的 G05 steps 使用 Raw 中已经存在的 Resume text，生成 Submission 层的版本化 `resume_extraction`、`resume_education`、`resume_employment`、`resume_skill`、`resume_project` 和 identity features；G06 完成去重与准入。Workflow B 再读取这些带来源和版本的提取结果，重新执行发布准入验证，把合格记录映射到 Person/Candidate 业务表。Dispatcher 只负责启动，不解析 Resume，也不生成 Person/Candidate 内容。

“Workflow B 读取 Workflow A 的结果”是显式、持久化的数据库交接，不是隐藏的 Cell/内存依赖：每条提取结果都要能指向权威 `resume_extraction`、来源 Submission、解析/规则版本和生成它的 step。Workflow B 按 Application lineage 指定的 source/extraction version 读取，不能简单选择“数据库里最新的一行”。默认不把完整 Resume 长文本或跨层来源 ID 复制到 `application` 或 `candidate_snapshot`；这两张表只保存稳定业务 core 和必要业务快照，完整来源文本留在 Raw/Submission extraction 层，跨层指针与哈希只放在 `application_source_lineage`。只有明确运行新版 parser、人工重处理或旧结果缺失/无效时，才创建新的 extraction version；正常启动 Workflow B 不重复解析整份简历。

本项目已经确认跨层 Resume 来源只通过 `application_source_lineage` 表达。后续 G07 应让一条 lineage 明确记录被该 Application 采用的 `source_resume_extraction_id`、来源版本/哈希和 lineage role；ML 通过这条明确关系读取 `resume_extraction` 的权威文本，不能把整段 Resume 放进 Outbox，也不能按时间猜测最新版本。Application 与 Candidate snapshot 保持较窄，避免长文本重复、PII 扩散和清除不一致。

本项目确认该主要来源的 `lineage_role` 使用标准值 `primary_decision_input`。它表示“这条来源是本 Application 及其决策流程正式采用的主要输入来源”，并不表示 Resume 是最终决策的唯一特征；Position JD、结构化 Candidate profile、模型版本和 threshold policy 仍由 ML input snapshot 共同记录。

### 2.6 为什么不能在 Raw batch 里直接调用 Workflow

D1 `batch()` 只能包含 SQL，不能把外部 Workflow API 调用放进同一个数据库事务。

如果采用：

```text
先写 Raw
→ 再直接调用 Workflow
```

Worker 可能在两者之间崩溃，造成 Raw 永远没有 Workflow。

如果采用：

```text
先调用 Workflow
→ 再写 Raw
```

则可能 Workflow 已启动，但 Raw 写入失败。

Outbox 把“必须启动 Workflow”先变成同一数据库事务中的持久事实，再异步执行外部调用。

## 3. Lease 和至少一次投递

### 3.1 为什么需要领取

如果 Dispatcher X 和 Dispatcher Y 同时 SELECT 到 event 100，然后都调用同一个目标，就可能创建两次副作用。Lease 用来保证同一时刻只有一个 Dispatcher invocation 获得主要处理权。这里的 X/Y 都是 Outbox 投递程序，不是 Workflow A/B。

领取使用条件更新，不是单纯 SELECT：

```text
只有 event 仍可处理且 lease 不存在/已过期时
才能把 lease_owner 改成本 invocation UUID
```

更新成功一行者获胜；更新零行者说明已被别人领取，必须跳过。例如 X 更新成功，Y 更新零行；如果 X 崩溃，Y 或未来另一个 invocation 只能在 lease 到期后重新领取同一条 Outbox。它仍然投递该事件原本指定的 Workflow A 或 Workflow B，不会因为重领而从 A 改成 B。

### 3.2 Lease 字段

```text
lease_owner
lease_expires_at
```

例如：

```text
lease_owner = dispatcher-invocation-abc
lease_expires_at = 2026-08-17T14:01:00Z
```

如果该 Dispatcher 崩溃，其他 Dispatcher 在 14:01 后可以重新领取。

这里的 Lease 只属于 `outbox_event` 的投递控制平面。它不是招聘合同 lease，不是 Candidate/Application 锁，也不会决定 Workflow A/B 的成功。它只回答：“未来一小段时间内，哪一个 Dispatcher invocation 有权尝试投递这条 event？”Lease 到期只允许其他 invocation 重新投递同一条 Outbox 指定的目标，不会改变 `event_type`，也不会把 Workflow A 自动变成 Workflow B。

### 3.3 至少一次投递

可能发生：

```text
Workflow 已成功创建
→ Dispatcher 尚未把 Outbox 更新为 published 就崩溃
→ lease 到期后再次发送同一事件
```

为了不丢事件，系统接受“同一事件可能被再次发送”。因此 Consumer 必须按 `event_uuid`、`deduplication_key` 和业务 UNIQUE 复用同一个结果。

Cloudflare Workflow instance 使用确定性 ID；如果 `create()` 返回“ID 已存在”，Dispatcher 应调用 `get(id)` 确认已有实例，而不是生成另一个随机 ID。

## 4. `etl_workflow_run` 完整字段字典

| 字段 | 是否可空 | 示例/可能值 | 意义与功能 |
|---|---:|---|---|
| `id` | 否 | `501` | D1 内部整数主键，只用于数据库关系；不向外作为全局身份 |
| `workflow_run_uuid` | 否 | `550e8400-...` | 全局运行 UUID；API、日志、Outbox 和跨系统追踪使用；唯一 |
| `workflow_type` | 否 | `workflow_a_submission_to_application`、`workflow_b_candidate_enrichment_to_application_decision` | 表示运行哪一种业务 Workflow；可扩展 TEXT，不是状态 |
| `workflow_version` | 否 | `v1`、`2026-08-17.1` | 冻结本次采用的 Workflow 定义/步骤编排版本；不是 ML model 或 Hiring Pipeline version |
| `idempotency_key` | 否 | `workflow_a:raw:123:v1` | 同一 subject 的同一逻辑运行唯一键；技术重送必须复用原 run |
| `cloudflare_instance_id` | 是 | `wfa_550e8400...` | Cloudflare Workflows 平台实例 ID；创建平台实例前可 NULL；唯一 |
| `parent_workflow_run_id` | 是 | Workflow B 指向 Workflow A 的 `id` | 表示业务交接来源；不是级联删除所有历史的命令 |
| `raw_submission_id` | 条件可空 | `123` | Workflow A 的直接 subject；与 `application_id` 恰有一个非 NULL；FK/RESTRICT |
| `application_id` | 条件可空 | `1049` | Workflow B 的直接 subject；与 `raw_submission_id` 恰有一个非 NULL；FK/RESTRICT |
| `trigger_outbox_event_id` | 否 | `2001` | 启动本 run 的唯一 Outbox FK；`NOT NULL + UNIQUE + ON DELETE RESTRICT`。所有正式 A/B run 都必须通过 Outbox，技术重送复用同一个 run |
| `workflow_status` | 否 | 下表 8 个值 | 整段 Workflow 的权威总状态 |
| `current_step_key` | 是 | `resume_extraction` | 当前步骤查询缓存；真正权威状态在 `etl_step_run` |
| `run_attempt_count` | 否 | `0,1,2...` | 同一 logical Workflow 被平台调度/恢复的技术次数；不是 resubmission 次数 |
| `last_error_code` | 是 | `d1_timeout`、`parser_schema_error` | 最近一个非敏感机器可读错误码；成功时可 NULL |
| `last_error_detail` | 是 | 截断后的说明 | 最近错误摘要；不存 PII、token、Resume 或完整 stack |
| `cancellation_reason_code` | 是 | `superseded_before_publish`、`admin_cancelled` | 只有 cancelled 时记录机器可读取消原因 |
| `requested_at` | 否 | UTC ISO 8601 | 逻辑运行请求被登记时间 |
| `started_at` | 是 | UTC ISO 8601 | 第一次实际开始执行时间；requested 阶段可 NULL |
| `last_progressed_at` | 是 | UTC ISO 8601 | 最近一次步骤推进/状态变化时间，用于卡住检测 |
| `completed_at` | 是 | UTC ISO 8601 | 进入 succeeded/compensated/failed_terminal/cancelled 等终结状态的时间 |
| `created_at` | 否 | UTC ISO 8601 | 数据库 run 行创建时间 |
| `updated_at` | 否 | UTC ISO 8601 | run 摘要最近更新的时间 |

### `workflow_status` 允许值

| 值 | 意义 |
|---|---|
| `requested` | 请求已登记，尚未真正开始 |
| `running` | 正常执行或推进中 |
| `waiting` | 持久等待退避时间、外部事件或资源，不是失败 |
| `succeeded` | 所有 required steps 完成，业务结果发布成功 |
| `compensating` | 正在处理此前跨步骤副作用 |
| `compensated` | Workflow 未成功，但可撤销影响已安全收敛 |
| `failed_terminal` | 无法自动继续，需要修复/重排，或补偿失败 |
| `cancelled` | 在安全边界被可信系统/管理员主动停止 |

## 5. `etl_step_run` 完整字段字典

| 字段 | 是否可空 | 示例/可能值 | 意义与功能 |
|---|---:|---|---|
| `id` | 否 | `801` | 逻辑 step 内部主键 |
| `workflow_run_id` | 否 | `501` | 所属 Workflow FK；Workflow 被物理删除时专属 step CASCADE，但正式历史原则上不物理删 |
| `step_key` | 否 | `initial_cleaning`、`normalization`、`resume_extraction`、`deduplication`、`application_publish`、`ml_analysis` | 稳定机器代码；同一 Workflow 内唯一 |
| `step_name` | 否 | `Resume extraction` | 面向人类的显示名称，可改文案但不用于幂等 |
| `step_version` | 否 | `resume_parser_v5` | 本次实际使用的步骤/规则代码版本 |
| `idempotency_key` | 否 | `wf-uuid:resume_extraction:v5` | 同一逻辑 step 只创建一行；唯一 |
| `is_required` | 否 | `1` 或 `0` | `1` 必须成功 Workflow 才能 succeeded；`0` 可根据业务条件明确 skipped |
| `step_status` | 否 | 下表 11 个值 | 该逻辑步骤当前权威状态 |
| `attempt_count` | 否 | `0,1,2...` | 已创建多少条技术 attempt 的缓存；需与 attempt 表事务同步 |
| `max_attempts` | 否 | `1`、`3`、`5` | 本次运行采用的重试上限快照；不随未来配置变化 |
| `next_retry_at` | 是 | UTC ISO 8601 | retryable 后最早再次执行时间 |
| `last_error_code` | 是 | `parser_503` | 最近错误机器码 |
| `last_error_detail` | 是 | 截断说明 | 最近非敏感技术摘要 |
| `started_at` | 是 | UTC ISO 8601 | 第一次 attempt 开始时间 |
| `completed_at` | 是 | UTC ISO 8601 | step 进入终结状态时间 |
| `created_at` | 否 | UTC ISO 8601 | step run 创建时间 |
| `updated_at` | 否 | UTC ISO 8601 | step 摘要最近更新时间 |

### `step_status` 允许值

| 值 | 意义 |
|---|---|
| `pending` | 已规划但尚未执行 |
| `running` | 某次 execute attempt 正在运行 |
| `waiting` | 等待外部事件/退避/调度时间 |
| `succeeded` | 逻辑 step 已得到合法成功结果，包括合法零行输出 |
| `skipped` | 业务规则明确允许不执行；只能用于 optional 或明确不适用步骤 |
| `failed_retryable` | 当前 attempt 失败但仍在上限内，可创建下一 attempt |
| `failed_terminal` | 不能再自动执行；错误非瞬态或重试耗尽 |
| `compensating` | 正在执行该 step 的反向补偿 |
| `compensated` | 该 step 的可撤销副作用已收敛 |
| `compensation_failed` | 补偿本身失败，Workflow 通常转 failed_terminal |
| `cancelled` | step 在未需补偿的安全边界被取消 |

## 6. `etl_step_attempt` 完整字段字典

| 字段 | 是否可空 | 示例/可能值 | 意义与功能 |
|---|---:|---|---|
| `id` | 否 | `1201` | 一次技术尝试的内部主键 |
| `step_run_id` | 否 | `801` | 所属逻辑 step FK |
| `attempt_uuid` | 否 | UUID | 本次尝试全局身份；重复回调/日志关联使用；唯一 |
| `attempt_number` | 否 | `1,2,3...` | 在同一 step 内的顺序号；与 step 唯一 |
| `attempt_kind` | 否 | `execute`、`compensate` | 正向执行业务步骤或执行补偿 |
| `worker_execution_id` | 是 | Cloudflare invocation/correlation ID | 关联平台日志；不同平台/本地测试拿不到时可 NULL |
| `attempt_status` | 否 | 下表 6 个值 | 本次具体尝试的结果，不是整个 step 结果 |
| `error_class` | 是 | `transient`、`terminal`、`timeout`、`cancelled` | 决定是否允许重试的粗粒度错误类别；成功/running 可 NULL |
| `error_code` | 是 | `d1_timeout` | 机器可读具体错误码 |
| `error_detail` | 是 | 截断说明 | 非敏感错误摘要 |
| `retry_scheduled_at` | 是 | UTC ISO 8601 | 本次失败后计划下一 attempt 的时间；不重试时 NULL |
| `started_at` | 否 | UTC ISO 8601 | 本次 attempt 开始时间 |
| `finished_at` | 条件可空 | UTC ISO 8601 | running 时必须 NULL；终结时必须有值 |
| `duration_ms` | 是 | `842` | 完成后耗时毫秒；必须非负 |
| `created_at` | 否 | UTC ISO 8601 | attempt 行创建时间；没有通用 updated_at，终结由 finished_at 表达 |

### `attempt_status` 允许值

| 值 | 意义 |
|---|---|
| `running` | 本次尝试尚未结束 |
| `succeeded` | 本次尝试完成，并产生幂等合法结果 |
| `failed_retryable` | 本次失败属于可重试错误 |
| `failed_terminal` | 本次失败不能自动重试 |
| `timed_out` | 超过定义时间；是否再试由 step policy 决定 |
| `cancelled` | 本次 invocation 被受控取消 |

终结后的 attempt 不应再改写。Worker 崩溃留下长期 running 时，只允许 reconciler 根据超时规则终结为 timed_out。

## 7. `outbox_event` 完整字段字典

| 字段 | 是否可空 | 示例/可能值 | 意义与功能 |
|---|---:|---|---|
| `id` | 否 | `2001` | Outbox 内部整数主键 |
| `event_uuid` | 否 | UUID | 跨系统事件身份；Consumer 幂等使用；唯一 |
| `deduplication_key` | 否 | `workflow-a-requested:sub-uuid:v1` | 同一个业务事实只能产生一条 Outbox；唯一 |
| `event_type` | 否 | `workflow_a_requested`、`workflow_b_requested`、`catalog_sync_requested`、未来 `offer_lifecycle_requested` | Dispatcher 路由依据；说明发生/请求什么 |
| `event_schema_version` | 否 | `v1` | payload contract 版本；Consumer 据此验证和兼容 |
| `aggregate_type` | 否 | `raw_submission`、`application`、`catalog_revision`、`offer` | 事件所属权威业务实体类型 |
| `aggregate_id` | 否 | `123` | 对应实体 ID；Dispatcher/Consumer 回 D1 查询 |
| `destination_type` | 否 | `cloudflare_workflow`、`cloudflare_queue`、`internal_service`、`external_api` | 目标机制类型 |
| `destination_key` | 是 | `workflow_a`、`workflow_b`、`google_form_catalog_sync` | 具体 binding/consumer/目标代码；只有一个默认目标时可 NULL |
| `producer_workflow_run_id` | 是 | `501` | 由某 Workflow 产生时填写；Ingress/Catalog 直接生产时可 NULL |
| `producer_step_run_id` | 是 | `805` | 由某 step 发布时填写，便于追踪；否则 NULL |
| `event_payload_json` | 否 | `{}` 或最小 ID/version JSON | 最小路由参数，不复制 PII 和完整业务实体；必须是合法 JSON |
| `dispatch_status` | 否 | 下表 6 个值 | Outbox 自身投递状态；不是目标 Workflow 状态 |
| `delivery_attempt_count` | 否 | `0,1,2...` | Dispatcher 实际投递尝试次数；不是 Workflow step attempt |
| `max_delivery_attempts` | 否 | `3`、`5`、`8` | 本事件采用的最大投递次数快照 |
| `available_at` | 否 | UTC ISO 8601 | 事件最早可被领取的时间，可用于延迟事件 |
| `next_attempt_at` | 是 | UTC ISO 8601 | retryable 失败后的下次最早时间 |
| `lease_owner` | 条件可空 | invocation UUID | 当前拥有临时处理权的 Dispatcher |
| `lease_expires_at` | 条件可空 | UTC ISO 8601 | Lease 到期时间；必须与 owner 同时有或同时无 |
| `last_error_code` | 是 | `workflow_create_timeout` | 最近投递错误机器码 |
| `last_error_detail` | 是 | 截断说明 | 最近非敏感投递错误摘要 |
| `published_at` | 是 | UTC ISO 8601 | 目标已经确认接受事件的时间；不代表目标业务已完成 |
| `created_at` | 否 | UTC ISO 8601 | Outbox 行与业务事实共同提交的时间 |
| `updated_at` | 否 | UTC ISO 8601 | 领取、重试、发布等状态最近更新时间 |

### `dispatch_status` 允许值

| 值 | 意义 |
|---|---|
| `pending` | 已提交，尚未被 Dispatcher 领取 |
| `dispatching` | 某 Dispatcher 持有有效 lease 并正在投递 |
| `published` | 目标已确认接受；终结成功，但目标 Workflow 可能仍在运行 |
| `failed_retryable` | 暂时投递失败，可在 next_attempt_at 后再试 |
| `failed_terminal` | 配置/Schema/目标错误或次数耗尽，停止自动投递 |
| `cancelled` | 在尚未发布且业务允许的情况下取消该交接 |

## 8. `audit_event` 完整字段字典

| 字段 | 是否可空 | 示例/可能值 | 意义与功能 |
|---|---:|---|---|
| `id` | 否 | `3001` | Audit 内部主键 |
| `event_uuid` | 否 | UUID | 审计事实全局身份；唯一、写入后不可变 |
| `event_type` | 否 | `application_superseded`、`decision_overridden`、`pii_purged`、`workflow_requeued` | 重要业务/管理事件机器代码；可扩展 TEXT |
| `entity_type` | 否 | `application`、`person`、`raw_submission`、`offer`、`catalog_revision`、`etl_workflow_run` | 被改变/审计的主要实体类型 |
| `entity_id` | 否 | `1049` | 主要实体 ID；是多态引用，不设动态 FK |
| `actor_type` | 否 | `system`、`workflow`、`admin`、`recruiter`、`applicant`、`external_service` | 谁执行或触发重要改变 |
| `actor_id` | 是 | 管理员 user UUID、service name | 具体 actor；无法/不适用时 NULL |
| `workflow_run_id` | 是 | `501` | 事件发生在某 Workflow 内时填写；FK SET NULL 保留 Audit |
| `correlation_key` | 是 | submission/application/incident correlation UUID | 跨多张表和日志串联同一业务事件 |
| `reason_code` | 是 | `resubmission_limit_reached`、`manual_override` | 为什么发生的机器可读原因 |
| `event_summary` | 否 | `Application 1049 superseded by 1050` | 简短、人可读、非敏感摘要；不能为空 |
| `event_metadata_json` | 是 | 状态前后值和相关 ID | 非敏感差异摘要；不复制完整行、Resume 或 stack；必须合法 JSON |
| `occurred_at` | 否 | UTC ISO 8601 | 业务事实真正发生时间 |
| `recorded_at` | 否 | UTC ISO 8601 | Audit 行成功写入时间；可晚于 occurred_at |

Audit 没有 `updated_at`。如果历史 Audit 写错，不能静默修改原行；应追加 correction Audit 并关联原 event。

## 9. 五张表之间的完整关系

```text
raw_submission
    │
    ├── outbox_event: workflow_a_requested
    │        │
    │        └── Dispatcher → Cloudflare Workflow A
    │
    └── etl_workflow_run (Workflow A)
             │
             ├── etl_step_run
             │       └── etl_step_attempt (1..N)
             │
             ├── audit_event（仅重要业务/管理动作）
             │
             └── Application publish + outbox_event: workflow_b_requested
                          │
                          └── Dispatcher → Cloudflare Workflow B
                                      │
                                      └── etl_workflow_run (Workflow B)
```

## 10. 当前建议的实现底线

1. `outbox_event` 不能被当成自动执行器；必须部署 Dispatcher。
2. Raw/Application 发布与对应 Outbox 必须在同一 D1 `batch()`。
3. Dispatcher 领取必须是条件原子更新，不能只 SELECT 后发送。
4. Cloudflare Workflow instance ID 必须确定性生成并可复用。
5. Consumer 必须按 event UUID/dedup key 幂等。
6. Outbox `published` 不等于 Workflow `succeeded`。
7. Payload 只传 ID/version，业务数据回 D1 权威表读取。
8. Step retry、Outbox delivery、申请人 resubmission 三种次数严格分开。
9. Audit 记录关键 actor/reason，不复制所有技术日志。
10. 每个 required step 的错误分类、retry 和 compensation 在后续业务组逐项冻结。
