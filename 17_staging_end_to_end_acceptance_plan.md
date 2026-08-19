# HireBeat v2 Staging End-to-End Acceptance Plan

This plan is the release gate between a bundle-valid implementation and production. It uses synthetic applicants only. Every case must verify D1 state, R2 objects, Workflow/step/attempt logs, Outbox state, and the externally returned response.

## 1. Environment gate

- staging D1, R2, Workers, Workflows, Parser, ML service and Secrets are separate from production;
- all `REPLACE_WITH_` runtime values are replaced through staging deployment configuration;
- Ingress and Orchestrator internal routes reject missing or invalid bearer tokens;
- while no managed staging domain exists, Ingress and the Access-protected
  Operations API use stable `workers.dev` targets, preview URLs are disabled,
  and production remains prohibited from using `workers.dev`;
- the Operations Worker code treats `/health` as non-sensitive, but the
  one-click Access application may still protect the whole `workers.dev`
  hostname at the edge; every authoring route requires both Access admission
  and the Worker's own verified Access JWT;
- R2 is private and no resume object has a public URL;
- migrations `0001` through `0013` are applied and `PRAGMA foreign_key_check` is empty.

## 2. Ingress and Raw publication

### First synthetic Google-path execution

This acceptance path does not require a live Google Form and must never use a
real applicant Resume.

1. Generate the ignored synthetic PDF:

   ```bash
   npm run acceptance:resume:generate
   ```

2. Upload the generated PDF from
   `test-exports/staging/synthetic-inputs/hirebeat-synthetic-resume.pdf` to a
   staging Google Drive folder. Share that one file as Viewer with
   `hb-google-drive-reader-stg@hirebeat-recruiting-stg-027.iam.gserviceaccount.com`.
3. Copy only its Google Drive file ID. Do not make the file public.
4. Submit the first native Google-source event. The script prompts for the
   Ingress bearer token with hidden terminal input and never persists it:

   ```bash
   npm run acceptance:intake:google -- \
     --google-drive-file-id "REPLACE_WITH_STAGING_DRIVE_FILE_ID"
   ```

5. Re-run with the same file and source identity to verify technical-redelivery
   idempotency:

   ```bash
   npm run acceptance:intake:google -- \
     --google-drive-file-id "REPLACE_WITH_STAGING_DRIVE_FILE_ID" \
     --redelivery-mechanism webhook_redelivery
   ```

The fixed synthetic source identity is deliberately reused only for this first
acceptance case. A later distinct-business-submission case must supply a new
`--source-record-id`.

1. Submit one valid Airtable event with a synthetic PDF. Expect one R2 object, one succeeded intake, one Raw row, one Resume row and one pending Workflow A Outbox event.
2. Submit one valid Google event for a service-account-readable Drive PDF. Expect the same canonical D1 shape as Airtable.
3. Redeliver the identical provider event. Expect the same technical intake/Raw identity and no duplicate R2 object, Raw row or Workflow A event.
4. Submit the same business content as a genuinely new provider record. Expect a new Raw submission; business duplication is decided later, not suppressed by payload HMAC.
5. Test oversized file, non-PDF bytes, unavailable source, Parser 429/5xx and Parser terminal empty-text response. Verify retryable versus terminal classification and that partial D1 publication never occurs.
6. Interrupt after R2 PUT but before D1 publication, then redeliver. Expect metadata verification of the same content-hash object and one eventual D1 publication.

## 2A. Reviewed Catalog seed gate

Before testing Ingress, publish one deliberately reviewed Catalog path. The
private source CSVs and generated preflight JSON remain ignored by Git.

1. Run `npm run data:preflight` and review the deterministic and ambiguous
   candidate counts.
2. Run `npm run data:seed:staging`. This is a dry run: it prints the selected
   Company, Position, JD length/hash, stable idempotency keys and the exact
   confirmation value, but performs no network request or D1 write.
3. For the first staging path, confirm `AGS Logistics` → `On-site` →
   `Operations Data Analyst (On-site)` and verify the full private JD in the
   ignored source output before applying it.
4. Apply only with the explicit normalized confirmation string:

   ```bash
   python3 scripts/import_reviewed_staging_catalog_seed.py \
     --apply \
     --confirm "ags logistics|operations data analyst (on-site)"
   ```

5. The importer delegates requests to the official `cloudflared access curl`
   wrapper, which uses the local short-lived Access session without the
   importer printing or persisting its JWT. Do not paste an Access JWT,
   `CF_Authorization` cookie, or service-token secret into a file, terminal
   transcript, issue, or chat.
6. Repeat the apply command. Expect idempotent reuse and no duplicate Company,
   Company Work Mode, Position, Catalog revision, or audit mutation.
7. Verify `/v1/catalog/options` reports one reviewed Company, one On-site
   Company Work Mode, one active Position, and a non-null Catalog revision.

## 3. Workflow A

1. Valid active Company/optional Company Work Mode and an authoritative
   `draft` or `active` Position ID with usable Resume text pass Initial
   Cleaning. Draft Positions are not selectable Catalog options, but a trusted
   source record that already references one may publish an Application that
   waits for JD in Workflow B.
2. Missing Resume text, Resume text shorter than the frozen minimum, inactive or mismatched Catalog IDs are blocked with explicit reason codes; no Application is published.
3. Zero Education, Employment, Skill or Project rows are valid extraction outcomes and require no placeholder rows.
4. A transient step failure is retried up to the active configured total-attempt limit. A terminal failure retains Raw, workflow and error history while compensating only unpublished workflow-owned derivatives.
5. A successful normalization/extraction/dedup run publishes one minimum Person/Application/Candidate core and one Workflow B event atomically.

## 3A. Automatic Intake recovery

1. Submit one valid authenticated intake request. Expect HTTP `202` after the
   private replay envelope is persisted and queued; the HTTP caller must not
   wait for PDF download, parsing, or Raw publication.
2. Inject one retryable source-download or Parser failure. Verify the Queue
   redelivers automatically and `raw_submission_intake_run.attempt_count`
   increases only when a new D1-fenced processing attempt starts.
3. Verify `max_retries = 4` produces at most five total Queue deliveries, not
   six. Exhaustion must move the message to the Intake DLQ and automatically
   change a remaining `failed_retryable` run to `failed_terminal` with
   `intake_queue_attempts_exhausted`.
4. Submit invalid authentication, a malformed envelope, and an integrity-HMAC
   mismatch. Expect immediate terminal rejection/acknowledgement and no repeated
   Queue delivery.
5. Redeliver the same accepted message concurrently. Verify the active attempt
   fence permits one owner, stale work cannot publish twice, and technical
   redelivery metadata is updated without creating a second Raw Submission.
6. Let a retryable technical error exhaust all five attempts and reach
   `failed_terminal`. Correct the root cause, then call the protected recovery
   command with a new command idempotency key:

   ```bash
   cloudflared access curl \
     "$OPERATIONS_URL/v1/intake-runs/1/recover" \
     -X POST \
     -H "Content-Type: application/json" \
     --data '{
       "idempotency_key":"staging-intake-1-google-token-fixed-v1",
       "recovery_reason":"Corrected the Google token dependency and approved replay."
     }'
   ```

   Expect HTTP `202` with `status = recovery_queued`. Verify one
   `command.intake.recovery.request` audit event and one
   `raw_submission.intake_recovery_requested` Outbox event. The attempt counter
   starts a new bounded cycle; the stable Submission UUID and accepted payload
   HMAC do not change.
7. Repeat step 6 with the same `idempotency_key`. Expect
   `idempotent_reuse = true` and no second Outbox or audit row. Deliver an old
   Queue message from the previous cycle and verify the recovery-fence mismatch
   makes it a no-op.

## 4. Deduplication and resubmission

1. Verify grouping by authoritative Company ID, Position ID and requested start `YYYY-MM`.
2. Verify positive identity pairs only, keyed-HMAC evidence only, and deterministic selected-prior ordering.
3. Verify the first submission has attempt number 1 and resubmission count 0.
4. While an older Application is processing, admit an allowed resubmission. Expect the old decision fence to rotate, old Application/Candidate to become superseded, active old hiring execution to stop, and old Workflow B writes to fail their fence check.
5. Verify maximum attempts includes the first submission and the sixth attempt is retained in Submission/Dedup but blocked from Application publication.
6. Verify prior Offer states that are not automatically reopenable produce `blocked_prior_application_state`.

### 4A. Isolated rejected-to-resubmission acceptance fixture

This case must use the dedicated Riley Chen synthetic PDF and synthetic violin
Position. It must not mutate or reuse the existing Alex Morgan Offer chain.

1. Generate `hirebeat-synthetic-resubmission-resume.pdf` with
   `npm run acceptance:resubmission:resume:generate`. Upload it to the private
   staging Google Drive folder and share only that file with the existing
   staging Drive-reader service account.
2. Run `npm run acceptance:resubmission:prepare` first. Review the redacted
   dry-run plan, then rerun it with `--apply --confirm` and the exact printed
   confirmation value. This creates one active synthetic violin Position through
   the protected Operations API and publishes a Catalog revision. Record the
   returned `position_id`; do not insert Catalog rows with manual SQL.
3. Submit source record `staging-google-resubmission-001` using the returned
   Position ID/name and the Riley Chen synthetic identity. Wait for Workflow B.
   The Resume/JD pair is intentionally unrelated; require a stored score below
   the active threshold and Application `completed + rejected`. If the reviewed
   model revision produces a score at or above the threshold, stop the case and
   revise the synthetic fixture instead of manually overwriting the decision.
4. Submit the same file, Candidate identity, Company, Position, requested-start
   month and Work Mode as source record `staging-google-resubmission-002`.
5. Require the second Dedup run to be `succeeded + duplicate_detected +
   admitted_resubmission`, with `submission_attempt_number = 2` and the first
   normalized Submission selected as prior. Require a new Application, the old
   rejected Application to be `superseded`, and the old Candidate execution to
   be superseded. The test must not create or update an Offer for the original
   Alex Morgan fixture.
6. Redeliver either stable source record ID and verify Intake idempotency does
   not create a third Raw Submission, Application, ML run, or Offer.

## 5. Workflow B, ML and decision

1. A Candidate with zero Education but valid Resume/JD reaches ML without entity-count errors.
2. If an active/ready Position loses readiness after Workflow A has created the
   Application but before Workflow B calls ML, missing/short JD does not call
   similarity or create `no_offer`; the Application remains
   `processing/pending`, Workflow B records `waiting_position_jd`, and a later
   ready-JD Position update publishes an idempotent requeue Outbox event. A
   Position already draft or non-ready when Workflow A runs is blocked instead.
   Zero Education, Employment, Skill, or Project rows do not independently
   exclude the Application.
3. While an Application is waiting for JD, admit an allowed resubmission and
   supersede the old Application. Then activate the Position with a valid JD.
   Verify the reconciler wakes only the current `processing + pending`
   Application and never revives the superseded waiter.
4. Otherwise send only complete Resume text and complete Position JD to the authenticated ML service.
5. Verify the returned hashes, model identity, cosine score, active threshold-policy snapshot and recommendation are stored.
6. Score below the fixed threshold atomically produces Rejected; score at or above it atomically produces the ML result, hiring-stage result, Application `offer_created`, one Offer draft and one Offer-lifecycle Outbox event.
7. Redeliver a Workflow Outbox event after Workflow creation but before Outbox acknowledgement. Expect `get/status` confirmation of the existing stable instance ID and no duplicate Workflow.
8. Inject a permanent Workflow contract error and verify `NonRetryableError`
   stops immediately. Inject a transient service error and verify the step uses
   no more than the configured total-attempt limit.

### 5A. Isolated missing-JD and stale-waiter acceptance fixture

1. Generate `hirebeat-synthetic-jd-waiting-resume.pdf` with
   `npm run acceptance:jd-wait:resume:generate`, upload it to the private
   staging Drive folder, and share only that file with the staging Drive-reader
   service account.
2. Run `npm run acceptance:jd-wait:prepare`, review the redacted dry run, then
   apply it with the printed confirmation. Require a new `active` Position with
   a ready JD and a published Catalog revision.
3. Submit `staging-google-jd-wait-001` for Jordan Lee. After Workflow A succeeds
   and creates the Application, but before Workflow B dispatches, run
   `npm run acceptance:jd-wait:prepare -- --draft-position-id <ID>` as a dry
   run and then apply it. This controlled choreography reproduces a Position
   losing readiness after Application creation; submitting directly against an
   already-draft Position is explicitly not allowed.
4. Require Workflow B to become `waiting + waiting_position_jd`, with the
   Application `processing + pending` and no ML run, recommendation, decision,
   or Offer.
5. Run `npm run acceptance:jd-wait:prepare -- --activate-position-id <ID>` as a
   dry run, then apply it. The protected Position update must return
   `resumed_waiting_workflow_count = 1`, rotate only the current Application
   fence, cancel its old waiting database run, and publish one
   `application.position_jd_ready` Outbox event.
6. Require the restarted Workflow B to finish ML. Repeating the activation
   command must be an idempotent reuse and create no additional recovery event.
   Separately verify with a controlled database fixture that a superseded
   historical waiter is excluded by the `processing + pending` and latest-run
   predicates and receives no ML run, Offer, or current-pointer ownership.

## 6. Operations and Offer

1. Repeat the same Catalog, Hiring, Offer-version and Offer-status command with the same idempotency key. Expect one business mutation and one reusable command result.
2. Concurrent Offer status commands using the same expected version must allow only one transition.
3. Invalid Offer transitions are rejected without altering the current state.
4. A new Offer version appends immutable terms, advances the current-version pointer and never rewrites an older version.
5. A Catalog semantic change creates a new reference row or deactivates the old row as appropriate; historical Application/ML/Offer snapshots remain unchanged.
6. Create a Draft with no deadline and transition it to `sent`. Verify the API
   creates a new immutable Offer version whose `response_due_at` equals the
   actual send time plus the active `offer.default_response_window_days`, then
   advances `offer.current_offer_version_id` in the same transaction.
7. Create another version with an explicit RFC 3339 deadline. Verify malformed,
   timezone-free, past or send-time-equal values are rejected, while a valid
   future value is preserved instead of being replaced by the default.
8. Set the current immutable Offer version's `response_due_at` in the past while
   the Offer is `sent` or `viewed`. Verify the scheduled reconciler changes it
   once to `expired`, appends one immutable status-history row, and records an
   audit event.
9. Verify invalid Outbox JSON/destination becomes terminal immediately, while a
   temporary Workflow API failure uses lease-based jittered backoff and stops at
   the frozen maximum delivery-attempt count.

## 7. Inspection and release evidence

- run the read-only inspection export into `test-exports/staging/<date>/<workflow_run_uuid>/`;
- verify its manifest and keep real CSVs out of Git history;
- record migration list, Worker versions, Parser version, ML model revision, configuration release and Catalog revision;
- retain the GitHub Actions validation result and synthetic acceptance report;
- obtain production GitHub Environment approval only after every required case passes.
