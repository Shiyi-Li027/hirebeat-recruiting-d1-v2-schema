# HireBeat v2：剩余生产实现一次性决策清单

版本日期：2026-08-18
状态：D01-D15 已于 2026-08-18 全部冻结

本文只列出会实质改变后续代码、资源或生产行为且此前尚未冻结的事项。
已经确认的 82/84 表结构、R2、Outbox、Workflow A/B 边界、13 个招聘阶段、
重申、fence、Application lineage、ML anomaly/no-offer、固定阈值、Offer 原子
创建等决定不重复询问。

## 0. 已冻结、无需再次确认

- TypeScript Cloudflare Worker 是唯一生产 Ingress；根目录早期 JavaScript
  Ingress 将退出生产部署入口。
- Airtable attachment URL 与 Google Drive file ID 是首版 Resume PDF 来源。
- PDF bytes 先写私有 R2，再把同一 bytes 发送给 Parser。
- 不做失效 PDF URL → 来源 Resume text 的自动 fallback。
- Raw 即使没有可用 Resume text 也忠实落地；Workflow A Initial Cleaning Block。
- Initial Cleaning 不做语言门禁；有效 Resume text 少于 10 字符时 Block。
- `submission_normalized` 不复制 Resume text。
- Person 身份首版以 normalized email 为 canonical identity。
- 查重使用 company + position + requested start YYYY-MM，并扫描同组历史。
- 最多五次 Submission attempt，包括首次。
- 新的合法重申 supersede 旧 processing/rejected Application，并先旋转 fence。
- anomaly excluded 直接 `no_offer`；不进入 manual review。
- 不做 KMeans、PCA、主观 Scorecard、组内 Top-N 排名。
- ML 使用 `all-MiniLM-L6-v2`、完整 Resume/JD、cosine similarity 和
  `ml_threshold_policy`。
- ML 可以直接决定 rejected 或原子创建 Offer draft。
- Offer 保留 `application_id` 与 `candidate_snapshot_id` 正式外键。
- SQL Trigger 不作为跨步骤编排机制；可靠交接使用 Outbox。
- `position_work_mode`、Offer document、Offer approval table、多模型版本等保持 deferred。

## 0.1 2026-08-18 新冻结的生产选择

- `D01=A`：Airtable/Google push-first，并保留低频 reconciliation。
- `D02=A`：来源 automation UUID，缺失时使用稳定 UUIDv5 fallback。
- `D03=A`：Catalog revision 发布时同步当前启用的 Native Form target。
- `D04=A`：D1 管理 API 是 Catalog 权威写入口，允许受控 CSV backfill。
- `D07=A`：先继续使用现有 Render PyMuPDF Parser，并补齐认证与版本契约。
- `D08=A`：Education 为零行仍允许继续，不创建 placeholder。
- `D09=A`（已由后续确认修订）：Position JD 缺失或过短时进入
  `waiting_position_jd`，不调用 ML、不生成 `no_offer`；JD ready 后由 Outbox 重启。
- `D10=A`：使用独立 Python FastAPI `all-MiniLM-L6-v2` 推理服务。
- `D11=A`：全局默认 threshold 使用 `standard = 0.32`。
- `D12=A+`：内部 command API 使用 Cloudflare Access 的成员独立身份；所有获准
  测试成员首版拥有相同 Author 权限。Worker 必须验证 Access JWT 并从 token claim
  派生 actor；不信任客户端自报 actor header。服务间调用使用独立 service token。
- `D13=A`：CSV 仅按需只读导出，并使用仓库工作区内固定的 `test-exports/`
  根目录，按环境/日期/workflow run 归档；同一检查 run 的所有 CSV 放入同一个
  文件夹，同时生成 manifest。真实候选人/生产数据不进入 Git history；本地文件被
  Git 忽略，共享检查结果通过有保留期限的私有 GitHub Actions Artifact 提供。
- `D14=A`：使用 local + staging + production 三套环境；当前已创建的远程 D1/R2
  定义为 staging，端到端验证通过后另建 production 资源。
- `D15=A`：Native source 使用版本化显式字段映射和有限 alias；fuzzy matching 只用于
  离线诊断，不得静默决定生产 Raw 映射。

## D01. Airtable / Google Form 如何触发 Ingress

### 推荐选择：A

**A. Push-first + 定时 reconciliation（推荐）**

- Airtable Automation/Webhook 在新记录创建后调用 Airtable Adapter；
- Google Apps Script `onFormSubmit` 调用 Google Form Adapter；
- 另设低频 reconciliation poller，只补偿漏掉的事件，不作为正常入口；
- Adapter 调用统一的 TypeScript canonical Ingress。

优点：接近实时、正常路径读取量低、仍能修复 webhook/automation 漏投。

**B. 只使用定时 Poller**

继续类似组员代码定时分页扫描 Airtable/Google Sheet。实现较简单，但不是严格
实时，会重复读取历史行，并更依赖同步游标。

已确认：`D01=A`。

## D02. Native Form 无法可靠在浏览器端生成 UUID 时的规则

此前已确认优先使用提交端生成的 `submission_uuid`。但 Airtable Form 和
Google Form 原生页面不能稳定运行我们的 `crypto.randomUUID()` 代码。

### 推荐选择：A

**A. Source automation 生成 + deterministic fallback（推荐）**

- Airtable Automation / Google Apps Script 首次收到记录时生成 UUID 并回写；
- 如果回写前发生技术重送，Adapter 使用固定 namespace 对
  `source_system + source_record_id` 生成 UUIDv5；
- 后续所有重送必须复用该 UUID。

**B. 强制来源表预先存在 UUID 字段**

缺失 UUID 就 terminal failure，不提供 fallback。规则简单，但来源 Automation
偶发失败会阻止 Raw 落地。

已确认：`D02=A`。

## D03. Catalog 选项何时同步到原生表单

Airtable Form / Google Form 没有可靠的“每个申请人打开窗口时调用 D1”hook，
因此无法严格实现每次 open 都读取 D1 并为该用户冻结独立 revision。

### 推荐选择：A

**A. Catalog revision 发布时同步（推荐）**

- D1 active Company/Company Work Mode/Position 有效选项变化；
- 发布新的 `catalog_revision`；
- Outbox 只同步当前启用的 Airtable/Google target；
- 用户打开表单时看到最近成功同步的 revision；
- 提交后 Raw 仍先落地，Initial Cleaning 再重新验证 ID/归属/active。

**B. 建立自有 wrapper 页面**

Wrapper 打开时读取 D1、记录 revision、再跳转或代理 Native Form。更接近原先的
per-open freeze，但已经属于第一方网页能力，会明显扩大当前范围。

已确认：`D03=A`。

## D04. Company / Work Mode / Position 权威 Catalog 的写入来源

### 推荐选择：A

**A. D1 管理 API + 受控 CSV backfill（推荐）**

- D1 始终是权威目录；
- 管理 API 支持创建、更新、停用与发布 revision；
- 首次数据可通过受控 CSV/import command 导入；
- Airtable/Google 只是 Catalog consumer，不反向创建 Company/Position。

**B. 指定一张 Airtable Catalog base 为上游权威**

Worker 把 Airtable Catalog 同步进 D1，再由 D1 发布 revision。需要额外 base/table
和字段映射，并会形成两个 Catalog 管理面。

已确认：`D04=A`。

## D05/D06. 新库数据来源（已冻结，不再询问）

已确认完全不迁移旧版数据库中的任何 Reference、Catalog、Submission、Application、
Candidate、ML、Hiring 或 Offer 数据。v2 新库从空业务数据开始，所有新数据通过新版
Reference/Catalog importer 和实时 Submission Ingress 逐条重新导入。旧库不属于 v2
部署、回滚或 reconciliation 范围。

真实 API token 不写进回答或仓库，只通过 Cloudflare/GitHub Secrets 配置。

## D07. Resume Parser 首版部署目标

组员当前 Parser 地址和 PyMuPDF 路径可以作为兼容起点，但生产前需要健康检查、
认证、版本返回、timeout 和错误契约。

### 推荐选择：A

**A. 继续使用现有 Render Parser，先加认证与版本契约（推荐）**

最快复用已跑通逻辑；代码支持以后切换 endpoint。

**B. 新建独立 Parser service/container**

从第一天独立部署，但需要新的 hosting、域名和运行维护。

已确认：`D07=A`。

## D08. Parser 成功但没有 Education 时是否允许进入 Application

此前已确认 Project/Certification/Phone 等可以为零行，但 Education 的业务门禁尚未
最终冻结。

### 推荐选择：A

**A. 允许继续（推荐）**

记录 `education_not_found` quality flag；不创建假 Education；后续 anomaly/招聘规则
可判断。这样不会因规则解析 false negative 永久丢失有效申请。

**B. Initial Cleaning Block**

没有可靠 Education 就不创建 `submission_normalized`。

已确认：`D08=A`。缺少 Education 本身不构成 ML 技术错误；生产查询和特征构造
必须把 Education 零行当作合法空集合。只有已有 anomaly 规则命中近乎空档案，或其他
独立必需输入缺失时，才按对应规则排除。

## D09. Position JD 在 ML 前变为不可用时如何处理

Position JD 在非 Active 状态允许 NULL；Active 状态由 Schema/API 强制要求有效 JD。
如果 Application 发布后因并发或后续 Catalog 变更导致 Workflow B 读取不到有效 JD，
cosine similarity 仍然没有业务含义。

### 推荐选择：A

**A. 等待 JD 并通过 Outbox 安全重启（已确认）**

Position JD 缺失或不足 10 字符时不调用 ML、不制造伪 similarity score，也不生成
`no_offer`。Application 保持 `processing/pending`，数据库 Workflow B 标记为
`waiting_position_jd`；JD 后续补齐并使 Position active 时，通过带新 decision fence 的
`application.position_jd_ready` Outbox event 安全启动新的 Workflow B。

**B. 使用空字符串继续 embedding**

最接近旧代码的技术行为，但生成的 cosine 不能解释为岗位匹配度。

**C. 跳过自动 ML，进入人工 Resume screening**

质量最佳，但不符合“每条申请由当前 ML 直接给最终结果”的首版目标。

已确认：`D09=A`。

## D10. `all-MiniLM-L6-v2` 的生产推理位置

该 sentence-transformers/PyTorch 模型不能直接打包进普通 Cloudflare Worker
JavaScript isolate。

### 推荐选择：A

**A. 仓库增加独立 Python FastAPI ML service + container（推荐）**

Workflow B 调用内部 `/v1/similarity`；服务固定模型名/revision，返回 input hashes、
embedding config 和 cosine。Hosting 可先使用 Render/Cloud Run，未来迁 Cloudflare
Container；业务数据库与 Workflow 代码仍在 Cloudflare。

**B. Cloudflare Container 首发**

架构更集中，但部署和费用配置更复杂，需确认当前账号已启用 Containers。

**C. 更换 Workers AI 模型**

不推荐；会违反已经确认继续使用 `all-MiniLM-L6-v2` 的决定。

已确认：`D10=A`。

## D11. 没有 Position/Company override 时的全局 ML threshold

已有参考映射为 0.24、0.28、0.32、0.35、0.38、0.42、0.47。生产必须有唯一
global default，否则新 Position 无法作出决定。

### 推荐选择：A

**A. `standard = 0.32`（推荐）**

与换算表“约保留前 50%”对应；之后每个 Position 可发布 override policy。

**B. 其他 threshold**

需要明确给出数值与 band。

已确认：`D11=A`，即 `standard = 0.32`。

## D12. Manual hiring command 首版如何认证

自动 ML 路径不需要 UI，但 flexible stages、人工面试结果和 Offer 状态转换需要受控
command API。

### 推荐选择：A

**A. Internal authenticated command API（已确认并安全化为 A+）**

使用 Cloudflare Access 保护内部 route；每位成员使用独立身份登录，但首版被授予相同
Author 权限。Worker 验证 Access JWT 的签名、audience、issuer 和有效期，再从已验证
claim 派生 `actor_type/actor_reference`；客户端仍必须提供 `idempotency_key`，所有命令
写 audit。机器调用使用独立 service token，禁止共享成员个人 token。

**B. 首版直接接正式用户登录/RBAC**

更完整，但需要另一个成员的身份系统 contract，目前仓库没有该信息。

已确认：`D12=A+`。当前不建立完整业务 RBAC；未来需要 Reviewer/Admin 等不同权限时
再升级为 B。

## D13. 测试 CSV 导出的生产方式

CSV 只用于检查，不能成为下游输入。

### 推荐选择：A

**A. 按需 export command（推荐）**

本地/Colab/GitHub manual workflow 从 D1 只读查询当前 workflow/application，输出到：

`HireBeat_v2_test_exports/<environment>/<YYYY-MM-DD>/<workflow_run_uuid>/`

同一 run 每张表一个固定文件名 CSV，并生成 `00_export_manifest.csv`。可额外维护
`latest/` 便捷副本。导出根目录位于当前 repository workspace：

`test-exports/<environment>/<YYYY-MM-DD>/<workflow_run_uuid>/`

真实候选人数据默认由 `.gitignore` 排除，不得提交到 Git history。需要团队共享时，
由手工 GitHub Actions workflow 把整个 run 文件夹上传为有保留期限、仅仓库授权成员
可读取的 Artifact。仓库只跟踪目录说明、manifest contract 和脱敏样例。Artifact 上传
失败不得影响生产 Workflow。

**B. 每个生产 step 成功后自动写 Google Drive**

会把测试设施变成生产依赖，增加 PII 副本、API 配额和失败分支，不推荐。

已确认：`D13=A`，并采用上述仓库内统一工作目录、manifest 和 GitHub Artifact 边界。

## D14. 部署环境

### 推荐选择：A

**A. local + staging + production（推荐）**

新增 staging D1/R2/Worker/Workflow，GitHub `main` 先验证 staging，production 使用
GitHub Environment approval。当前已创建的远程 D1/R2 可指定为 staging 或 production。

**B. local + production only**

资源少，但所有远程集成测试都会触及正式资源。

已确认：`D14=A`。当前
`hirebeat_recruiting_d1_v2`/`hirebeat-hr-raw-resumes-pdf-r2-v1` 视为 staging；
production 使用后续独立创建的 D1、R2、Worker、Workflow 和 Secrets。

## D15. Native source 字段映射的冻结方式

组员的 fuzzy field-name matching 可兼容 emoji 和轻微改名，但生产中静默匹配错误字段
风险较高。

### 推荐选择：A

**A. Versioned explicit mapping + limited aliases（推荐）**

每个 source schema version 保存明确 canonical→source 字段名列表；只允许清单内 alias，
缺必需字段 terminal failure。保留 fuzzy matcher 仅作为离线诊断，不自动发布 Raw。

**B. 继续完全 fuzzy matching**

对表单改名更宽容，但可能把相似字段误映射。

已确认：`D15=A`。组员 fuzzy matcher 可复用于离线 alias 诊断，但不进入生产自动映射。

## 部署前必须提供/完成，但不属于业务选择

以下不会阻止代码骨架、测试和 migrations 编写，但会阻止真实端到端部署：

1. 轮换附件中已经暴露过的 Airtable PAT；旧 token 不得继续使用。
2. 决定是否轮换已作为附件共享过的 Google service account key；生产推荐轮换。
3. 为 Adapter 提供新的 Secret，以及 Airtable base/table、Google spreadsheet/range。
4. 若选择 Push-first，建立 Airtable Automation 和 Google Apps Script trigger。
5. 配置 Parser/ML service URL 与 auth token。
6. 将当前远程 D1/R2 固定为 staging，配置 staging GitHub Environment secrets；在端到端
   验证完成后另建 production D1/R2 和 production GitHub Environment approval。
7. 通过新版 importer 提供首批 Reference/Catalog 数据；不会读取旧 D1。

## 最终冻结结果

D01-D15 已全部确认。后续实现不得重新询问这些决定；只有发现安全阻断、技术上无法
实现，或新需求与冻结决定直接冲突时，才应明确列出冲突和影响，而不能静默修改。
