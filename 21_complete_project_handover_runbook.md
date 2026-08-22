# HireBeat 完整项目与五类人员交接手册

## 1. 目的与适用范围

本手册用于把 HireBeat production 系统从个人维护状态交接到公司可持续运营状态。完成交接的标准不是“添加一个管理员邮箱”，而是接手团队已经能够独立完成日常业务操作、代码协作、生产审批、平台维护、故障恢复和人员离职回收，并且不再依赖原维护者的个人账户、个人邮箱或本地文件。

本手册覆盖以下七个权限面：

1. Cloudflare Access：控制谁可以访问 production Operations API。
2. Cloudflare Account：管理 D1、Workers、R2、Queues、DLQ、Workflows 和 Access。
3. GitHub Repository：管理代码、Pull Request、Actions 和仓库设置。
4. GitHub production Environment：审批生产迁移和部署。
5. Google Cloud production project：管理 Parser、ML、Cloud Run、IAM、Artifact Registry 和 Secret Manager。
6. Google Drive：管理 production 简历目录及共享关系。
7. 凭据与恢复资料：保存、轮换和恢复公司拥有的密钥与管理员入口。

当前 production 资源清单：

| 平台 | production 资源 |
| --- | --- |
| GitHub | Shiyi-Li027/hirebeat-recruiting-d1-v2-schema；Environment: production |
| Cloudflare D1 | hirebeat_recruiting_d1_v2_prod |
| Cloudflare R2 | hirebeat-hr-raw-resumes-pdf-r2-prod-v1 |
| Cloudflare Queue | hirebeat-submission-intake-prod-v1 |
| Cloudflare DLQ | hirebeat-submission-intake-dlq-prod-v1 |
| Cloudflare Workers | hirebeat-submission-ingress-prod-v1；hirebeat-etl-orchestrator-prod-v1；hirebeat-operations-api-prod-v1 |
| Cloudflare Workflows | hirebeat-workflow-a-prod-v1；hirebeat-workflow-b-prod-v1 |
| Google Cloud project | hirebeat-recruiting-prod-027 |
| Cloud Run | hirebeat-resume-parser-prod；hirebeat-ml-inference-prod |
| Google Drive | HireBeat Production Resumes；folder ID: 1daN3diSMow_9rov7e1uuxGdp61dubgi2 |

## 2. 交接基本原则

- 使用公司身份，不把个人邮箱作为唯一 Owner、审批人或恢复入口。
- 最小权限：业务人员不进入基础设施控制台；开发、部署、平台管理和业务数据权限分开。
- 双人控制：至少两名公司成员能够恢复系统，但生产部署仍需显式审批。
- 默认拒绝：没有被明确加入 Cloudflare Access policy 的人不能调用 Operations API。
- 密钥不进 Git、不写进本文档、不贴在工单或聊天中。
- GitHub Environment Secret 只能覆盖更新，不能读回；交接时应轮换，而不是尝试导出现有值。
- 每次授权必须配套一次登录验证、一次最小工作任务和一次回收演练。
- 先添加并验证新接手人，再移除原维护者，避免锁死账户。

## 3. 五类人员及权限边界

### 3.1 业务操作人员

目标：能够执行已经批准的招聘业务操作，但不能管理 Cloudflare、Google Cloud、GitHub 或直接修改 D1。

当前边界：内部 Operations Console 和路由级 RBAC 尚未完成，因此普通业务用户暂时不能广泛接入 production Operations API。现阶段只允许经过审核的少量 Operations Admin 使用现有 API；一般 HR 用户保持延期。

#### 授权步骤

1. 由直属负责人提交访问申请，写明姓名、公司邮箱、岗位、所需业务动作和到期日。
2. 系统管理员确认该用户确实只需要业务操作，不需要基础设施权限。
3. 在 Cloudflare Zero Trust 进入 Access controls → Applications → HireBeat Production Operations API。
4. 编辑 Production Operations Admin policy。
5. Action 保持 Allow。
6. Include selector 必须选择 Emails，然后逐一填入经过批准的公司邮箱。
7. 不选择 Everyone、All authenticated users、Emails ending in 或整个公共身份提供商。
8. 保存 policy 后，用 Policy tester 输入该邮箱验证 Allow；输入一个未授权邮箱验证 Deny。
9. 不给该用户 Cloudflare Account Member、GitHub collaborator、Google Cloud IAM 或 Drive Manager。

#### 首次使用验证

1. 用户打开 production Operations API 的 workers.dev 地址。
2. 使用被允许的公司身份提供商登录。
3. 确认 Cloudflare Access 登录完成；未授权账号必须被拒绝。
4. 在没有内部页面和 RBAC 前，仅由管理员使用经过审核的请求脚本调用允许的 API。
5. 执行一个低风险查询或测试操作，并在 D1 audit_event 中核对 actor_type、actor_id、event_type 和 occurred_at。
6. 禁止把 API Token、D1 控制台或 Worker Secret 发给业务人员。

#### 日常工作

- 只通过 Operations API 或未来的内部 Operations Console 操作。
- 遇到 401：检查身份是否有效、Access JWT 是否存在。
- 遇到 403：表示身份有效但业务权限不足，不应要求直接数据库权限绕过。
- 业务变更失败时提供 correlation key、时间和页面错误，不发送秘密值。

#### 验收与离职回收

- 验收：授权邮箱可进入，未授权邮箱被拒绝，操作进入 audit_event。
- 回收：从 exact-email Allow policy 删除邮箱，终止 Access session，再用 Policy tester 确认 Deny。
- 未来 RBAC 上线后，还必须同时禁用 Operations API 内部角色映射。

### 3.2 普通开发人员

目标：能够拉取代码、建分支、提交 PR、查看 CI 和只读排障，但不能自行批准 production deployment。

#### GitHub 授权步骤

1. 将开发人员加入公司 GitHub Organization；若仓库仍在个人 namespace，应优先迁入公司 Organization。
2. Repository → Settings → Collaborators and teams。
3. 添加用户或开发团队，赋予 Write。不要默认给 Admin。
4. Rulesets/Branches 中保护 main：要求 PR、要求状态检查、禁止强推和删除。
5. 确认开发人员不是 production Environment required reviewer，除非另有部署职责。

#### Cloudflare 只读授权

1. Cloudflare Dashboard → Manage account → Members → Invite。
2. 使用公司邮箱邀请。
3. 优先使用只读或 Analytics/Viewer 类角色，并把资源范围限制到工作所需账户。
4. 如果当前套餐或角色模型无法精确只读，则不要授予 Account Member；由平台人员提供经过脱敏的日志和诊断结果。
5. 不授予 D1 Edit、Workers Scripts Edit、Queues Edit、Access Apps Edit。

#### Google Cloud 只读授权

1. Google Cloud Console → IAM & Admin → IAM → Grant access。
2. 添加公司邮箱或开发团队 Google Group。
3. 仅按需要授予 Viewer、Logs Viewer、Cloud Run Viewer；避免 Project Owner/Editor。
4. 如需查看 Secret 名称，不代表需要读取 Secret payload；不要授予 Secret Manager Secret Accessor。

#### 首次工作验证

1. clone 仓库并执行 npm ci 和 npm test。
2. 创建个人 feature branch，提交一个无害文档更改并打开 PR。
3. 确认 CI 自动运行，开发人员不能直接 push 到受保护 main。
4. 查看一次 staging 或 production 只读日志，确认无法修改资源。
5. 确认无法批准 production Environment deployment。

#### 日常流程

1. 从最新 main 新建分支。
2. 本地测试、git diff --check、提交并推送。
3. PR 写 Summary、Validation、Scope notes。
4. 等待 checks 和代码审查后合并。
5. production 部署由独立部署人员启动和审批。

#### 回收

- 从 GitHub team/collaborators 移除。
- 从 Cloudflare Member 和 Google Cloud IAM/Groups 移除。
- 撤销个人 PAT、SSH key 和活跃会话；不需要轮换公司共享 Secret，因为不应把它们发给普通开发人员。

### 3.3 部署开发人员与 production 审批人

目标：可以发起受保护 GitHub Actions，并在职责允许时审批 production；不因能部署而自动获得全部平台管理权。

建议把“发起人”和“审批人”设置为不同人员。若团队规模暂时只有一人，保留审计评论并在扩员后开启 Prevent self-review。

#### GitHub 设置步骤

1. Repository → Settings → Environments → production。
2. Required reviewers 中添加公司的部署审批人或部署团队。
3. 有第二位审批人后勾选 Prevent self-review。
4. 取消 Allow administrators to bypass configured protection rules。
5. Deployment branches and tags 限制为 main。
6. 仓库权限给 Write 或 Maintain；只有需要管理仓库设置的人给 Admin。
7. 确认审批人能看到 Actions，但不能读取 Environment Secret 值。

#### production Environment 变量和 Secret 管理

非敏感变量包括：

- PRODUCTION_D1_DATABASE_ID
- PRODUCTION_PARSER_SERVICE_URL
- PRODUCTION_ML_SERVICE_URL
- PRODUCTION_SUBMISSION_UUID_NAMESPACE
- PRODUCTION_ACCESS_TEAM_DOMAIN
- PRODUCTION_ACCESS_AUD

敏感 Secret 包括：

- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_WORKERS_API_TOKEN
- CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON
- GOOGLE_SERVICE_ACCOUNT_JSON
- PARSER_SERVICE_AUTH_TOKEN
- ML_SERVICE_AUTH_TOKEN
- SUBMISSION_HMAC_KEY_V1
- INGRESS_INTERNAL_AUTH_TOKEN
- IDENTITY_HMAC_KEY_V1
- ORCHESTRATOR_INTERNAL_AUTH_TOKEN

Secret 不可读回；修改前必须从公司密码库取得当前受控副本，或直接生成新值并同步轮换所有消费者。

#### 日常部署步骤

1. 确认目标 commit 已在 main，checks 全绿，变更单和回滚计划已批准。
2. Actions 中选择对应 workflow：Deploy production D1 migrations、Deploy production Workers 或 Deploy production Operations API。
3. 选择 main，输入 workflow 要求的精确确认文本。
4. 等待 preflight 通过，不在 preflight 失败时强行绕过。
5. Required reviewer 检查 commit、变更范围、目标资源和 secrets/variables 最近更新时间。
6. Review deployments 评论写明批准内容，例如：Approved production Operations API deployment for commit <SHA>; validation passed and rollback plan reviewed.
7. 点击 Approve and deploy。
8. 部署完成后核对 Worker version、D1 migration count、Queue consumer、Workflow registration 和审计记录。
9. 在运行手册或 PR 中记录 workflow run number、commit SHA、审批人、结果和异常。

#### Operations API 特殊流程

1. 初次 bootstrap 可使用 deployment_mode=bootstrap，目的仅是让 Worker 出现在 Cloudflare Access 的 Worker destination 列表。
2. 创建 Access application 并取得 Application Audience/AUD 后，设置 PRODUCTION_ACCESS_AUD。
3. 再以 deployment_mode=access-protected 运行 Deploy production Operations API。
4. 确认线上配置不再使用 bootstrap 的占位 AUD。
5. 匿名请求必须被 Access 拦截，允许邮箱登录后才能到达 Worker。

#### 验收与回收

- 验收：能发起 workflow；未审批前 deploy job 等待；批准后成功；不能绕过 protection。
- 回收：从 required reviewers 和部署团队移除，撤销 GitHub session/PAT；必要时轮换其接触过的部署凭据。

### 3.4 平台运维人员

目标：日常管理 Cloudflare 和 Google Cloud 生产资源、处理告警和故障，但不默认拥有 GitHub Repository Admin 或业务 API 全权限。

#### Cloudflare Account 交接

1. Manage account → Members → Invite members。
2. 使用公司邮箱，不使用私人邮箱。
3. 根据职责授予资源级角色：
   - D1 管理：D1 Read/Edit。
   - Workers 管理：Workers Scripts Read/Edit、Workers Tail/Logs。
   - R2 管理：R2 Read/Edit。
   - Queue/DLQ 管理：Queues Read/Edit。
   - Access 管理：Zero Trust/Access Apps and Policies Admin。
4. 只选择 HireBeat 所在 account，避免 All accounts。
5. 除完整接班管理员外，不授予 Super Administrator。
6. 被邀请人接受后，逐项验证可查看目标资源，并确认看不到无关账户。

#### Google Cloud production project 交接

1. 项目切换到 hirebeat-recruiting-prod-027。
2. IAM & Admin → IAM → Grant access。
3. 推荐以 Google Group 授权；平台运维组按职责组合：Cloud Run Admin、Service Account User、Artifact Registry Reader/Writer、Logs Viewer、Secret Manager Viewer；需要轮换 Secret 的受控人员才给 Secret Manager Admin/Secret Accessor。
4. 只有完整接班管理员给 Project Owner；日常平台人员避免 Owner。
5. 验证可查看两个 Cloud Run service、revision、runtime service account、日志和 Secret 引用。
6. 验证不能随意修改 billing/IAM，除非这正是其职责。

#### 日常运维清单

- Cloudflare：Worker errors、Queue backlog、DLQ messages、D1 errors、R2 access、Workflow failures。
- Google Cloud：Cloud Run 5xx、latency、revision health、container logs、Secret version、service account key age。
- 每周检查未消费 DLQ；处理前保存 correlation key 和失败原因。
- 不直接在 D1 Console 修业务数据；优先使用 Operations API 和有审计的恢复命令。
- 紧急修改后必须补 PR、事件记录和复盘。

#### 故障演练验收

1. 识别一个模拟 Queue backlog。
2. 查看 Worker/Cloud Run 日志并找到 correlation key。
3. 不泄露 PII 地记录诊断结果。
4. 演示禁用一个旧 Secret version 和回滚 Cloud Run revision，但不在生产实际执行破坏性动作。
5. 确认紧急联系人、状态沟通和恢复时间目标。

### 3.5 系统管理员／完整项目接手人

目标：公司在原维护者不可用时仍可独立控制、恢复、审计和继续开发整个系统。

该角色需要覆盖全部七个权限面，但仍建议至少两名管理员互为备份，并把日常部署审批与平台超级管理员分开。

#### A. Cloudflare Access

1. 将接手人的精确公司邮箱加入 Production Operations Admin Allow policy。
2. 用 Policy tester 验证该邮箱 Allow、任意未授权邮箱 Deny。
3. 检查 Production Operations API destination 只指向 hirebeat-operations-api-prod-v1。
4. 删除或解除 HireBeat Google Form Catalog Sync Staging 这类 staging Service Auth policy 与 production app 的关联。
5. 如 production Catalog Sync 需要机器调用，创建 production 专用 Access service token 和 Service Auth policy，不复用 staging token。

#### B. Cloudflare Account

1. 邀请接手人的公司邮箱成为 Account Member。
2. 完整接手人可授予 Super Administrator；公司应至少有两名可恢复管理员。
3. 开启 MFA，记录 account ID、支持计划、账单联系人和域名状态。
4. 验证其能查看 D1、R2、Workers、Queues/DLQ、Workflows、Access 和 API Tokens。
5. 在新管理员验证完成前不要删除原管理员。

#### C. GitHub Repository Admin

1. 优先把仓库迁移到公司 Organization；若暂不迁移，至少新增公司控制的 Admin。
2. Settings → Collaborators and teams → Add people/team → Admin。
3. 新 Admin 检查 rulesets、Actions permissions、Environments、Secrets/variables、Deploy keys、Webhooks 和安全告警。
4. 验证能管理 PR、分支保护和 Actions，但不能读取已有 Secret payload。
5. 保存仓库恢复信息：默认分支、remote URL、required checks、workflow 文件和最近 release/tag。

#### D. GitHub production Environment reviewer

1. Settings → Environments → production。
2. 把接手人或部署团队加入 Required reviewers。
3. 验证仅 main 可部署、管理员不可 bypass。
4. 发起一次无变更或安全 dry-run，确认接手人能 Review deployments。
5. 评论、批准并核对审计记录。

#### E. Google Cloud production project

1. IAM 中为公司接手人或管理员组授予 Owner；若组织要求最小权限，则用预先批准的角色组合替代。
2. 同时确认 Billing Account 管理和项目恢复联系人不再只属于个人账户。
3. 验证 Cloud Run、Artifact Registry、Secret Manager、IAM、Service Accounts、Cloud Build 和日志权限。
4. 清点 user-managed service account keys，删除未知或重复 key。
5. 长期应使用 Workload Identity Federation/OIDC 取代静态 JSON key；迁移完成前把 JSON key 保存在公司密码库并设轮换日期。

#### F. Google Drive production 简历目录

1. 打开 HireBeat Production Resumes 文件夹。
2. Share → 添加接手人的公司 Google 账号，赋予 Manager 或 Editor；生产读取 service account 保持 Viewer。
3. 最佳做法是把目录迁入公司 Shared Drive，由公司而非个人拥有。
4. 新接手人上传一个无真实 PII 的测试 PDF，确认 service account 可读取，再删除测试文件。
5. 检查链接共享不是 Anyone with the link，并清理个人/过期共享者。

#### G. 凭据与恢复资料

1. 建立公司密码库 vault，至少两名受控管理员可恢复。
2. 保存项目标识、恢复步骤、密钥创建日期、key ID、用途、持有人和轮换期限；不把明文值写入 Git。
3. 交接期间轮换：Cloudflare API tokens、Access service tokens、内部 auth tokens、HMAC keys、Parser/ML tokens、Google service-account keys。
4. 每个 Secret 按“生成新值 → 更新上游和下游 → staging/production 验证 → 撤销旧值”顺序轮换。
5. 更新 GitHub Environment、Cloudflare Worker secrets、Google Secret Manager 后，确认各处版本一致。
6. 删除个人 Downloads 中未加密 JSON；加密备份也应迁入公司 vault，验证恢复后再删除个人副本。
7. 保存 break-glass 流程，使用一次性恢复账号、硬件 MFA 和密封恢复码；每季度测试。

#### 完整接手验收

接手人必须在原维护者仅观察、不代操作的情况下完成：

1. 合并一个文档 PR。
2. 发起并审批一个安全的 production workflow。
3. 登录 Cloudflare 并定位全部 production 资源。
4. 登录 Google Cloud 并查看 Cloud Run revision/logs 与 Secret 引用。
5. 管理 Drive folder 分享并完成无 PII 文件读取测试。
6. 使用 Access exact-email 登录 Operations API，并证明未授权邮箱被拒绝。
7. 从公司密码库恢复一个测试凭据，核对 checksum 后安全删除临时文件。
8. 解释 Queue → Worker → Cloud Run → D1/R2/Outbox 的故障定位链路。

## 4. Cloudflare Access 当前页面：Destination 与 Preview 怎么处理

### 4.1 Destination 应如何设置

在页面顶部 Destinations：

1. Scope 选择 hirebeat-operations-api-prod-v1。
2. Type 若可选 A Worker's production URLs，优先选择它。
3. 如果 UI 只有 A Worker's production and preview URLs，可以暂时使用；仓库已设置 preview_urls=false，因此没有可用的 Worker preview URL，但仍应保持配置层禁止 preview。
4. 不要添加 submission-ingress、etl-orchestrator、staging Worker、Public DNS、private hostname 或 private IP。
5. application 名称保持 HireBeat Production Operations API。

### 4.2 Preview 中的 Destination

底部 Preview 是系统根据 Sources、Policies 和顶部 Destinations 自动生成的摘要，不是手工输入框。

- 创建前显示 No destinations assigned 可能只是创建页面尚未持久化的预览状态。
- 不要为了修复 Preview 再添加第二个 destination。
- 完成下面的 policy 修正后点击 Create，然后重新打开 application；确认顶部仍保存 production Worker，并确认 Preview/详情页已经显示该 destination。
- 若 Create 后仍无 destination，返回编辑页删除该 Worker destination、保存，再重新添加一次；不要改成 Public DNS。

### 4.3 点击 Create 前必须修正的安全项

当前截图的 Preview 出现 All authenticated users，范围过宽。请先：

1. 编辑 Production Operations Admin。
2. Include selector 选择 Emails。
3. Value 填写唯一获批的公司管理员邮箱；需要多人时逐个添加精确邮箱。
4. 删除 Everyone、All authenticated users 或整个 identity provider 的 Include rule。
5. 保存后确认 Preview Sources 显示具体邮箱，而不是 All authenticated users。
6. 暂时移除 HireBeat Google Form Catalog Sync Staging Service Auth policy。production 不应复用 staging service token。
7. 初始状态只保留 Production Operations Admin Allow policy。
8. Authentication 中只开启实际使用的公司身份提供商；不需要 Browser rendering、RDP、SSH 或 VNC。
9. 确认无误后点击 Create。

### 4.4 创建后的收尾步骤

1. 打开新 application 的详情页，复制 Application Audience (AUD) / Audience tag。
2. AUD 应是 64 位十六进制值，不是 policy ID、application ID 或 team domain。
3. GitHub → Repository → Settings → Environments → production → Add environment variable。
4. Name 填 PRODUCTION_ACCESS_AUD，Value 填复制的 AUD。
5. PRODUCTION_ACCESS_TEAM_DOMAIN 保持 Cloudflare Zero Trust team domain；历史名称中含 stg 不会把 production 流量导向 staging，但长期可另行重命名/迁移。
6. Actions → Deploy production Operations API → Run workflow。
7. deployment_mode 选择 access-protected。
8. confirmation 输入 DEPLOY PRODUCTION OPERATIONS。
9. Required reviewer 评论：Approved Access-protected production Operations API deployment after exact-email policy and AUD verification.
10. 批准部署并等待成功。

### 4.5 访问验收

1. 无登录浏览器访问 Worker URL，必须被重定向到 Access 或拒绝，不能直接收到 API 成功响应。
2. 使用 Allow policy 中的邮箱登录，应能到达应用。
3. 使用未列入 policy 的邮箱测试，应被拒绝。
4. 调用健康/安全只读路由，确认 Worker 使用 production D1。
5. 检查 audit_event actor provenance；不要用生产写操作做首次测试。
6. 保存 Access application ID、AUD、policy ID、测试时间和测试人到受控运行记录，不保存 token 值。

## 5. 完整交接实施时间表

### D-14 至 D-7：准备

- 确认公司 Organization、公司邮箱、Google Group、密码库和两名接手管理员。
- 清点全部资源、成员、service account keys、GitHub secrets/variables 和 Access policies。
- 建立角色矩阵，记录每项授权的批准人和到期日。
- 创建测试方案和回滚计划。

### D-7 至 D-2：并行授权

- 添加新管理员，不删除原维护者。
- 完成五类人员的首次登录和最小任务。
- 把 Drive 迁入 Shared Drive 或至少添加公司 Manager。
- 轮换公司凭据并同步所有消费者。
- 做一次部署审批、Access deny、Drive read 和故障定位演练。

### D-1：最终核对

- 两名管理员均能恢复 Cloudflare、GitHub、Google Cloud 和密码库。
- production Environment 至少有合适 reviewer，且 main-only/no-bypass。
- Access 只允许精确邮箱或 production service token。
- 未授权身份测试为 Deny。
- 所有新密钥已验证，旧密钥等待正式撤销。

### D0：正式交接

- 接手人独立执行完整接手验收。
- 记录签字人、时间、资源版本、未完成风险和下一次轮换日期。
- 撤销旧 token 和旧 service-account key。
- 将原维护者从日常审批和 Owner 中降权，但先保留短期受控支持窗口。

### D+7 至 D+30：退出个人依赖

- 确认无系统仍使用个人邮箱、本机路径或个人 Drive 所有权。
- 移除原维护者的 Cloudflare/GitHub/GCP/Drive 权限。
- 撤销其 PAT、SSH key、OAuth session 和恢复码。
- 审计最近 30 天的部署、Secret、IAM 和 Access policy 变更。
- 完成复盘并关闭交接工单。

## 6. 季度复核清单

- 五类人员名单和业务职责仍匹配。
- Cloudflare Access 不含 Everyone 或 staging service token。
- Cloudflare/GitHub/GCP 不存在离职成员。
- production reviewer、main-only 和 no-bypass 仍有效。
- service-account user-managed keys 数量、年龄和用途清楚。
- GitHub Environment 与 Google Secret Manager/Worker secret 已按计划轮换。
- Drive 不允许公开链接，生产 reader 仍为 Viewer。
- Queue/DLQ、Workflow、Cloud Run 和 D1 有可执行的恢复步骤。
- 至少一名非原维护者完成了季度恢复演练。

## 7. 明确禁止事项

- 不把业务人员加为 Cloudflare Super Administrator。
- 不把 D1、R2、Queue、Cloudflare 或 Google service-account 凭据发给浏览器。
- 不复用 staging Access service token 保护 production。
- 不通过直接改 D1 绕过 Operations API、审计或状态机。
- 不在 PR、README、截图、聊天或 shell history 中写真实 Secret。
- 不在新接手人验证之前删除最后一个 Owner/Administrator。
- 不把“能够登录”当成交接完成；必须完成实际任务、拒绝测试、恢复测试和离职回收测试。
