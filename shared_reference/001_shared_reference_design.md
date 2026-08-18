# Group G01：共享参考数据与人才分类字典（Confirmed 1）

确认日期：2026-08-13  
状态：`confirmed`  
对应 SQL：`001_shared_reference_schema.sql`

## 1. 本组结论

G01 首版确认创建 21 张表。原清单中的 20 张继续保留，并新增：

```text
skill_type_assignment
```

新增原因不是预留未来功能，而是修复旧版真实数据模型的问题。旧版 `skill.skill_type_id` 强制一条 Skill 只能属于一种类型；现有三份技能参考 CSV 中约有 4,091 个大小写归一化后同名、但同时出现在 Function 和 Technology 类型中的技能。如果继续沿用旧结构，只能复制 Skill 行。

新版改为：

```text
skill 1 ──< skill_type_assignment >── 1 skill_type
```

因此一条规范 Skill 可以属于 Language、Technology、Function 中一个或多个类型，Candidate/Position 只关联同一个 `skill.id`，不会因为类型不同重复计算同一技能。

这里的 `UNIQUE(skill_id, skill_type_id)` 是**组合唯一约束**，不是要求 `skill_id` 单独唯一。例如以下三行全部允许：

```text
Python + Technology
Python + Function
Python + Language
```

它只禁止重复写入第二条完全相同的 `Python + Technology` 关联。因此，同一个提取得到的 Skill 可以同时属于任意多个不同 Skill type。

## 2. 三个子组

### G01-A：岗位与联系方式字典

| 表 | 粒度 | 主要用途 |
|---|---|---|
| `function` | 每个规范岗位职能一行 | Position 和工作经历的职能分类 |
| `seniority` | 每个规范资历层级一行 | Position 和工作经历的 seniority |
| `contact_type` | 每种联系方式一行 | email、phone 等 Person contact 分类 |
| `work_mode` | 每种工作模式一行 | onsite、hybrid、remote 的唯一字典 |
| `position_employment_type` | 每种雇佣类型一行 | internship、full-time、part-time 等 |
| `position_occupational_type` | 每种职业类型/职业代码一行 | 外部或内部 occupational taxonomy |

### G01-B：技能与证书字典

| 表 | 粒度 | 主要用途 |
|---|---|---|
| `skill_type` | 每个技能类别一行 | Language、Technology、Function |
| `skill` | 每个规范技能名称一行 | Candidate 与 Position 共享的 Skill 目录 |
| `skill_type_assignment` | 每个 Skill 与 Skill type 组合一行 | 支持同一 Skill 属于多个类型 |
| `skill_proficiency_level` | 每个熟练度等级一行 | Candidate skill 或岗位要求的规范等级 |
| `certification_type` | 每种证书类别一行 | Certification 分类 |
| `issuing_organization` | 每个证书签发机构一行 | 证书签发者目录 |
| `certification` | 每个规范证书一行 | Candidate certification 和岗位证书要求共享目录 |

### G01-C：地点与教育字典

| 表 | 粒度 | 主要用途 |
|---|---|---|
| `country` | 每个国家一行 | 地理父级 |
| `state` | 每个国家下的州/省一行 | 直接属于 Country，不再经过 Region |
| `city` | 每个城市一行 | 必须属于 Country，可选属于 State |
| `location` | 每个可复用业务地点一行 | Company、Position、Offer 等复用的地点组合 |
| `degree` | 每个标准学历级别一行 | Doctorate、Master、Bachelor、Associate、High School |
| `field_study` | 每个规范研究领域一行 | Education 的 field of study |
| `major` | 每个规范专业一行 | Education 的 major，可选归属 field of study |
| `school` | 每个规范学校一行 | Education 共享学校目录 |

## 3. 字段设计规则

### 3.1 哪些表使用 code

规模小、由系统控制、会写入业务规则的枚举型字典使用稳定 `code`：

```text
function.function_code
seniority.seniority_code
contact_type.contact_type_code
skill_type.skill_type_code
skill_proficiency_level.proficiency_level_code
certification_type.certification_type_code
country.country_code
degree.degree_code
work_mode.work_mode_code
position_employment_type.employment_type_code
position_occupational_type.occupational_code
```

代码判断使用 `code`，界面展示使用 `name`。这样管理员以后可以修改展示名称而不破坏 Workflow 规则。

### 3.2 哪些表使用 UUID

会不断增长、可能来自多个 importer、可能跨 D1/R2/API 使用的目录实体增加 UUID：

```text
skill
issuing_organization
certification
city
location
field_study
major
school
```

整数 `id` 仍用于 D1 内部 JOIN；UUID 用于跨系统稳定引用。

### 3.3 normalized name

需要按名称幂等导入或匹配的目录保存标准化查找值：

```text
normalized_function_name
normalized_skill_name
normalized_organization_name
normalized_certification_name
normalized_state_name
normalized_city_name
normalized_field_study_name
normalized_major_name
normalized_school_name
```

标准化值由同一版本的服务函数生成，不由 SQL Trigger 自动生成。建议规则至少包括 Unicode normalization、首尾空白去除、连续空白折叠和业务确定的大小写折叠。原始展示名称仍保留在对应 `*_name` 字段。

## 4. 关键约束和删除行为

- 所有字典主键使用 `INTEGER PRIMARY KEY`，不使用 `AUTOINCREMENT`。
- 受控 code、UUID 和明确规范名称使用 `UNIQUE`，支持 importer 幂等复用。
- `skill_type_assignment` 使用 `UNIQUE(skill_id, skill_type_id)`，防止重复分类。
- 删除 Skill 时其分类关联 `ON DELETE CASCADE`；删除 Skill type 时使用 `RESTRICT`，避免仍有 Skill 使用的类型被误删。
- Country/State/City、证书和教育目录之间使用 `ON DELETE RESTRICT`。历史中已经引用的共享目录不应物理删除，应把 `is_active` 改为 0。
- `location` 至少要有 country、state、city、postal code 或自由地点名之一，禁止完全空的地点行。
- `seniority` 的最大经验月数不能小于最小经验月数。
- `typical_validity_months` 代替原版 `typical_validity_years`，可表达 6、18、30 个月等非整年有效期。

### 4.1 完全没有 Location 数据时如何保存

如果某份简历、工作经历、学校、岗位或 Offer 完全没有提取/获得任何地点信息：

- 不创建 `location` 记录；
- 对应业务表的 `location_id` 必须允许 `NULL`；
- 原始文本仍可留在该业务实体的 raw/description 字段中；
- 不创建 country、state、city、postal code 和 location name 全部为空的占位行。

因此，“禁止完全空的 Location 行”不等于“每条业务记录必须有 Location”。它只是防止数据库中出现没有任何信息、也无法复用或解释的空地点实体。后续设计引用 `location` 的每张提取结果表时，都必须单独确认其 `location_id` 是否可空；简历提取类表默认可空。

### 4.2 Seniority 经验范围的 NULL 规则

`seniority` 分别具有两个 nullable 字段：

```text
typical_experience_months_min
typical_experience_months_max
```

以下四种情况都合法：

1. 两个字段都有值，且 `max >= min`；
2. 只有 min，max 为 `NULL`；
3. 只有 max，min 为 `NULL`；
4. 两个字段同时为 `NULL`。

只有在两个字段都非空时，才检查最大值不能小于最小值。任意非空值本身还必须大于或等于 0。

## 5. 初始种子数据建议

这里的“种子数据”就是数据库第一次建立后必须存在的初始 Reference table 数据，例如 email/phone、remote/hybrid/onsite 和五个标准 Degree。

建议采用以下文件职责分离（等待部署结构确认）：

```text
schema SQL     只负责 CREATE TABLE / INDEX / CONSTRAINT
seed SQL       负责初始 Reference rows
migration SQL 负责以后版本升级和数据迁移
```

种子数据放在单独、带版本号且幂等的 seed SQL 文件中，不直接写进最终总 `create_schema.sql`。部署脚本按固定顺序先执行 schema、再执行 seed。这样可以：

- 在空数据库初始化时一次完成；
- 在已有数据库重复部署时通过 `INSERT ... ON CONFLICT` 安全复用；
- 单独修改展示名称或增加字典值，而不混淆建表结构变更；
- 测试环境可以只测试 schema，也可以测试 schema + seed；
- 避免为了更新一条 Reference row 而修改整个建表文件。

首版 seed 至少包括：

### `contact_type`

```text
email
phone
```

### `skill_type`

```text
language
technology
function
```

### `work_mode`

```text
onsite
hybrid
remote
```

### `degree`

| degree_code | degree_name | rank |
|---|---|---:|
| `high_school` | High School | 1 |
| `associate` | Associate | 2 |
| `bachelor` | Bachelor | 3 |
| `master` | Master | 4 |
| `doctorate` | Doctorate | 5 |

`Other` 不进入正式 Degree 字典。无法可靠映射的学历仍保留在 Submission extraction/rejected audit 中，不伪装成规范学历。

## 6. 与原版数据库的具体差异

1. 全部表名和字段改为 `lower_snake_case`。
2. 原版 `skill.skill_type_id` 被移除，新增 `skill_type_assignment` 多对多桥表。
3. 原版允许跨类型同名 Skill 复制；新版按 `normalized_skill_name` 只保存一条 Skill。
4. 原版 `state` 通过 `region_id` 关联 Region；新版删除 Region，改成 `state.country_id`。
5. 原版 `location` 具有 `region_id`、`timezone_id`、`zipcode`；新版删除前两项，并把 `zipcode` 更名为更通用的 `postal_code`。
6. 原版 City 只连 State；新版 City 必须直接连 Country，State 可空，以支持没有州/省层级的地址。
7. 原版 `seniority_experience_average` 是语义模糊的 TEXT；新版改为可验证的最小/最大经验月数。
8. 原版 `certification.typical_validity_years` 改为月份。
9. 原版大多只有展示名称；新版对受控枚举增加稳定 code，对增长型目录增加 UUID 和 normalized name。
10. 新版共享目录统一采用 `is_active` 软停用，避免历史外键因物理删除失效。
11. `experience_level`、`region`、`timezone`、`school_location` 已确认不创建。

## 7. 与组员项目的具体差异

1. 组员版只有 `companies`、`roles` 等最小业务目录，没有独立技能、教育、证书、地点和联系方式字典。
2. 组员版 `applications.work_mode` 使用自由 TEXT；新版首版使用 `work_mode` 字典和 `company_work_mode` 关系。`position_work_mode` 已移入 deferred，待取得真实岗位级数据后再限定每个岗位允许的模式。
3. 组员版简历解析只把 PDF 文本写回 Submission，没有把 Skill、Degree、School、Certification 映射到共享参考实体。
4. 新版能够让 Candidate profile、Position requirements、ML features 和 Offer snapshot 共享同一套规范词汇；组员版当前不能提供这种跨模块一致性。
5. 新版不会让简历中出现的新字符串自动污染正式字典。无法映射的值保留在 raw/extraction 层，由明确 importer 或管理员审核后再升级。

## 8. Workflow、Outbox 和 Trigger

- 本组没有独立业务状态机。
- 本组首版不使用 SQL Trigger。
- 普通 Candidate Workflow 不应自动创建共享目录项；只允许读取或关联现有 active 字典。
- Catalog 管理或受控 migration 可以新增、重命名、停用字典。
- 如果字典变化需要推动 Airtable/Google Form 选项刷新，由 G02 的 `catalog_revision` 和 Outbox 处理，而不是由 G01 每张表各自触发外部调用。

## 9. CSV 测试导出

本组将来建议提供三个只读测试 CSV，而不是 21 个 CSV：

```text
g01_job_reference_audit.csv
g01_skill_certification_reference_audit.csv
g01_location_education_reference_audit.csv
```

每份 CSV 通过 JOIN 展示 ID、UUID/code、规范名称、父级名称、active 状态和时间，用于测试核对；CSV 不是后续 Workflow 的输入。

## 10. 已确认的设计点

1. 新增 `skill_type_assignment`，`skill` 本身不再保存 `skill_type_id`。
2. `degree` 正式字典只允许五个标准类别，不包含 `Other`。
3. 所有共享字典都使用 `is_active` 软停用，不允许业务代码物理删除已被引用的数据。
4. Location 首版不保存 timezone；如果未来 Offer/面试排期产生真实需求，再作为独立需求设计。

## 11. “共享字典”的准确含义

本文中的“共享字典”指 G01 的 Reference tables：由多个业务模块共同读取、更新频率较低、用于统一分类或标准名称的表。例如 `work_mode`、`degree`、`skill_type`、`skill`、`school`。

它们与普通业务交易表的区别是：

- 一条 Application 不会独占一条 Reference row；
- 多个 Candidate、Position、Application 或 Offer 可以引用同一行；
- 历史业务记录需要继续理解原来的引用含义；
- 因此已被引用的行通常设置 `is_active = 0`，而不是物理删除。

“共享字典”在本项目语境中基本等同于“共享 Reference tables”，但并不意味着所有 Reference table 都必须在 G01。例如 `company` 和 `position` 也是参考/目录性质的数据，但由于它们具有独立业务生命周期、表单同步和 active 管理，被放在 G02 Recruitment Catalog，而不是 G01。

## 12. Reference Data 变更策略

本组正式冻结以下跨数据库和 Workflow 通用规则：

1. Reference row 的主键、稳定 code 和 UUID 一旦发布便不可修改。
2. 已发布或已被引用的 Reference row 不做普通物理删除；停止未来使用时设置 `is_active = 0`。
3. 只有拼写、大小写、展示名称等不改变业务语义的修正，才允许原地 `UPDATE`。
4. 如果分类含义、排序、适用范围或业务语义发生改变，必须创建新 Reference row，并停用旧 row；不能通过改写旧 row 偷偷改变历史业务记录的含义。
5. Reference 停用只控制未来选择、映射和发布，不追溯使历史 Application、Candidate、ML result 或 Offer 失效。
6. 已发布 Application、ML 和 Offer 使用各自已经冻结的 ID、输入快照或业务文本快照；Reference 后续变化不得追溯改写这些终态结果。
7. 重要 Reference 创建、展示名称修正、停用、替换或合并写入 G04 `audit_event`；高频技术错误仍进入 Cloudflare Logs，不复制成 Reference 审计事件。
8. 影响 Airtable、Google Form 或未来网页可选项的 Catalog 有效集合变化，通过 G02 创建新的 `catalog_revision`，再由 Outbox 驱动对应渠道同步。

推荐的重要 Reference 审计事件类型包括：

```text
reference_created
reference_display_name_updated
reference_deactivated
reference_replaced
reference_merged
```

事件应保存 Reference 类型、记录 ID、非敏感修改前后值、修改原因、操作者和发生时间。审计事件不得复制 Secret 或不必要的候选人 PII。

### 正在运行的 Workflow

- 尚未通过 Initial Cleaning 或 Application admission 的新 Submission，在对应边界重新验证 Reference 是否存在、归属正确且仍允许未来使用。
- 已经发布的 Application 不因普通 Reference 停用而被静默删除、重写或自动改变招聘决定。
- 已经生成的 ML result 和 Offer 继续使用当次冻结的输入、policy 和文本快照。
- 如果 Reference 变化涉及法律、安全或重大数据错误，应通过显式的 block、cancel、supersede 或受控 migration 处理，不能依靠普通名称更新隐式改变业务结果。

### 重复 Reference 的合并

发现重复 row 时选择一个 canonical row。尚未发布、仍处于 draft/current operational 状态且明确允许迁移的记录，可以通过受控 migration 改指 canonical ID；终态历史事实默认保持原引用。旧 row 在迁移后设置 `is_active = 0`。业务代码不得通过 `ON DELETE CASCADE` 批量删除引用历史。

首版不为全部 G01 表创建各自的 temporal/version history。`updated_at` 表示当前记录最后修改时间，`audit_event` 记录重要变更；将统一 `reference_data_release` 及 Workflow 冻结 Reference release 的能力保留为未来增强项。
