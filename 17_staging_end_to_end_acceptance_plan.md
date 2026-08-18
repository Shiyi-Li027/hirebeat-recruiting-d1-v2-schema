# HireBeat v2 Staging End-to-End Acceptance Plan

This plan is the release gate between a bundle-valid implementation and production. It uses synthetic applicants only. Every case must verify D1 state, R2 objects, Workflow/step/attempt logs, Outbox state, and the externally returned response.

## 1. Environment gate

- staging D1, R2, Workers, Workflows, Parser, ML service and Secrets are separate from production;
- all `REPLACE_WITH_` runtime values are replaced through staging deployment configuration;
- Ingress and Orchestrator internal routes reject missing or invalid bearer tokens;
- Operations routes reject requests without a valid Cloudflare Access JWT;
- R2 is private and no resume object has a public URL;
- migrations `0001` through `0009` are applied and `PRAGMA foreign_key_check` is empty.

## 2. Ingress and Raw publication

1. Submit one valid Airtable event with a synthetic PDF. Expect one R2 object, one succeeded intake, one Raw row, one Resume row and one pending Workflow A Outbox event.
2. Submit one valid Google event for a service-account-readable Drive PDF. Expect the same canonical D1 shape as Airtable.
3. Redeliver the identical provider event. Expect the same technical intake/Raw identity and no duplicate R2 object, Raw row or Workflow A event.
4. Submit the same business content as a genuinely new provider record. Expect a new Raw submission; business duplication is decided later, not suppressed by payload HMAC.
5. Test oversized file, non-PDF bytes, unavailable source, Parser 429/5xx and Parser terminal empty-text response. Verify retryable versus terminal classification and that partial D1 publication never occurs.
6. Interrupt after R2 PUT but before D1 publication, then redeliver. Expect metadata verification of the same content-hash object and one eventual D1 publication.

## 3. Workflow A

1. Valid active Company/optional Company Work Mode/Position IDs and usable Resume text pass Initial Cleaning.
2. Missing Resume text, Resume text shorter than the frozen minimum, inactive or mismatched Catalog IDs are blocked with explicit reason codes; no Application is published.
3. Zero Education, Employment, Skill or Project rows are valid extraction outcomes and require no placeholder rows.
4. A transient step failure is retried up to the active configured total-attempt limit. A terminal failure retains Raw, workflow and error history while compensating only unpublished workflow-owned derivatives.
5. A successful normalization/extraction/dedup run publishes one minimum Person/Application/Candidate core and one Workflow B event atomically.

## 4. Deduplication and resubmission

1. Verify grouping by authoritative Company ID, Position ID and requested start `YYYY-MM`.
2. Verify positive identity pairs only, keyed-HMAC evidence only, and deterministic selected-prior ordering.
3. Verify the first submission has attempt number 1 and resubmission count 0.
4. While an older Application is processing, admit an allowed resubmission. Expect the old decision fence to rotate, old Application/Candidate to become superseded, active old hiring execution to stop, and old Workflow B writes to fail their fence check.
5. Verify maximum attempts includes the first submission and the sixth attempt is retained in Submission/Dedup but blocked from Application publication.
6. Verify prior Offer states that are not automatically reopenable produce `blocked_prior_application_state`.

## 5. Workflow B, ML and decision

1. A Candidate with zero Education but valid Resume/JD reaches ML without entity-count errors.
2. Missing/short JD does not call similarity or create `no_offer`; the
   Application remains `processing/pending`, Workflow B records
   `waiting_position_jd`, and a later ready-JD Position update publishes an
   idempotent requeue Outbox event. Zero Education, Employment, Skill, or
   Project rows do not independently exclude the Application.
3. Otherwise send only complete Resume text and complete Position JD to the authenticated ML service.
4. Verify the returned hashes, model identity, cosine score, active threshold-policy snapshot and recommendation are stored.
5. Score below the fixed threshold atomically produces Rejected; score at or above it atomically produces the ML result, hiring-stage result, Application `offer_created`, one Offer draft and one Offer-lifecycle Outbox event.
6. Redeliver a Workflow Outbox event after Workflow creation but before Outbox acknowledgement. Expect `get/status` confirmation of the existing stable instance ID and no duplicate Workflow.

## 6. Operations and Offer

1. Repeat the same Catalog, Hiring, Offer-version and Offer-status command with the same idempotency key. Expect one business mutation and one reusable command result.
2. Concurrent Offer status commands using the same expected version must allow only one transition.
3. Invalid Offer transitions are rejected without altering the current state.
4. A new Offer version appends immutable terms, advances the current-version pointer and never rewrites an older version.
5. A Catalog semantic change creates a new reference row or deactivates the old row as appropriate; historical Application/ML/Offer snapshots remain unchanged.

## 7. Inspection and release evidence

- run the read-only inspection export into `test-exports/staging/<date>/<workflow_run_uuid>/`;
- verify its manifest and keep real CSVs out of Git history;
- record migration list, Worker versions, Parser version, ML model revision, configuration release and Catalog revision;
- retain the GitHub Actions validation result and synthetic acceptance report;
- obtain production GitHub Environment approval only after every required case passes.
