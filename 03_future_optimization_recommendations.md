# HireBeat 新 D1 数据库与 Workflow 未来优化建议

版本日期：2026-08-17  
用途：记录已讨论但明确不进入首版 Schema/Workflow 的能力。只有出现真实数据、业务需求和验证结果后，才通过 migration 与新版 Workflow 引入。

## 1. ML 多模型版本与部署治理

首版固定使用 `all-MiniLM-L6-v2`，不创建 `ml_model_version` 或 `ml_feature_pipeline_version`。

未来出现多 embedding model、shadow evaluation、历史回测、champion/challenger，或 artifact/feature/preprocessing 需要正式版本治理时再增加。未来实现必须保证：终态 Application 不因模型升级自动重新决策；shadow/回测结果只能 advisory；一个 Application 最多一个正式决定和一条 Offer；已启动 Workflow 使用冻结版本。

## 2. KMeans Candidate Profile Clustering 与 PCA

首版实时每次处理一条 Application，KMeans/PCA 不参与 Offer 决策，因此不运行也不入库。

未来只有在存在明确冻结 cohort、招聘方需要群体分析、且聚类被证明支持真实业务时，才增加离线 analytics workflow 和 `ml_profile_cluster_result`。PCA 只作为可视化，不作为录取依据。

## 3. Rule-based Scorecard

旧版加权 Scorecard 具有主观权重且最终未参与 Offer 判断，因此首版删除 `ml_scorecard_result`。

未来只有在权重经招聘方正式确认、有标签或人工评估验证、完成公平性与稳定性检查，并明确 advisory/正式权限后才恢复。

## 4. Group Top Ratio、排名与冻结 Cohort

首版实时决策只使用 fixed similarity threshold，不保存：

```text
group_top_ratio
selection_ratio
round_up_selection
group_size
selected_count_in_group
rank_within_group
selection_ratio_snapshot
```

未来若恢复，必须定义 cohort 开始/关闭/冻结时间、统一决策时点、取整和最低人数、后到申请影响，以及禁止相对排名覆盖已创建 Offer。旧版 CSV 只作为历史实验材料。

## 5. Resume/JD 长文本分块 Embedding

当前继续使用原版完整 Resume/JD 输入。未来建议把 Resume 按 Education/Employment/Skills/Projects 分块，把 JD 按 Responsibilities/Requirements/Skills 分块，分别 embedding 后按经过验证的业务权重合成。

该方案必须先与当前基线做离线比较，确认准确性、成本和延迟收益后再进入生产。
