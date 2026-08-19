# Data Change Reaction Policy

Version date: 2026-08-19  
Status: confirmed design policy

## 1. Purpose

This policy answers a different question from the constraint/default matrix:
after an accepted `UPDATE`, what else must change, what may be recomputed, and
what must remain frozen?

The governing rule is not "every changed column cascades". The writer first
classifies the field and then applies the corresponding reaction:

| Field class | Update rule | Required reaction |
|---|---|---|
| Stable identity (`id`, published UUID, stable code) | Immutable | Reject the update. Create a replacement row when semantics changed. |
| Display correction | In-place update allowed when semantics are unchanged | Recompute the matching `normalized_*` value, write `audit_event`, and publish a new Catalog revision only if the selectable option tree changed. |
| Semantic classification or parent ownership | Do not silently rewrite a published row | Create a replacement row and deactivate/retire the old row. Existing historical facts keep the old ID. |
| `is_active` or lifecycle status | Controlled in-place transition | Affect future selection only, audit the transition, and publish/sync a new Catalog revision when the effective option set changed. |
| Operational mutable value | Controlled in-place update | Update only the current operational row and its timestamp; do not rewrite immutable downstream snapshots. |
| Published snapshot/result/version | Append-only or immutable | Create a new version/run/snapshot; never patch the historical record. |

Database `NOT NULL`, `CHECK`, FK and `UNIQUE` constraints remain the final
integrity boundary. Cross-system reactions belong to the command/importer,
Outbox and reconciler layers, not to SQL triggers that call external services.

## 2. Reference-table reactions

The following policy applies to all G01 Reference tables.

| Change | Allowed in place? | Reaction |
|---|---:|---|
| `id`, stable UUID, stable code | No after publication | Reject. A changed identity is a new Reference row. |
| Spelling, capitalization or display-name correction with unchanged meaning | Yes | Recompute `normalized_*` in the same command, update `updated_at`, and write `reference_display_name_updated`. |
| Meaning, rank, hierarchy, parent FK or applicability changes | Normally no | Create the new semantic row, deactivate the old row, and record `reference_replaced`. |
| `is_active: 1 -> 0` | Yes | Stop future selection/mapping; keep every historical FK and snapshot unchanged; write `reference_deactivated`. |
| `is_active: 0 -> 1` | Yes after validation | Permit future selection again and audit reactivation. Do not replay old workflows automatically. |
| Optional metadata URL or description | Yes | Audit when operationally important; no downstream historical rewrite. |

If a Reference change alters the effective Company/Work Mode/Position option
tree, G02 publishes a new `catalog_revision`. G01 writers do not each call
Airtable or Google directly. A Catalog revision Outbox event is the single
integration boundary.

Reference changes do not automatically recalculate old Candidate enrichment,
ML results, Application decisions or Offers. A legal/safety correction that
must affect existing records uses an explicit block, cancel, supersede or
reviewed migration, never an ordinary Reference `UPDATE`.

## 3. Position field-by-field policy

`position` is a mutable current Catalog record, but not every field has the
same update semantics.

| Position field(s) | In-place policy | Required reaction |
|---|---|---|
| `id`, `position_uuid` | Immutable | Reject changes. |
| `company_id` | Immutable after the Position has been published or referenced | Wrong ownership means a replacement Position. Historical submissions keep the original Position ID. |
| `position_name` | Corrective rename allowed | Recompute `normalized_position_name` atomically; if the active option label changes, publish a new Catalog revision and sync enabled form targets. |
| `normalized_position_name` | Not independently authorable | Always derived from `position_name`. |
| `position_jd` | Mutable | Validate readiness. An active Position may never retain a JD shorter than 10 trimmed characters. JD content changes alone do not rewrite existing ML input/results. |
| `position_status` | Controlled state transition | If the effective selectable set changes, publish a Catalog revision. Transition to active requires a valid JD. Transition away from active removes the Position from future form options. |
| `position_jd` + `position_status` | Update together when withdrawing an invalidated JD | A command replacing a formerly valid JD with a missing/short JD must explicitly set `position_status='draft'` in the same operation. The database rejects `active + invalid JD`; it does not guess a lifecycle transition. |
| `occupational_type_id`, `employment_type_id`, `function_id`, `seniority_id`, `location_id` | Controlled metadata/classification update | Validate active/existing Reference IDs. Do not rewrite historical Application/ML/Offer snapshots. A semantic reclassification is audited. |
| `work_duration`, `openings_count`, `posted_date`, relocation/local flags | Mutable operational metadata | Update current Position and audit as appropriate. No Catalog revision unless the published option payload later explicitly includes that field. |
| Requirement child rows | Append/update/deactivate through their own controlled command | Future ML feature building may read the current set; already published ML results remain frozen. They do not change native form options in release 1. |
| `created_at` | Immutable | Never update. |
| `updated_at` | System maintained | Change only after an effective accepted update. |

## 4. Position status and native form synchronization

The frozen flow remains:

```text
approved Position command
  -> validate cross-field rules
  -> update Position
  -> build the effective active option tree
  -> compare its hash with the latest catalog_revision
  -> if unchanged: no new revision and no form sync
  -> if changed: append catalog_revision
                 -> transactional Outbox event
                 -> one target run per currently enabled Airtable/Google target
                 -> retry automatically per target
                 -> dead-letter and alert only after retry exhaustion
```

In particular, a `position_status` transition into or out of `active` changes
the selectable option tree and therefore requires a new revision. Updating an
already active Position with a valid JD does not by itself change the form
option tree unless a form-visible field such as `position_name` changed.

The current repository already implements the authoritative D1 Catalog,
revision snapshots and protected Catalog commands. Provider-specific Airtable
and Google Form option writers remain intentionally pending until the exact
base/form IDs and credentials are supplied. Until those adapters exist, D1
revision publication is durable but cannot truthfully be described as a
completed external form update.

The current protected API also keeps revision publication as a separate
`POST /v1/catalog/revisions` command after a Catalog mutation. Consequently,
the present release must not claim that every Position PATCH already performs
an atomic automatic publish. The production completion item is to put mutation,
effective option-tree hash comparison, revision append and Outbox creation
behind one orchestrated command (with a scheduled hash reconciler as the repair
path). The existing explicit revision command remains valid and idempotent
during that transition.

## 5. Already-open native form windows

No change is made to the frozen native-form boundary:

- a newly opened or newly enabled channel uses the latest successfully synced
  Catalog revision;
- a form page that is already open may continue displaying the options it
  loaded when opened;
- the page is not live-mutated while it remains open;
- reopening the form reads the newest successfully synchronized option set;
- Raw intake always preserves what the applicant submitted;
- Workflow A revalidates the submitted IDs against current D1 state before it
  creates an Application.

The last rule closes the stale-window race. If a Position was active when the
window opened but changed before submission, Workflow A returns one precise
reason:

| Condition at Workflow A validation | Reason code |
|---|---|
| Position ID no longer exists | `submitted_position_missing` |
| Position belongs to another Company | `submitted_position_wrong_company` |
| Position is `draft`, `paused`, `closed` or `archived` | `submitted_position_not_active` |
| Position claims active but its JD is not ready (defensive race/corruption boundary) | `submitted_position_jd_not_ready` |

The Raw submission and audit evidence remain, but no Normalized/Application
business result is created for a blocked stale option.

## 6. Reactions for applications already created

An Application admitted while the Position was valid is a historical business
fact. Later Position changes follow these rules:

- do not change its stored `position_id`;
- do not rewrite its Candidate snapshot, ML input, ML result, decision or Offer;
- a Workflow B run that has not yet crossed the ML readiness gate rechecks the
  current Position state and cannot call ML if the Position is no longer ready;
- a superseded Application is never revived;
- only a current `processing + pending` Application that is explicitly waiting
  for Position readiness is eligible for a fenced resume event;
- operational cancellation caused by closing/archiving a Position should use
  an explicit reviewed command and audit reason, not an implicit cascade.

## 7. Other status-bearing tables

Status fields across the remaining groups fall into four reaction families:

| Family | Examples | Strategy |
|---|---|---|
| Future-selection state | Reference `is_active`, Company/child `is_active`, Position status | Revalidate future writes; publish Catalog revision only when the option tree hash changes. |
| Workflow/delivery state | intake, Queue/DLQ, workflow, step, attempt, Outbox, sync runs | State-machine transitions, automatic retry/backoff/reconciliation, fencing and terminal alerting; never copy the state into unrelated business rows. |
| Business lifecycle state | Application, Candidate snapshot, Offer | Use explicit transitions and immutable versions/snapshots; supersede rather than overwrite history. |
| Immutable result state | Dedup result, ML run/result/recommendation, audit event, Catalog revision | Append a new run/result/revision; do not update the published result payload. |

This avoids 84-table trigger proliferation. Each command owns the few reactions
that have business meaning, while the schema validator continues checking that
every status/`is_active` column has an explicit policy.

## 8. Implementation safeguards

Every mutable production command should implement this sequence:

1. authenticate and authorize the writer;
2. locate the row by stable identity, never by fuzzy name;
3. read the current row and compute the effective proposed row;
4. validate immutable fields and cross-field invariants;
5. compute a non-sensitive before/after diff;
6. return `unchanged` when there is no effective change;
7. persist the row, derived normalized fields and audit event together;
8. publish a revision/Outbox event only when the relevant projection hash
   changed;
9. make consumers idempotent and protect concurrent recovery with unique keys,
   leases and fence tokens.

Direct SQL remains an emergency/administrative path. It must use the reviewed
templates and is not allowed to bypass required external reactions. A periodic
Catalog reconciler should compare the current active option-tree hash with the
latest revision so an interrupted command or exceptional manual repair cannot
leave D1 and the published Catalog permanently divergent.

In the current release, the controlled APIs deliberately expose a narrow
update surface: G01 Reference commands create rows or change `is_active`;
Position PATCH changes only its reviewed operational subset. Stable IDs, UUIDs,
parent Company ownership and normalized identity fields cannot be arbitrarily
patched through these endpoints. A future endpoint that adds another mutable
column must first add that column's row to this reaction policy and its tests.

## 9. Compatibility with frozen decisions

This policy does not change any frozen schema or lifecycle decision:

- no table or column is added or removed;
- no deployed migration is edited;
- Reference IDs/codes/UUIDs remain immutable;
- Reference deactivation remains non-retroactive;
- Position active still requires a JD with at least 10 trimmed characters;
- only active Positions are published as application options;
- opened native form windows remain frozen until reopened;
- Workflow A remains the final stale-Catalog admission gate;
- published Application, ML and Offer facts are not rewritten;
- superseded Applications are not resumed;
- provider-specific Airtable/Google option writers remain a deployment task,
  not a silently claimed capability.
