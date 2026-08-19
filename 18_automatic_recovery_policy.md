# HireBeat Automatic Recovery and Retry Policy

Version: 2026-08-18

Scope: the current production implementation of Submission Ingress, Workflow A,
Workflow B, Outbox delivery, Position-JD waiting, and Offer lifecycle recovery.

## 1. Governing rule

The platform does not treat every failure as retryable. Each failure is assigned
one of four dispositions:

| Disposition | Meaning | Automatic action |
|---|---|---|
| `retryable` | A later attempt can reasonably succeed without changing business input | Retry with bounded exponential backoff and jitter |
| `terminal` | Repeating the same input cannot fix the failure | Stop immediately, preserve safe error state, and do not consume further attempts |
| `waiting` | The request is valid but a business prerequisite is not ready | Stop the retry loop, retain durable waiting state, and wake automatically when the prerequisite becomes ready |
| `stale_noop` | A newer decision fence or lifecycle state has replaced this work | Acknowledge/cancel it without writing decisions, ML results, or Offers |

Automatic recovery is implemented by the platform component that owns the
relevant time boundary. D1 records durable state and fences; it is not used as a
busy polling engine.

## 2. Attempt-count semantics

All HireBeat configuration values named `max_attempts` count **total attempts**,
including the first attempt.

- Intake Queue: `max_retries = 4` means one initial delivery plus four
  redeliveries, for five total deliveries.
- `raw_submission_intake_run.attempt_count` increases only when the D1-fenced
  intake processor actually claims a processing attempt. Merely accepting an
  HTTP request into the Queue does not increment it.
- Workflow `retries.limit = 5` means five total executions of that step, not one
  execution plus five retries.
- Outbox `max_delivery_attempts = 8` means at most eight dispatcher claims.

These counters are related but not interchangeable. Queue delivery attempts
schedule Intake work; D1 attempt counts prove how many Intake claims actually
started; Workflow attempts belong to one Workflow step; Outbox attempts belong
to one event delivery.

## 3. Recovery matrix

| Boundary | Examples | Disposition | Current automatic mechanism |
|---|---|---|---|
| Ingress authentication and envelope validation | Missing bearer token, invalid UUID, unsupported source, malformed required field | Terminal | HTTP 4xx; no Queue message and no retry |
| Intake Queue and source download | Network interruption, 429, temporary 5xx, Google token network failure, temporary R2/D1 service failure | Retryable | Main Queue retries with jitter; five total deliveries; exhaustion goes to DLQ |
| Intake replay integrity | Missing/mismatched Submission identity, keyed-HMAC mismatch, corrupt replay envelope | Terminal | Ack immediately; never process untrusted content |
| Intake concurrency | Another delivery owns the active fence, stale delivery loses the fence | Stale/no-op or short retry | Existing in-progress work receives a short Queue retry; a lost fence is acknowledged |
| Intake retry exhaustion | A retryable failure remains after the bounded attempts | Terminal after exhaustion | DLQ consumer marks the D1 run `failed_terminal`; no operator resubmission is required |
| PDF Parser request | Timeout, connection error, 429, temporary 5xx | Retryable | Parent Intake Queue redelivers the whole idempotent Intake attempt |
| PDF content/parser result | Unsupported or invalid PDF, successful parse with no usable text | Terminal parser outcome | Raw evidence remains; `resume_text` may be `NULL`; later Initial Cleaning blocks unusable Resume text |
| Workflow A/B step | Temporary D1/service error | Retryable | Cloudflare Workflows retries the step with exponential backoff, five total attempts, ten-minute step timeout |
| Workflow validation/configuration | Invalid durable input, missing immutable configuration, permanent contract violation | Terminal | `NonRetryableError`; Workflow ledger records terminal failure |
| Superseded/cancelled Application | Old Workflow B wakes after a newer resubmission rotated the decision fence | Stale/no-op | Fence check cancels the stale Workflow; it cannot create ML results, decisions, or Offers |
| Missing Position JD | Position is not Active or usable JD is unavailable | Waiting | Workflow B records `waiting_position_jd`; no false zero score and no retry loop |
| Position JD becomes ready | Current Application is still `processing + pending` | Wake automatically | Scheduled reconciler rotates the fence, cancels the old waiter, and publishes one idempotent Workflow B Outbox event |
| Position JD becomes ready after supersession | Application is `superseded`, cancelled, or no longer pending | Stale/no-op | Reconciler query excludes it; no Workflow B restart |
| ML request | Timeout, connection error, 429, temporary 5xx | Retryable | Workflow B step retry; ML client also enforces its shorter request timeout |
| ML invalid input/response | Missing ready JD, missing Resume decision input, invalid model response | Waiting or terminal according to cause | Missing JD waits; invalid immutable input/contract stops without fabricating a score |
| Outbox delivery | Temporary Workflow API failure, network error | Retryable | Lease-based claim, exponential backoff with jitter, maximum eight delivery attempts |
| Outbox payload/destination | Invalid JSON, unsupported destination, missing required payload | Terminal | Immediate `failed_terminal`; repeated delivery would not repair it |
| Offer response deadline | Current Offer is `sent`/`viewed` and current version passed `response_due_at` | Scheduled business transition | Reconciler atomically changes it to `expired`, appends status history, and records audit evidence |

Before that scheduled transition can apply, the `sent` command guarantees a deadline. A recruiter-supplied RFC 3339 deadline takes precedence. If the Draft version has no deadline, the command uses the active versioned `offer.default_response_window_days` policy (initially 7), derives a new immutable Offer version from the actual send instant, and then enters `sent`. Invalid or elapsed explicit deadlines are terminal authoring errors and are not retried.

## 4. Why one universal Queue is not used

Large production systems normally match the scheduler to the kind of work:

- Queue for discrete, at-least-once delivery and backpressure;
- Workflow for durable multi-step orchestration and step replay;
- Outbox for committing a business mutation and its asynchronous handoff
  atomically;
- scheduled reconciler for time-based state transitions and durable waiters;
- D1 transaction/batch for short atomic database changes;
- decision fence for stale-work cancellation.

Putting every failure into one Queue would duplicate Workflow state, weaken
transactional Outbox guarantees, and turn business waits such as a missing JD
into wasteful retry storms. The current split keeps recovery automatic without
making all failure types look identical.

## 5. No routine manual recovery

Operators may inspect alerts and terminal records, but normal progress must not
depend on repeatedly pressing a button or resubmitting an unchanged request.
Manual action remains appropriate only when the underlying input, permission,
mapping, Secret, code, or business policy must actually change. After that
change, a controlled replay/release mechanism may be used; the original Raw,
workflow, Outbox, and audit evidence is not deleted.

## 6. Observability and recalibration

Before changing limits, collect Parser and ML p50/p95/p99 latency, Queue retry
distribution, final success attempt, DLQ count, Workflow attempt distribution,
Outbox age and attempt distribution, stale-fence cancellations, reconciler wake
count, and terminal error codes. Limits are bootstrap safeguards, not permanent
truths. Changes must be published through a new active configuration release
where the value is configuration-backed.

Alerting should notify the team about DLQ growth, repeated terminal contract
errors, old pending Outbox events, or an abnormal waiting-JD backlog. An alert
does not replace the automatic state transition; it identifies a condition that
may require correcting external data, permissions, code, or capacity.

## 7. Deferred extensions

The current version does not add a general retry-policy table, per-attempt
Ingress history, or a durable global circuit-breaker table. Add those only when
production metrics demonstrate that per-error policies must be changed without
deployment, individual attempts require formal audit, or a downstream outage
needs account-wide load shedding.

Future Airtable/Google Catalog external synchronization will use a target-level
Queue/Outbox so one failing destination can retry independently. That deferred
design is recorded in `03_future_optimization_recommendations.md`; no premature
Catalog source/target tables are added to the current schema.
