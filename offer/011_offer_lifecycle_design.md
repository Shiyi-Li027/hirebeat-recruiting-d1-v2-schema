# Group G11：Offer 生命周期（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G11）
状态：`confirmed`

## 1. 首版三张表

| 表 | 一行代表什么 | 写入方式 |
|---|---|---|
| `offer` | 一个 Application 唯一的一份 Offer 主记录及当前状态 | 只更新 current state/pointer/cache |
| `offer_version` | 一版不可变的 Offer 条款 | 条款变化时追加新版本 |
| `offer_status_history` | 一次不可变的生命周期状态变化 | 每次转移追加一行 |

首版继续延后 `offer_document` 和独立 `offer_approval`。真正生成文件时再建前者；需要预算、法务或多级审批实体时再建后者。G10 的 `Offer approval` Stage 可以先记录简单审批结果。

## 2. 三个不同概念

```text
Offer process Stage = G10 中“开始处理 Offer”的招聘阶段
offer               = 一份 Offer 的主身份和当前状态
offer_version       = 某一版实际条款
```

它们不能合并。Stage 说明招聘流程走到哪里；Offer 主表证明已经创建 Draft；Version 保存薪资、正式日期等可能协商修改的条款。

## 3. 为什么主表和条款版本分开

来源 Application、Company、Position 和 Candidate 不会因为一次薪资协商而改变；薪资、奖金、开始日期、Work Mode 和回复期限可能改变。

如果直接 UPDATE 一行，就无法证明第一版给了什么、候选人接受哪一版、已发送文件对应哪一版。因此：

```text
offer          = 身份 + 当前状态 + 当前版本 pointer
offer_version  = append-only 条款版本
status_history = append-only 状态事件
```

## 4. Draft Offer 的原子创建

ML 自动决定 `offer` 时，Workflow B 最后一个短 D1 batch 共同写：

```text
ml_recommendation_result
ML stage run / transition event
Application lifecycle = completed
Application decision = offer_created
offer current_status = draft
offer_status_history NULL → draft
下一条 outbox_event
```

任一 SQL 失败，本批语句一起回滚，绝不允许 Application 显示 `offer_created` 而 `offer` 没有记录。`UNIQUE(application_id)` 加稳定幂等键保证重试不会创建第二份 Offer。

## 5. Application 与 Candidate 外键边界

采用已经确认的强关系：

```text
offer.application_id FK → application.id
(offer.candidate_snapshot_id, offer.application_id)
  FK → candidate_snapshot(id, application_id)
```

同时，`creating_stage_run_id` 和可选 ML recommendation 也通过复合 FK 验证属于同一 Application。

这不等于把 Application 与 Offer 混成同一层。它表示两者是同一已发布招聘业务生命周期里的强关系；数据库要阻止 Offer 指向不存在或错误 Application 的 Candidate。删除行为为 `RESTRICT`，避免破坏已经形成的 Offer 证据。

Submission → Application 是 Raw/业务发布的硬边界，因此继续只用 `application_source_lineage` 的普通上游 ID，不设跨层 FK。这两个边界的语义不同。

## 6. `offer` 字段

### 来源

- `application_id`：Offer 对应的唯一 Application。
- `candidate_snapshot_id`：决策时采用的 Candidate snapshot。
- `creating_stage_run_id`：实际创建 Offer 的 Offer process stage run。
- `ml_recommendation_result_id`：ML 自动决定时必填；人工路径可 NULL。
- `current_offer_version_id`：当前有效条款；Draft 条款尚未准备好时可 NULL。

### 决策来源

```text
ml_recommendation
manual_hiring_decision
offer_approval
```

`offer_approval` 目前可以由 G10 Stage 证明，以后复杂化再增加独立审批表。

### Application 决策上下文快照

```text
company_name_snapshot
position_title_snapshot
candidate_name_snapshot
candidate_email_snapshot
application_work_location_snapshot
application_work_mode_snapshot
requested_start_date_snapshot
requested_end_date_snapshot
work_duration_snapshot
```

它们表示作出 Offer 决定时的 Application 输入，不等于最终谈定条款。

当前 Catalog 已确认删除 `company_legal_name`，Person 也没有经过法律验证的 `candidate_legal_name`，所以字段不能冒充 legal name。未来生成正式法律文件时应另行采集和验证。

## 7. `offer_version` 字段

- `version_no`：同一 Offer 内从 1 递增。
- `terms_sha256`：规范化条款 hash，阻止同一 Offer 重复插入完全相同版本。
- `offer_title`：正式 Offer title。
- `employment_type_id`：可选规范 Employment Type。
- `work_location`、`work_mode`：该版拟定条款。
- `employment_start_date`、`employment_end_date`、`work_duration`：该版正式日期/时长。
- `compensation_amount_minor_units`：最小货币单位，例如 cents。
- `compensation_currency_code`：三位大写货币代码。
- `compensation_period`：hour/day/week/month/year/project。
- `signing_bonus_minor_units`、`target_bonus_description`、`equity_description`：可选补充条款。
- `response_due_at`：候选人回复期限。Draft 阶段允许 `NULL`；显式值必须是合法 RFC 3339 时间并在发送时仍晚于实际发送时间。
- `offer_terms_json`：尚未独立结构化的少量扩展条款，必须是合法 JSON。
- `prepared_by_type/reference`：谁准备该版本。
- `created_at`：版本创建时间；没有 `updated_at`，因为版本不可变。

薪酬 amount/currency/period 必须同时存在或同时 NULL，避免只有数值却不知道币种与周期。

如果刚创建 Draft 时条款未知：允许 `current_offer_version_id = NULL`，不创建全 NULL 的假 version。

## 8. Offer 状态机

| 状态 | 意义 |
|---|---|
| `draft` | 主记录已创建，条款或文件未完成 |
| `preparing` | 正在准备或修改条款 |
| `ready_to_send` | 当前版本完成并可发送 |
| `sent` | 已正式发送 |
| `viewed` | 外部渠道确认已查看；无法检测时可跳过 |
| `accepted` | 候选人接受当前版本 |
| `declined` | 候选人拒绝 |
| `expired` | 超过回复期限 |
| `withdrawn` | 招聘方发出后撤回 |
| `cancelled` | 正式发送前取消 |

建议路径：

```text
draft → preparing / ready_to_send / cancelled
preparing → draft / ready_to_send / cancelled
ready_to_send → preparing / sent / cancelled
sent → viewed / accepted / declined / expired / withdrawn
viewed → accepted / declined / expired / withdrawn
```

`accepted`、`declined`、`expired`、`withdrawn`、`cancelled` 是终态。首版不支持自动 reopening。`ready_to_send` 及后续必须指向实际 Offer version。

Offer 进入 `sent` 时，当前版本必须具有合法且晚于实际发送时刻的 `response_due_at`。招聘人员明确填写的期限优先；若当前版本没有期限，Operations API 从 active `system_configuration` 读取 `offer.default_response_window_days`，以实际发送时刻加该天数生成期限。首版默认值为 7 天。

因为 `offer_version` 不可变，系统不会把默认期限 UPDATE 回原版本，而是在同一个短事务内派生 `version_no + 1` 的新版本、更新 `offer.current_offer_version_id`，再进入 `sent`。期限以后发生改变时也必须创建新版本。数据库 Trigger 是直接 SQL 和未来写入者的最后防线，禁止没有未来期限的 Offer 进入 `sent`。

## 9. `offer_status_history`

`offer.current_status` 只回答“现在是什么”；History 回答“怎么变成这样”。每行保存：

- 同一 Offer/Application；
- 当时使用的 Offer version；
- Workflow 和可选 Stage run；
- from/to status；
- system、ML、recruiter、candidate 或 external system 发起者；
- reason、note、时间和少量合法 JSON metadata；
- 唯一幂等键。

第一行必须是 `NULL → draft`；后续不允许 `from_status = to_status`。复合 FK 防止引用其他 Offer 的版本或其他 Application 的 Stage run。

## 10. 并发与重试保护

- `status_version`：乐观并发计数。更新使用 `WHERE id=? AND status_version=?`，成功后加 1。
- `offer_fence_token`：当前合法生命周期所有权；过期 Workflow 即使恢复也不能写。
- `offer_status_history.idempotency_key`：同一业务事件重试不会重复追加。

一次状态移动用短 D1 batch：验证状态/version/fence，更新 Offer，插入 history，必要时更新 Stage，再写 audit/outbox。

## 11. Outbox 与 Trigger

首版不使用 SQL Trigger。显式 Worker/Workflow 命令负责状态转换；Outbox 可靠交接异步动作，例如：

- 通知招聘方准备条款；
- 未来生成 Offer document；
- 调用邮件或电子签名；
- 处理 accepted/declined 回调；
- accepted 后进入 G10 Hired；
- declined/expired/withdrawn 后进入相应终态。

Outbox 能处理“数据库已提交，但外部动作尚未成功”的重试，不把外部服务调用塞进数据库事务。

## 12. Application 状态与 Offer 状态不同

Draft 创建成功时：

```text
application_lifecycle_status = completed
application_decision_status = offer_created
offer.current_status = draft
```

以后 Offer 即使 declined/expired，Application 仍保留 `offer_created`，因为它表达“该 Application 当时确实获得 Offer”，不是候选人后来是否接受。

`offer_created` Application 不允许自动重申。旧 processing Application 若被合法重申 supersede，G07/G10 fence 会先使旧 Workflow 失去写入资格；创建 Offer 前还会再次验证 Application、Candidate、decision fence 和决策来源。

## 13. 与组员项目的差异

| 项目 | 组员版 | 新版 G11 |
|---|---|---|
| Offer 模型 | 无 | Master + immutable version + history |
| Application 一致性 | 无 Offer 流程 | 与 Draft 在同一短事务提交 |
| Candidate 快照 | 无 | 复合 FK 固定同一 Application 快照 |
| 条款协商 | 无 | 追加版本，不改写历史 |
| 生命周期 | 无 | 十种状态和明确终态 |
| 并发 | 简单同步 Worker | status version + fence + idempotency |
| 异步后续 | 同步调用为主 | Transactional Outbox |

## 14. 与原版数据库/Colab 的差异

| 项目 | 原版 | 新版 G11 |
|---|---|---|
| 命名 | `Offer` 等大写单数 | lower_snake_case |
| Master | Application ID + timestamps | Candidate/Stage/ML 来源、状态、fence、快照 |
| 一 Application 一 Offer | 已有 unique | 保留并加强跨表一致性 |
| Version | start date 强制非空、字段较少 | 日期可 NULL，薪酬三元组、hash 和 JSON 校验 |
| 条款未知 | importer 避免假 version | Schema 明确允许 Draft 暂无 version |
| History | status/note/time | from/to、version、Workflow、Stage、actor、幂等键 |
| 状态机 | 主要靠代码 | 明确状态、终态与 version 前置条件 |
| ML → Offer | 多步 HTTP SQL 风险 | 最终短 D1 batch 原子发布 |
| 后续动作 | 无 Outbox | Outbox 负责可靠异步交接 |

## 15. 已确认边界

以上 15 项全部确认：首版只创建三张表；Document/独立 Approval 延后；一 Application 一 Offer；使用正式 Application/Candidate `RESTRICT` 外键；Stage/Master/Version 分离；最终发布使用短 D1 batch；输入快照与可变条款分层；不冒充 legal name；薪酬三元组共同存在或共同为空；Draft 可暂无 Version；条款版本不可变；状态机与终态冻结；Offer 后续结果不改写 Application 的历史决定；每次状态变化追加 History；使用 status version、fence、idempotency；首版不使用业务 SQL Trigger。
