# HireBeat D1 Schema：GitHub 与 Cloudflare 部署手册

## 1. 本仓库已经包含什么

| 文件 | 用途 |
|---|---|
| `schema/HIREBEAT_D1_CREATE_2026-08-17.sql` | 完整建库 SQL；包含 82 张业务表和 116 个显式索引，不包含 seed data |
| `migrations/0001_initial_schema.sql` | GitHub Actions 实际部署的第一个 D1 migration；内容与 CREATE.sql 完全相同 |
| `schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql` | 危险的手工清库脚本；删除 82 张业务表，不删除 `d1_migrations` 或 D1 内部表 |
| `scripts/build_schema_artifacts.py` | 从 11 个已确认 group SQL 重新生成上述三个 SQL 文件 |
| `scripts/validate_schema.py` | 在内存 SQLite 中验证表、索引和外键 |
| `wrangler.toml` | Wrangler 与目标 D1 数据库的绑定配置 |
| `.github/workflows/deploy-d1.yml` | push 到 `main` 后验证并执行远程 D1 migrations |

## 2. 重要安全边界

1. `DELETE_ALL.sql` **不在** `migrations/` 中，也不会被 GitHub Actions 自动执行。
2. 不要把 Cloudflare API token、Google service account JSON、`.env` 或 `.dev.vars` 提交到 GitHub。
3. `migrations/0001_initial_schema.sql` 已经部署后不要原地修改；以后每次 schema 变化都新增 `0002_*.sql`、`0003_*.sql`。
4. `d1_migrations` 记录哪些 migration 已执行。运行 DELETE_ALL.sql 后，该表仍会保留，因此 0001 不会自动重新执行。需要完全重建时，最干净的方法是创建一个新的 D1 database；如果明确要复用原数据库，则在清库后手工执行 CREATE.sql，而不是再次依赖 0001 migration。

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
82 tables
116 explicit indexes
0 FK violations
```

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
2. 用 SQLite 内存数据库验证 82 张表、116 个索引和外键；
3. 检查 `wrangler.toml` 已无占位符；
4. 使用官方 `cloudflare/wrangler-action@v3`；
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

注意：当前验证脚本针对完整 0001 初始 schema。增加 0002 以后，应同步扩展验证脚本，让它按文件名顺序执行全部 migrations。

## 13. 手工清空数据库

这是不可逆的危险操作。执行前先确认目标数据库，并优先依赖 D1 backup/Time Travel 或导出备份。

```bash
npx wrangler d1 execute DB --remote \
  --file="schema/HIREBEAT_D1_DELETE_ALL_2026-08-17.sql"
```

它只删除本项目的 82 张业务表，不删除 `d1_migrations`。如果目的是从零重新测试 migration，推荐删除并重新创建一个新的测试 D1 database，然后更新 `wrangler.toml` 的 UUID。

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
