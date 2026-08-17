# Group G07：Person、Application 与 Candidate Core（Confirmed Revision 1）

版本日期：2026-08-17  
对应 SQL：`007_application_core_draft.sql`  
状态：`confirmed`

## 1. 三个核心实体不是同一件事

| 实体 | 粒度 | 作用 |
|---|---|---|
| `person` | 一个长期自然人 | 维护当前规范身份和 current pointers |
| `application` | 一个人对公司+岗位+requested month 的一次合法提交尝试 | 保存招聘生命周期和决定 |
| `candidate_snapshot` | 某个 Application 当时采用的人才快照 | 保证后续 ML、阶段和 Offer 可复现 |

合法重申：

```text
复用 Person
+ 创建新 Application
+ 创建新 Candidate snapshot
+ 旧 Application superseded
+ 旧 Candidate snapshot superseded
```

不覆盖旧 Application、旧 Candidate、旧 ML 或旧 stage history。

## 2. `person`

Person 保存当前规范姓名、完整 normalized email、可选 phone，以及以下性能/导航 pointer：

```text
current_application_id
current_candidate_snapshot_id
highest_person_education_id
current_person_position_id
```

pointer 不是历史事实；历史来自 Application、Candidate 和 Person 子表。pointer 使用 `ON DELETE SET NULL`，并在同一发布事务内同步更新。

首版明确采用以下业务身份定义：

```text
Person identity key = exact normalized_email_address
```

未合并的 Person 使用 partial unique index 保证 normalized email 唯一；`person_status = merged` 的历史 Person 可以保留相同邮箱并通过 `merged_into_person_id` 指向 canonical Person。这一规则换取简单、确定和幂等的实时处理，同时主动接受共享邮箱、邮箱重新分配和邮箱变更可能导致误合并或新建 Person 的限制。

`person_status = merged` 时必须填写 `merged_into_person_id`；不会物理删除已参与历史决策的 Person。

## 3. `application`

### 3.1 双状态

```text
application_lifecycle_status
application_decision_status
```

生命周期：

```text
processing
completed
superseded
cancelled
```

招聘决定：

```text
pending
rejected
offer_created
```

因此旧 Application 可以同时表达：

```text
lifecycle = superseded
decision = rejected
```

数据库同时限制合法组合，不能只依赖流程代码：

- `processing`、`cancelled` 只能搭配 `pending`；
- `completed` 必须搭配 `rejected` 或 `offer_created`；
- `superseded` 只能保留此前的 `pending` 或 `rejected` 决定；
- `offer_created` 必须搭配 `completed`，并且不能被自动重申覆盖为 `superseded`。

也可以表达在尚未决定时被合法重申替代：

```text
lifecycle = superseded
decision = pending
```

### 3.2 申请分组与重申

```text
person_id
company_id
position_id
requested_start_year_month
```

共同确定业务申请组。`company_work_mode_id` 不进入重申组 key，因为首版重申政策按同人、同公司、同岗位、同 requested month 判断。

只保存：

```text
submission_attempt_number
```

首次为 1；`resubmission_count` 可确定性派生为 `submission_attempt_number - 1`，草案不重复保存两列。

`max_submission_attempts_snapshot` 冻结当次采用的 Company 默认上限。

### 3.3 名称快照

Application 保存公司、Company Work Mode 和岗位名称快照。即使 Catalog 以后改名或关闭，历史 Application 仍显示当时申请内容。

### 3.4 decision fence

每条 Application 有不可空的随机 `decision_fence_token`。Workflow B 启动时把同一 token 冻结在 `etl_workflow_run.subject_fence_token`。

Application 的 `hiring_pipeline_id` 与 `current_stage_id` 必须同时为空或同时有值；复合外键 `(current_stage_id, hiring_pipeline_id)` 保证当前 Stage 确实属于该 Pipeline。`UNIQUE(id, hiring_pipeline_id)` 还允许 G10 的实际 stage run 用复合外键证明它属于该 Application 已选择的模板。

每次写入 ML result、stage decision 或 Offer draft 前：

```text
workflow subject_fence_token
必须等于
application decision_fence_token
```

合法重申 supersede 旧 Application 时旋转旧 token；旧 Workflow 即使晚到也无法提交副作用。

## 4. `candidate_snapshot`

一条 Application 只有一个 Candidate snapshot core。它保存当时采用的：

`candidate_snapshot` 还提供 `UNIQUE(id, application_id)` 和 `UNIQUE(id, application_id, person_id)` 作为复合外键目标。它们不改变业务基数：前者供 G11 Offer 证明 Candidate 属于同一 Application，后者供 ML 同时证明 Application、Candidate 和 Person 属于同一条业务链，避免分别存在但彼此错配的 ID 被写入。

- normalized name/email/phone；
- selected LinkedIn/GitHub；
- Resume text SHA-256；
- extraction version；
- profile snapshot SHA-256。

它不保存 Raw name/email/phone，也不复制 Resume 长文本。

状态：

```text
core_published
enrichment_running
enriched
superseded
cancelled
```

Workflow A 创建 core；Workflow B 发布完整 Education/Employment/Skill/Project 后改成 `enriched`。没有某类子实体仍可以 enriched，前提是 parser 成功且零行是合法结果。

## 5. `application_source_lineage`

这是 Submission 与 Application 的硬层级边界。

真实 FK 只有：

```text
application_id → application.id
```

以下上游 ID 都保留为普通 INTEGER，不设置跨层 FK：

```text
source_submission_normalized_id
source_raw_submission_id
source_dedup_run_id
source_resume_extraction_id
```

这样 Application 日常运行不依赖 Submission 层，Submission 将来归档不会被外键阻止；需要审计时仍能按 ID JOIN。

为双向审计查询建立 `source_submission_normalized_id`、`source_raw_submission_id`、`source_dedup_run_id` 和 `source_resume_extraction_id` 索引。普通 INTEGER 并不妨碍 JOIN；它只是不要求上游记录永远存在。

`primary_decision_input` 是已经确认的角色名称。数据库 partial unique index 保证一个 Application 最多一条 primary decision input。

其他 lineage role：

```text
selected_prior_submission
supporting_duplicate_match
```

Application 不再额外保存 `current_source_submission_normalized_id`，也不复制 Resume。

## 6. Person 身份历史子表

Person 主表中的 normalized name/email/phone 是“当前主值缓存”，不是唯一历史，也不是每次申请当时值的权威来源。每次获准发布新的 Application/Candidate snapshot 时：

1. Candidate snapshot 保存该次申请实际采用的 normalized name/email/phone/link；
2. 新的不同 normalized value 追加到对应 Person 历史子表；
3. 已存在的相同 normalized value 不重复插入，只更新 `last_seen_at`；
4. 只有被身份规则选为当前主值的记录才设为 `is_primary = 1`，同时更新 Person 主表缓存；
5. 旧值保留且改为非 primary，不被覆盖或删除；
6. 新申请缺少某类可靠值时不创建 placeholder，也不把 Person 已有主值清空。

因此同一邮箱下出现新姓名、同一姓名下出现新电话、LinkedIn 或 GitHub 变化，都能保存为历史。每次 Application 当时究竟使用哪个值由其 `candidate_snapshot` 证明。

首版不增加 `blocked_identity_conflict`。同一 normalized email 即复用同一 Person；即使姓名不同，也把新姓名作为 `person_name` 历史追加，并由该次 `candidate_snapshot` 保存申请时采用的姓名。共享邮箱、邮箱重新分配、填错邮箱和邮箱变化导致的误合并/重复 Person 被明确登记为未来 identity-resolution 优化，而不是首版自动阻断条件。

### `person_name`

一行同时保存 display name 和 normalized name，不再像原版那样把 `Aike Cai` 与 `aike cai` 保存成两条语义重复记录。每个 Person 最多一条 primary name。

### `person_contact`

保存 normalized contact value、keyed HMAC、类型、主联系方式和验证状态。`contact_type_id` 在 Person 层必须非空，因为 G01 已有 email/phone 类型；Company contact 允许 NULL 的决定不扩展到 Person。

### `person_link`

保存 LinkedIn、GitHub、portfolio 或 other URL。每种 link type 最多一条 primary URL，但允许保留历史不同 URL。

三张历史表都允许没有可靠来源时保存零行；不会建立空 placeholder。

## 7. Application 发布短事务

G06 得到 admitted 决定后，`application_publish` 使用一次 D1 `batch()`：

1. 重新验证 dedup run、selected prior、Application/Offer 状态、attempt limit；
2. 新人则创建 Person；重申则复用 Person；
3. processing 重申先旋转旧 decision fence；
4. 标记旧 Application/Candidate superseded；
5. 创建新 Application；
6. 创建 Candidate snapshot core；
7. 创建 primary lineage 及必要的 prior/supporting lineage；
8. upsert Person name/contact/link history；
9. 更新 Person current pointers；
10. 创建终止旧 Workflow B 和启动新 Workflow B 的 Outbox。

任一数据库语句失败，整批共同回滚；不会出现只有 Person 没有 Application，或 Application 没有 Candidate/lineage 的半套数据。

## 8. 与组员项目的全部本组差异

| 项目 | 组员版 | 新版 G07 |
|---|---|---|
| Person | `applicants`，结构较轻 | 规范 Person + name/contact/link history + current pointers |
| Application | 每个来源记录实际创建新 Application | 只有 G06 admitted 才创建；合法重申有明确 previous/supersede |
| Candidate snapshot | 无 | 每个 Application 一份可复现快照 |
| 状态 | 较简单 Application/Submission 状态 | lifecycle 与 decision 分开 |
| 来源关系 | 文档说一 Application 多 Submission，代码未真正实现 | 正式 lineage，`primary_decision_input` 唯一 |
| 并发 | 无 fence | token fence + Workflow/Outbox |
| 公司岗位 | Worker 可 find-or-create | 只接受 G02 权威 Catalog FK 与名称快照 |

## 9. 与原版数据库和 Colab 的全部本组差异

| 项目 | 原版 | 新版 G07 |
|---|---|---|
| Person | email/phone 与 history 表并存但规则不统一 | 主表 current cache + 规范 history，事务同步 |
| Person name | 原始和 normalized 常被写成两行 | 一行保存 display + normalized |
| Application 状态 | 单一 `application_status` | lifecycle/decision 双状态 |
| Cluster | `application_cluster_id` FK | 纯 `application_group_key` + company/position/month |
| Submission 来源 | `Application_submission` 对 Submission 有硬 FK | lineage 上游 ID 无跨层 FK |
| Candidate | 保存大量 Raw PII 和完整 Resume | 只保存 normalized snapshot、hash、version |
| 重申 | 初版批量流程没有完整实时 supersede/fence | 新 Application/Candidate + previous/superseded pointers |
| CSV | Application CSV 曾是导入权威输入 | D1 G05/G06 是唯一输入；CSV 只读测试 |

## 10. 已确认决定

1. Person 主表保存 normalized name/email/phone 当前缓存，同时保留 name/contact/link 历史子表；
2. 首版以 exact normalized email 定位 Person，未合并 Person 的当前邮箱必须唯一；
3. 不增加 `blocked_identity_conflict`；同邮箱不同姓名追加姓名历史；
4. Application 使用 lifecycle + decision 双状态及当前枚举值；
5. 只保存 `submission_attempt_number`，`resubmission_count = submission_attempt_number - 1`；
6. Company Work Mode 不参与 `application_group_key`；
7. Application 保存 Catalog 名称快照，即使同时已有 Catalog FK；
8. Application 不保存 current Submission pointer，全部来源只通过 lineage 表达；
9. lineage 的四个上游 ID 都不设跨层 FK，但 `application_id` 保留正式 FK；
10. Candidate snapshot 不保存 Raw PII 或 Resume 长文本，只保存 normalized values、hash 和 extraction version；
11. 一条 Application 首版只有一个 Candidate snapshot core，合法重申通过新 Application 创建新 snapshot；
12. `etl_workflow_run.subject_fence_token` nullable，Workflow B 必填并与 Application token 比较；
13. Person 的 `highest_person_education_id`、`current_person_position_id` 是 nullable 缓存 pointer，由 G08 发布事务维护。
