# Group G05：Submission 标准化与简历结构化提取（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G05）
状态：`confirmed（2026-08-17）`

## 1. 本组的业务边界

G05 属于 Workflow A。它只保存 Application 发布前的可重试派生结果：

```text
raw_submission
  ├── normalization_run
  │     └── submission_normalized
  └── raw_submission_resume
          └── resume_extraction
                ├── resume_education
                ├── resume_employment
                ├── resume_skill
                └── resume_project

submission_normalized + resume_extraction
  └── submission_identity_feature
```

本组不创建 Person、Application、Candidate，也不执行查重。G06 才使用这些结果进行查重和 Application 准入；Workflow B 才把合格的学历、工作、技能和项目发布到正式人才档案。

## 2. 已采用的关键决定

1. `raw_submission_resume.resume_text` 是 Raw 来源证据；`submission_normalized` 不复制 Resume 长文本。
2. `resume_extraction` 也不复制 Resume 长文本，只保存精确 `raw_submission_resume_id`、输入 SHA-256、提取版本和结果状态。
3. Workflow B 必须通过 `application_source_lineage(primary_decision_input)` 找到指定来源，再读取本次冻结的 extraction version；不能静默读取“当前最新”结果。
4. PDF 转文本已经在 Raw 完整落地前完成；G05 不重新下载 PDF。
5. Initial Cleaning 不做语言识别或英文门禁。
6. Initial Cleaning 要求至少 100 个清洗后非空白 Unicode 字符；ML 内部原有 50 字符异常检查仍保留。
7. parser 成功但没有某一类实体是合法零行，不创建 `unknown`、空白或 placeholder 子记录。
8. `extraction_confidence` 不作为字段或入库条件；延续用户已经确认的规则准入逻辑。
9. Project 的日期和 URL 允许 NULL；Employment 发布准入要求开始或结束日期至少存在一个。
10. Education 以 degree 为核心；`Other` 或无法可靠映射的学位留在 extraction 层，不发布到正式 Education。
11. 已确认 `resume_extraction` 不复制 Resume 长文本。
12. 已确认 `resume_education` 不保存权威 `is_highest_degree`；Workflow B 发布时局部计算。
13. 已确认 `source_entry_order` 只用于原文定位、确定性顺序和幂等，不表示重要性。
14. 已确认首版不创建 `resume_certification`；当前正式 Certification 关联允许为零行。
15. 已确认 `submission_normalized` 只保存完整 `normalized_email_address`；prefix/domain 在需要时确定性派生。
16. 已确认显式保存 `requested_start_year_month`，并与 `requested_start_date` 保持数据库约束一致。
17. 已确认 rejected extraction candidates 保留在 G05，但绝不发布到正式 Person/Candidate 人才档案。

## 3. `normalization_run`

一行表示一个 Raw Submission 使用一个 `normalization_version` 的逻辑标准化运行。

它记录：

- 谁拥有本次运行：`workflow_run_id`、`step_run_id`；
- 使用哪版规则：`normalization_version`；
- 是否成功以及错误/警告；
- 幂等身份：`idempotency_key`。

`UNIQUE(raw_submission_id, normalization_version)` 表示同一 Raw 和同一规则版本只产生一个逻辑结果；网络重试复用该 run，不重复创建。

## 4. `submission_normalized`

一行是一次成功 normalization 的结构化结果，不是运行日志。

核心字段分为：

| 类别 | 字段 |
|---|---|
| Catalog | `company_id`、`company_work_mode_id`、`position_id` |
| 姓名 | normalized full/first/middle/last name |
| 联系方式 | `normalized_email_address`、`normalized_phone` |
| 申请偏好 | requested start/end date、start year-month、work duration |
| 来源/版本 | `raw_submission_id`、`normalization_run_id`、`normalization_version` |

这里不再保存：

- Raw 姓名、邮箱、电话：G03 已忠实保存；
- email prefix/domain：可从完整 normalized email 确定性派生，首版不重复存；
- `application_cluster_id`、`open_window_id`、`application_cycle_id`：新版已删除这些实体；
- `resume_text`：只保存在 `raw_submission_resume`。

`requested_start_year_month` 是为实时查重冻结的确定性派生值，例如 `2026-04`。虽然通常可从完整日期计算，但明确保存能支持部分日期政策、规则版本复现和 G06 的组合索引。

## 5. `resume_extraction`

这是一次完整 Resume 结构化提取的父记录，不是第二份 Resume 文本。

它冻结：

- 使用的 `submission_normalized_id`；
- 精确 `raw_submission_resume_id`；
- `input_resume_text_sha256`；
- `extraction_version`；
- Workflow/step owner；
- 五类输出记录数、警告和最终状态。

状态中的 `succeeded_no_structured_entity` 表示技术上成功读取和解析了 Resume，但没有生成任何可靠子实体；它不是 parser failure。

同一个 Resume 将来使用新版规则重提取时，创建新 `resume_extraction`，旧结果变为 `superseded`，不覆盖旧子记录。

## 6. 四类结构化 Resume 子表

### 6.1 `resume_education`

保存所有识别到的学历候选段，包括未达到正式发布标准的记录。核心字段包括完整原始段落、学校、degree、field study、major、GPA 和日期。正常候选段必须有原始文本；只有专门标记为 `rejected_missing_raw_text` 的异常 parser candidate 才允许该字段为 NULL，不能写空字符串占位。

`degree_id` 指向标准 degree：Doctorate、Master、Bachelor、Associate、High School。原始和 normalized 名称仍保存，便于审核映射。

`extraction_eligibility_status` 保存 A 阶段规则判断；Workflow B 发布前必须重新验证，不能只相信旧状态。最高学历不在本表冻结为权威事实，而是在发布 Candidate/Person Education 时依据所有合格记录重新计算。

### 6.2 `resume_employment`

保存完整原始工作段、公司、岗位、描述和日期。提取层允许保留日期缺失的 rejected candidate；标记 `eligible` 时数据库强制要求原始段、公司、岗位以及至少一个开始/结束日期。

不因结构字段相同自动去重；只有同一 extraction 内原始工作文本完全重复时，规则才可拒绝或标记。

### 6.3 `resume_skill`

严格沿用现有逻辑：使用数据库已有 `skill` 作为关键词/规范目标，在 Resume matched skill 数据中识别；同一个 Skill 可通过 `skill_type_assignment` 属于多个 Skill Type。

本表不复制 `skill_type_id`，否则一条技能属于多个类型时会制造重复技能行。类型需要时通过：

```text
resume_skill.skill_id
→ skill_type_assignment
→ skill_type
```

### 6.4 `resume_project`

保存原始项目段、项目名、描述、可选日期和 URL。标记 `eligible` 时数据库强制要求原始项目段和项目名；日期和 URL 继续允许 NULL。`source_entry_order` 只是原文定位和稳定幂等顺序，不代表项目重要程度，也不参与 ML 排名。

## 7. `submission_identity_feature`

统一替代原版独立的 `Resume_external_identifier` 和身份查重中间 CSV。

一行表示一个 Submission 的一个候选身份信号：

```text
email
phone
linkedin_url
github_url
```

它同时保存 normalized value 和服务端 keyed HMAC：

- normalized value：Workflow B 发布 Person contact/link 和人工审核需要；
- HMAC：G06 实时查重的索引键；
- `feature_source`：区分表单字段和 Resume；
- `selection_status`：区分主要候选、额外候选、歧义和不可靠候选。

45 个额外电话、2 个额外 GitHub 等历史问题不会被静默丢失：可靠主值标记 `selected`；其余信号可保留为 `additional_candidate`、`ambiguous` 或 `rejected_unreliable`。发布到 Person 主联系方式时仍只采用可靠选中值。

## 8. 零行、失败与补偿

| 情况 | 数据结果 |
|---|---|
| Resume 有效但没有 Project | `resume_project` 0 行；extraction 可以成功 |
| Education section 存在但没有可靠 degree | rejected `resume_education` 可保留；正式 Education 0 行 |
| parser 瞬态失败 | attempt/step 标记 retryable；不发布半套 extraction |
| parser terminal failure | extraction/step 失败；Workflow A 不发布 Application |
| 子表 batch 中任一 INSERT 失败 | 本次 extraction 父子结果共同回滚 |
| Workflow A 后续 dedup/publish 失败 | G05 版本化结果可保留用于安全重试；若必须补偿则只处理本 workflow 专属、未发布结果 |

四类子表和父 `resume_extraction` 应在一次短 D1 `batch()` 中提交；记录数必须与父表 count 字段一致。

## 9. 与组员项目的全部本组差异

| 项目 | 组员版 | 新版 G05 |
|---|---|---|
| Raw/normalized | 合在 `application_submissions` 周围 | 明确分开 Raw、run 和 normalized result |
| PDF text | Worker 调 FastAPI/PyMuPDF 后写 `resume_text` | 沿用该能力但文本在 G03 Raw 落地前完成，G05 只引用 |
| Normalization run | 没有独立权威表 | `normalization_run` |
| Resume extraction version | 没有 | `resume_extraction.extraction_version` + input hash |
| Education/employment/skill/project | 没有结构化 D1 结果表 | 四类权威 extraction 子表 |
| 身份信号 | 主要是 applicant/email/Submission 字段 | 统一版本化 `submission_identity_feature` |
| 幂等 | `wasAlreadySynced()` 主要按来源 record ID | run、step、version、input hash 多层幂等 |
| 失败追踪 | Submission parse status/error | Workflow/step/attempt + extraction status |

## 10. 与原版数据库和 Colab 的全部本组差异

| 项目 | 原版 | 新版 G05 |
|---|---|---|
| 数据来源 | Cell/CSV/前一 cell 变量混合 | 每一步只从 D1 权威表读取 |
| `Submission_normalized` | 强制 Company/Position/Cycle，保存 raw 与 normalized 混合字段 | 去掉 cycle/cluster/open window；Raw 与 normalized 分责 |
| Email | 分存 prefix/domain，没有完整 normalized email | 保存完整 normalized email；prefix/domain查询时派生 |
| Resume text | Raw、Candidate、Resume extraction 等位置存在复制 | Raw child 表保存一次，其他层只引用/冻结 hash |
| Extraction 数量 | 原表一条 normalized Submission 一个固定 extraction | 允许规则版本化重提取，不覆盖历史 |
| Education/Employment | 老表存在但实际主要经 CSV 再直接导入 Candidate | 先进入权威 extraction 层，再由 Workflow B发布 |
| Skill/Project | 提取 CSV 曾是主要中间结果 | 新增 D1 `resume_skill`/`resume_project` |
| confidence | 部分规则输出/表依赖 confidence | 不保存为准入依据 |
| Highest education | 曾出现重复 `is_highest`，后续全库修复 | extraction 不宣称权威最高；发布时局部重算并事务更新 |
| 外部 identifier | `Resume_external_identifier` 独立表 | 合并进 identity feature |
| CSV | 会被覆盖并作为下游输入 | 仅作为每个写入 Cell 后的只读测试输出 |

## 11. 最终确认结果

1. 已确认：`submission_normalized` 只保存完整 normalized email，不再分别保存 prefix/domain。原版最终查重规则是完整 email 精确匹配；GitHub 候选选择需要 prefix 时，从完整 normalized email 确定性拆出，保留原业务能力。
2. 已确认：显式保存 `requested_start_year_month`；数据库强制它等于 `requested_start_date` 的 `YYYY-MM`，并用于 G06 组合索引及运行规则复现。
3. 已确认：`resume_extraction` 不保存 Resume 长文本，只保存 Raw Resume FK + SHA-256。
4. 已确认：最高学历只在 Workflow B 发布时计算，`resume_education` 不保存权威 `is_highest_degree`。
5. 已确认：rejected extraction candidates 留在 G05，并通过 `extraction_eligibility_status` 表达原因；Workflow B 不得发布这些记录。
6. 已确认：`source_entry_order` 只用于原文定位、幂等与审计，不代表重要程度。
7. 已确认：首版不增加 `resume_certification`；正式 Candidate Certification 表允许暂时为零行。
