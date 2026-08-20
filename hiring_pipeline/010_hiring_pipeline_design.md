# Group G10：Hiring Pipeline 与实际招聘阶段运行（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G10）
状态：`confirmed`

## 1. 五张表的职责

| 表 | 表示什么 |
|---|---|
| `hiring_pipeline` | 一套招聘流程模板的一个版本 |
| `pipeline_stage` | 模板中的可用阶段节点 |
| `pipeline_stage_transition` | 模板允许的有向跳转边 |
| `application_stage_run` | 某个 Application 实际执行某个阶段的一次业务尝试 |
| `application_stage_transition_event` | 某个 Application 实际从一个 stage attempt 移动到另一个 attempt 的不可变事件 |

模板回答“允许怎么走”；Stage run/Event 回答“这个 Application 实际怎么走了”。

## 2. Pipeline 与 Stage 不是同一功能

`hiring_pipeline` 是完整模板，例如：

```text
Flexible recruitment pipeline v1
```

`pipeline_stage` 是模板内的节点，例如：

```text
Resume screening
ML recommendation
Technical interview
Offer process
Rejected
```

一个 Pipeline 包含多个 Stage；不同 Pipeline version 可以包含不同 Stage 和允许路径。

Application 因为自身表现跳过或返回阶段时，不创建新 Pipeline。只有招聘方改变全局模板定义，例如增加一个 Background check、删除某类面试或改变允许边，才创建新的 Pipeline version。已在流程中的 Application 继续使用原来冻结的版本。

## 3. 建议保留的 13 个模板 Stage

| 默认展示顺序 | Stage name | stage code | stage type | 业务作用 |
|---:|---|---|---|---|
| 1 | Application received | `application_received` | `application_received` | Application core 已发布，进入招聘流程 |
| 2 | Resume screening | `resume_screening` | `resume_screening` | 可选人工或规则化简历初筛 |
| 3 | ML recommendation | `ml_recommendation` | `ml_recommendation` | 运行 G09 并允许直接决定 Offer/No Offer |
| 4 | Written assessment 1 | `written_assessment_1` | `written_assessment` | 第一轮可选笔试 |
| 5 | Written assessment 2 | `written_assessment_2` | `written_assessment` | 第二轮可选笔试 |
| 6 | HR interview | `hr_interview` | `interview` | HR/行为/基础匹配面试 |
| 7 | Technical interview | `technical_interview` | `interview` | 技术能力面试 |
| 8 | Final interview | `final_interview` | `interview` | 最终面试或招聘负责人面试 |
| 9 | Offer approval | `offer_approval` | `offer_approval` | 可选人工、预算或条款审批，不等于最终录取决定 |
| 10 | Offer process | `offer_process` | `offer_process` | 已决定给 Offer，创建 draft 并进入 Offer 生命周期 |
| 11 | Hired | `hired` | `hired` | Offer 接受并完成录用的终点 |
| 12 | Rejected | `rejected` | `rejected` | 不给 Offer 或 Offer 后终止的终点 |
| 13 | Withdrawn | `withdrawn` | `withdrawn` | Candidate/公司撤回流程的终点 |

`Offer process` 是 Stage；`offer` 是 G11 业务表。二者不是同一个东西。

## 4. 模板顺序与实际顺序

`pipeline_stage.default_display_order` 只是模板默认显示顺序，不约束每个 Application 必须按 1→13 执行。

实际顺序保存在：

```text
application_stage_run.actual_sequence_no
```

例如一个优秀 Candidate 可以实际执行：

| actual sequence | Stage | attempt |
|---:|---|---:|
| 1 | Application received | 1 |
| 2 | Technical interview | 1 |
| 3 | Written assessment 1 | 1 |
| 4 | Technical interview | 2 |
| 5 | Offer approval | 1 |
| 6 | Offer process | 1 |

模板仍然不变。返回 Technical interview 时，新增 attempt 2，不覆盖 attempt 1。

## 5. `attempt_no` 与技术 retry 不同

`application_stage_run.attempt_no` 是业务上的第几次同类阶段，例如第二次 Technical interview。

网络失败、Worker 重启或 D1 暂时错误造成的技术重试不会增加它。技术重试继续记录在 G04：

```text
etl_step_run
etl_step_attempt
```

因此：

```text
面试真正重新举行一次 → stage attempt_no + 1
D1 写入失败自动再试 → ETL step attempt + 1
```

## 6. Stage run 状态

| `run_status` | 含义 |
|---|---|
| `scheduled` | 已建立业务阶段，尚未开始 |
| `in_progress` | 阶段正在执行 |
| `waiting` | 等待 Candidate、招聘方或外部系统 |
| `completed` | 阶段已正常结束，必须有 outcome |
| `skipped` | 阶段被明确跳过，outcome 固定为 `skipped` |
| `cancelled` | 因 Application superseded/cancelled 等原因终止 |

这里不保存 `failed_retryable/failed_terminal`，因为它们属于技术 Workflow 状态，而不是业务招聘阶段状态。

`stage_outcome_code` 暂时保持受代码控制的 TEXT，而不做过窄 CHECK。建议常用值包括：

```text
passed
failed
offer
no_offer
approved
not_approved
needs_additional_assessment
needs_additional_interview
hired
rejected
withdrawn
skipped
cancelled
```

## 7. Repeat、Return、Skip 的表达

### Repeat

同一个 Stage 再做一次：

```text
相同 pipeline_stage_id
attempt_no + 1
actual_sequence_no + 1
movement_type = repeat
```

Stage 必须 `is_repeatable = 1`，并遵守可选 `max_business_attempts`。该验证由 Workflow command 在事务前完成。

### Return

从后面的 Stage 返回前面的 Stage：

```text
movement_type = return
configured transition 必须 active/allowed
```

### Skip

直接从早期 Stage 跳到更后的 Stage：

```text
movement_type = skip_forward
```

中间未进入的 Stage 不需要建立假 run。如果某个已经建立的 Stage 后来被明确取消执行，可保留 `skipped` run。

## 8. 建议的允许路径

首版沿用原版灵活逻辑，但名称和约束更清楚：

- Application received 可进入 Resume、ML、任一笔试/面试、Offer approval、Offer process、Rejected 或 Withdrawn；
- Resume screening 可进入 ML、任一笔试/面试、Offer approval、Offer process、Rejected 或 Withdrawn；
- ML recommendation 可以直接到 Offer process 或 Rejected，也可以进入可选测试/面试/审批；
- Written assessment 1/2 可互相流转，也可进入面试、Offer approval、Offer process 或终点；
- HR/Technical/Final interview 可返回 Resume、ML、任一笔试或其他面试，也可进入审批、Offer process 或终点；
- Offer approval 可返回笔试/面试，也可进入 Offer process、Rejected 或 Withdrawn；
- Offer process 只进入 Hired、Rejected 或 Withdrawn；
- Hired、Rejected、Withdrawn 没有自动出边。

同一 Stage 的重复不创建 self-edge，而是由 `is_repeatable` 和 `movement_type = repeat` 控制。

## 9. 当前自动 ML 路径

当前已经决定的首版自动路径是：

```text
Application received
→ ML recommendation
   ├── anomaly/score below threshold → Rejected
   └── score passed threshold → Offer process
                                  └── G11 Offer draft 已在同一事务创建
```

`Offer approval` 是可选 Stage，不是每个 Application 的最终 selected/rejected 结果。当前自动 ML 路径可以完全绕过它。

## 10. Fence 与重申

每个 Stage run 和 transition event 都冻结 Application 的 `decision_fence_token`。

合法新重申发布前：

1. 旋转旧 Application fence；
2. 将旧 Application/Candidate 标记为 superseded；
3. 将旧 Application 尚未完成的 stage runs 标记 cancelled；
4. 创建新 Application/Candidate 和新 Workflow B；
5. 旧 Workflow 每次写入前发现 fence 不匹配，停止写 ML、Stage decision 或 Offer。

已经 completed 的历史 stage runs 和 transition events不删除，它们证明旧 Application 当时执行过什么。取消的是未完成业务运行，不是抹除历史。

## 11. 为什么 Stage run 与 transition event 都需要

只有 Stage run 可以回答：

```text
Technical interview 第一次得分多少？
第二次是谁执行的？
阶段等待了多久？
结果是什么？
```

只有 transition event 可以回答：

```text
为什么从 Final interview 返回 Written assessment？
何时跳过 Resume screening？
哪次 Stage run 导致进入 Offer process？
实际路径是什么？
```

两者不是重复记录。

## 12. 原子写入方式

一次正常 Stage 移动使用一个短 D1 batch，至少共同写入：

```text
完成/更新 from application_stage_run
创建 to application_stage_run
创建 application_stage_transition_event
更新 application.current_stage_id/current_stage_entered_at
必要时写 audit/outbox
```

ML 最终决定还会共同写入 G09 recommendation、Application decision 和条件性 G11 Offer draft。任一语句失败，本次短 batch 全部回滚。

## 13. 字段级完整性

- Stage 使用 `(id, hiring_pipeline_id)` 复合关系，防止跨 Pipeline 错连；
- Application 使用 `(id, hiring_pipeline_id)` 复合关系，防止 Stage run 使用其他模板；
- Stage run 使用 `(id, application_id, hiring_pipeline_id, pipeline_stage_id)` 作为 transition event 的复合目标；
- Stage run 另外提供 `(id, application_id)` 唯一父键，供 G11 Offer 验证创建它的 Offer process run 确实属于同一 Application；
- `actual_sequence_no` 在每个 Application 内唯一；
- `(application_id, pipeline_stage_id, attempt_no)` 唯一；
- ML recommendation 最多关联一个 ML Stage run；
- 每个 to-stage run 只能被一个 transition event 引入；
- 所有 run/event 必须关联 G04 Workflow run，保证技术运行可追踪。

## 14. 与组员项目的全部本组差异

| 项目 | 组员版 | 新版 G10 |
|---|---|---|
| Hiring Pipeline | 无 | 有版本化模板 |
| Stage | 无 | 13 个可配置节点 |
| 实际路径 | 无 | Run + immutable transition event |
| 多次面试/笔试 | 无 | Stage attempt 明确表达 |
| 跳过/返回 | 无 | Template edge + actual movement |
| ML | 无 | ML stage 可直接决定 Offer/Rejected |
| 并发/重申 | 无 | Application fence + cancelled open runs |
| 技术日志 | 简单同步状态 | 与 G04 Workflow/step/attempt 分离关联 |

## 15. 与原版数据库和 Colab 的全部本组差异

| 项目 | 原版 | 新版 G10 |
|---|---|---|
| 命名 | 大写单数混合 | lower_snake_case |
| Pipeline version | 主要靠名称 v1 | family + integer version + lifecycle |
| `sequence_no` | 容易误解为实际执行顺序 | 改名 `default_display_order`；实际顺序另存 |
| Actual order | 依赖 history 时间 | `actual_sequence_no` 明确保存 |
| Stage retry | attempt 与技术 retry 易混 | business attempt 与 G04 technical retry 分开 |
| History | `Application_stage_history` | 被 immutable transition event 替代 |
| Result metadata | 自由 TEXT | valid JSON +明确 outcome |
| Pipeline/Stage 归属 | 部分依赖代码 | composite FK 强制 |
| Application fence | 无 | 每个 run/event 冻结并验证 |
| 写入 | 多个独立 HTTP SQL，可能部分成功 | 一个业务动作使用短 D1 batch |
| Offer 原子性 | 先更新 Application 再建 Offer | Recommendation/Stage/Application/Offer 共同提交 |

## 16. 已确认边界

上述 17 项均已确认：首版创建五张表和 13 个 Stage；模板顺序与实际顺序分离；业务重做与技术 retry 分离；active 模板冻结；支持跳过、返回、repeat 与直接终态；ML 可直接决定 Offer/Rejected；Offer approval 可选；Offer process 与 Offer 表分离；不创建假 Stage；全部 run/event 关联 Workflow；supersede 取消未完成 run 但保留历史；业务移动使用短 D1 batch；旧 `Application_stage_history` 不再创建。
