# HireBeat 新版 D1 数据库全局 Schema 规范（Confirmed Revision 1）

版本日期：2026-08-13  
适用范围：新版 Cloudflare D1 数据库、实时单条申请 ETL、批量回填、Airtable/Google Form 接入、ML 招聘决策与 Offer 生命周期。

## 1. 三方基准

本设计持续比较三个实现：

1. **新版设计**：当前正在设计的单一权威 D1 数据库和生产级 Workflow。
2. **组员版**：以 `worker.js` 的实际行为为主，`D1 worker_parser_documentation.docx` 与 `readme (4).md` 为辅助说明。
3. **原版**：以 `Create_schema_2026-08-04.sql`、`chaojiwudiniubidaima (11).ipynb` 以及已成功运行的 Colab 导入代码为依据。

当文档与代码冲突时，实际代码是事实依据。例如组员文档声明“一条 Application 可以有多条 Submission”，但 `worker.js` 的当前实现对每条来源记录都先创建新的 `applications`，再创建新的 `application_submissions`，实际并没有复用旧 Application。

## 2. 命名规范

### 新版决定

- 所有正式表、字段、索引和约束使用 `lower_snake_case`。
- 表名使用单数业务实体名，例如 `company`、`position`、`application`、`offer`。
- 桥接表使用两个实体名称，例如 `candidate_skill`。
- 外键字段统一使用 `<target_table>_id`。
- 稳定公共标识使用 `<entity>_uuid`。
- 状态字段使用 `<entity>_status` 或语义明确的 `status`，不使用含义模糊的 `state`。
- 原始字段使用 `raw_`，标准化字段使用 `normalized_`，业务权威字段不额外添加 `canonical_`，除非同一表同时保存多个候选值。
- 金额使用最小货币单位。仅在业务明确限定为 cents 时使用 `_cents`；支持多币种的字段使用更准确的 `_minor_units`，并同时保存 currency code 和 period。
- 时间点使用 `_at`，业务日期使用 `_date`，年月使用 `_year_month`。

### 与组员版不同

- 组员版使用小写复数表名（`companies`、`roles`、`applications`）；新版使用小写单数。
- 组员版使用 `role` 表达招聘岗位；新版继续使用业务语义更明确、与原版一致的 `position`。
- 组员版部分主键命名为 `company_id`、`role_id`；新版每表主键统一为 `id`，外部引用字段才使用 `company_id`、`position_id`。

### 与原版不同

- 原版主要使用首字母大写的单数表名和双引号，例如 `"Company"`、`"Application"`。
- 新版取消依赖大小写和大量引号的命名方式，降低 Worker SQL、migration 和手工查询的书写复杂度。
- 这是命名重构，不改变业务实体的含义；旧数据迁移时必须使用明确映射，不能只做大小写替换。

## 3. 主键与稳定 UUID

### 新版决定

每个核心业务实体采用：

```sql
id INTEGER PRIMARY KEY,
<entity>_uuid TEXT NOT NULL UNIQUE
```

- `id`：D1 内部 JOIN 和外键使用，体积小、查询简单。
- UUID：跨 Worker、Workflow、Airtable、Google、R2、日志、迁移与 API 使用。
- UUID 由服务端或受信任入口生成；来自前端的 UUID 必须做格式验证。
- 默认不使用 `AUTOINCREMENT`。SQLite 的 `INTEGER PRIMARY KEY` 已能生成 rowid；核心记录依靠 UUID 保持跨系统稳定身份。
- 不允许把数据库整数 ID 当作公开 API 的唯一永久身份。

### 与组员版不同

- 组员版当前主要依赖整数 ID 和来源系统 record ID，没有统一的跨层业务 UUID 方案。
- 组员版 Google Sheet 使用 `google:<spreadsheetId>:<rowNumber>` 作为模拟来源 ID；新版认为裸 row number 会因插入、删除或排序而不稳定。首选持久化 response UUID；暂时无法取得时至少组合 spreadsheet、sheet identity 和 row number，并记录为 Adapter 技术债务。`source_event_key` 不替代全局 `submission_uuid`。

### 与原版不同

- 原版几乎所有表都使用 `INTEGER PRIMARY KEY AUTOINCREMENT`，没有为大多数核心实体提供稳定 UUID。
- 新版减少 `sqlite_sequence` 依赖，并为跨系统引用增加 UUID。

## 4. 时间规范

### 新版决定

- 所有系统时间统一保存 UTC ISO 8601 文本，例如 `2026-08-13T19:20:31Z`。
- 核心可变记录包含：

```sql
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

- 不依赖 D1 `CURRENT_TIMESTAMP` 产生格式；由 Worker 的统一时间函数写入。
- `created_at` 创建后不更新。
- `updated_at` 只在该行实际变化时更新。
- 不给纯 append-only 事件强制增加 `updated_at`；但 Outbox、Workflow run、目录等可变状态记录需要它。

### 与组员版不同

- 组员代码对不同表的时间字段覆盖并不统一，且运行状态主要直接更新 `application_submissions`。
- 新版区分来源时间、业务时间、运行时间和状态更新时间。

### 与原版不同

- 原版大量字段使用 `TEXT`，但没有一份统一、强制执行的 UTC/格式规范。
- 某些原版表的 `created_at`/`updated_at` 可为 NULL；新版核心表将其设为必填。

## 5. NULL 与 NOT NULL

### 新版决定

必须 `NOT NULL`：

- 主体归属 ID（同层 parent-child 关系）；
- UUID、幂等键和来源事件键；
- 状态、版本号；
- 核心目录名称；
- `created_at`；
- 可变权威记录的 `updated_at`。

允许 NULL：

- 简历中没有提取到的电话、URL、日期、GPA、描述；
- 可选 ML 映射或可选外部对象 ID；
- 错误发生前不存在的完成时间；
- 尚未产生的 superseded/approved/issued 指针和时间；
- 非必要的企业档案扩展字段。

不使用空字符串、`unknown` 或 placeholder 代替缺失值。

### 缺失子实体与空子记录规则

已确认采用以下全数据库规则：

1. 完全没有获得某类业务子实体时，对应子表保存 0 行，不创建全空占位记录。
2. 子实体确实存在、但其中某个可选属性缺失时，创建子实体行，并把该可选字段保存为 `NULL`。
3. 该规则递归适用于子表的子表以及更深层关系。
4. 桥接表只有在两端实体都存在时才创建；桥接表两端 parent ID 必须 `NOT NULL`。
5. 每张业务子表在逐表设计时必须定义“最低准入条件”。未满足最低条件的解析结果停留在 extraction/audit 层，不发布成正式业务实体。
6. 没有业务输出的原因保存在 Workflow/extraction 的 status、result code、record count 或 error 字段中，不用空业务记录表达。
7. Workflow run、step run、step attempt、normalization run、dedup run 和 audit event 等运行控制记录按“是否发生过执行/事件”创建，不按“是否产生业务子记录”创建。
8. Application、Candidate snapshot、Offer 等核心生命周期关系在进入对应 published 状态前单独验证；这不意味着 Education、Employment、Project、Skill 等可选子集合必须至少有一行。
9. Raw 层忠实保留来源实际发送的字符串；如果来源真的发送空字符串、`unknown` 或 placeholder，Raw 可以保留原值。Normalized/published 层必须将确认属于缺失占位的内容转换为 `NULL` 或拒绝发布，并把原因记录到状态/错误字段。
10. 查询可选子集合时默认考虑使用 `LEFT JOIN`，避免没有 Education 或 Employment 的合法 Candidate 被错误过滤。

示例：

```text
完全没有可靠 Employment
→ person_position 0 行
→ candidate_position 0 行
→ employment extraction status = no_valid_record

存在 Employment，但没有 Location
→ 创建 person_position
→ person_position.location_id = NULL
→ 不创建 location 行

简历下载失败
→ raw/normalized resume text 不填“提取失败”占位文字
→ resume_parse_status = failed
→ error_code 保存非敏感失败原因
```

数据库实现原则：子表记录一旦存在，其 parent ID 应为 `NOT NULL + FK`；可选下级引用（例如提取型 `location_id`）允许 `NULL`；跨表“至少一个子记录”要求不能由 SQLite 单行 `CHECK` 实现，应在发布服务的条件验证和短 `batch()` 中保证。

### 三方差异

- 组员版倾向在最小表结构上直接写入，数据库层约束证据不足，部分完整性主要依赖代码。
- 原版部分 published 业务表约束较强，但也存在例如所有 `Position` 必须具有 `function_id`、所有 Application 必须具有映射公司岗位等对输入过于理想化的要求。
- 原版部分导入流程通过 CSV/status 表达无输出，但没有形成一条覆盖所有子表层级的统一“零行而非空占位行”规则；新版将其提升为全局准则。
- 新版采用“raw/staging 较宽松、published 业务层严格”的分层约束。

### 约束、默认值与手写 SQL 的冻结治理规则

1. 保留数据库原生 `NOT NULL`、`CHECK`、FK 和 `UNIQUE` 作为所有写入者共同的最后防线。
2. 不给普通 `NOT NULL` 字段重复建立 Trigger；Trigger 只用于单列约束无法表达的、已经审核的跨字段不变量。
3. `DEFAULT` 只用于存在唯一、安全且不依赖上下文的初始值。身份、父级 ID、业务证据、事件结果和无法安全推断的状态不得由数据库猜测。
4. 正式 importer 必须在到达 D1 前返回字段级友好错误代码，并负责标准化、稳定 UUID/幂等键、时间与获准的业务推导。
5. 手写 SQL 是受控管理/修复通道，必须从 `schema/HIREBEAT_D1_MANUAL_INSERT_TEMPLATES.sql` 对应表模板开始，不允许使用空字符串、占位 ID 或 `unknown` 绕过必填规则。
6. `schema/HIREBEAT_D1_CONSTRAINT_DEFAULT_MATRIX.csv` 提供逐字段必填性、NULL、默认值、FK、唯一性、CHECK/Trigger、推导规则和常见失败；配套 Markdown 提供 84 张表的摘要。
7. `schema/status_field_policy.csv` 必须覆盖每一个 `status`、`*_status` 与 `is_active` 字段。Schema validator 对覆盖率、过期策略、NOT NULL、默认值及 Trigger allowlist 自动审计。
8. 新增状态字段或 Trigger 时，必须在同一次变更中更新策略文件、矩阵、设计文档和测试；否则验证失败。

## 6. 外键和 ON DELETE

### 新版决定

1. 同一业务层内保留外键。
2. `application` 到 `offer` 保留正式外键。
3. Submission 到 Application 的硬层级边界由 `application_source_lineage` 表表达；上游 Submission ID 在 lineage 中可以是普通 INTEGER，不强制跨层外键。
4. 每一个外键必须显式指定删除行为：
   - Workflow 专属子记录：`ON DELETE CASCADE`。
   - 共享 Catalog/reference：`ON DELETE RESTRICT`。
   - 缓存指针：`ON DELETE SET NULL`。
   - 已被 Offer 使用的 Application/Candidate：`ON DELETE RESTRICT`。
5. 业务历史优先使用状态关闭或 supersede，不进行物理删除。

### 与组员版不同

- 组员版表关系较少，并且 Worker 使用多次独立 INSERT；没有完整展示所有外键和删除行为。
- 新版不仅建立关系，还为每种关系定义生命周期和删除语义。

### 与原版不同

- 原版大量外键未显式定义 `ON DELETE`，实际默认为 `NO ACTION`。
- 新版不会对所有外键统一套用一种删除行为，而是按关系职责确定。

## 7. 状态机、Trigger、Outbox 与 Workflow

### 新版决定

- 状态机定义允许的业务状态和转换，由专门的 Worker/Workflow service 执行。
- 第一版仅保留 2 个已审核的 Position 跨字段保护 Trigger（分别保护 INSERT 和 UPDATE）：`position_status = 'active'` 时，trim 后的 `position_jd` 必须至少 10 个字符。Trigger 不承担 Workflow 编排。
- 跨步骤、Queue、外部 API、通知、Offer document 和 Workflow 交接使用 `outbox_event`。
- 同一短数据库发布动作使用 D1 `batch()`，共同成功或共同回滚。
- 跨多个 Workflow step 的失败使用幂等重试和业务补偿，不假装是一个长数据库事务。
- 每个 Workflow step 自包含、可重试、幂等。

### 与组员版不同

- 组员版使用一个 Worker 函数顺序执行来源读取、实体创建、查重、Submission 写入和简历解析。
- 当前没有持久化 Workflow run、step run、attempt、Outbox 或跨步骤补偿模型。
- 新版将入口适配、Workflow A、Workflow B 和 Offer 生命周期分成清晰边界。

### 与原版不同

- 原版主要通过独立 Colab cells 和 CSV 串联，运行历史依赖 notebook output 和人工顺序。
- 新版所有权威输入来自 D1，每个步骤结果进入对应表，测试 CSV 只是只读投影。

## 8. 幂等与来源身份

### 新版决定

`raw_submission` 同时保存：

```text
submission_uuid        全局业务提交标识
source_system          airtable / google_form / future_website
source_event_key       来源系统稳定幂等标识
payload_hmac           服务端 keyed HMAC，用于内容核对
```

唯一约束：

```text
UNIQUE(submission_uuid)
UNIQUE(source_event_key)
```

- UUID 防止同一业务事件因网络重试重复落库。
- `source_event_key` 标识来源系统中的同一个事件，防止 adapter 错误地为同一个 Airtable/Google 来源记录生成新 UUID；它不是申请内容查重 key。
- HMAC 是同一 source identity 内的内容核对，不设唯一约束，也不跨两个独立来源事件合并记录；合法重申即使内容相同仍分别进入 Raw。

### 与组员版不同

- 组员版 `wasAlreadySynced()` 只根据 `application_submissions.airtable_record_id` 检查；Google Sheet 记录也复用该字段保存模拟 ID。
- 新版明确拆分全局业务 UUID 与来源系统事件键。

### 与原版不同

- 原版依赖 `ingestion_batch_id + source_record_number` 和 CSV 文件 hash。
- 新版删除 `ingestion_batch`/`dataset_type` 作为实时入口前提，但仍允许批量 adapter 为每一条记录生成独立来源事件键和 Workflow run。

## 9. 发布、历史和 supersede

### 新版决定

- 不覆盖已经发布并参与决策的 Candidate snapshot、ML result、stage history 或旧 Application。
- 合法重申创建新的 Application、Candidate snapshot、ML result 和 stage history。
- Application 的生命周期状态与招聘决定状态分开建模：例如旧记录可以同时表达 `lifecycle_status = superseded` 与 `decision_status = rejected/pending`，不能用 supersede 覆盖历史决定。
- 旧 Application 标记生命周期 `superseded`，并保存替代关系。
- 新重申发布时，同时撤销旧 Workflow 的决策资格并通过 Outbox 请求 terminate。
- 每一个有副作用的旧 Workflow step 和最终 Offer batch 必须重新验证 Application 状态、Workflow owner 和 fence token。
- 已经 `offer_created` 的旧 Application 阻止自动重申进入 Application 层。

### 与组员版不同

- 组员版每条来源记录实际创建新的 Application，但没有正式 supersede、attempt number、lineage 或旧 Workflow 终止机制。
- 文档声称 Application 可复用多次 Submission，与实际代码不一致。

### 与原版不同

- 原版已具备 Candidate snapshot 和 stage history 的部分结构，但导入流程最初以一次性批量为主，未完整处理实时重申与并发旧 Workflow。
- 新版明确 `submission_attempt_number`，总提交上限包括首次共 5 次。

## 10. Catalog 权威来源

### 新版决定

- D1 的 `company`、`company_work_mode`、`position` 是首版权威目录；`position_work_mode` 已移入 deferred。
- 首版正确选择层级为 Company → 可选 Company Work Mode → Position。Company 没有 active Work Mode 时允许退化为 Company → Position；`position_work_mode` 已延后，不参与首版表单目录。
- 当前 Airtable/Google Form 近似采用“窗口加载一次、不主动刷新；新窗口读取最新目录；提交时最终验证”。
- 当前不承诺原生表单真正支持每用户独立 catalog snapshot。
- 后端最终验证 ID、归属关系和 active 状态。
- 无效目录选择保留在 raw/submission 审计层，业务结果为 `rejected_catalog_stale`，不进入 Application。

### 与组员版不同

- 组员 Worker 会根据提交文本自动 `findOrCreateCompany()` 和 `findOrCreateRole()`。
- 这会允许拼写错误、过期选项或非授权岗位污染正式 Catalog。
- 组员版没有 D1 → Airtable/Google Form 的反向目录同步。

### 与原版不同

- 原版 Application 导入使用 ML/catalog matching 结果关联 Company/Position，同时保存申请文本。
- 新版不再对前端选择的公司岗位进行模糊/ML 匹配，而是验证真实选择 ID。
- 原版 `Company` 缺少明确 `is_active`；新版将 active 状态作为表单目录过滤的核心字段。

## 11. 索引原则

### 新版决定

初建时只建立：

- 主键与 UUID 唯一索引；
- 幂等唯一键；
- 关键 parent-child 外键查询索引；
- Workflow pending/status 索引；
- Outbox pending/next-attempt 索引；
- 实时 dedup 分组和 identity hash 索引；
- 明确的业务唯一性约束。

普通报表索引等 Workflow 和查询 SQL 完成后通过 `EXPLAIN QUERY PLAN` 决定。无用索引可以使用 `DROP INDEX` 删除，但会增加写入和存储成本，因此不提前大量创建。

## 12. Schema 变更策略

- 新建表、增加 nullable column、增加/删除 index 通常容易。
- 改列名、增加某些列可以通过 D1/SQLite 支持的 `ALTER TABLE` 完成，但必须先验证版本能力。
- 修改既有列的类型、NULL、CHECK、外键或主键通常需要重建表、复制数据、验证并替换。
- 因此主键、核心外键、唯一幂等键、`ON DELETE` 和硬层级边界应在初建时确定。
- 每个 Schema 变化通过 migration 文件管理，不直接只在 D1 Console 临时修改。

## 13. 安全与凭据

- Google service account JSON、private key、Airtable token、HMAC key 和 API token 不进入 Git、Schema、CSV、日志或文档示例。
- 组员附件中的现有凭据必须撤销/轮换，不能直接部署到新版。
- 敏感配置使用 Cloudflare Secrets；非敏感 ID 使用 environment variables。
- 错误日志不得记录完整简历、完整 payload、access token 或 private key。

## 14. 已确认的全局收口事项

- `company.default_max_submission_attempts` 直接保存在 Company，Schema 允许 NULL，但正式 Company importer 默认明确写入 5；Application 再冻结当次采用值。未来政策复杂后迁移到版本化 recruiting policy。
- Company 名称不建立数据库唯一约束；只索引 `normalized_company_name`，避免真实不同公司归一化后误冲突。
- 第一版 Company 不保存 `company_domain`、`company_logo_url`、`company_legal_name`。Offer 暂以 Company 标准名称生成快照；未来需要法律文件时再增加权威法律实体数据。
- Catalog revision 和按实际打开渠道分别记录的 Airtable/Google Form sync run/target run 已在 G02 确认。
- 首版公共 UUID 使用受信任入口或服务生成并验证的 UUID v4；前端网页可用 `crypto.randomUUID()`，Airtable/Google adapter 对同一 source identity 必须复用首次生成的 UUID，不能在轮询重送时重新生成。
