# Group G08：Candidate/Person 人才档案（Confirmed Revision 1）

版本日期：2026-08-17
对应 Canonical SQL：[`HIREBEAT_D1_CREATE_2026-08-17.sql`](../schema/HIREBEAT_D1_CREATE_2026-08-17.sql)（Group G08）
状态：`confirmed`

## 1. 本组边界

G05 保存规则提取器产生的全部候选结果，包括 eligible 和 rejected。G08 只发布 Workflow B 重新验证后仍 eligible 的人才事实：

```text
G05 Resume extraction candidates
  → Workflow B publication eligibility revalidation
  → G08 Person facts + Candidate snapshot membership
```

某类实体完全没有可靠结果时允许零行。不会插入空字符串、`unknown` 或 placeholder 假记录。

首版创建 11 张表：

```text
education
person_education
candidate_education
person_position
candidate_position
person_skill
candidate_skill
person_project
candidate_project
person_certification
candidate_certification
```

已确认不创建：

```text
person_relocation_preference
candidate_reference
```

## 2. 双层档案模型

Person 层回答“这个长期人才档案已经出现过哪些事实”；Candidate bridge 回答“这次 Application 的 Candidate snapshot 实际采用了哪些事实”。

```text
person
  └── person_* fact
         └── candidate_* bridge
                └── candidate_snapshot
```

新重申不会修改旧 Candidate bridge。完全相同的已发布事实可以复用 Person fact，并为新 Candidate 新增 bridge；内容发生变化时创建新的不可变版本。

所有 Candidate bridge 都同时保存 `person_id`，并使用两个 composite FK，数据库直接阻止把 A 的 Candidate 错连到 B 的 Person fact。为此 G07 `candidate_snapshot` 增加 `UNIQUE(id, person_id)`。

## 3. Education

### 3.1 三张表职责

- `education`：一段具体学历的结构化内容；
- `person_education`：该学历属于哪个 Person，以及首次来源；
- `candidate_education`：某次 Candidate 是否采用该学历及是否为该 Candidate 的最高学历。

### 3.2 发布门槛

沿用已确认的保守规则：

- G05 `resume_education.extraction_eligibility_status = eligible`；
- 原始教育段落、学校原文和学位原文非空；
- `degree_id` 必须映射到 G01 的标准学位；
- `Other` 不发布；
- school/field/major Catalog ID 可以 NULL，只要原始学校和学位证据可靠；
- 日期、GPA、专业和 current 状态允许 NULL。

`education_description` 继续保存 G05 的完整 `raw_education_text`。按此前决定，首版不另建 `raw_education_text` 字段。

### 3.3 标准学位与最高学历

标准学位来自 G01 `degree`，例如：

```text
High School → 1
Associate   → 2
Bachelor    → 3
Master      → 4
Doctorate   → 5
```

G05 不保存权威 highest；Workflow B 在全部 eligible 教育记录确定后计算。Candidate 有教育时必须在代码中选出恰好一条 highest；数据库 partial unique index保证最多一条。

建议稳定排序：

```text
degree.degree_level_rank DESC
education_end_date DESC（NULL 最后）
source_entry_order ASC
candidate_education.id ASC
```

Person 的 `highest_person_education_id` 是当前缓存 pointer。增量发布时比较当前 pointer 和新 Candidate 的 highest 即可，不要求每次扫描全库；定期审计 Cell/Job 才做全量复核。

### 3.4 版本与复用

`education_record_sha256` 根据发布后的结构化内容和原始段落生成。同一 Person + 相同 hash 复用原 Person education；新的 Candidate bridge 保存本次 `source_resume_education_id`。内容变化产生新的 Education/Person education，不覆盖旧版本。

## 4. Employment

`person_position` 保存一段可靠工作经历，`candidate_position` 保存某次 Candidate 对它的使用关系。

发布门槛保持原版已确定规则：

- 原始工作段落非空；
- 公司名称非空；
- 岗位名称非空；
- 开始日期或结束日期至少一个存在；
- 必须来自明确 Employment section；
- 没有日期和 URL 以外的可选字段允许 NULL。

`position_description` 保存 G05 `raw_employment_text`，即该段工作经历原文。

过去雇主和岗位未必属于 HireBeat 招聘 Catalog，因此 `company_id`、`position_id` 允许 NULL；raw/normalized company/position name 仍保留。function、seniority、location 和 employment type 也允许 NULL。

同一 Person + `employment_record_sha256` 完全相同时复用；描述、日期或其他参与 hash 的内容变化时创建新版本。普通同名职位不自动合并。

一个 Candidate 可以有多个 current positions。`candidate_position.is_current_at_snapshot` 冻结本次判断；`is_primary_current_position` 最多一条且只能标在 current 记录上，供 `person.current_person_position_id` 缓存选择；没有 current 工作时允许零条 primary。多个 current 的稳定选择顺序建议为：明确 current 优先、开始日期最新优先、source entry order 最小优先、ID 最小优先。

## 5. Skills

G01 已确认：一个 Skill 可以通过 `skill_type_assignment` 同时属于多个 Skill type。

G08 采用：

```text
person_skill UNIQUE(person_id, skill_id)
```

因为“Python”作为 Person 的长期技能不需要按每次申请复制。Person skill 保存当前汇总值和 first/latest seen；Candidate skill 保存本次申请的来源、上下文和 proficiency/years snapshot。因此后续 Person 汇总更新不会改写旧 Candidate 当时的快照值。

只有 G05 已映射到权威 `skill.id` 且 eligible 的 Skill 发布；未映射文本保留在 G05 rejected result，不进入正式人才档案。

当前规则提取器没有稳定 proficiency/years 时，这些字段保持 NULL，不填默认值。

## 6. Projects

`person_project` 保存不可变项目内容；`candidate_project` 保存本次 Candidate 的来源关系。

发布门槛：

- 项目名称非空；
- 原始项目段落非空；
- G05 已排除同一 Candidate 完全相同的 raw project text；
- 日期和 URL 允许 NULL；
- `project_role` 允许 Project Leader、Individual Project 等合法角色，也允许 NULL；
- 纯地点名称不因其是地点而自动排除。

`project_description` 保存 G05 `raw_project_text`。同一 Person + 完全相同 `project_record_sha256` 复用；更新后的描述或日期形成新版本。普通同名项目不自动删除或合并。

## 7. Certifications

按已确认决定保留 `person_certification` 和 `candidate_certification`，并连接 G01 certification taxonomy。

但是当前成功运行的 Colab 没有稳定的 Resume Certification 提取器，因此首版允许两张表长期为零行。不能为了“表有数据”创建假证书。

未来来源可以是：

```text
resume_extraction
administrative
integration
```

同一 Person 的一个具体证书实例使用 `certification_instance_key` 幂等。Candidate bridge 冻结该次申请时的 status/issue/expiry snapshot，避免后续过期状态改变旧 Candidate 视图。

## 8. 删除与更新规则

- Person fact 被历史 Candidate 使用后不物理删除；
- Education/Position/Project 内容变化创建新版本；
- Person skill 是当前汇总，可受控更新，Candidate skill snapshot 不更新；
- Certification 当前状态可受控更新，Candidate certification snapshot 不更新；
- Candidate bridge append-only；
- G05 source IDs 是跨层普通 INTEGER，不设置硬 FK；
- Candidate/Person/G01/G02 同业务层关系保留 FK。

Workflow B 使用短 D1 batch 同时：发布本 Candidate 的所有合格 facts/bridges、计算 highest/current pointer、更新 Person current cache、将 Candidate 标为 `enriched`。任一语句失败共同回滚。

## 9. 与组员项目的全部本组差异

| 项目 | 组员版 | 新版 G08 |
|---|---|---|
| 人才档案 | `applicants` + `applicant_emails` | Education/Employment/Skill/Project/Certification 完整双层档案 |
| Resume 处理 | PDF 转文本后保存 | G05 规则提取候选；G08 只发布重新验证后的可靠事实 |
| Application 快照 | 无 Candidate profile snapshot | 每次合法 Application 有独立 Candidate membership |
| 历史更新 | 没有结构化版本策略 | 相同内容复用、变化内容新版本、旧 Candidate 不改写 |
| Skill taxonomy | 无 | 权威 Skill + 多 Skill type + Candidate snapshot |
| 最高学历 | 无 | Candidate highest + Person highest pointer |
| 证书 | 无 | taxonomy 和正式关系保留，首版允许零行 |

组员版 PDF→text 能作为 G03 `raw_submission_resume` 上游；它不替代 G05/G08 的结构化提取与发布。

## 10. 与原版数据库和 Colab 的全部本组差异

| 项目 | 原版 | 新版 G08 |
|---|---|---|
| 数据源 | CSV 是 importer 输入 | D1 G05 是唯一输入；CSV 只做测试导出 |
| 运行粒度 | 经常全量扫描 1,039 条 | 单个 Candidate 增量发布，定期审计才全量 |
| 最高学历 | 增量错误曾产生多个 highest，再全库修复 | partial unique + 单 Candidate batch + Person pointer 比较 |
| Education raw text | 写入 `education_description` | 保持相同决定，并增加 hash 版本复用 |
| Employment | Catalog IDs 多数 NULL，按 CSV key 幂等 | 明确 Past employer mapping 可 NULL，以内容 hash 版本化 |
| Skill | Person skill + Candidate skill，CSV 匹配 | 保留双层模型，Candidate 保存本次 snapshot 值 |
| Project | 后期新增 Candidate project | 初始 schema 直接建立且有 source/hash 规则 |
| Profile 更新 | 跨多个独立 Colab、可能中途只写一部分 | Workflow B 的单 Candidate 发布 batch 原子提交 |
| FK ownership | bridge 可能只验证单列 ID | composite FK 确保 Candidate 与 Person fact 属于同一 Person |
| 空数据 | 部分旧表长期为空 | 零子表行是显式合法状态，不创建 placeholder |

## 11. 已确认决定

1. 11 张表全部首版创建，Certification 两张表允许暂时零行；
2. 使用 Candidate/Person 双层模型，Candidate bridge append-only；
3. 相同内容 hash 复用 Person fact，内容变化时 append 新版本；
4. Education `degree_id` 必填，`school_id/field_study_id/major_id` 可 NULL，但 raw school/degree/description 必填；
5. `education_description` 保存完整 raw education segment，不新增 `raw_education_text`；
6. 有已发布 Education 的 Candidate 必须恰好一条 highest，并采用本文件的稳定排序；
7. Person highest pointer 采用增量比较，另设低频全库审计；
8. Employment 要求至少一个可靠日期，Past company/position Catalog IDs 可 NULL；
9. `position_description` 保存完整 raw employment segment；
10. Candidate 可以有多个 current positions，但最多一条 primary current；该 0/1 标记 NOT NULL；
11. Person skill 每个标准 Skill 一条当前汇总，Candidate skill 保存每次申请 snapshot；
12. Skill 没有稳定 proficiency/years 时保持 NULL；
13. Project 日期/URL nullable，合法角色不排除，普通同名不合并，完全相同内容 hash 才复用；
14. `project_description` 保存完整 raw project segment；
15. G05 source IDs 不设跨层 FK，Candidate/Person/reference/catalog 保留同层 FK；
16. Workflow B 以一个 Candidate 为原子发布单元，任一 G08 写入失败则本 Candidate 的本次发布 batch 全部回滚；
17. Resume 历史雇主和岗位不自动升级为 HireBeat Catalog；raw/normalized name 必须保存，Catalog ID 可 NULL；
18. Composite FK 同时验证 Candidate 和 Person fact 的 `person_id`，防止跨 Person 错连。
