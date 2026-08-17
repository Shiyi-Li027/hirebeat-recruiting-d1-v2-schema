# Group G09：实时 ML Anomaly、Similarity 与 Recommendation（Confirmed）

版本日期：2026-08-17  
对应 SQL：`009_machine_learning_draft.sql`  
状态：`confirmed，Revision 1`

## 1. 已确定的首版业务边界

首版生产 Workflow B 只运行：

```text
固定 all-MiniLM-L6-v2
→ ML anomaly 检查
→ clean Application 的 Resume/JD embedding
→ cosine similarity
→ fixed similarity threshold policy
→ offer / no_offer
```

首版不运行、不建正式结果表：

- KMeans candidate profile clustering；
- PCA 可视化；
- 主观加权 Scorecard；
- group top ratio；
- Candidate 最终排名；
- 多模型版本、shadow evaluation 或历史模型回测。

这些能力不是永久否定，而是全部进入数据库未来优化清单。只有产生真实业务需求并验证有效后，才通过 migration 增加。

## 2. 首版五张表

| 表 | 作用 | 是否直接影响正式决定 |
|---|---|---:|
| `ml_threshold_policy` | 保存 reference/global/company/position 固定阈值政策 | 是 |
| `ml_analysis_run` | 保存一次 ML 技术执行、输入 hash、固定模型信息和 fence | 间接 |
| `ml_anomaly_result` | 保存异常命中情况以及是否直接排除 | 是 |
| `ml_similarity_result` | 保存 clean Application 的 cosine score | 是 |
| `ml_recommendation_result` | 保存并发布一个 Application 唯一的最终 ML recommendation | 是 |

## 3. 为什么首版不创建 model version 表

当前只有一个正式模型：

```text
model_name = all-MiniLM-L6-v2
model_provider = sentence_transformers
```

首版不建立：

```text
ml_model_version
ml_feature_pipeline_version
```

但每个 `ml_analysis_run` 仍冻结模型名称、provider、可选 revision、模型配置 JSON、pipeline code、pipeline source code SHA-256、anomaly rule version，以及 Resume、JD 和完整输入 snapshot hash。

因此当前决定仍然可以复现和审计，只是暂时不支持同一新数据库并行管理多个模型版本。未来需要多模型、shadow evaluation 或历史回测时，再增加正式版本表和 deployment 机制。

## 4. Threshold policy 仍需保留版本

“不支持多个 ML model version”不代表阈值永远不能调整。模型可以保持不变，但招聘方可能把阈值从 `0.35` 调整为 `0.38`。

因此 `ml_threshold_policy` 仍保留 policy family/version/status、supersedes、effective/retired 和 updated 时间。生效政策不原地覆盖阈值：

```text
旧 policy → retired
新 policy → 新增 version 并 active
```

首版唯一方法：

```text
match_score >= match_score_threshold → offer
match_score <  match_score_threshold → no_offer
```

政策选择优先级：

```text
Position active policy
→ Company active policy
→ Global default active policy
```

七档 reference mapping 作为 seed/reference rows：

| band | threshold | expected retention |
|---|---:|---:|
| `very_loose` | 0.24 | 70% |
| `loose` | 0.28 | 60% |
| `standard` | 0.32 | 50% |
| `moderate` | 0.35 | 40% |
| `strict` | 0.38 | 30% |
| `very_strict` | 0.42 | 20% |
| `highly_selective` | 0.47 | 10% |

`expected_retention_ratio` 只是参考解释，不代表系统运行时计算或保证组内百分比。

## 5. Analysis、Anomaly、Similarity 与 Recommendation

### `ml_analysis_run`

一行表示一个 Application/Candidate 输入的一次 ML 技术执行。它保存 Application/Candidate/Person/Workflow、幂等键、Application fence、固定模型和 pipeline 信息、输入 hashes、非长文本 feature snapshot、状态和技术错误。

`(candidate_snapshot_id, application_id, person_id)` 使用复合外键，数据库会同时验证三者属于同一条业务链，而不只是分别验证三个 ID 都存在。

它不保存 Resume/JD 长文本，也不保存 embedding vector。相同 Application 和相同 input snapshot 只能有一个 run；技术重试复用同一幂等运行。

### `ml_anomaly_result`

Anomaly 会直接改变正式决定，所以必须保存依据。首版继续使用已经运行过的规则：

```text
resume_missing_or_too_short
candidate_profile_almost_empty
senior_role_but_no_employment_history
```

无 anomaly 才继续 similarity；任一 anomaly 直接 `excluded_no_offer`，不创建 similarity row。

### `ml_similarity_result`

只有 clean Application 创建一行，保存 Application/Candidate/Position、cosine score、metric 和计算时间。模型及输入 hashes 已在 parent analysis 中冻结，不重复保存。

### `ml_recommendation_result`

首版不做多模型重评，因此：

```sql
application_id INTEGER NOT NULL UNIQUE
```

Anomaly 路径不需要 similarity 或 threshold policy；Similarity 路径必须冻结 score、threshold、passed flag 和 policy ID。

Recommendation 与 Hiring ML stage、Application 最终决定、条件性 Offer draft 和下一条 Outbox event 在 Workflow B 最终短事务中共同发布。Recommendation 另外提供 `(id, application_id)` 唯一父键，供 G11 用复合外键证明 ML 结果与 Offer 属于同一 Application；G11 还会对 `offer.application_id` 建 `UNIQUE`，双层防止同一 Application 创建多份 Offer。

已是 `rejected` 或 `offer_created` 的终态 Application 不重新运行正式 ML。合法重申创建新的 Application/Candidate，而不是重新决定旧 Application。

## 6. 已从首版删除并移入未来优化

不再创建：

```text
ml_model_version
ml_feature_pipeline_version
ml_profile_cluster_result
ml_scorecard_result
```

不再保存：

```text
group_top_ratio
selection_ratio
round_up_selection
group_size
selected_count_in_group
rank_within_group
selection_ratio_snapshot
```

PCA 也不进入实时生产流程或数据库。

## 7. 与组员项目的本组差异

| 项目 | 组员版 | 新版 G09 Confirmed Revision 1 |
|---|---|---|
| ML | 无 | Anomaly + MiniLM embedding + cosine + threshold |
| PDF/Text | 负责 PDF→text | 使用上游文本，不重复保存 |
| 决策依据 | 无 | Anomaly 或固定 threshold，均可审计 |
| 实时安全 | 无 | idempotency + Application fence + final D1 batch |
| Offer | 无 | G09 与 G10/G11 原子发布 |

## 8. 与原版数据库和 Colab 的本组差异

| 项目 | 原版 | 新版 G09 Confirmed Revision 1 |
|---|---|---|
| 输入 | ML 宽表 CSV | 直接读取 D1 Application/Candidate/Profile/JD |
| KMeans/PCA | 批次实验或可视化 | 实时生产删除 |
| Scorecard | 计算但不参与最终选择 | 删除正式计算和结果表 |
| Similarity | CSV match_score | D1 不可变 score + parent input hashes |
| Pick | 当前 CSV 内 top ratio | 固定 threshold，无最终排名 |
| Threshold | 代码/换算表 | 全局、公司、岗位政策表 |
| 模型 | CSV metadata | 首版固定单模型，每次 run 冻结模型/代码信息 |
| Recommendation | CSV 后再导入 | 与 Application/Offer 最终事务共同发布 |

## 9. 已确认决定

1. 首版 G09 从 9 张表缩减为 5 张；
2. 首版固定使用 `all-MiniLM-L6-v2`；
3. 不创建 model/pipeline version 表，但 analysis run 冻结模型、配置和代码 hash；
4. threshold policy 仍保留政策版本和 `updated_at`；
5. 首版只支持 fixed similarity threshold；
6. 七档 mapping 作为 reference seed；
7. KMeans、PCA、Scorecard 退出实时 Workflow B；
8. Anomaly 继续直接决定 `no_offer`；
9. clean Application 才产生 similarity；
10. 不保存 embedding vector、Resume 或 JD 副本；
11. 每个 Application 只有一条正式 recommendation；
12. Recommendation、Application 决定和条件性 Offer draft 在最终短事务共同发布；
13. 多模型、shadow evaluation、历史回测、group ratio 和排名进入未来优化清单。
