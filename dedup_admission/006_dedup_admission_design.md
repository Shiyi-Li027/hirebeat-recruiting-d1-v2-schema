# Group G06：实时查重与 Application 准入（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G06）
状态：`confirmed（2026-08-17）`

## 1. 本组只做两件事

```text
第一件：这个新 Submission 是否与同组历史 Submission 属于同一身份？
第二件：即使重复，它是否符合业务规则、可以作为合法重申进入 Application？
```

因此必须拆开：

```text
dedup_decision
application_entry_decision
```

“检测到重复”不等于“必须丢弃”。同一申请人可能在限制内合法重申。已确认使用两个独立字段，不把身份查重结果和 Application 业务准入混成一个 `decision`。

## 2. 实时查重范围

每次只处理一个新的 `submission_normalized`，不重新生成全库所有旧 Submission 的 dedup run。

查询范围是：

```text
当前 Submission
+ D1 中相同 company_id
+ 相同 position_id
+ 相同 requested_start_year_month
的所有历史 Submission
```

不对只有一条新记录的当前 intake 自己查自己；也不扫描其他 Company、Position 或年月。

这满足“全局历史查重”，因为历史范围来自 D1 全库；同时避免每来一条记录都做全库两两组合。

## 3. 身份匹配规则：严格沿用当前 Colab

优先级保持：

1. 完整 normalized email 精确相同；
2. 可靠电话最后 10 位精确相同；
3. normalized LinkedIn person URL 精确相同；
4. normalized GitHub URL 精确相同，并且双方 normalized last name 精确相同。

满足任意规则即建立正向 `submission_dedup_match`。同一 pair 的全部正向证据进入 `submission_match_evidence`。

没有满足规则的历史 pair 不逐行保存，避免随数据库增长产生二次方负面证据；run 只保存扫描范围数和比较数。规则版本与输入身份特征已经冻结，必要时可复现。该边界已确认。

## 4. `submission_dedup_run`

一行表示一个目标 Submission 使用一个 `dedup_rule_version` 的逻辑运行。

### 分组快照

```text
dedup_company_id
dedup_position_id
dedup_requested_start_year_month
dedup_group_key
```

`dedup_group_key` 是规则运行快照，例如基于 ID 生成：

```text
company:12|position:88|requested-start:2026-04
```

它不是独立 Cluster FK，也不需要 `submission_cluster`/`application_cluster` 表。

### 运行结果

`dedup_decision`：

| 值 | 含义 |
|---|---|
| `no_duplicate` | 同组历史中没有任何身份规则命中 |
| `duplicate_detected` | 至少一个历史 Submission 命中 |
| `not_evaluated_missing_group_key` | 缺少 requested start year-month，无法按当前规则查重 |

`application_entry_decision`：

| 值 | 含义 |
|---|---|
| `pending` | 尚未完成业务准入判断 |
| `admitted_new_application` | 无重复，作为首次 Application |
| `admitted_resubmission` | 有重复，但旧 Application 状态和次数允许重申 |
| `blocked_missing_dedup_group` | 缺少必要分组字段 |
| `blocked_resubmission_limit` | 包括首次在内已经达到最多 5 次 |
| `blocked_offer_in_progress` | 历史 Application 已有正在处理的 Offer draft/process |
| `blocked_offer_finalized` | 历史 Offer 已 issued/accepted 等，不允许自动重开 |
| `blocked_prior_application_state` | 历史状态不在自动允许范围，必须由明确政策处理 |

不使用含义模糊的单一 `decision` 字段，也不把 `rejected` 用来表示“没有进入 Application”。

### 一个 selected prior pointer

一个新 Submission 可能匹配多个历史 Submission。`submission_dedup_match` 保存全部正向 pair；run 只保存一个：

```text
selected_prior_submission_normalized_id
```

它表示业务准入时采用哪一条历史 Submission 去找到最新适用的 Application 状态和 submission attempt count。它不是“所有 matched IDs”的重复存储。该单一 pointer 方案已确认。

选择规则必须版本化，首版已确认：

```text
优先选择已发布到 Application 的匹配 Submission；
再按 source_submitted_at DESC；
最后按 submission_normalized_id DESC。
```

## 5. `submission_dedup_match`

一行表示目标 Submission 与一条历史 Submission 的正向重复 pair。

本表保存：

- 两端 Submission ID；
- 命中的最高优先级规则；
- strong/resume identity evidence 数量；
- 是否为 selected prior；
- 与当前 Colab 一致的 aggregate 0/1 score。

一条 run 可以有多条 match。数据库使用 partial unique index 保证一个 run 最多只有一条 `is_selected_prior_submission = 1`。

## 6. `submission_match_evidence`

一行表示一个正向 pair 的一条具体证据。它引用双方的 `submission_identity_feature`，不再引用：

```text
matched_application_id
matched_person_identifier_claim_id
```

原因是证据证明的是 Submission 对 Submission 的身份关系；Application 状态属于后续业务准入查询，Person claim 旧体系已被 G05 identity feature 和 G07 contact/link 取代。

匹配值不再写裸 email/phone/URL，而保存服务端 keyed HMAC。GitHub 规则额外保存相同 last name 的 HMAC，避免在证据表重复暴露姓名。该证据隐私规则已确认。

## 7. 重申处理

首版最多提交次数：

```text
max_submission_attempts = 5
```

包括首次提交，因此：

```text
首次 Application                    attempt 1
第一次合法重申                     attempt 2
...
第四次合法重申                     attempt 5
再提交                              blocked_resubmission_limit
```

已确认最多 5 次包括首次。运行时把当次采用的上限冻结到：

```text
max_submission_attempts_snapshot
```

`submission_attempt_number` 是业务提交次数，不是：

- Workflow technical retry；
- `etl_step_attempt.attempt_number`；
- Hiring stage attempt。

### 历史 Application 状态处理

| 历史状态类别 | 新 Submission |
|---|---|
| 无历史 Application | 建立首次 Application |
| processing，且次数未满 | 先 fence/终止旧 Workflow B，再原子 supersede 旧 Application，创建新 Application/Candidate |
| rejected，且次数未满 | supersede 旧 Application，创建新 Application/Candidate |
| offer draft/process | 阻止自动准入 |
| offer issued/accepted | 阻止自动准入 |
| declined/expired/withdrawn | 已确认首版不自动假设可重申，进入 `blocked_prior_application_state`，以后由 policy 明确 |
| 次数达到 5 | 阻止准入，Submission 和 dedup 记录保留 |

G06 只产生准入决定；真正创建新 Application、标记旧 Application superseded、写 lineage 和发出 terminate Outbox，在 G07 的 `application_publish` 短事务中一起完成。

## 8. 并发与旧 Workflow 栅栏

当旧 Application 仍在 processing 时，不能只改状态后放任旧 Workflow B 继续执行。

G07 发布新重申时必须在同一短事务中：

1. 重新读取旧 Application 当前 lifecycle/decision/Offer 状态；
2. 验证 submission attempt 仍未达到上限；
3. 更新旧 Application 为 `superseded`；
4. 增加/旋转旧 Application 的 decision fence token；
5. 创建新 Application、Candidate snapshot、lineage；
6. 创建终止旧 Workflow B 的 Outbox；
7. 创建启动新 Workflow B 的 Outbox。

旧 Workflow B 在任何 ML decision、stage result 或 Offer draft 写入前必须重新验证 fence token。验证失败立即终止，不能创建 Offer。该 fence 边界已确认。

## 9. Ingress 技术幂等与业务查重不同

```text
同一 source_event_key 的网络重送
→ G03 幂等复用同一 raw_submission
→ 不创建第二个 G06 run

申请人再次点击提交，产生新的 submission_uuid/source_event_key
→ 新 raw_submission
→ 新 Workflow A
→ G06 执行业务查重
```

相同 payload HMAC 不能直接拦截第二种情况，因为两次真实提交即使内容完全一样，也应当形成两条 Raw 证据，再由 G06 判断重申。

## 10. 失败、重试和补偿

| 情况 | 策略 |
|---|---|
| D1 读取暂时失败 | step/attempt retry；复用同一 dedup run idempotency key |
| 同组历史数量在运行中改变 | 最终提交前重新查询或使用一致性版本/fence；不能依据过期计数发布 Application |
| match/evidence batch 失败 | 本次 children 共同回滚；run 保持 retryable |
| 规则/Schema 错误 | failed terminal；不发布 Application |
| dedup 成功、G07 publish 失败 | 保留 dedup 结果；G07 幂等重试并重新验证最新业务状态 |
| 旧 Workflow 终止 Outbox 暂时投递失败 | 新 Application 已发布时仍靠旧 fence 阻止副作用；Outbox 继续重试终止通知 |

## 11. 与组员项目的全部本组差异

| 项目 | 组员版 | 新版 G06 |
|---|---|---|
| 分组周期 | 提交自然月 | requested start year-month |
| 身份范围 | applicant + role + month 的简单判断 | 同组历史 + email/phone/LinkedIn/GitHub 证据 |
| 证据表 | 无 | pair + evidence 两层 |
| 重复处理 | 标记 duplicate | dedup 与 Application entry 分开；支持有上限重申 |
| 历史 | 简单 wasAlreadySynced/duplicate | 每次规则版本、范围、pair、证据、准入决定可审计 |
| 并发旧流程 | 无明确 fence | supersede + fence + terminate Outbox |

## 12. 与原版数据库和 Colab 的全部本组差异

| 项目 | 原版 | 新版 G06 |
|---|---|---|
| 运行模式 | 当前批次加 CSV，再生成全组结果 | 每条新 Submission 对 D1 同组历史实时运行 |
| 历史扫描 | 曾要求 CSV 与全库 ID 完全一致，后改子集 | 不依赖 CSV，直接读 D1 |
| Cluster 表 | Application cluster/Position cycle 曾显式存在 | 不建 Cluster 表；run 保存分组快照 |
| Pair 模型 | evidence 行直接带两个 Submission ID，run 有单个 matched ID | 独立 `submission_dedup_match` 表达一对多 pair |
| Evidence FK | matched Application/person claim | 双方 identity feature |
| Canonical 行为 | 最新记录 accepted，其余 duplicate suppressed | 重复不是自动丢弃；根据历史状态和次数决定合法重申 |
| 分数 | strong/resume/final 0/1 | 为兼容保留 aggregate 0/1，同时以具体 evidence 为权威 |
| 输出 | CSV 是下游输入 | D1 是权威；CSV 仅测试导出 |

## 13. 需要确认的关键问题

1. 已确认：把 `dedup_decision` 与 `application_entry_decision` 分成两个字段。
2. 已确认：只保存正向 matched pairs，不保存每一个未命中的历史 pair。
3. 已确认：run 保存一个 `selected_prior_submission_normalized_id`，全部 matches 留在 match 表。
4. 已确认：selected prior 首版排序为已发布 Application 优先，再 `source_submitted_at DESC`，最后 normalized ID DESC。
5. 已确认：最大 5 次包括首次，并在 dedup run 冻结本次采用的上限。
6. 已确认：declined/expired/withdrawn 首版不自动允许重申，使用 `blocked_prior_application_state`。
7. 已确认：旧 processing Application 的 Workflow B 必须先被 fence；Application publish 才能 supersede 并启动新 Workflow B。
8. 已确认：evidence 只保存 keyed HMAC，不重复保存裸 email/phone/URL。
9. 已确认：不再建立 `submission_cluster`、`application_cluster`、`identity_identifier`、`person_identifier_claim`。
