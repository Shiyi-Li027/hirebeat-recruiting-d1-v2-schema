# Group G02：招聘 Catalog 与表单目录同步（Confirmed Revision 2）

版本日期：2026-08-17  
对应 SQL：`002_recruitment_catalog_draft.sql`  
状态：`confirmed`

## 1. 本组边界

G02 建议首版创建 11 张表：

```text
company
company_contact_info
company_work_mode
position
position_salary_range
position_skill
position_education_requirement
position_certification_requirement
catalog_revision
catalog_sync_run
catalog_sync_target_run
```

`position_work_mode` 已确认不进入 initial Schema，移入 G12 deferred。只有取得可靠的 Position 级 Work Mode 数据，或 Company Work Mode 不能再默认适用于该公司所有 Position 时，才通过 migration 增加。

G02 是 Airtable、Google Form 和未来自建页面的权威招聘目录。它决定当前可以被选择的 Company、可选 Company Work Mode 和 Position，但不保存申请人的提交快照。Raw、Normalized、Application 和 Offer 会在后续 Group 中分别保存来源值或发布快照。

本组依赖已确认的 G01 reference tables，包括 `contact_type`、`work_mode`、`function`、`seniority`、`location`、Skill、Degree 和 Certification 字典。

## Production importer defaults

G02 子表使用固定白名单端点：

```text
GET   /v1/catalog/child-types
POST  /v1/catalog/children/{catalog_child_type}
PATCH /v1/catalog/children/{catalog_child_type}/{id}/active-state
```

覆盖 `company_contact_info`、`company_work_mode`、`position_salary_range`、
`position_skill`、`position_education_requirement` 和
`position_certification_requirement`。新记录未显式提供 `is_active` 时默认写入 `1`。

Position 的默认状态由 JD readiness 决定：

- 未显式传入 `position_status` 且 JD trim 后至少 10 字符：`active`；
- 未显式传入 `position_status` 且 JD 缺失或不足 10 字符：`draft`；
- 显式传入状态时使用该状态，但 `active` 始终必须通过 JD readiness gate；
- 无有效 JD 的 Position 不进入 Catalog options。即使可信来源携带权威 Position
  ID，Workflow A 仍按 D1 当前状态重新验证；`draft`、`paused`、`closed`、
  `archived` 都在 Initial Cleaning 阻断，不创建 Application。

人工 SQL 同样必须遵守上述推导，不允许简单省略 `position_status` 后依赖固定
Schema default。D1/SQLite 的普通 `DEFAULT` 不能引用本行 `position_jd`，也无法区分
“省略状态”与“显式指定 draft”。因此获批的手工 SQL 和后续批量 importer 必须使用：

```sql
CASE
  WHEN :position_status IS NOT NULL THEN :position_status
  WHEN length(trim(COALESCE(:position_jd, ''))) >= 10 THEN 'active'
  ELSE 'draft'
END
```

数据库 trigger 是最后的强制约束，继续拒绝所有 `active + 无效 JD` 写入。

## 2. 三个子组

### G02-A：Company Catalog

```text
company
company_contact_info
company_work_mode
```

### G02-B：Position Catalog 与岗位要求

```text
position
position_salary_range
position_skill
position_education_requirement
position_certification_requirement
```

### G02-C：目录版本与渠道同步

```text
catalog_revision
catalog_sync_run
catalog_sync_target_run
```

## 3. `company`

每个受招聘方管理的正式公司一行。申请 intake 只能验证和读取 Company，禁止根据申请人提交的文字自动创建 Company。

| 字段 | NULL | 说明 |
|---|---|---|
| `id` | 否 | D1 内部主键 |
| `company_uuid` | 否 | 跨系统稳定 ID，唯一 |
| `company_name` | 否 | 正式展示名称 |
| `normalized_company_name` | 否 | 管理查重和检索值；首版不设唯一 |
| `company_website_url` | 是 | 受信任目录网站 URL |
| `company_linkedin_url` | 是 | 官方 LinkedIn URL |
| `company_description` | 是 | 公司简介 |
| `is_active` | 否 | 是否允许出现在新的投递目录中 |
| `default_max_submission_attempts` | 是 | 公司默认总提交次数；Importer 对正式记录显式写 5，包括首次 |
| `created_at` | 否 | 创建时间 |
| `updated_at` | 否 | 最后实际变化时间 |

`default_max_submission_attempts` 初建时允许 NULL，SQL 提供 `DEFAULT 5`，并只约束非空值必须大于等于 1。可信 Company importer 必须显式写入 5；数据库仍允许未来导入未知策略的 Company 使用 NULL。不能声称仅靠 importer 能使数据库中该字段绝对不可能为 NULL，因为管理 SQL 或其他 writer 仍可能显式写 NULL。

已确认第一版不保存：

```text
company_domain
company_logo_url
company_legal_name
```

Company 只使用 `is_active`，不增加 `active_from`、`active_until` 或 Company status。历史引用不因停用而删除。

## 4. `company_contact_info`

一条可联系的公司招聘联系人、团队入口或其他联系渠道一行。一家公司可以有 0 到多行，也允许同时有多个 primary contact，例如不同招聘地区、职能或沟通渠道各有主要联系人。

| 字段 | NULL | 说明 |
|---|---|---|
| `company_id` | 否 | 所属 Company |
| `contact_type_id` | 是 | 可选 G01 `contact_type`；未知类型时允许 NULL |
| `contact_value` | 否 | 邮箱、电话、URL、Slack handle 或其他形式 |
| `contact_name` | 是 | 联系人姓名；通用入口可以没有 |
| `contact_position_title` | 是 | 联系人职位 |
| `is_primary` | 否 | 是否为某个业务语境下的主要入口；允许多行同时为 1 |
| `priority_rank` | 是 | 建议展示/联络顺序 |
| `is_active` | 否 | 当前是否可用 |

首版准入规则只要求 `contact_value` 非空。`contact_type_id` 可以为 NULL，不增加 `contact_label`，也不要求未知类型必须具有替代标签。联系方式不限制为 email、phone、URL。

这是有意接受的首版宽松设计：类型未知的记录仍然可以保存，但消费者不能假设能够自动识别其联系方式类型。未来若出现分类、路由、格式校验或 UI 图标需求，再通过 migration 增加 `contact_label` 或扩充 `contact_type`，并对历史 NULL 类型进行回填；该项列入 deferred 优化建议。

不创建“同一 Company 最多一个 active primary contact”的唯一索引。若未来需要按地区或业务范围选择唯一 primary，应增加 scope 后再建立相应唯一约束。没有可靠联系方式时保存 0 行，不创建 `unknown`、空字符串或 placeholder 行。

## 5. `company_work_mode`

每个 Company 与一个规范 Work Mode 的允许关系一行，例如 `HireBeat + Remote`。`UNIQUE(company_id, work_mode_id)` 只禁止同一组合重复，不限制一家公司具有多个 Work Mode。

`company_work_mode.is_active` 默认是 1。这里不要求招聘方另外执行一次“审核按钮”：只要受信任的 Catalog 来源明确提供了 Company + Work Mode 这条关系，而来源没有显式把它标记为 inactive，Importer 就写 1；只有来源明确传入 inactive/disabled，或者后续管理员停用时才写 0。来源完全没有提供某个 Work Mode 时，不创建该关系行，也不能把“没有提供”解释为一条 `is_active = 0` 的新记录。

Company 可以有 0 条 Company Work Mode：

- 有 active Company Work Mode 时，表单路径为 `Company → Company Work Mode → Position`；
- 没有 active Company Work Mode 时，路径退化为 `Company → Position`，提交中的 `selected_company_work_mode_id` 为 NULL；
- 首版没有 Position 级 Work Mode 过滤。一个 Company 的 active Work Mode 暂时视为适用于该公司的全部 active Position。

这是首版业务简化，不应误称为已经拥有 Position 级兼容性数据。

## 6. `position`

每个独立招聘岗位一行。同一 Company 可以拥有多个同名 Position，因此 `normalized_position_name` 不设唯一；跨系统身份使用 `position_uuid`。

| 字段 | NULL | 说明 |
|---|---|---|
| `position_uuid` | 否 | 稳定跨系统 ID |
| `company_id` | 否 | 所属 Company |
| `position_name` | 否 | 展示岗位名 |
| `normalized_position_name` | 否 | 检索/查重名称 |
| `position_jd` | 是 | UTF-8 JD；非 Active 状态允许 NULL，Active 时去除首尾空白后至少 10 字符 |
| `occupational_type_id` | 是 | G01 职业分类 |
| `employment_type_id` | 是 | internship/full-time 等 |
| `function_id` | 是 | 岗位职能 |
| `seniority_id` | 是 | Seniority |
| `location_id` | 是 | 没有地点时不创建空 Location |
| `work_duration` | 是 | 暂时保留单个自由 TEXT，例如 `10 weeks` |
| `position_status` | 否 | 岗位生命周期状态 |
| `openings_count` | 是 | 招聘人数 |
| `posted_date` | 是 | 发布日期 |

Position 状态：

| 状态 | 新申请可选 | 含义 |
|---|---:|---|
| `draft` | 否 | 正在编辑 |
| `active` | 是 | 当前允许申请，提交时仍重新验证 |
| `paused` | 否 | 临时停止，可恢复 active |
| `closed` | 否 | 已结束接收新申请，保留历史 |
| `archived` | 否 | 长期隐藏的历史记录 |

建议转换为 `draft → active`、`active ↔ paused`、`active/paused → closed`、`closed → archived`。不建立多个互相可能冲突的状态布尔字段。

Position 进入 `active` 前至少验证：Company 存在且 active；岗位名称有效；已配置 Requirement 的外键有效；Catalog revision 与 Outbox 在同一个短 `batch()` 中发布。根据已确认决策，JD、Location、Salary、Skills、Education requirements、Certification requirements 和 Company Work Mode 均可缺失。

## 7. 为什么 `position_work_mode` 延后

首版没有可靠的 Position 级 Work Mode 数据，也不使用它参与表单或后续 Workflow。此时建表只会产生长期空表或把 Company 级数据复制到每个 Position。

触发未来 migration 的条件：

1. 获得招聘方明确的 Position 级 Work Mode 数据；
2. 同一 Company 的不同 Position 具有不同 Work Mode；
3. 前端或申请验证必须按 Position 精确过滤；
4. Offer/JD 明确依赖 Position 级 Work Mode。

届时添加 `position_work_mode(position_id, company_work_mode_id, ...)`，不会破坏现有 Company Work Mode 或历史申请快照。

## 8. Position 的可选子表

- `position_salary_range`：0 到多行；min/max 至少一个非空，两者都有时 max ≥ min。
- `position_skill`：Position + Skill 最多一行；required/preferred；没有可靠要求时 0 行。
- `position_education_requirement`：degree 必填、field 可空；没有可靠要求时 0 行。
- `position_certification_requirement`：Position 和 Certification 必填；没有可靠要求时 0 行。

完全没有取得有意义子实体时，不创建子表记录；不使用空字符串、`unknown` 或 placeholder 冒充缺失子实体。

## 9. `catalog_revision`

每次可申请目录成功发布后创建不可变 revision，保存完整可选目录快照：

```text
Company
├── Company Work Mode（0..n，可选层）
└── Position（0..n）
```

界面可呈现 `Company → Company Work Mode → Position`，但首版 Position 只按 Company 过滤，不按 Work Mode 再过滤。

`catalog_snapshot_json` 使用 UTF-8 JSON TEXT 保存 ID、UUID、名称、active/status 和父子关系；`snapshot_sha256` 用于完整性和幂等核对。Revision append-only，不设置 `updated_at`；发布错误通过新 revision 修正。

Revision 的生成时机是“有效可选目录发生变化并成功发布”，不是申请者每打开一次投递窗口。会生成新 revision 的典型变化包括：

- Company name 或 `is_active` 改变，并影响表单展示/选择；
- Company Work Mode 新增、删除、归属改变或 `is_active` 改变；
- Position name、所属 Company 或 `position_status` 改变，并影响可选列表；
- 其他任何导致 active option-tree snapshot hash 改变的变化。

联系人、JD、薪资、Requirements 或 description 的变化，如果不改变可选 Company/Work Mode/Position 列表，则不生成 Catalog revision。发布服务应先构建新的 active option-tree 并计算 hash；若 hash 与最新 revision 相同，不插入重复 revision。

打开新的投递窗口不会创建 revision。窗口读取或同步当时最新且已经成功发布的 revision：未来自建网页可以直接取得 `MAX(revision_number)` 对应的 snapshot；Airtable/Google Form 则使用该渠道最后一次成功同步的 revision。如果某渠道落后于最新 revision，先为它发起同步，再开放该投递入口；不要绕过 revision 直接临时拼接三张实时表，否则同一个窗口可能读到不一致的 Company、Work Mode 和 Position 状态。

## 10. Catalog 同步按启用渠道分别执行

`catalog_sync_run` 表示“把某个 Catalog revision 同步到本次选中的一个或多个目标”的聚合请求，不强制同步全部已知渠道。`catalog_sync_target_run` 为本次实际目标各保存一行。

| 场景 | aggregate run | target rows |
|---|---:|---|
| 只有 Airtable 开放 | 1 | Airtable 1 行 |
| 稍后只开放 Google Form | 同一最新 revision 的另一个 run | Google Form 1 行 |
| 两个渠道同时开放 | 1 | Airtable + Google Form 共 2 行 |
| 没有渠道开放 | 不发起 sync run | 0 |

关闭或本次不更新的渠道不创建 target row，也不计为失败。保留 aggregate + target 两层可统一保存幂等键、请求状态和汇总，并在多目标时准确表达部分成功；它不要求两个渠道同时打开。

“渠道开放”指运营层面该 Airtable/Google Form 入口当前启用，不是每个申请者浏览器会话。首版可由调用服务或 Outbox payload 指定目标；只有未来需要由 D1 管理渠道 enabled/disabled 时，才增加 `catalog_sync_target_config`。

渠道每次被运营方打开或重新启用时，读取最新已发布 `catalog_revision`：如果目标渠道已经成功同步到该 revision，可以直接复用，不新建 revision；如果尚未同步，则只为该渠道创建 sync run/target run。申请者随后多次打开同一个已经启用的 Airtable/Google Form，不应每次都创建 Catalog revision 或 sync run。

Target 单独记录 status、attempt count、外部 revision key、非敏感错误和 next attempt。凭据只放 Cloudflare Secrets。`triggering_outbox_event_id` 等 G04 冻结后再补外键。

## 11. Initial Cleaning：旧逻辑与新版逻辑

对原版 `chaojiwudiniubidaima (11).ipynb` 的实际检查结果：

- 旧 `InitialSubmissionCleaner` 主要检查 `name`、`contact_email` 缺失并生成 null flags；
- 它依赖 CSV、ingestion batch 和 Cell 内对象；
- 后续 normalization 仍读取 Company/Position 全表并做名称精确/模糊匹配；
- 没有 Company/Position active、Position 归属或 Company Work Mode 验证。

所以新的 Catalog 验证不是旧 Cell 已有功能。建议保留并移植旧版有价值的必填检查、Unicode/空白规范化和 warnings，但重写为按当前 `raw_submission_id` 从 D1 读取的自包含、幂等 Workflow A step，并删除 Company/Position fuzzy find-or-create。

新增权威验证：

```text
selected_company_id 存在且 company.is_active = 1
selected_position_id 存在
position.company_id = selected_company_id
position.position_status = 'active'
position.position_jd IS NOT NULL
length(trim(position.position_jd)) >= 10

只有 `active + position_jd trim 后至少 10 字符` 才能建立 Application。Workflow B
仍会在调用 ML 前再次检查，以覆盖 Workflow A 成功后 Position 被撤回为 `draft`
或失去 JD readiness 的并发时间窗。

若 selected_company_work_mode_id 非 NULL：
  company_work_mode 存在
  company_work_mode.company_id = selected_company_id
  company_work_mode.is_active = 1
  对应 work_mode.is_active = 1

若 selected_company_work_mode_id 为 NULL：
  所选 Company 当前不存在 active company_work_mode
```

Raw 无论选项是否失效都先落地。Catalog 验证失败时停止 Workflow A 后续步骤，保留 Raw、workflow 状态和非敏感错误，不创建 normalized/application 业务结果。

## 12. 什么叫“已审核并显式写 `is_active = 1`”

“审核”不是必须人工逐行点击，而是进入权威 Catalog 前已经通过受信任来源、授权范围、结构和重复检查。`is_active = 1` 应由可信 importer 显式写入，不应对所有表统一依赖默认值。

| 情况 | 审核内容 | 建议写值 |
|---|---|---:|
| G01 Reference seed | Seed SQL 进版本控制并 code review；code/name 非空；无重复；父级有效；值属批准字典 | 明确 1 |
| Company importer | 来源是招聘方/管理员；UUID、名称有效；normalized duplicate audit 通过；不是申请人自由文本 | 明确 1 |
| Company Work Mode importer | Company/Work Mode 存在；组合不重复；受信任来源提供该关系；未显式标记 inactive | 明确 1；只有来源明确 inactive 才写 0 |
| Company contact importer | Company 有效；value 非空；来源获授权；类型未知时允许 `contact_type_id = NULL` | 明确 1；代表可用，不代表身份认证 |
| Position Requirement importer | Position/reference FK 有效；required/preferred 合法；组合不重复；来源获授权 | 明确 1 |
| 新发现但未审核 Company | 仅从候选数据发现，未核实权限、名称或重复 | 建议不进 Company；必须暂存时为 0 |

Position 新建默认 `draft`，发布验证成功后才改为 `active`。申请人文本不能成为审核依据，不能触发 `findOrCreateCompany()` 或 `findOrCreateRole()`。

## 13. 状态机、Outbox 与窗口冻结边界

- Company 与 Company Work Mode：active flag；
- Position：五状态生命周期；
- Catalog sync run/target：同步状态机；
- 第一版不使用业务 SQL Trigger；Catalog 服务显式发布 revision 和 Outbox。

影响选项的 Company name/active、Position name/status、Company Work Mode 关系/active 变化，在短 D1 `batch()` 中更新 Catalog、创建 revision 和 `catalog_options_sync_requested` Outbox。联系人、薪资或 Requirement 变化不必同步表单选项，但仍审计；是否刷新 ML feature 在 G09 决定。

原生 Airtable/Google Form 是否能为每个已打开窗口携带独立 revision 取决于 adapter/form 能力。首版边界：新打开/新同步入口使用最新 Catalog；已打开窗口可继续显示打开时选项；Raw 先落地；Initial Cleaning 最终复验；失效选项记为 `rejected_catalog_stale`，不进入 Application。

字段级更新和下游反应的统一规则见
`19_data_change_reaction_policy.md`。尤其是 Position：`id`、UUID 和已发布后的
Company 归属不允许普通原地改写；名称修正必须同时重算 normalized name；status
进入或离开 active 会改变 option-tree，必须创建新的 Catalog revision；JD 变化不
追溯重算已经发布的 ML 结果。原来 active 的 Position 若要把 JD 改成不足 10 字符，
同一受控命令必须显式把 status 改为 draft，不能让数据库猜测生命周期意图。

## 14. 与组员项目的差异

| 维度 | 新版 | 组员版 |
|---|---|---|
| Company 写入 | 仅受信任 Catalog importer | `findOrCreateCompany()` 根据提交文字自动创建 |
| Position 写入 | 受控 Catalog + lifecycle | `findOrCreateRole()` 自动创建 |
| Work Mode | 规范 Company Work Mode；无 Position 级表 | Application 自由 TEXT |
| Active 验证 | Initial Cleaning 验证 ID/active/ownership | 未发现同等机制 |
| 反向同步 | Revision + Outbox + 本次选中 targets | 当前只读取 Airtable/Google Sheets |
| 部分失败 | 每个实际目标独立状态 | 无持久化跨目标 run |
| 历史解释 | Catalog revision snapshot | 无发布 revision |

组员版 PDF 解析和来源读取可作为 Ingress adapter；自动创建 Company/Role 和自由文本 Work Mode 不进入权威 Catalog。

## 15. 与原版数据库的差异

1. 删除 Company industry/name alias/location、Position application cycle、Specific open window。
2. Company 增加 UUID、normalized name、active、nullable 默认总提交次数。
3. Position 增加 UUID、normalized name 和受控状态；JD、location 等可 NULL。
4. 删除 `experience_level_id`。
5. Company Work Mode 自由 TEXT 改为 G01 `work_mode_id`。
6. `position_work_mode` 移入 deferred。
7. Position status 使用单一五状态字段。
8. duration 保留一个 nullable `work_duration TEXT`。
9. Requirements 使用 required/preferred。
10. 新增 Catalog revision 和按选中渠道执行的两级同步运行表。
11. 不使用 Position application cycle；requested start year-month 属于 Submission/Dedup。
12. 新 Initial Cleaning 增加 Catalog ID/active/ownership 验证。

## 16. 缺失子实体规则

| 没有获得的数据 | 正确结果 |
|---|---|
| Company 联系方式 | `company_contact_info` 0 行 |
| Company Work Mode | `company_work_mode` 0 行；UI 使用 Company → Position |
| Position 地点 | `position.location_id = NULL` |
| Position JD | 可在 Draft/Paused/Closed/Archived 时为 NULL；进入 Active 前必须满足 JD readiness gate |
| Position salary/skills/education/certification requirements | 对应子表 0 行 |

## 17. 测试导出

建议只读生成：

```text
g02_catalog_active_option_tree.csv
g02_catalog_sync_audit.csv
```

CSV 只用于测试检查，不作为 Workflow 输入。

## 18. 当前已确认与待确认

已确认：

1. `default_max_submission_attempts` Schema 可 NULL，正式 Company importer 显式写 5（包括首次）。
2. Company 不保存 domain、logo、legal name。
3. Company 可有 0 条 Work Mode，此时 UI 使用 Company → Position。
4. `position_work_mode` 移入 deferred。
5. Position JD、Location 和 Requirements 可缺失，Active 不因此自动禁止。
6. duration 保留单个 nullable TEXT。
7. Company 联系方式不限三种；`contact_type_id` 可 NULL；首版不增加 `contact_label` 或未知类型替代条件。
8. Company 可有多个 primary contact。
9. Catalog 同步只为实际开放/选中的渠道创建 target row。
10. Raw 先落地，Initial Cleaning 再验证 Catalog。

待后续 Group 冻结：

1. G03 Raw 保存哪些 Catalog ID/名称/revision 快照；
2. G04 Outbox 字段和 sync run 外键；
3. Adapter 如何识别渠道开放及 target key；
4. Catalog importer 权限模型；
5. Position 发布服务最终验证清单。
6. 当业务需要按类型分类、路由或校验未知联系方式时，是否增加 `contact_label` 并回填 NULL `contact_type_id` 历史记录。
