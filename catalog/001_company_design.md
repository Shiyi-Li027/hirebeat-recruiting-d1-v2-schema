# Catalog 001：`company` 表设计与三方比较（Draft 1）

> 状态说明：本文件是早期 Company 单表审查记录。当前完整字段和约束已经合并进 `002_recruitment_catalog_draft.sql` 与 `002_recruitment_catalog_design.md`；组装最终 Schema 时不要重复执行 `001_company_draft.sql`。

## 1. 表的职责

`company` 是招聘目录中的权威公司实体。它回答：

- 哪些公司可以出现在 Airtable/Google Form 的申请选项中；
- 一个 `position` 属于哪家公司；
- Application 和 Offer 应引用哪个正式公司；
- Offer draft 应从哪里取得公司名称快照；
- 公司层默认允许多少次总提交机会。

它不负责保存：

- 某一次申请人原始提交的公司文本；
- 某个来源系统的 raw payload；
- 查重证据；
- 公司目录同步运行日志；
- Company 状态变化历史；
- Offer 中已经冻结的公司名称。

## 2. 字段逐项定义

### `id INTEGER PRIMARY KEY`

内部 D1 主键。所有同库 Catalog、Application、Offer 外键优先引用该字段。

- 必填：是，由 SQLite 生成。
- 可更新：否。
- 对外公开：否。
- 原版对应：`Company.id`。
- 组员版对应：`companies.company_id`。
- 新版变化：不使用 `AUTOINCREMENT`；对外身份由 `company_uuid` 承担。

### `company_uuid TEXT NOT NULL UNIQUE`

跨 Worker、Workflow、API、R2、Airtable、Google 和未来迁移使用的稳定公司标识。

- 由 Catalog 管理服务生成。
- 不能由申请导入流程临时生成公司 UUID。
- 创建后不可修改。
- 组员版不存在对应的统一字段。
- 原版不存在对应字段。

### `company_name TEXT NOT NULL`

招聘目录和候选人申请页面显示的标准公司名称，例如 `HireBeat`。

- 这是业务展示名称，不是 raw applicant text。
- 如果品牌名称变化，可以更新并修改 `updated_at`。
- 历史 Offer 不跟随更新，因为 Offer 保存自己的名称快照。
- 组员版对应 `companies.company_name`，但组员 Worker 会根据任何提交文本自动创建。
- 原版对应 `Company.company_name`。

### `normalized_company_name TEXT NOT NULL`

由版本化规范化函数生成的检索名称，例如大小写、首尾空格和 Unicode 规范化后的值。

- 主要用于管理端查重和查找，不作为申请人显示名称。
- 当前只建普通索引，不建唯一约束。
- 不建唯一约束的原因：不同合法实体可能归一化出相同文本，数据库不应自动把它们合并。
- 组员版每次查询执行 `LOWER(company_name) = LOWER(?)`，未保存明确的标准化结果。
- 原版没有对应字段。

### `company_website_url TEXT`

公司标准网站 URL。来自受信任 Catalog 管理，而不是申请表 raw text。

- 原版对应 `Company.company_website_url`。
- 组员版当前未写入。

### `company_linkedin_url TEXT`

公司 LinkedIn 官方页面 URL。

- 原版对应 `Company.company_linkedin_url`。
- 组员版当前未写入。

### `company_description TEXT`

公司业务简介，可用于招聘页面展示或未来 ML 辅助特征。

- 原版对应 `Company.company_description`。
- 组员版当前未写入。
- 不把申请人提交文本写进该字段。

### `is_active INTEGER NOT NULL DEFAULT 1`

决定公司是否可出现在新的岗位申请入口中。

- `1`：允许作为 active catalog 公司。
- `0`：不允许新的选择，但历史 Position、Application、Offer 仍保留引用。
- 使用 `CHECK (is_active IN (0, 1))`。
- 不使用删除 Company 来表达停用。
- 组员版没有 active 过滤；提交文本可能自动创建公司。
- 原版 `Company` 没有 `is_active`，因此不能直接可靠驱动实时表单目录。

### `default_max_submission_attempts INTEGER NOT NULL DEFAULT 5`

公司层默认的总提交次数上限，包括首次提交。

```text
1 = 首次
2 = 第一次重申
3 = 第二次重申
4 = 第三次重申
5 = 第四次重申
```

- 必须大于等于 1。
- Position 后续可以具有 override。
- Application 发布时冻结为 `max_submission_attempts_snapshot`。
- 修改 Company 默认值不会追溯改变已经存在的 Application。
- 组员版和原版均没有对应字段。
- 当前状态为 Draft：如果后续决定建立版本化 `recruiting_policy`，该字段可以被策略 FK 替代；但第一版采用它最简单。

### `created_at TEXT NOT NULL`

Company 首次创建时间，UTC ISO 8601。创建后不修改。

### `updated_at TEXT NOT NULL`

Company 任一可变权威字段发生变化的时间，包括名称、描述、active 状态或默认提交次数。

## 3. 索引和约束

### 已确定

```text
PRIMARY KEY(id)
UNIQUE(company_uuid)
CHECK(is_active IN (0,1))
CHECK(default_max_submission_attempts >= 1)
CHECK(non-empty UUID/name/normalized name)
INDEX(normalized_company_name)
INDEX(is_active, company_name)
```

### 暂不建立

- 不建立 `UNIQUE(company_name)`。
- 不建立 `UNIQUE(normalized_company_name)`。
- 不为所有 URL 单独建立索引。

原因是这些字段的真实唯一性尚未得到业务保证。过早加入唯一约束会让合法公司记录无法写入，而且后续放宽唯一约束通常需要更复杂的 migration。

## 4. Company 状态变化

Company 第一版不需要完整状态机，只有当前 active 标志：

```text
is_active: 1 → 0
is_active: 0 → 1
```

状态更新服务必须：

1. 条件更新 Company 和 `updated_at`；
2. 在同一个 D1 `batch()` 中写 `catalog_options_sync_requested` Outbox；
3. 后续 Catalog sync adapter 更新 Airtable/Google Form 的可选目录；
4. 已打开的原生表单窗口不保证真正的独立快照；提交时仍重新验证 Company active 状态。

不使用 SQL Trigger 发起同步。

## 5. 组员版的具体差异

### 5.1 Catalog 权威性

组员代码：

```text
findOrCreateCompany(companyName)
→ LOWER(company_name) 查找
→ 找不到就 INSERT companies(company_name)
```

新版：

```text
申请入口只提交已存在的 company_id/company_uuid
→ Workflow A 验证存在且 active
→ 找不到或 inactive 时 rejected_catalog_stale
→ 申请导入绝不自动创建 Company
```

这防止以下值进入正式目录：

- 拼写错误；
- 表单旧选项；
- 申请人手工修改的名称；
- 未经招聘方批准的公司；
- 同一公司因大小写/空格产生的重复记录。

### 5.2 数据粒度

组员版 Company 当前主要只有名称，并把 Company/Role 创建嵌在单条申请处理函数中。新版 Company 是独立 Catalog 生命周期，由 Catalog 管理和同步流程维护。

### 5.3 原子性与错误处理

组员 Worker 的 Company、Role、Applicant、Application、Submission 写入是多次独立数据库调用；后续失败可能留下部分实体。新版申请流程只验证 Company，不在申请事务中创建共享 Company，因此避免补偿清理共享目录实体。

### 5.4 表单反向同步

组员代码只读取 Airtable 和 Google Sheets，没有 D1 Company 状态变化后更新 Airtable/Google Form 选项的逻辑。新版通过 Catalog Outbox + target sync run 设计补齐该能力。

## 6. 原版的具体差异

### 6.1 字段范围

原版 `Company` 包含：

```text
industry/funding/revenue/review/size/founded year/social URLs/keywords
```

新版第一阶段只保留当前 Workflow、申请目录、Offer 和可预见 ML 使用的字段。尚未导入、没有可靠来源的融资、收入、评论评分等字段暂不进入新表。

### 6.2 删除的周边表

按照已经确认的决定，新版删除：

```text
Company_industry_code
Company_name_aliases
Company_location
```

保留并将在后续逐表设计：

```text
company_contact_info
company_work_mode
```

### 6.3 Application 公司关联

原版 Application 的 `company_id` 是 ML/catalog 匹配结果，同时另存 `applied_company_name`。新版申请页面提交受控 Company ID，因此不再进行公司名称 ML 模糊匹配。

### 6.4 Active 状态

原版缺少 Company active 字段，无法直接回答“这个公司现在能否出现在申请页面”。新版 `is_active` 是 Catalog API 和表单同步的核心过滤条件。

## 7. 写入所有权

允许写 `company` 的组件：

- Catalog administration service；
- Catalog import/backfill service；
- 受控 Company update Workflow。

禁止直接写 `company` 的组件：

- Airtable/Google raw submission adapter；
- Workflow A 的申请 normalization step；
- dedup step；
- ML Workflow；
- Offer Workflow。

这些组件只能读取并验证 Company。

## 8. 失败和补偿

- Company update 和 Outbox INSERT 位于同一个短 D1 `batch()`：任一失败则共同回滚。
- Airtable/Google 同步失败不回滚 Company，因为 D1 是权威来源；Outbox 保持 retry/dead-letter 状态。
- 不删除已经被 Position、Application 或 Offer 引用的 Company。
- 错误创建且尚未被引用的 Company 也优先设 `is_active = 0` 并审计，而不是直接删除；是否允许物理清理由后续管理策略决定。

## 9. 当前待用户确认

在正式冻结 `company` 前仍需确认：

1. `default_max_submission_attempts` 是否确定直接存 Company；
2. 当前保留的企业档案字段是否足够，是否还需要 `company_keywords`；
3. Company normalized name 是否确认只建普通索引、不设唯一约束。

## 10. 已确认删除的字段

以下字段不进入新版第一版 `company`：

```text
company_domain
company_logo_url
company_legal_name
```

删除原因：

- 当前申请目录、查重、招聘 Workflow 和 ML 不依赖这些字段；
- 当前没有已经确认的权威数据来源；
- 避免为未来假设提前扩大第一版 Schema；
- 三者以后均可通过新增 nullable column 或独立实体进行扩展。

Offer 创建时，当前先将 `company.company_name` 冻结到 Offer 自己的公司名称快照字段。未来若正式 Offer 必须使用签约法人名称，应增加明确的法律实体数据来源和字段，不应将未经核实的品牌名称伪装成法律名称。
