# HireBeat D1 Schema：GitHub 与 Cloudflare 部署手册

## 1. 本仓库已经包含什么

| 文件 | 用途 |
|---|---|
| `schema/HIREBEAT_D1_CREATE_2026-08-17.sql` | 当前最新完整建库 SQL；包含 84 张业务表和 120 个显式索引 |
| `migrations/0001_initial_schema.sql` | 已部署且不可修改的初始 D1 migration；其 SHA-256 由构建和校验脚本保护 |
| `migrations/0002_add_resume_file_integrity.sql` | 为 R2 原始简历 PDF 增加 SHA-256 完整性字段与 object key 唯一索引 |
| `migrations/0003_add_versioned_system_configuration.sql` | 增加版本化非敏感运行配置、初始 active release，以及 Intake/Workflow 配置版本指针 |
| `migrations/0004_seed_pipeline_and_ml_reference_bands.sql` | 写入 13 个招聘阶段、流程模板和 ML threshold reference band |
| `migrations/0005_freeze_intake_resume_file_hash.sql` | 冻结 Intake 采用的简历文件哈希，支持技术重送和解析复现 |
| `migrations/0006_seed_global_ml_threshold_policy.sql` | 写入首版实时生产使用的全局 fixed similarity threshold policy |
| `migrations/0007_seed_minimum_runtime_reference_data.sql` | 写入最小 Contact、Work Mode、Degree reference seed，并补充 ML timeout 配置 |
| `migrations/0008_enforce_command_idempotency.sql` | 为 Offer、Hiring 与 Catalog command audit 增加幂等唯一索引 |
| `migrations/0009_enforce_single_application_promotion.sql` | 保证同一 normalized Submission 最多发布为一个 Application primary input |
| `migrations/0010_require_jd_for_active_position.sql` | 只允许具有合格 JD 的 Position 进入 Active 状态 |
| `migrations/0011_add_offer_response_deadline_policy.sql` | 发布 Offer 默认回复期限配置，并要求 sent Offer 使用未来的不可变版本期限 |
| `migrations/0012_add_controlled_intake_recovery.sql` | 为技术重试耗尽后的受控 Intake 重放增加可旋转恢复 fence |
| `schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql` | 危险的手工清库脚本；删除 84 张业务表，不删除 `d1_migrations` 或 D1 内部表 |
| `scripts/build_schema_artifacts.py` | 从 11 个已确认 group SQL 重新生成最新 CREATE/DELETE SQL，并保护已部署 migration 不被改写 |
| `scripts/validate_schema.py` | 在内存 SQLite 中验证表、索引和外键 |
| `wrangler.toml` | Wrangler 与目标 D1 数据库的绑定配置 |
| `.github/workflows/deploy-d1.yml` | push 到 `main` 后验证并执行远程 D1 migrations |

## 2. 重要安全边界

1. `DELETE_ALL.sql` **不在** `migrations/` 中，也不会被 GitHub Actions 自动执行。
2. 不要把 Cloudflare API token、Google service account JSON、`.env` 或 `.dev.vars` 提交到 GitHub。
3. 任意已经部署的 migration 都不得原地修改；以后每次 schema、约束或正式 seed 变化都新增下一个编号的 migration。
4. `d1_migrations` 记录哪些 migration 已执行。运行 DELETE_ALL.sql 后，该表仍会保留，因此 0001 不会自动重新执行。需要完全重建时，最干净的方法是创建一个新的 D1 database；如果明确要复用原数据库，则在清库后手工执行 CREATE.sql，而不是再次依赖 0001 migration。
5. 业务代码不得依赖 `SELECT *` 的物理列顺序；必须显式列出字段。完整 CREATE 与按 migration 演进的数据库应保持相同字段集合和约束，构建验证会对当前列定义进行比较。

## 2.1 已冻结的环境边界

本项目采用：

```text
local → staging → production
```

- `local` 用于单元测试和本地 D1/R2 模拟；
- `staging` 使用独立的远程 D1/R2/Worker/Workflow，运行与 production 相同的发布产物；
- `production` 处理真实候选人 PII、正式招聘决定和 Offer，必须使用独立资源及受保护的
  GitHub Environment approval。

当前远程 `hirebeat_recruiting_d1_v2` 和
`hirebeat-hr-raw-resumes-pdf-r2-v1` 已定义为 staging。端到端验证通过后再创建 production
资源，不能把 staging binding 复用于 production。生产级指代码、契约、测试、审计和恢复
达到上线标准，不表示跳过 staging、直接使用真实候选人数据测试。

## 2.2 检查 CSV 的集中目录

按需检查导出统一写入仓库工作区：

```text
test-exports/<environment>/<YYYY-MM-DD>/<workflow_run_uuid>/
```

同一 run 的 CSV 和 `00_export_manifest.csv` 必须位于同一目录。真实导出被 `.gitignore`
排除，禁止使用 `git add -f` 写入 Git history。团队共享通过手工 GitHub Actions workflow
上传为有保留期限的私有 Artifact；仓库只跟踪目录 contract、manifest schema 和脱敏样例。
导出或 Artifact 上传失败不得改变生产 Workflow 的成功/失败状态。

## 3. 第一次本地准备

进入本目录：

```bash
cd "/Users/shiyili/Documents/Codex/2026-07-20/project-users-shiyili-documents-codex-2026/new_d1_schema_design_2026_08_13"
```

安装本地 Wrangler：

```bash
npm install
```

这会生成 `package-lock.json`。请把它提交到 GitHub，以后本地和 CI 可以使用同一套依赖版本。

重新生成并验证 SQL：

```bash
npm run schema:build
npm run schema:validate
```

预期结果必须是：

```text
84 tables
120 explicit indexes
0 FK violations
```

## Cloudflare R2 原始简历 Bucket

### 当前资源

```text
Bucket name:
hirebeat-hr-raw-resumes-pdf-r2-v1

Wrangler binding:
hirebeat_hr_raw_resumes_pdf_r2_v1

Storage class:
Standard
```

该 Bucket 用于保存原始简历 PDF。D1 的 `raw_submission_resume` 表保存对应的 object key、文件 SHA-256、文件 metadata 和解析文本，不保存 PDF BLOB。

### 首次创建 Bucket

如果目标 Cloudflare Account 中还不存在该 Bucket：

```bash
npx wrangler r2 bucket create hirebeat-hr-raw-resumes-pdf-r2-v1
```

不要对已经存在的 Bucket 重复执行创建命令。

### 查询 Bucket

```bash
npx wrangler r2 bucket list
```

预期结果应包含：

```text
hirebeat-hr-raw-resumes-pdf-r2-v1
```

### Wrangler binding

`wrangler.toml` 必须包含：

```toml
[[r2_buckets]]
binding = "hirebeat_hr_raw_resumes_pdf_r2_v1"
bucket_name = "hirebeat-hr-raw-resumes-pdf-r2-v1"
```

### 安全和职责边界

- Bucket 保持 private。
- 不在 GitHub 中保存 Cloudflare API Token。
- 不把简历对象暴露为公开 URL。
- D1 只保存 object key、文件 metadata、SHA-256 和解析文本，不保存 PDF binary。
- 上传 Worker 必须验证 MIME type、文件大小和 SHA-256。
- object key 不应包含候选人姓名、邮箱或其他明文 PII。
- R2 PUT 必须幂等。
- R2 与 D1 不构成跨产品 ACID 事务。
- R2 上传成功后，再使用短 D1 transaction 发布 Raw metadata、intake 状态和 Workflow A Outbox event。

### Submission Ingress Worker 验证

当前 staging Cloudflare 账户没有托管域名，因此仅
`workers/submission-ingress/wrangler.toml` 临时启用稳定的 `workers.dev`
target，并关闭 preview URLs。所有写入端点仍必须验证
`INGRESS_INTERNAL_AUTH_TOKEN`。Production 必须重新设为
`workers_dev = false` 并使用公司自有 Custom Domain；不得把这一 staging
例外直接提升到 Production。

独立 Worker package 位于 `workers/submission-ingress/`。它已经接通 Airtable/Google adapter、R2、Parser、D1 原子发布和 Workflow A Outbox；部署前必须先配置真实私有服务 URL、Secrets，并在 staging 做端到端验证：

```bash
cd workers/submission-ingress
npm install
npm run typecheck
npm run test:unit
npm run deploy:dry-run
```

合成单元测试不连接任何远程服务。真实写入入口必须使用 `INGRESS_INTERNAL_AUTH_TOKEN`；公开 `workers.dev` 路由保持关闭。R2 与 D1 不具备跨产品 ACID，因此 R2 使用内容哈希稳定 key 和 conditional PUT，随后由单次 D1 `batch()` 原子发布 Raw、Resume metadata、Outbox 与成功状态。完整运行边界见 `15_production_implementation_runbook.md`。

## 4. 创建新的 Cloudflare D1 database

先登录 Cloudflare：

```bash
npx wrangler login
```

创建数据库（名称可以自行调整）：

```bash
npx wrangler d1 create hirebeat-production
```

Wrangler 会返回 `database_name` 和 `database_id`。把 `wrangler.toml` 中这两项占位符替换掉：

```toml
database_name = "hirebeat-production"
database_id = "实际返回的 D1 UUID"
```

不要修改 binding `DB`，除非同时修改仓库里的相关命令。

## 5. 部署前先在本地 D1 测试

检查待执行 migration：

```bash
npm run d1:migrations:list:local
```

应用到本地 D1：

```bash
npm run d1:migrations:apply:local
```

查询本地建表结果：

```bash
npx wrangler d1 execute DB --local --command \
  "SELECT type, COUNT(*) AS object_count FROM sqlite_master WHERE sql IS NOT NULL GROUP BY type ORDER BY type;"
```

只有本地测试成功后再 push 到远程仓库。

## 6. 建立本地 Git repository

如果当前目录还不是 Git repository：

```bash
git init
git branch -M main
git status
git add .
git commit -m "Initialize confirmed HireBeat D1 schema"
```

提交前检查敏感文件：

```bash
git status --short
git ls-files | grep -E 'service-account|\.env|\.dev\.vars|token|secret' || true
```

如果输出中出现真实凭证，先使用 `git rm --cached <文件>` 移出版本控制，并立即轮换已经暴露的凭证。

## 7. 创建并连接 GitHub remote repository

在 GitHub 网站创建一个**空仓库**，不要勾选自动创建 README、`.gitignore` 或 license。假设仓库地址是：

```text
https://github.com/YOUR_GITHUB_USERNAME/hirebeat-d1-schema.git
```

使用 HTTPS：

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/hirebeat-d1-schema.git
git remote -v
git push -u origin main
```

或者使用 SSH：

```bash
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/hirebeat-d1-schema.git
git remote -v
git push -u origin main
```

如果已经存在错误的 `origin`：

```bash
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/hirebeat-d1-schema.git
```

## 8. 创建 Cloudflare API token

在 Cloudflare Dashboard 创建一个专用 API token：

- 权限至少包含目标账户的 **D1 Edit**；
- Account Resources 只选择实际部署所用账户；
- 不要使用 Global API Key；
- 不要把 token 写入代码、`wrangler.toml`、commit 或截图。

同时在 Cloudflare Dashboard 获取该账户的 Account ID。

## 9. 添加 GitHub Actions secrets

进入 GitHub repository：

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

创建两个 secrets：

| Secret 名称 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

不要把 D1 UUID 当作 Account ID。D1 UUID 已经放在 `wrangler.toml`；Account ID 是 Cloudflare 账户 ID。

## 10. GitHub Actions 如何部署

`.github/workflows/deploy-d1.yml` 会在以下情况启动：

- migration、Wrangler 配置、验证脚本或 workflow 文件被 push 到 `main`；
- 在 GitHub Actions 页面手工点击 `Run workflow`。

执行顺序：

1. checkout repository；
2. 按文件名顺序执行全部 migrations，并用 SQLite 内存数据库验证 84 张表、120 个索引和外键；
3. 检查 `wrangler.toml` 已无占位符；
4. 使用官方 `cloudflare/wrangler-action@v4`；
5. 执行 `wrangler d1 migrations apply DB --remote`。

D1 只会执行尚未登记在 `d1_migrations` 中的 migration。同一个 migration 不会因为每次 push 而重复建表。

## 11. 第一次远程部署后的验证

查看远程 migration 状态：

```bash
npm run d1:migrations:list:remote
```

确认代表性表存在：

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('raw_submission','submission_normalized','application','candidate_snapshot','offer') ORDER BY name;"
```

统计业务表：

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT COUNT(*) AS application_table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV','_cf_METADATA');"
```

也可以在 Cloudflare Dashboard 的 D1 Console 检查 `d1_migrations` 是否包含 `0001_initial_schema.sql`。

## 11.1 Staging 运行时部署（Schema migration 之后）

先把三个 Worker 配置中的非敏感占位值替换成真实 staging 值：

- `workers/submission-ingress/wrangler.toml`: `PARSER_SERVICE_URL`；
- `workers/etl-orchestrator/wrangler.toml`: `ML_SERVICE_URL`；
- `workers/operations-api/wrangler.toml`: `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`。

不要把 Token 或 service-account JSON 写进 TOML。使用交互式 Secret 命令：

```bash
npx wrangler secret put SUBMISSION_HMAC_KEY_V1 --config workers/submission-ingress/wrangler.toml
npx wrangler secret put INGRESS_INTERNAL_AUTH_TOKEN --config workers/submission-ingress/wrangler.toml
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config workers/submission-ingress/wrangler.toml
npx wrangler secret put CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON --config workers/submission-ingress/wrangler.toml
npx wrangler secret put PARSER_SERVICE_AUTH_TOKEN --config workers/submission-ingress/wrangler.toml

npx wrangler secret put IDENTITY_HMAC_KEY_V1 --config workers/etl-orchestrator/wrangler.toml
npx wrangler secret put ORCHESTRATOR_INTERNAL_AUTH_TOKEN --config workers/etl-orchestrator/wrangler.toml
npx wrangler secret put ML_SERVICE_AUTH_TOKEN --config workers/etl-orchestrator/wrangler.toml
npx wrangler secret put CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON --config workers/etl-orchestrator/wrangler.toml
```

如果 Operations Worker 尚不存在，可先使用 staging 的固定
`workers.dev` route 完成 bootstrap deploy。此时除 `/health` 外的路由仍会
因为缺少有效 Access JWT 而失败关闭。部署完成后，必须立即在 Cloudflare
Dashboard 中为该 Worker 的 `workers.dev` route 启用 Cloudflare Access，
再把 Access Team Domain 和 Application AUD 写回 TOML 并重新部署。当前 staging
值为：

- Team Domain：`https://hirebeat-recruiting-stg-027.cloudflareaccess.com`
- Application AUD：`5f60dbf34db2d7ccdb1fb9b7271bb71efe27f1f0184297ec71fd9d7d5a9deb8d`
- Session duration：7 天；它表示重新认证周期，不表示成员权限在 7 天后失效。

AUD 是可提交的应用标识符，不是 Secret。Access JWT、`CF_Authorization`
Cookie、service-token secret 和 Cloudflare API token 不得写入仓库。
Preview URL 必须保持关闭。Ingress 使用内部 Bearer Token；Operations 使用
Access；Orchestrator 不设置公开 route。

```bash
npm run ingress:deploy:staging
npm run orchestrator:deploy:staging
npm run operations:deploy:staging
```

Operations API 必须先建立 Cloudflare Access Self-hosted application。为项目成员建立团队 group，并让 Allow policy 只包含该 group；项目成员可以拥有 Author 权限，但 Operations API 仍以 Access JWT 记录每个操作者的 email/sub。不要共享一个人员 Token 来替代成员身份。

首次 bootstrap 的安全顺序：

1. 部署 Operations Worker，获得固定 `workers.dev` 地址；
2. Cloudflare Dashboard → Workers & Pages → 选择该 Worker → Settings →
   Domains & Routes → 对 `workers.dev` 选择 **Enable Cloudflare Access**；
3. 在生成的 Access application 中建立只允许项目成员的 Allow policy；
4. 复制 Access Team Domain（完整 `https://<team>.cloudflareaccess.com`）与
   application AUD；
5. 替换 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 占位值并重新部署；
6. 验证 `/health` 可访问，而未登录请求访问 `/v1/reference/types` 被 Access
   拦截；登录成员请求能够通过，并且 API 会再次校验 JWT 的签名、issuer、
   audience 和有效期。

Parser 与 ML 是容器服务，不由 Wrangler Worker 命令部署。它们必须使用私有 URL，并分别配置与 Worker 相同的 `PARSER_SERVICE_AUTH_TOKEN`、`ML_SERVICE_AUTH_TOKEN`。Ingress 与 Orchestrator 还必须配置同一个专用、最小权限的 `CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON`，用于换取 audience-bound Google ID Token；该身份只获得两个目标服务的 `roles/run.invoker`。上线前分别调用 authenticated `/ready`。完整运行边界见 `15_production_implementation_runbook.md`。

## 12. 以后修改 schema 的正确方式

不要修改已经上线的 0001。创建新的 migration：

```bash
npx wrangler d1 migrations create DB "add_example_column"
```

把生成文件补充为真正的 `ALTER TABLE`、`CREATE TABLE` 或 `CREATE INDEX` SQL，然后执行：

```bash
python3 scripts/validate_schema.py
npm run d1:migrations:list:local
npm run d1:migrations:apply:local
git add migrations
git commit -m "Add example schema migration"
git push origin main
```

验证脚本会按文件名顺序执行全部 migrations，并校验已部署的 `0001` 基线 SHA-256；如果有人误改 `0001`，本地校验和 GitHub Actions 都会失败。

## 13. 手工清空数据库

这是不可逆的危险操作。执行前先确认目标数据库，并优先依赖 D1 backup/Time Travel 或导出备份。

```bash
npx wrangler d1 execute DB --remote \
  --file="schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql"
```

它只删除本项目的 84 张业务表，不删除 `d1_migrations`。如果目的是从零重新测试 migration，推荐删除并重新创建一个新的测试 D1 database，然后更新 `wrangler.toml` 的 UUID。

## 14. 常用排错

### GitHub Action 报配置仍有占位符

修改并提交 `wrangler.toml` 中的 `database_name` 和 `database_id`。

### 认证失败

检查 GitHub secrets 名称是否完全一致、token 是否包含目标账户 D1 Edit 权限，以及 Account ID 是否属于目标数据库所在账户。

### migration 已执行但修改没有生效

不要编辑已经登记的 0001；创建新的 0002 migration。

### 部署到了错误数据库

立即停止后续写入，核对 `wrangler.toml` 的 `database_id`。部署前应同时核对 Cloudflare database name 和 UUID。

### migration 中途失败

D1 会回滚当前失败 migration；此前已经成功的 migration 保留。修复 SQL 后不要复用一个已成功登记的 migration 名称，而应根据实际状态决定修复当前未成功文件或创建后续 migration。

## 15. Intake Queue 与 DLQ

部署新版 Ingress Worker 前一次性创建两个 staging Queue：

```bash
npx wrangler queues create hirebeat-submission-intake-stg-v1
npx wrangler queues create hirebeat-submission-intake-dlq-stg-v1
```

主 Queue 配置 `max_retries = 4`，表示首次投递加四次重投，共五次。DLQ 由同一个 Ingress Worker 消费，但只负责把已耗尽的 D1 intake run 自动终结，不重复下载 PDF 或调用 Parser。部署输出必须同时显示 `INTAKE_QUEUE` producer、主 Queue consumer 和 DLQ consumer。Queue 只携带私有 R2 replay envelope 的指针与 keyed HMAC，不携带完整申请内容或 PDF bytes。

创建后核对资源并重新部署 Ingress/Orchestrator：

```bash
npx wrangler queues list
npm run ingress:deploy:staging
npm run orchestrator:deploy:staging
```

Ingress 部署输出必须显示 `INTAKE_QUEUE` binding。提交接口成功接收时返回
HTTP `202`，这只表示 replay envelope 已安全保存并进入 Queue，不表示 PDF、
Parser、Raw publication、Workflow A/B 已同步完成。后续状态应查询 D1：

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT submission_uuid,intake_status,attempt_count,
          technical_redelivery_count,last_error_code,updated_at
   FROM raw_submission_intake_run
   ORDER BY id DESC LIMIT 20;"
```

正常重试不需要人工再次运行提交脚本。只有输入、权限、Secret、字段映射或
程序本身必须改变时才进行修复；修复前不得删除 Raw、run、Outbox 或审计证据。
完整分类、上限和自动唤醒规则见
`18_automatic_recovery_policy.md`。

修复根因后，通过受 Cloudflare Access 保护的 Operations API 释放原有
R2 replay envelope，不重新提交申请内容：

```bash
cloudflared access curl \
  "$OPERATIONS_URL/v1/intake-runs/INTAKE_RUN_ID/recover" \
  -X POST \
  -H "Content-Type: application/json" \
  --data '{
    "idempotency_key":"UNIQUE_RECOVERY_COMMAND_KEY",
    "recovery_reason":"Describe the corrected root cause and approval."
  }'
```

命令只接受技术重试耗尽、尚未发布 Raw 的 `failed_terminal` run。它在同一
短事务中旋转 recovery fence、写入 Outbox 和审计记录；Orchestrator 将事件
转发到原 Intake Queue。不要把 token、service-account JSON、PDF 或完整申请
payload 放进命令、reason 或日志。
