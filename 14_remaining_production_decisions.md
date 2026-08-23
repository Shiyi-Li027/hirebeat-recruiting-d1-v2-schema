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

Staging 端到端验收已经完成，包括 Google Form provider-native 实时申请提交路径。
对应证据记录在 `17_staging_end_to_end_acceptance_plan.md` 和 staging closeout report 中。

Airtable provider-native 申请窗口当前明确暂缓，不阻塞已通过验收的 Google Form
staging 通道，也不阻塞 production 基础设施准备。

初始 production D1 Schema migration 已完成并通过验证：

- 受保护的 GitHub Actions `Deploy production D1 migrations` run `#1` 从
  `main` commit `f4f49a0` 手工启动，并在 `production` Environment 人工审批后执行成功。
- 隔离的 production D1 `hirebeat_recruiting_d1_v2_prod` 已应用全部 14 个 migrations。
- 已验证 84 张应用 Schema 表、120 个显式索引和 0 个外键违规；Cloudflare 管理的
  `_cf_KV` 使 `sqlite_master` 中排除 `d1_migrations` 后的总表数显示为 85。
- 代表性运行、PII、审计和 Outbox 表均为空，未从 staging 或旧 D1 复制运行数据。
- D1 remote SQL 禁止 `PRAGMA integrity_check`（`SQLITE_AUTH`）；这属于平台限制，
  不能解释为数据库损坏。

初始 production Worker 部署也已完成并通过基础验证：

- 受保护的 GitHub Actions `Deploy production Workers` run `#2` 从 `main`
  commit `41ac450` 手工启动，并在 `production` Environment 人工审批后成功。
- `hirebeat-submission-ingress-prod-v1` 已部署为 version
  `315e3994-cda5-43c7-be29-5aaf7247f493`。
- `hirebeat-etl-orchestrator-prod-v1` 已部署为 version
  `08a8896b-1587-4d1d-acc9-ca7acea002c5`。
- production Intake Queue 已连接 2 个 producers 和 1 个 consumer；production
  DLQ 已连接 1 个 consumer。
- `hirebeat-workflow-a-prod-v1` 与 `hirebeat-workflow-b-prod-v1` 已注册到
  production ETL Orchestrator。
- production Resume Parser、ML inference、专用调用身份、服务认证和 Google
  Drive reader 已配置，并通过 Drive PDF 下载验收。
- 部署后 production D1 仍保留 14 个 migrations、0 个外键违规，代表性运行、
  PII、审计和 Outbox 表仍为空。

production Operations API 的管理员受限部署与 Access 验收也已完成：

- 受保护的 GitHub Actions `Deploy production Operations API` run `#2` 从
  `main` commit `7cbb3c3` 手工启动，并在 `production` Environment 人工审批后成功。
- `hirebeat-operations-api-prod-v1` 已部署；由于当前 Cloudflare account 没有
  managed domain，暂时使用受 Cloudflare Access 保护的 `workers.dev` production
  URL，`preview_urls` 保持关闭。
- Worker 级 Access 对 production URL 的全部流量生效；`Production Operations
  Admin` 仅允许精确邮箱 `shiyilidorothy@gmail.com`。production Access AUD 已写入
  受保护的部署配置。
- 已通过授权访问 `/health`、`/v1/reference/types`、`/v1/catalog/options` 和
  `/v1/system/time-policy`；根路径返回 `{"error":"not_found"}` 属于未定义根路由的
  预期行为。
- 无痕窗口中的未认证访问会跳转到 Cloudflare 登录，未授权邮箱拒绝测试也已通过。
- production Catalog 仍为空，未启用 provider channel、广泛业务用户访问或真实业务流量。

production Parser/ML 最小 runtime smoke 也已完成并通过验证：

- 受保护的 GitHub Actions `Smoke test production Parser and ML` run `#1`
  从 `main` commit `7e26c91` 手工启动并成功完成。
- protected production runtime configuration、production Resume Parser 和
  production ML 三项检查均返回 `PASS`。
- 测试只使用合成请求，不使用 production resume 或 applicant 数据；未执行 D1
  写入，也未向 Queue 或 Workflow 投递消息。
- 该结果确认 production 私有服务的认证、可达性和最小响应契约；不等于完整
  provider-path 端到端验收、失败路径监控、告警或回滚演练已经完成。

以上确认初始 production D1 Schema migration、Submission Ingress 和 ETL
Orchestrator 首次部署、管理员受限的 Operations API 部署与 Access 验收，以及
production Parser/ML 最小非写入 runtime smoke。它不代表 company-owned custom
domain、provider channel、广泛业务用户访问或真实业务流量已经启用。

Production 部署前仍必须完成：

1. 独立的 production D1、R2、Queue、DLQ、Resume Parser、ML 服务、
   Submission Ingress、ETL Orchestrator、Workflows 和 Operations API 已创建或
   部署；继续保持与 staging 资源完全隔离。
2. 当前管理员受限的 Operations API 使用受 Access 保护的 `workers.dev` URL，属于
   已审核的临时无域名方案。获得 company-owned managed domain 后，迁移到正式
   custom domain，并重新验证 Access destination、AUD、精确邮箱 Allow 和未授权拒绝。
   在应用级 RBAC 和内部 Operations Console 完成前，不得向广泛业务用户开放。
3. 受保护的 GitHub `production` Environment 已创建并启用人工 approval；
   后续 production migration 和部署仍必须经过该 Environment，并只使用
   production 专用凭据。
4. 为 production Google Form bridge 配置 production 专用的 provider 标识和
   凭据；不得复用 staging token、service token 或其他 Secrets。
5. `catalog_sync_run` / `catalog_sync_target_run` 结果报告已经在 staging
   通过真实 Google Form Catalog Sync 验证；如 production 需要依赖
   `failed_retryable` 自动恢复，还必须先补齐自动重试 dispatcher。
6. production Parser/ML service URL、服务间认证和最小权限调用身份已配置，且
   最小非写入 runtime smoke 已通过；仍需完成 provider-path 端到端验收、
   失败路径验证、持续监控、告警和回滚验收。
7. 使用 production importer 提供经过审核的首批 Reference/Catalog 数据；
   不从旧 D1 或 staging D1 复制未经审核的运行数据。
8. 任何曾经在附件、截图或聊天记录中显示过的密钥都不得直接作为 production
   凭据使用；production 应创建或轮换为独立凭据。

## Production 最小 Catalog / Operations 写入验收

状态：**PASS**。已通过受 Cloudflare Access 保护的 production Operations API
完成最小真实写入链路验收：

- 创建 Company `Nello`；
- 关联 `work_mode.id = 3`、code `remote`、name `Remote`；
- 创建 Position `Influencer Marketing Coordinator`；
- 发布 Catalog revision `1`，snapshot SHA-256 为
  `123fe2375d16d0334c12aae4359db9fe3bd30390ecb913f33fb00fd728e2e895`；
- `/v1/catalog/options` 返回上述 revision、Company、Company Work Mode 和
  Position；
- production D1 中 `company`、`company_work_mode`、`position`、
  `catalog_revision` 的记录数均为 `1`；
- 四个业务命令均写入 `audit_event`，actor 为
  `member / shiyilidorothy@gmail.com`。

本次验收使用以下 correlation/idempotency keys：

- `prod-acceptance-nello-company-v1`；
- `prod-acceptance-nello-remote-v1`；
- `prod-acceptance-nello-position-v1`；
- `prod-acceptance-nello-revision-v1`。

完全相同的请求第二次执行后，Company、Company Work Mode、Position 和
Catalog Revision 均返回 `idempotent_reuse: true`；四张业务表的记录数保持为
`1`，每个 correlation key 对应的审计事件数也保持为 `1`。因此已确认重复提交
不会产生重复业务记录或重复审计事件。

Access 访问边界也已验收：精确授权邮箱可以登录并调用 Operations API，未授权邮箱
无法获得访问权限。该验收没有复制 staging 或旧 D1 的运行数据，也没有启用
production provider traffic。

初始批量 Reference/Catalog CSV 导入明确标记为 **deferred**，不阻塞当前最小
production 验收。日常 Company、Position、Catalog 等单条业务变更继续通过受
Access 保护的 Operations API 执行，不允许绕过 API 直接写 production D1。

## 最终冻结结果

D01-D15 已全部确认。后续实现不得重新询问这些决定；只有发现安全阻断、技术上无法
实现，或新需求与冻结决定直接冲突时，才应明确列出冲突和影响，而不能静默修改。

## Production Google Form provider 端到端验收（2026-08-22）

受控 synthetic production provider 路径已通过验收：

`Google Form → Apps Script provider bridge → Cloudflare Access 保护的 Submission Ingress → D1/R2 → Intake Queue → ETL Workflows → Parser/ML`

- 3 次受控 synthetic 表单提交均完成；
- Apps Script `onHireBeatFormSubmit` 执行成功；
- Intake Queue 写入 3、确认 3、重试 0，并恢复为 0 backlog；
- DLQ 无未确认消息；
- R2 已生成 `raw-resumes/v1` 和 `intake-replay-envelopes/v1` 对象；
- D1 形成 3 个 `application`、3 个 `ml_analysis_run`，外键违规为 0；
- `person = 2`、`application = 3` 是预期的身份去重与复用结果。

决策：最小受控 production provider 路径判定为 **PASS**。该结论不等于允许广泛真实候选人流量；监控与告警、故障路径、回滚验证、运维责任确认及业务上线审批仍为独立前置条件。

## Production Google Form provider 端到端验收（2026-08-22）

受控的 synthetic production provider 路径已经完成端到端验收并通过：

- 3 条 synthetic Google Form submission 已通过 Apps Script 和受 Cloudflare Access 保护的 production Submission Ingress 接收；
- production D1 中形成 3 条 `raw_submission`、3 条 `raw_submission_resume`、3 条 `application` 和 3 条 `ml_analysis_run`；
- `person = 2`、`application = 3` 是预期的身份去重结果，不是数据丢失；
- production Intake Queue 共接收并确认 3 条消息，retry 为 0、backlog 为 0；
- production Intake DLQ 没有未确认消息；
- production R2 的 `raw-resumes/v1` 与 `intake-replay-envelopes/v1` 均存在对应的 3 组 UUID artifact；
- 外键检查结果为 0 个违规。

该结果只证明受控 synthetic production provider 路径可运行，不代表已经批准接收广泛真实申请人流量。正式开放前仍需完成监控与告警、失败路径、回滚、值班归属和最终 launch approval。

## Production Google Form Catalog 同步决策（2026-08-22）

已冻结以下生产操作边界：

1. Google Form 只消费已经发布的 Catalog Revision；未发布的 Company、Work Mode 或 Position 草稿不得进入表单选项。
2. 现有 `onHireBeatFormSubmit` 触发器继续负责申请提交，不得为目录同步而删除或替换。
3. 不采用 `onOpen` 同步。Google Form 响应者打开表单时，表单绑定的 Apps Script 并不提供可靠的逐次打开同步语义，而且会引入竞态、延迟和不必要的写入。
4. 新 Revision 急需显示时，由获授权的 Catalog/Operations 操作人员手动运行 `syncHireBeatCatalogOptions()`。
5. 不急需显示时，可以依赖已经配置且验证成功的五分钟 time-driven trigger；0–5 分钟只是正常操作目标，不是硬性 SLA。
6. 若五分钟触发器尚未在 Triggers 页面确认存在，或尚未在 Executions 中确认成功，则手动同步仍是当前必需步骤。
7. 普通招聘人员不需要 Apps Script 访问权限，也不承担目录同步决策或执行职责。
8. Catalog Revision 发布后自动触发 Google Form 同步属于未来优化，当前保持 **DEFERRED**。

## Production 定时运行时监控状态（2026-08-23）

已完成：

- 受保护的 `Monitor production runtime endpoints` workflow 每 15 分钟定时
  运行，并保留显式手工触发入口。
- `main` 上的手工 run `#1` 与定时 run `#2` 均成功。
- 定时 run `#2`（`32661661195`）在 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 上执行，开始时间为
  `2026-08-23T19:34:25Z`，完成时间为 `2026-08-23T19:34:35Z`。
- 监控使用独立的 Cloudflare Access production monitoring service token，
  只对 Submission Ingress `/health` 和 Operations API `/health` 发起已认证的
  `GET` 请求；凭据值不进入仓库或日志。
- 该流程不写 D1、不投递 Queue/Workflow 消息，也不读取或提交 production
  简历和申请人数据。
- Cloudflare 账户级 Expiring Access Service Token Alert 与 Billing Budget
  Alert 已保留；monitoring token 已设置明确过期时间。

仍待完成：

1. 受控故障演练；
2. 实际故障通知送达验证；
3. production 回滚演练。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

已完成受保护的 production 运行时定时监控验收：

- `Monitor production runtime endpoints` 已在 `main` 启用；手工 run `#1`
  与 schedule run `#2` 均成功。
- schedule run `#2`（run ID `32661661195`）基于 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 完成。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service authentication 均通过。
- 监控只执行认证后的只读健康检查，没有 D1 写入，也没有提交 Queue 或
  Workflow 消息。
- `hirebeat-production-runtime-monitor` Service Token 已设置明确过期时间；
  账号级 Expiring Access Service Token Alert 与 Billing Budget Alert 已保留。
- 受控故障与通知送达验证、rollback 演练仍为后续事项，不能把本次成功监控
  解释为这些能力已经验收。

## Production 定时运行时监控状态（2026-08-23）

- 受保护的 `Monitor production runtime endpoints` workflow 已合并到 `main`，
  每 15 分钟自动运行，也支持手工触发。
- 定时 run `#2`（run ID `32661661195`）从 commit
  `a8aec519d4951902960102351bd2322126e5c39e` 执行成功。
- Submission Ingress `/health`、Operations API `/health` 和 Cloudflare Access
  service-token 认证均通过。
- 该监控只执行经 Access 认证的 `GET /health`，不会写入 D1，也不会发送
  Queue 或 Workflow 消息。
- 专用 monitoring service token 已设置明确过期时间；Cloudflare 账户级
  token 到期通知和 USD 5 billing budget alert 已保留。
- 故障通知的受控触发测试、告警接收确认以及 rollback 验证仍为后续生产事项。

## Production Worker 可观测性验收（2026-08-23）

状态：**PASS（持久化调用日志和基础运行可见性）**。

- PR #24 已在 `main` commit `871b93a` 合并 production Submission Ingress 与 ETL Orchestrator 的持久化 invocation logs 配置。
- 受保护的 `Deploy production Workers` run `#5` 经 production Environment 人工审批后，从该 commit 成功重新部署两个 Workers。
- run `#4` 因确认文本不是精确的 `DEPLOY PRODUCTION WORKERS` 而仅在 preflight 阶段失败，部署 job 未执行，证明生产确认保护有效。
- 两个 production 模板均配置 `[observability.logs]`、`enabled = true` 和 `invocation_logs = true`。
- ETL Orchestrator 已记录 `*/1 * * * *` scheduled 事件，结果为 `ok`（1 success、0 errors）。
- 通过 Cloudflare Access 调用 production Ingress `/health` 返回 HTTP 200；Ingress observability 记录到该成功请求（1 success、0 errors）。
- 临时 `verifyProductionIngressObservability()` 已删除；`onHireBeatFormSubmit` 与每五分钟 `syncHireBeatCatalogOptions` 两个既有触发器保持不变。
- 本次健康检查没有写入 D1，也没有提交 Queue 或 Workflow 消息。

以上只确认日志持久化和基础可见性；主动告警、受控失败路径监控与回滚验证仍待完成。

## Production 定时运行时监控验收（2026-08-23）

已完成并确认：

- 受保护的 GitHub Actions `Monitor production runtime endpoints` 已配置为每 15 分钟定时运行，并保留手工触发入口。
- 定时 run [`#2`](https://github.com/Shiyi-Li027/hirebeat-recruiting-d1-v2-schema/actions/runs/32661661195) 从 `main` commit `a8aec51` 启动，事件为 `schedule`，于 2026-08-23T19:34:25Z 开始、19:34:35Z 成功结束。
- production Submission Ingress 与 Operations API 的 Access 认证 `GET /health` 检查均通过。
- 监控只执行只读健康检查，没有写入 D1，也没有向 Queue 或 Workflow 提交消息。
- 监控使用独立的 `hirebeat-production-runtime-monitor` Access Service Token，该 Token 已设置明确过期时间。
- Cloudflare 账户级 Access Service Token 过期提醒以及 USD 5 Billing Budget Alert 已保留。

仍待完成：

- 人为制造一次受控、可恢复的监控失败，确认 GitHub Actions 失败通知能够到达指定接收人。
- 完成 production Worker 与相关运行配置的回滚演练和证据记录。
## Production 定时运行时监控验收（2026-08-23）

production 运行时的只读定时监控已经完成最小验收：

- 受保护的 GitHub Actions `Monitor production runtime endpoints` workflow 已配置为每 15 分钟运行一次，并保留手工触发入口。
- 定时 run `#2`（database ID `32661661195`）从 `main` commit `a8aec519d4951902960102351bd2322126e5c39e` 启动，状态为 `completed`，结论为 `success`。
- Submission Ingress `/health`、Operations API `/health` 与 Cloudflare Access service authentication 均通过。
- 本监控仅执行经过 Access 认证的 GET 请求，没有写入 D1，也没有投递 Queue 或 Workflow 消息。
- 专用 Access service token `hirebeat-production-runtime-monitor` 已设置明确过期时间；账户级 Access service-token 到期提醒与 USD 5 Billing Budget Alert 已保留。

以上证据只确认正常路径的定时健康检查与凭据到期/预算提醒准备完成。受控失败通知测试、失败路径监控和 production rollback 验证仍为待办，不能据此标记为已完成。
