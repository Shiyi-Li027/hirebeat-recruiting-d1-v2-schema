# HireBeat v2 Production Implementation Runbook

## 1. Implemented runtime chain

```text
Airtable Automation / Google Apps Script
  -> Submission Ingress (internal bearer authentication)
  -> bounded PDF download
  -> private R2 conditional PUT
  -> authenticated PDF Parser
  -> one D1 batch: raw_submission + raw_submission_resume
                   + raw_submission_intake_run succeeded
                   + Workflow A outbox
  -> Outbox dispatcher lease
  -> Cloudflare Workflow A
  -> Initial Cleaning / normalization / structured extraction / dedup-admission
  -> one D1 batch publishes minimum Person + Application + Candidate core
  -> Workflow B outbox
  -> Cloudflare Workflow B
  -> full Candidate/Person enrichment
  -> anomaly rules + all-MiniLM-L6-v2 cosine similarity
  -> fixed threshold policy
  -> one D1 batch publishes ML result, hiring stages and either Rejected or Offer draft
  -> protected Operations API creates immutable Offer versions and advances Offer state
```

All child entity sets allow zero rows. ML receives only complete `resume_text` and `position_jd`; it does not require Education, Employment, Skill, or Project rows. The frozen anomaly rules remain separate from cosine similarity. Skill tokens that do not match the active reviewed Skill Catalog remain in `resume_skill` as `rejected_unmapped_skill` evidence and are never promoted into `person_skill` or `candidate_skill`.

The active `workflow.default_step_max_attempts` value counts total attempts, including the original call. Cloudflare Workflows gives `retries.limit` the same total-attempt meaning, so the adapter passes the configured value directly, uses exponential backoff from one second, and applies a ten-minute per-step timeout. Permanent validation, configuration and stale-fence failures stop immediately through `NonRetryableError`. ML and Parser HTTP calls additionally enforce their shorter 30-second request timeout.

Submission intake is asynchronous. The authenticated HTTP route validates the source envelope, stores a private integrity-checked replay envelope in R2, publishes only its pointer and keyed HMAC to `hirebeat-submission-intake-stg-v1`, and returns HTTP 202. Queue `max_retries = 4` means one initial delivery plus four redeliveries, matching the frozen maximum of five total intake attempts. Retryable failures use jittered backoff; terminal failures are acknowledged immediately. Exhausted messages move to `hirebeat-submission-intake-dlq-stg-v1`, whose consumer automatically marks the D1 run `failed_terminal`.

After a retryable technical failure exhausts that cycle, do not resubmit the
source application. Correct the Secret, permission, mapping, dependency, or
code, then use the Access-protected controlled-recovery command. It reuses the
private R2 replay envelope and stable Submission identity, rotates a recovery
fence, and commits one Queue-targeted Outbox event. Outbox and Queue then resume
the work automatically. Older Queue messages are harmless because their fence
no longer matches.

The one-minute orchestrator schedule also runs a bounded idempotent reconciler before Outbox dispatch. It requeues only current `processing + pending` Applications whose Position JD has become ready, so superseded/cancelled Applications cannot be revived. It also expires sent/viewed Offers whose current immutable Offer version has passed `response_due_at`, appending Offer status history and an audit event.

An Offer version may omit `response_due_at` while it is a Draft. The Operations API normalizes explicit deadlines to RFC 3339 UTC and rejects invalid or non-future values. On the `sent` transition, an explicit future deadline is retained; if it is absent, the API reads `offer.default_response_window_days` from the active versioned configuration, calculates the deadline from the actual send instant, derives a new immutable Offer version, points the Offer to it, and transitions the status in one short D1 batch. Database triggers reject any direct writer that attempts to enter `sent` without a parseable future deadline.

All persisted instants use RFC 3339 UTC. The active versioned configuration declares `localization.storage_timezone = "UTC"` and `localization.business_timezone = "America/New_York"`. An Operations caller may provide an explicit RFC 3339 offset, or pair a wall-clock `response_due_at` with `response_due_at_timezone = "America/New_York"`; the API rejects nonexistent DST times and requires an explicit offset for repeated fall-back times. Raw D1, Workflow, Queue, retry, lease, deadline, and audit comparisons remain UTC. Human inspection exports retain the canonical UTC field and append an `_eastern` display column. Date-only business fields are never shifted.

Outbox delivery is at least once. A stable `event_uuid` is also the Cloudflare Workflow instance ID. If `create()` succeeded but the Outbox status update was interrupted, redelivery confirms the existing instance with `get()` and `status()` instead of creating a second Workflow or exhausting the event as a false failure.

Deterministic Workflow/Outbox fault fixtures require both
`DEPLOYMENT_STAGE=staging` and `ENABLE_STAGING_FAULT_INJECTION=enabled`, plus an
exact reviewed synthetic source record ID. Production configuration must omit
the enablement variable. The pre-create and post-create/pre-ack Outbox fixtures
fail only delivery attempt 1. Separate boundary fixtures replace only the
in-memory dispatcher input with invalid JSON or an unsupported destination, so
the real terminal classifiers run without weakening D1's `json_valid` CHECK or
mutating the stored event. The transient Workflow fixture fails only step
attempt 1; the permanent contract fixture remains terminal on every attempted
execution and crosses the runtime boundary as `NonRetryableError`.

Within Workflow A, a retry of Resume extraction or Dedup removes only the same input/version's unpublished partial derivative before rebuilding it. Successful historical results, Raw evidence and shared reference rows are never part of that cleanup. ML input identity includes the Application decision fence, so a manual re-request produces a distinct auditable analysis run while technical retries under the same fence remain idempotent.

## 2. Runtime packages

| Package | Responsibility |
|---|---|
| `workers/submission-ingress` | source adaptation, technical idempotency, R2, Parser, Raw atomic publication |
| `workers/etl-orchestrator` | Outbox leasing, Workflow A, Workflow B, compensation-safe fencing |
| `workers/operations-api` | Access-authenticated Catalog, ML re-request, Offer version and Offer status commands |
| `services/resume-parser` | authenticated PyMuPDF PDF-to-text service |
| `services/ml-inference` | authenticated all-MiniLM-L6-v2 cosine-similarity service |
| `scripts/export_workflow_inspection.py` | read-only, on-demand test inspection CSV export |

## 3. HTTP boundaries

### Submission Ingress

- `GET /health`: public non-sensitive liveness only.
- `GET /ready`: authenticated configuration readiness.
- `POST /internal/v1/submissions/intake`: canonical intake.
- `POST /internal/v1/sources/airtable`: Airtable event adapter.
- `POST /internal/v1/sources/google-form`: Google event adapter.

### ETL Orchestrator

- `GET /health`: liveness.
- `POST /internal/dispatch`: authenticated manual Outbox drain; cron also drains pending events.

### ML Inference

- `GET /health`: public non-sensitive liveness only; Cloud Run IAM can still
  keep the entire service private at the platform boundary.
- `GET /ready`: authenticated readiness that loads the reviewed model.
- `POST /v1/similarity`: authenticated Resume-to-JD cosine similarity.
- The image pins Hugging Face revision
  `c9745ed1d9f207416be6d2e6f8de32d1f16199bf`, downloads it at build time and
  runs with Hugging Face/Transformers offline mode enabled.

### Operations API (Cloudflare Access JWT required)

Reference and Catalog authoring endpoints include:

- `GET /v1/reference/types` and `POST /v1/reference/{type}` for every G01 Reference importer;
- `PATCH /v1/reference/{type}/{id}/active-state` for controlled Reference activation/deactivation;
- `GET /v1/catalog/child-types` and `POST /v1/catalog/children/{type}` for the remaining G02 child tables;
- `PATCH /v1/catalog/children/{type}/{id}/active-state` for G02 child state changes;
- `POST /v1/intake-runs/{id}/recover` for an audited, idempotent release of a
  technically exhausted Intake run after its root cause has been corrected;

For the first reviewed staging Catalog path, generate the ignored private
preflight output and use the dry-run-first importer:

```bash
npm run data:preflight
npm run data:seed:staging
```

After reviewing the selected source row, JD hash/length, Work Mode and stable
idempotency keys, explicitly apply it:

```bash
python3 scripts/import_reviewed_staging_catalog_seed.py \
  --apply \
  --confirm "ags logistics|operations data analyst (on-site)"
```

The apply path delegates requests to the official `cloudflared access curl`
wrapper, which uses the operator's short-lived Access session without the
importer printing or persisting its JWT. The four mutations
(Company, Company Work Mode, Position and Catalog revision) each use a stable
idempotency key, so an interrupted command can be safely rerun. This is a
reviewed staging bootstrap, not a bulk auto-approval mechanism for ambiguous
private source rows.

- records with `is_active` default to active unless an authoring command explicitly supplies `false` or `0`;
- Position defaults to `active` only when its JD passes the 10-character readiness gate; otherwise it defaults to `draft`.
- `draft` Positions are excluded from published Catalog options and are blocked
  by Workflow A even when a trusted source carries an authoritative Position
  ID. Workflow A also blocks paused, closed, archived, missing, wrong-Company,
  and non-ready-JD Positions using distinct reason codes. Workflow B retains a
  second readiness check for a Position that changes after Application creation.
- A later Position update that supplies a ready JD requeues every matching
  current `processing + pending` Application only when the waiting row is its
  latest Workflow B run, through an idempotent Outbox event and a newly rotated
  decision fence.

- Catalog company, company-work-mode, position and revision endpoints.
- `POST /v1/applications/{id}/ml-recommendation`: rotate fence and request a fresh Workflow B run.
- `POST /v1/offers/{id}/versions`: append one immutable Offer terms version.
- `POST /v1/offers/{id}/status`: validated optimistic Offer-state transition.

Every mutation requires a caller-supplied `idempotency_key`. Migration `0008` enforces uniqueness for command audit events. Migration `0009` guarantees that one normalized Submission can be promoted as the primary input of only one Application; retrying a committed core-publication batch reuses the existing Application, Candidate and Workflow B Outbox event.

## 4. Required non-secret variables

| Worker/service | Variable |
|---|---|
| Ingress | `DEPLOYMENT_STAGE`, `SOURCE_SCHEMA_VERSION`, `SUBMISSION_UUID_NAMESPACE`, `PARSER_SERVICE_URL` |
| Orchestrator | `DEPLOYMENT_STAGE`, `WORKFLOW_A_VERSION`, `WORKFLOW_B_VERSION`, `ML_SERVICE_URL` |
| Operations | `DEPLOYMENT_STAGE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
| ML service | `MODEL_REVISION` |
| Parser service | `MAX_PDF_BYTES` |

Place environment-specific URLs and Access identifiers in the deployment environment, not in source defaults.

The Cloudflare account currently has no managed domain. Staging Ingress and
Operations use stable `workers.dev` targets with preview URLs disabled.
Production Operations temporarily also uses its stable `workers.dev` route
with preview URLs disabled and Cloudflare Access Worker-level protection over
all traffic. Every Ingress mutation still requires the provider-specific HMAC
header, while every Operations route except `/health` requires a valid
Cloudflare Access JWT. `workers.dev` is only the transport endpoint; it is not
an authorization boundary and does not weaken either application-level
verification path. Production Ingress and ETL Orchestrator remain
`workers_dev = false`; Orchestrator has no public route.

The administrator-only production `workers.dev` route is a reviewed bootstrap
transport. When a company-owned managed domain is available, move Operations
to the reviewed custom domain and revalidate the Access destination, AUD,
exact-email Allow policy and unauthorized-user denial before enabling business
traffic.

## 5. Required Secrets

| Runtime | Secret |
|---|---|
| Ingress | `SUBMISSION_HMAC_KEY_V1`, `INGRESS_INTERNAL_AUTH_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON`, `PARSER_SERVICE_AUTH_TOKEN` |
| Orchestrator | `IDENTITY_HMAC_KEY_V1`, `ORCHESTRATOR_INTERNAL_AUTH_TOKEN`, `CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON`, `ML_SERVICE_AUTH_TOKEN` |
| Resume Parser | `PARSER_SERVICE_AUTH_TOKEN` |
| ML service | `ML_SERVICE_AUTH_TOKEN` |
| GitHub migration environment | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

`AIRTABLE_API_TOKEN` is needed only if a future adapter calls Airtable's API directly. Attachment URLs supplied by a trusted Automation do not automatically require it.

`CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON` belongs to a dedicated least-privilege
Google service account that has `roles/run.invoker` only on the private Parser
and ML services. Workers exchange its signed assertion for a short-lived,
audience-bound Google ID token and send that token in
`X-Serverless-Authorization`; the independent Parser/ML application token stays
in `Authorization`. Do not reuse the Google Drive reader identity for this role.
Migrate away from a downloaded key to Workload Identity Federation if a
supported Cloudflare workload identity becomes available.

## 6. Release gates

Run before every deployment:

```bash
npm ci
npm run schema:build
npm run schema:validate
npm run workers:build
python3 -m compileall -q services scripts
python3 -m pip install -r services/resume-parser/requirements-dev.txt
PYTHONPATH=services/resume-parser python3 -m pytest -q services/resume-parser/test
```

Staging and production migrations, runtime deployments, synthetic end-to-end acceptance, and the Google Form provider-native submission path have completed successfully. Production uses separate D1, R2, Queues/DLQ, Workers, Workflows, private Parser/ML services, Access configuration and Secrets. The temporary Access-protected `workers.dev` Operations route is the documented no-domain exception; staging resources must never be rebound or reused as production resources.

## 7. Provider-native channel status

The Google Form provider-native staging channel is implemented and accepted.
Its verified path covers Catalog option synchronization, native Form submission,
authenticated Ingress delivery, Queue intake, Workflow A, normalized submission,
deduplication, Application creation, Workflow B, ML recommendation and Offer
draft creation. The accepted evidence is recorded in
`17_staging_end_to_end_acceptance_plan.md` and the staging closeout report.

The Airtable provider-native application window is deliberately deferred. Its
templates may remain in the repository for future work, but Airtable activation
is not part of the current production scope and does not block the accepted
Google Form channel.

Continue to follow `20_provider_native_submission_windows.md`; never place
provider credentials, Access service-token secrets, Form IDs or production
resource identifiers directly in tracked source files.

## 8. Operations access boundary

Cloudflare Access authentication and authenticated actor provenance are
implemented for the Operations API. They establish who made a request, but do
not yet provide application-level role mapping or route-level RBAC.

Until the deferred RBAC layer and internal Operations Console are implemented:

- restrict the production Access application to reviewed administrator/operator
  identities;
- do not treat any valid Access JWT as authorization for every API command;
- do not onboard broad business-user groups to the production Operations API;
- do not grant business users direct D1, Workers, R2, Queue, DLQ, GitHub or
  Cloudflare API-token access;
- continue recording all accepted business commands in `audit_event`.

The production infrastructure may be deployed with this narrow administrative
Access policy. Expanding access to ordinary business users must remain blocked
until the permission matrix, API enforcement, authorization tests and staging
user acceptance are complete.

## 9. Initial production D1 migration evidence

Status: **PASS for the initial schema migration only**. This does not activate
the production provider channel or deploy the production Workers.

- GitHub Actions workflow `Deploy production D1 migrations`, run `#1`, was
  manually dispatched from `main` at commit `f4f49a0`.
- The preflight validation job passed before the deployment job entered the
  protected `production` Environment.
- The production deployment required and received explicit Environment
  reviewer approval.
- All 14 repository migrations were applied to the isolated production D1
  database `hirebeat_recruiting_d1_v2_prod`.
- Remote verification found 84 schema-managed application tables. The raw
  count excluding SQLite internal tables and `d1_migrations` was 85 because
  Cloudflare also creates the managed `_cf_KV` table.
- Remote verification found 120 explicit indexes and 0 foreign-key violations.
- Representative Intake, ETL, Application, ML, Offer, Catalog Sync, Audit and
  Outbox runtime tables all contained 0 rows, confirming that staging runtime
  data was not copied into production.
- D1 rejected `PRAGMA integrity_check` with `SQLITE_AUTH`; this is a platform
  restriction on that pragma and is not evidence of database corruption.
- No production Worker, Workflow, provider submission window or business-user
  access was enabled by this migration run.

## 10. Initial production Worker deployment evidence

Status: **PASS for the initial Submission Ingress and ETL Orchestrator
deployment only**. This does not enable production provider traffic or deploy
the production Operations API.

- GitHub Actions workflow `Deploy production Workers`, run `#2`, was manually
  dispatched from `main` at commit `41ac450`.
- Preflight validation passed before the deployment job entered the protected
  `production` Environment.
- The production deployment required and received explicit Environment
  reviewer approval.
- Submission Ingress deployment version
  `315e3994-cda5-43c7-be29-5aaf7247f493` was created from commit `41ac450`.
- ETL Orchestrator deployment version
  `08a8896b-1587-4d1d-acc9-ca7acea002c5` was created from the same commit.
- The production Intake Queue reports 2 producers and 1 consumer; the
  production DLQ reports 1 consumer.
- `hirebeat-workflow-a-prod-v1` and `hirebeat-workflow-b-prod-v1` are
  registered to `hirebeat-etl-orchestrator-prod-v1`.
- Production Resume Parser and ML inference services, dedicated invocation
  identity, service authentication and Google Drive reader access are
  configured.
- Production D1 still reports 14 applied migrations, 0 foreign-key violations
  and no representative runtime, PII, audit or Outbox records after deployment.
- The production Operations API was excluded from this Worker run and was
  deployed and Access-protected separately afterward. Custom-domain routing
  and the provider business channel remain excluded.

## 11. Initial production Operations API deployment evidence

Status: **PASS for the administrator-only Operations API deployment and
Cloudflare Access acceptance**. This does not enable the production provider
channel, broad business-user access or production business traffic.

- GitHub Actions workflow `Deploy production Operations API`, run `#2`, was
  manually dispatched from `main` at commit `7cbb3c3`.
- The preflight validation job passed before the deployment job entered the
  protected `production` Environment.
- The deployment required and received explicit Environment reviewer approval.
- `hirebeat-operations-api-prod-v1` was deployed to its temporary production
  `workers.dev` URL; preview URLs remain disabled.
- Cloudflare Access Worker-level protection applies to all production URL
  traffic. The `Production Operations Admin` Allow policy contains only the
  exact administrator email `shiyilidorothy@gmail.com`.
- The production Access AUD is configured in the protected GitHub Environment;
  its full value is intentionally omitted from documentation.
- Authorized acceptance checks passed for `/health`, `/v1/reference/types`,
  `/v1/catalog/options` and `/v1/system/time-policy`. The health response
  reported `stage: production`; the Catalog response remained empty by design;
  and the time-policy response reported configuration release version 3, UTC
  storage and `America/New_York` business/display time.
- The root path returned `{"error":"not_found"}`, which is expected because the
  API defines no root route.
- An unauthenticated incognito request was redirected to Cloudflare login, and
  an unauthorized-email denial test passed.

## 12. Production Catalog / Operations write acceptance evidence

Status: **PASS for the minimum production Catalog write path**.

The acceptance was performed through the Cloudflare Access-protected production
Operations API, not by directly inserting rows in D1.

### Accepted business records

- Company: `Nello` (`company.id = 1`).
- Company Work Mode: `Remote` (`work_mode.id = 3`, code `remote`,
  `company_work_mode.id = 1`).
- Position: `Influencer Marketing Coordinator` (`position.id = 1`).
- Catalog revision: `1` (`catalog_revision.id = 1`).
- Snapshot SHA-256:
  `123fe2375d16d0334c12aae4359db9fe3bd30390ecb913f33fb00fd728e2e895`.

After publication, `/v1/catalog/options` returned revision `1` and the expected
Company, Company Work Mode, and Position. Production D1 inspection independently
confirmed the same rows.

### Audit and actor provenance

The four accepted commands produced one `audit_event` each:

- `command.catalog.company.create`;
- `command.catalog.company_work_mode.create`;
- `command.catalog.position.create`;
- `command.catalog.revision.publish`.

Each event retained actor type `member` and actor ID
`shiyilidorothy@gmail.com`. The correlation/idempotency keys were:

- `prod-acceptance-nello-company-v1`;
- `prod-acceptance-nello-remote-v1`;
- `prod-acceptance-nello-position-v1`;
- `prod-acceptance-nello-revision-v1`.

### Idempotency replay

The exact same JavaScript request sequence was executed a second time. Company,
Company Work Mode, Position, and Catalog Revision responses all contained
`idempotent_reuse: true`. The following counts remained unchanged:

- `company = 1`;
- `company_work_mode = 1`;
- `position = 1`;
- `catalog_revision = 1`;
- one matching `audit_event` for each of the four correlation keys.

This confirms that retrying an already accepted business command does not create
duplicate business rows or duplicate audit events.

### Access and scope boundaries

- The exact-email production Access user successfully authenticated and used the
  protected API.
- A separately tested unauthorized email was denied access.
- No staging or legacy runtime data was copied into production.
- This acceptance does not enable Google Form or other production provider
  traffic.
- Initial bulk Reference/Catalog CSV import remains deferred.
- Routine business writes must use the Operations API; direct production D1
  writes are not an approved operating procedure.
- Broad business-user access, the internal Operations Console, and route-level
  RBAC remain deferred as documented in the future-optimization plan.

## 13. Production Parser and ML runtime smoke evidence

Status: **PASS for the minimum non-mutating production runtime smoke scope**.

- Protected GitHub Actions workflow `Smoke test production Parser and ML`, run
  `#1`, was manually dispatched from `main` at commit `7e26c91`.
- The protected production runtime configuration validation passed.
- The authenticated production Resume Parser smoke request passed.
- The authenticated production ML smoke request passed and satisfied the
  workflow's response-contract checks.
- No D1 write commands were executed.
- No Queue or Workflow messages were submitted.
- No production resume or applicant data was used.

This evidence confirms the configured private production service URLs,
authentication path, reachability and minimum response contracts. Provider-path
end-to-end acceptance, controlled monitoring failure/notification/recovery and
Operations API rollback/forward restoration were completed afterward.

## 14. Production deployment closeout and deferred follow-up

The original pre-enable checklist is now closed for runtime and operational
readiness. Continue to enforce these operating and deferred-handover boundaries:

- Maintain the already isolated production D1, R2, Queues/DLQ, Workers,
  Workflows and Operations API without rebinding any staging resource.
- The minimum non-mutating production Parser/ML runtime smoke, provider-path
  end-to-end acceptance, runtime monitoring, controlled failure notification and
  Operations API rollback/forward restoration have passed.
- The administrator-only Operations API currently uses an Access-protected
  `workers.dev` route as the reviewed temporary no-domain solution. Move it to
  a company-owned custom domain when available, then revalidate its Access
  destination, AUD, exact-email Allow policy and unauthorized-user denial.
- Continue requiring the protected GitHub production Environment and reviewer
  approval for every later production migration and deployment.
- Production-only Google Form provider identifiers, Ingress credentials and
  Cloudflare Access service credentials are configured; do not reuse staging
  tokens or Secrets in later rotations.
- The implemented `catalog_sync_run` / `catalog_sync_target_run`
  result-reporting path has passed a real Google Form Catalog Sync in staging.
  Add an automatic retry dispatcher before relying on `failed_retryable`
  recovery in production.
- The minimum production Catalog write acceptance passed through the Operations
  API. Initial bulk Reference/Catalog CSV import remains deferred; never replace
  it with direct D1 writes or copied staging runtime data.
- Rotate or replace every credential that has appeared in an attachment,
  screenshot, terminal transcript or chat record.

Future changes must not weaken authentication, reuse staging infrastructure or
silently apply defaults.

## Production Google Form provider end-to-end acceptance evidence

Status: **PASS — controlled synthetic production acceptance (2026-08-22)**

The verified production path was:

`Google Form → Apps Script provider bridge → Cloudflare Access-protected Submission Ingress → D1/R2 → Intake Queue → ETL Workflows → Parser/ML`

### Observed evidence

- Three controlled synthetic Google Form submissions completed successfully.
- Apps Script `onHireBeatFormSubmit` executions completed.
- The production Intake Queue ingested 3 messages, acknowledged 3 messages, retried 0 messages and returned to 0 backlog.
- The production Intake DLQ contained no unacknowledged messages.
- Production R2 contains submission-scoped objects under both `raw-resumes/v1` and `intake-replay-envelopes/v1`.
- The production Catalog option synchronizer continued to complete on its five-minute time-based trigger.

### Production D1 acceptance counts

| Table or check | Observed value |
| --- | ---: |
| `raw_submission` | 3 |
| `raw_submission_resume` | 3 |
| `raw_submission_intake_run` | 3 |
| `submission_dedup_run` | 3 |
| `normalization_run` | 3 |
| `etl_workflow_run` | 6 |
| `etl_step_run` | 30 |
| `person` | 2 |
| `application` | 3 |
| `application_stage_run` | 9 |
| `ml_analysis_run` | 3 |
| `offer` | 0 |
| `audit_event` | 7 |
| `outbox_event` | 36 |
| Foreign-key violations | 0 |

`person = 2` with `application = 3` is expected: the production identity-deduplication path reused a person identity while retaining separate application records.

### Scope boundary

These counts are the retained snapshot from the initial three-submission acceptance; `offer = 0` in that snapshot does not contradict the later closeout evidence that a synthetic provider flow reached Offer processing. This acceptance does not authorize unrestricted real-applicant traffic. Monitoring, controlled notification failure/recovery, Operations API rollback/forward restoration and final readiness audit were completed afterward.

## Production Google Form Catalog 日常同步操作

### 适用范围与责任人

本流程用于 Operations API 中的 Company、Work Mode 或 Position 发生变化后，将最新的已发布 Catalog Revision 同步到 production Google Form。执行者必须是获授权的 Catalog/Operations 操作人员；普通招聘人员不需要进入 Apps Script。

### 每次 Catalog 变更后的标准流程

1. 通过 Operations API 创建或更新 Company、Company Work Mode 和 Position。
2. 完成业务复核后，通过 Operations API 发布新的 Catalog Revision。
3. 根据业务时效选择：
   - **立即需要显示**：手动运行 `syncHireBeatCatalogOptions()`。
   - **不要求立即显示**：等待已经配置且验证成功的五分钟 time-driven trigger。
4. 同步后检查 production Google Form 的 Position 选项，确认 Company → Work Mode → Position 层级与最新 Revision 一致。
5. 在 Apps Script 的 Executions 页面确认本次 `syncHireBeatCatalogOptions` 状态为成功，并核对记录的 revision number、snapshot SHA-256 和同步时间。
6. 若同步失败，不得让招聘人员继续使用可能过期的选项；先检查 Script Properties、Cloudflare Access Service Token、Operations API 可用性和执行日志，然后重试。

### 核对或创建五分钟触发器

1. 打开 production Google Form 绑定的 Apps Script 项目。
2. 点击左侧 **Triggers**（闹钟图标）。
3. 保留现有的 `onHireBeatFormSubmit` / **From form – On form submit** 触发器，不要删除或修改。
4. 检查是否存在以下触发器：
   - Function：`syncHireBeatCatalogOptions`
   - Deployment：`Head`
   - Event source：`Time-driven`
   - Time based trigger type：`Minutes timer`
   - Minute interval：`Every 5 minutes`
5. 如果不存在，点击 **Add Trigger**，按上述值创建并完成 Google 授权。
6. 创建后先在编辑器中手动运行一次 `syncHireBeatCatalogOptions()`，再到 **Executions** 确认成功。
7. 只有在 Triggers 页面可见且至少一次执行成功后，才可以把它视为已启用。在此之前，每次发布 Revision 后都必须手动同步。

### 立即手动同步

1. 打开 production Google Form 对应的 Apps Script 项目。
2. 在函数下拉框选择 `syncHireBeatCatalogOptions`。
3. 点击 **Run**。
4. 等待 Execution log 显示成功。
5. 打开 production Google Form，确认职位列表已更新。
6. 在 Executions 中保存本次成功运行的时间、revision number 和 snapshot SHA-256 作为验收证据。

### 禁止事项

- 不要用 `onOpen` 代替手动或五分钟定时同步。
- 不要删除 `onHireBeatFormSubmit`。
- 不要让普通招聘人员获得 Apps Script、Service Token 或生产基础设施权限。
- 不要绕过 Operations API 直接写 D1。
- 不要在发布 Catalog Revision 之前同步草稿数据。
- 不要把 0–5 分钟目标延迟描述为可用性 SLA。

## Production Worker observability evidence (2026-08-23)

Status: **PASS for persisted invocation logging and basic runtime visibility**.

### Deployment evidence

- PR #24 was merged to `main` as commit `871b93a`.
- Protected `Deploy production Workers` run `#5` redeployed Submission Ingress and ETL Orchestrator after production Environment approval.
- Run `#4` failed only in preflight because the supplied confirmation text was not exactly `DEPLOY PRODUCTION WORKERS`; its deployment job never ran.
- Both production templates contain:

  ```toml
  [observability.logs]
  enabled = true
  invocation_logs = true
  ```

### Runtime evidence

- ETL Orchestrator observability recorded its `*/1 * * * *` scheduled invocation with outcome `ok` (1 success, 0 errors).
- A temporary Apps Script verifier called the Access-protected production Ingress `/health` endpoint and received HTTP 200 with:

  ```json
  {"service":"hirebeat-submission-ingress","version":"1.0.0-production-ingress","status":"running","deploymentStage":"production","writesEnabled":true}
  ```

- Ingress observability recorded the successful `GET /health` invocation (1 success, 0 errors).
- The temporary `verifyProductionIngressObservability()` function was removed after verification.
- The existing `onHireBeatFormSubmit` and five-minute `syncHireBeatCatalogOptions` triggers remain unchanged.

### Scope and remaining work

The health verification made no D1 writes and submitted no Queue or Workflow messages. Controlled monitoring failure/notification/recovery and Operations API rollback/forward restoration were completed afterward; a real-outage drill remains optional follow-up rather than a readiness blocker.

## Production 定时运行时监控运行手册与证据（2026-08-23）

### 当前配置

Production 运行时监控由
`.github/workflows/monitor-production-runtime.yml` 执行：

- 定时频率：每 15 分钟
- 手工触发：支持
- GitHub Environment：`production-monitoring`
- 检查对象：
  - Submission Ingress `/health`
  - Operations API `/health`
- 认证方式：专用 Cloudflare Access monitoring Service Token
- 数据修改：不执行 D1、Queue 或 Workflow 写入

### 已验证证据

首次确认的定时运行：

- run number：`#2`
- database ID：`32661661195`
- event：`schedule`
- branch：`main`
- commit：
  `a8aec519d4951902960102351bd2322126e5c39e`
- started：`2026-08-23T19:34:25Z`
- completed：`2026-08-23T19:34:35Z`
- conclusion：`success`

该运行确认：

- Submission Ingress `/health`：PASS
- Operations API `/health`：PASS
- Cloudflare Access service authentication：PASS
- D1/Queue/Workflow mutation：none

### 日常检查

1. 打开 GitHub Actions 的 `Monitor production runtime endpoints`。
2. 确认最近的 scheduled run 为 `success`。
3. 若失败，打开失败 job，先区分：
   - Cloudflare Access 认证失败
   - Submission Ingress 健康检查失败
   - Operations API 健康检查失败
   - GitHub Environment Secret 或 Variable 缺失
4. 不要通过重复提交业务数据来测试健康状态。
5. 不要为了排障绕过 Cloudflare Access。
6. 修复后手工运行一次 workflow，并等待下一次 scheduled run 成功。

### 告警与后续工作

当前已保留：

- Access Service Token expiration notification
- Billing Budget Alert

当前账户 UI 未提供适用的 Workers/Queues 错误阈值通知。因此仍需后续完成：

- 受控失败路径演练
- 告警邮件送达验证
- Queue/DLQ 异常监控设计
- rollback 验证
- 公司账号接管后的通知收件人和 monitoring token 轮换

## Production 监控失败路径与通知送达运行手册（2026-08-23）

### 已验证证据

- 失败运行：[`Monitor production runtime endpoints #12`](https://github.com/Shiyi-Li027/hirebeat-recruiting-d1-v2-schema/actions/runs/32674785941)
- 恢复运行：[`Monitor production runtime endpoints #13`](https://github.com/Shiyi-Li027/hirebeat-recruiting-d1-v2-schema/actions/runs/32675179763)
- 验证 commit：`a838798e3e0b740065da4b4c6b09591895f7edca`
- 失败运行先完成真实只读健康检查，再由 `simulate_failure=true` 主动退出失败。
- GitHub Inbox 与 GitHub 账户邮箱均收到失败通知。
- 新运行使用 `simulate_failure=false` 后成功恢复。
- 两次运行都没有执行生产数据写入、部署或消息投递。

### 日常监控失败处理

1. 打开失败的 `Monitor production runtime endpoints` workflow run。
2. 查看 Job Summary，确认具体是 Ingress、Operations API、Cloudflare Access authentication，还是受控模拟步骤失败。
3. 如果运行使用了 `simulate_failure=true`，将其识别为受控测试，不要把它当作真实生产中断。
4. 如果需要验证恢复，不要点击 `Re-run failed jobs`，因为它会沿用原运行输入。
5. 返回 workflow 首页，点击 `Run workflow`，选择 `main`。
6. 输入要求的确认文字，并将 `simulate_failure` 设为 `false`。
7. 启动新的独立运行，确认两个 `/health` 检查、Access authentication 和整体结论全部为 PASS。
8. 保存失败运行、通知送达和恢复运行的链接作为审计证据。
9. 如果非模拟的定时运行失败，应停止发布操作并调查 Access token、Worker deployment、URL、网络及服务健康状态。

### 安全边界

该验收只验证监控失败检测、GitHub 通知和恢复流程，不会故意破坏生产 Worker、D1、Queue、Workflow、Parser、ML 或真实申请数据。真实故障注入和生产回滚验证必须另行审批。

## Production Operations API 回滚与前向恢复运行手册及证据（2026-08-23）

### 已验证版本

- Worker：`hirebeat-operations-api-prod-v1`
- 已知正常回滚版本：
  `3ef7a9c7-93b3-4125-bed7-15cc60fcdd11`
- 前向恢复版本：
  `3b424f14-1383-43a0-b207-ec2cfb993281`
- 禁止作为日常回滚目标的 bootstrap 版本：
  `5261e449-0796-4499-a5ac-73c9da05e527`

### 受控回滚操作

1. 首先运行 `Monitor production runtime endpoints`，保留回滚前状态证据。
2. 打开 GitHub Actions 中的
   `Roll back or restore production Operations API`。
3. 选择 workflow 中的 rollback 操作。
4. 输入页面要求的精确确认文本。
5. 提交后，在 `production` Environment 审批页面核对目标版本和操作原因。
6. 审批并等待 workflow 成功完成。
7. 立即重新运行 runtime monitoring，确认 Ingress、Operations API 和
   Cloudflare Access 均为 PASS。
8. 不要把一次成功回滚当作最终状态；确认是否需要执行前向恢复。

### 前向恢复操作

1. 再次打开同一个受保护 workflow。
2. 选择 forward-restoration 操作。
3. 输入页面要求的精确确认文本。
4. 在 production Environment 中确认目标为
   `3b424f14-1383-43a0-b207-ec2cfb993281`。
5. 审批并等待 workflow 成功完成。
6. 再次运行 runtime monitoring。
7. 使用 `wrangler deployments list` 确认最终版本获得 100% 流量。

### 本次验收证据

- 回滚 run `#1` / ID `32681414030`：成功。
- 回滚后监控 run `#15`：成功。
- 前向恢复 run `#2` / ID `32681730509`：成功。
- 恢复后监控 run `#16` / ID `32681834676`：成功。
- 最终 deployment：
  `eb8b4d2e-cc9e-4bc1-83a2-65878403dc10`。
- 最终 active version：
  `3b424f14-1383-43a0-b207-ec2cfb993281`，traffic `100%`。
- `/health` 返回 `status=running`、`stage=production`。
- workflow 不执行 D1、Queue 或 Workflow mutation。

GitHub Actions 中出现的 Node.js 20 deprecation annotation 是非阻塞维护告警，
不影响本次回滚结果；后续应随官方 Action runtime 升级单独处理。

## 最终 Production Readiness 收尾审计及放行判定（2026-08-24）

最终状态：

- `FINAL_PRODUCTION_RUNTIME_READINESS=PASS`
- `FINAL_PRODUCTION_OPERATIONAL_READINESS=PASS`
- `FINAL_COMPANY_INDEPENDENCE_READINESS=DEFERRED`
- `PRODUCTION_GO_LIVE_READINESS=PASS_WITH_DOCUMENTED_DEFERRED_HANDOVER`

### 已完成的审计

1. production 配置模板、D1、R2、Queue、Workflow 和 staging 隔离检查通过。
2. GitHub `production` 与 `production-monitoring` Environment 所需 Secrets 和 Variables 均存在。
3. Cloudflare D1、R2、Queues 和三个 production Workers 的身份及部署历史通过检查。
4. Google Cloud production project、Cloud Run services、invoker IAM、非公开访问和 production traffic 通过检查。
5. production Google Form、Drive、Apps Script Properties、两个触发器及执行记录通过人工检查。
6. synthetic provider-native E2E 验收已覆盖 Ingress、R2、Queue、D1、Parser、ML、Workflow 和 Offer。
7. runtime monitor 的手动及定时运行通过。
8. 受控监控失败、GitHub Inbox/邮件通知及独立恢复运行通过。
9. Operations API 回滚到已知良好版本和恢复至前向版本均通过，恢复后监控再次通过。

### 当前日常运行要求

- 每 15 分钟的 production runtime monitor 应保持成功；
- Apps Script 的 `syncHireBeatCatalogOptions` 定时触发器和 `onHireBeatFormSubmit` 提交触发器应保持启用；
- 新增或更新岗位后必须先发布 Catalog Revision；
- 紧急同步可以手工执行 `syncHireBeatCatalogOptions()`，否则等待定时同步；
- 任何 production 部署或回滚必须使用受保护 workflow、准确确认文本和 Environment 审批；
- 不得通过 D1 Console 绕过 Operations API 写入 Catalog 业务数据；
- 不得使用真实申请人数据执行故障演练。

### 告警或监控失败处理

1. 打开失败的 GitHub Actions run，确认失败发生在哪个只读健康检查。
2. 检查 Cloudflare Access Service Token 是否过期或被撤销。
3. 检查 Ingress 和 Operations API observability。
4. 检查 Cloudflare、GitHub Actions 和 Google Cloud 服务状态。
5. 修复后创建新的正常 monitoring run；不要通过重跑带 `simulate_failure=true` 的历史 run 验证恢复。
6. 若 Operations API 版本异常，使用受保护 rollback workflow。
7. 恢复后记录监控、回滚、通知和资源状态证据。

### Deferred 交接边界

实际 Apps Script trigger ownership transfer 尚未执行。执行时必须使用
`21_complete_project_handover_runbook.md` 中的换主 SOP，并满足以下条件：

- 公司控制的 Google Workspace 账号具有所需权限；
- 公司账号重新创建两个 installable triggers；
- 公司账号完成 Google 授权；
- 新执行身份下完成一条新的 synthetic production submission；
- 确认无重复处理且流程到达预期终点；
- 轮换个人账号曾接触的相关凭据；
- 最后才删除旧触发器并降低或移除个人账号权限。

在这些条件完成前，不得把 company independence 状态从 `DEFERRED` 改为 `PASS`。
