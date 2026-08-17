# HireBeat 新版 D1：全部 Group 确认与结构审计报告

审计日期：2026-08-17  
状态：`all groups reviewed`

## 1. 最终分组结果

| Group | 范围 | 首版表数 | 最终状态 |
|---|---|---:|---|
| G00 | 全局 Schema 规范 | 0 | confirmed |
| G01 | 共享 Reference 与人才分类 | 21 | confirmed |
| G02 | Company/Work Mode/Position Catalog 与目录同步 | 11 | confirmed |
| G03 | Ingress、Raw Submission、Raw Resume | 3 | confirmed |
| G04 | Workflow、Step、Attempt、Outbox、Audit | 5 | confirmed |
| G05 | Normalization 与 Resume 结构化提取 | 8 | confirmed |
| G06 | Dedup 与 Application 准入 | 3 | confirmed |
| G07 | Person、Application、Candidate Core | 7 | confirmed |
| G08 | Candidate/Person 人才档案 | 11 | confirmed |
| G09 | 实时 ML 分析与 Recommendation | 5 | confirmed |
| G10 | Hiring Pipeline 与实际 Stage 运行 | 5 | confirmed |
| G11 | Offer 生命周期 | 3 | confirmed |
| G12 | 未来扩展 | 0 | 11 deferred objects confirmed |
| G99 | 旧表删除/替代台账 | 0 | 22 removed objects confirmed |

首版 `CREATE.sql` 的冻结表数：

```text
21 + 11 + 3 + 5 + 8 + 3 + 7 + 11 + 5 + 5 + 3 = 82
```

## 2. 本次统一确认时修正的矛盾

### Raw Resume 为 NULL 的处理

最终规则：终结性 `no_resume`、`parse_failed_terminal` 或短文本仍忠实创建 `raw_submission` 与 `raw_submission_resume`，Ingress 状态为 `succeeded`。Workflow A Initial Cleaning 记录 Block，不创建 `submission_normalized`。

因此删除 G03 `rejected_input` 状态，避免同一份设计一处要求保存 Raw、另一处又在 Raw 前拒绝。

### 表单目录层级

最终首版：

```text
Company → 可选 Company Work Mode → Position
```

Company 没有 active Work Mode 时允许退化为 Company → Position。`position_work_mode` 留在 G12，不参与首版列表。

### 金额命名

固定 cents 的旧字段可以保留 `_cents`；新建的多币种 Offer 条款使用 `_minor_units + currency_code + period`，避免假定每个币种的最小单位都叫 cents。

### G02 数量

确认 G02 是 11 张表，不是旧 Master 文本误写的 12 张；`position_work_mode` 不计入 initial。

## 3. G12 / G99 结论

- 11 张 deferred 表不进入首版 Schema；满足明确触发条件后单独 migration。
- 22 张 removed 表不进入首版 Schema；不能未经重新设计直接恢复旧定义。
- Deferred 和 Removed 都不会被任何首版 importer/Workflow 写入。
- 测试 CSV 不创建假记录来模拟未启用能力。

详细依据见 `12_deferred_and_removed_review.md`。

## 4. 自动结构审计结果

按正式依赖顺序在全新 SQLite 内存库执行 G01–G11 当前 SQL：

```text
schema files executed:                11
actual initial tables:                82
inventory initial tables:             82
explicit indexes:                     117
inventory tables missing from schema: 0
schema tables missing from inventory: 0
foreign-key parent-key errors:         0
DML prepare foreign-key mismatches:    0
PRAGMA foreign_key_check violations:   0
```

额外审计方法：对每一个 FK 检查 parent table 是否存在、被引用字段是否为主键或唯一键；并对 82 张表分别准备 `EXPLAIN DELETE`，捕捉空库 `foreign_key_check` 可能无法暴露的 SQLite `foreign key mismatch`。

## 5. Inventory 最终状态

```text
confirmed initial: 82
deferred:          11
removed:           22
total inventory:  115
```

Inventory 中已经没有 `draft` 或 `proposed` 表。

## 6. 仍未执行的下一阶段工作

“Group 已确认”表示表、字段、约束和业务边界可以进入最终 Schema；不表示生产部署已经完成。后续仍需要：

1. 按依赖顺序组装一份正式、单文件、无重复表的 `CREATE.sql`；
2. 把 reference seed 与 13 个 Pipeline Stage seed 作为可重复运行的 seed/migration 管理；
3. 建立 migration manifest/version；
4. 在 D1 local/preview 环境运行完整 Schema；
5. 编写 Workflow A/B、Ingress、Catalog sync、Offer command 的表级实现；
6. 为每个写入动作测试首次运行、相同幂等键重跑、并发唯一冲突、瞬态失败重试、terminal failure 和 compensation；
7. 使用 `EXPLAIN QUERY PLAN` 再审核非关键索引，而不是继续无依据增加索引；
8. 准备空库、第一条 Submission、重复技术投递、合法业务重申、被 supersede 的旧 Workflow、ML no-offer、ML Offer、Offer 状态转换等端到端测试。

## 7. 安全阻断项

组员附件中出现过明文 Airtable token 和 Google service-account credential。任何部署前必须撤销/轮换，并迁移到 Cloudflare Secrets。旧凭据不能进入最终 Git repository、Schema、seed、CSV、错误日志或文档示例。
