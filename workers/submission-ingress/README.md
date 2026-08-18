# Submission Ingress Worker

This package is the production boundary for receiving one application submission at a time. It is intentionally isolated from the root D1 schema package.

## Current status

The HTTP implementation is the production writing boundary:

- `GET /health` returns service metadata only;
- authenticated `GET /ready` verifies that the active Ingress configuration can be loaded from D1;
- authenticated `POST /internal/v1/submissions/intake` validates the canonical envelope and runs the idempotent intake service;
- authenticated Airtable and Google source routes adapt provider events into the same canonical contract;
- the validated request receives a deterministic keyed HMAC fingerprint, but the fingerprint itself is never returned;
- D1 intake reservation, technical-redelivery accounting, payload-conflict detection, attempt fencing, and stale takeover are connected;
- an Airtable attachment downloader, Google Drive service-account downloader,
  bounded PDF reader, PDF signature validator, SHA-256 calculator, and conditional
  R2 store now exist as independently testable services;
- PDF acquisition, conditional private R2 storage and authenticated Parser calls run before one short D1 batch publishes Raw, Resume metadata, Workflow A Outbox, and succeeded intake state;
- the public `workers.dev` endpoint remains disabled through `workers_dev = false`.

## Frozen v1 resume sequence

For a valid source submission, the frozen sequence is:

1. obtain the PDF bytes from the source-specific downloader;
2. validate MIME type and configured maximum size;
3. calculate the file hash;
4. save the original PDF bytes to the private R2 bucket;
5. send the same bytes to the existing PDF Parser;
6. preserve Parser line breaks;
7. publish the complete structured Raw Submission and nullable Resume text to D1 in a short transaction.

The first release will support only these source paths:

- Airtable attachment URL -> download bytes -> R2 -> Parser;
- Google Drive file ID -> authorized download -> R2 -> Parser.

If parsing fails after retry policy is exhausted, `resume_text` remains `NULL` and the technical status/error is recorded. Source-provided fallback text is deliberately deferred.

## Bindings

- D1 binding: `DB`
- D1 database: `hirebeat_recruiting_d1_v2`
- R2 binding: `hirebeat_hr_raw_resumes_pdf_r2_v1`
- R2 bucket: `hirebeat-hr-raw-resumes-pdf-r2-v1`

## Secrets

Real values must be stored through Cloudflare Secrets and must never be committed:

- `SUBMISSION_HMAC_KEY_V1`
- `INGRESS_INTERNAL_AUTH_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `PARSER_SERVICE_AUTH_TOKEN`
- `CLOUD_RUN_INVOKER_SERVICE_ACCOUNT_JSON` (dedicated least-privilege Cloud
  Run caller; do not reuse the Google Drive reader identity)

For local development only, copy `.dev.vars.example` to `.dev.vars` and replace the placeholders. The real `.dev.vars` file is ignored by Git.

## Local validation

```bash
cd workers/submission-ingress
npm install
npm run typecheck
npm run deploy:dry-run
```

The synthetic unit suite can also be run with `npm run test:unit`. It validates
PDF signature and size handling, Google Drive ID extraction, stable object keys,
and conditional R2 redelivery without contacting any external service.

Local development is available with `npm run dev`. All writing routes require:

```text
Authorization: Bearer <INGRESS_INTERNAL_AUTH_TOKEN>
Content-Type: application/json
```

The fixture files under `test/fixtures/` contain synthetic data only. Business fields may be empty at Ingress because Workflow A, rather than the technical envelope gate, owns Initial Cleaning.

## Idempotency boundary

The keyed HMAC is a payload-conflict detector, not a recruitment deduplication rule. Two intentional applications with different `submission_uuid` and source-record identities remain two independent Raw submissions even when their business content is identical.

The stable HMAC projection excludes:

- technical delivery mechanism, cause, and delivery timestamp;
- temporary Airtable attachment URL;
- source event key, which is independently protected by a unique identity constraint;
- provider envelope fields in `sourceFieldSnapshot`.

It includes the stable submission/source identity, submitted catalog values, Raw applicant values, source submission timestamp, and stable Resume reference metadata. The acquisition service calculates the actual PDF SHA-256 after a bounded download.

`attempt_count` is also the processing fencing token. Every successful processing claim increments it. Later write steps must include the claimed attempt number in their conditional updates, so an older Worker cannot publish after a stale takeover.

New intake runs freeze the currently active `configuration_release_id`. A retry must reload that exact historical release—even after it becomes `superseded` or `retired`—rather than silently adopting newer timeout or attempt limits. The coordinator rejects a caller that supplies a different release.

The stable R2 key is:

```text
raw-resumes/v1/{submission_uuid}/{resume_file_sha256}.pdf
```

R2 uses a conditional create. A technical redelivery reuses an existing object
only after its size and SHA-256 metadata match; it never blindly overwrites the key.
