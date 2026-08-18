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

All child entity sets allow zero rows. ML receives only complete `resume_text` and `position_jd`; it does not require Education, Employment, Skill, or Project rows. The frozen anomaly rules remain separate from cosine similarity.

The active `workflow.default_step_max_attempts` value counts the original call plus retries. The Workflow adapter converts it to Cloudflare's retry-limit convention (`configured total - 1`), uses exponential backoff from one second, and applies a ten-minute per-step timeout. ML and Parser HTTP calls additionally enforce their shorter 30-second request timeout.

Outbox delivery is at least once. A stable `event_uuid` is also the Cloudflare Workflow instance ID. If `create()` succeeded but the Outbox status update was interrupted, redelivery confirms the existing instance with `get()` and `status()` instead of creating a second Workflow or exhausting the event as a false failure.

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
- records with `is_active` default to active unless an authoring command explicitly supplies `false` or `0`;
- Position defaults to `active` only when its JD passes the 10-character readiness gate; otherwise it defaults to `draft`.
- A later Position update that supplies a ready JD requeues every matching
  `waiting_position_jd` Application through an idempotent Outbox event and a
  newly rotated decision fence.

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

Then apply migrations in staging, deploy both Python services privately, configure Worker Secrets/variables, deploy the three Workers, and execute synthetic end-to-end cases. Production uses separate D1, R2, Workers, Workflows, service URLs and Secrets; staging resources must never be rebound as production.

## 7. Still externally blocked, not missing code

- Exact Airtable base/table/field IDs and Automation webhook configuration.
- Exact Google Form/Sheet IDs and Apps Script deployment.
- Private hosting URLs for Parser and ML containers.
- Cloudflare Access application team domain, AUD, member group and Author policy.
- Provider-specific writing of a published `catalog_revision` into native Airtable/Google form options.

These values cannot be safely invented in source code. Their absence must block remote enablement, not weaken authentication or silently use defaults.
