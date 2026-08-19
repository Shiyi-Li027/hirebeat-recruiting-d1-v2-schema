# HireBeat Operations API

This private Cloudflare Worker is the reviewed authoring boundary for Reference,
Recruitment Catalog, hiring, and Offer commands. Every endpoint except
`GET /health` requires a valid Cloudflare Access JWT.

`GET /health` is exempt only from the Worker's application-level JWT check.
When Access protects the entire hostname, Cloudflare may still require Access
authentication before the request reaches that route.

For the domain-less staging account, the Worker uses one stable `workers.dev`
route with preview URLs disabled. Cloudflare Access protects all production-route
traffic, and the Worker independently validates the Access JWT against the
configured staging Team Domain and application AUD. Production must disable
`workers.dev` and use a reviewed company-owned domain.

Current staging Access identity:

- Team Domain: `https://hirebeat-recruiting-stg-027.cloudflareaccess.com`
- Application AUD: `5f60dbf34db2d7ccdb1fb9b7271bb71efe27f1f0184297ec71fd9d7d5a9deb8d`
- Access session duration: 7 days (reauthentication interval, not membership
  expiration)

The AUD is a public application identifier used for JWT audience validation; it
is not an authentication Secret. Never commit an Access JWT, `CF_Authorization`
cookie, service-token secret, or Cloudflare API token.

## Common command rules

- Every POST/PATCH body must be a JSON object.
- Every state-changing request must include a unique `idempotency_key` between
  8 and 200 characters.
- Boolean state accepts JSON `true`/`false` or numeric `1`/`0`; strings such as
  `"false"` are rejected.
- A record with an `is_active` column defaults to active when `is_active` is
  omitted during creation.
- Code, UUID, and primary-key identity are immutable. A semantic change creates
  a new Reference row and deactivates the old row.
- Secrets never belong in these request bodies.

## G01 Reference importers

Discover the fixed whitelist:

```http
GET /v1/reference/types
```

Supported types:

```text
function
seniority
contact_type
skill_type
skill
skill_type_assignment
skill_proficiency_level
certification_type
issuing_organization
certification
country
state
city
location
degree
field_study
major
school
work_mode
position_employment_type
position_occupational_type
```

Create one authoritative row:

```http
POST /v1/reference/skill
Content-Type: application/json

{
  "idempotency_key": "reference-skill-python-2026-08-18",
  "skill_name": "Python"
}
```

The importer generates `skill_uuid`, `normalized_skill_name`, timestamps, and
`is_active = 1`. To create it inactive, explicitly send `"is_active": false`.

Deactivate or reactivate a Reference that supports active state:

```http
PATCH /v1/reference/skill/123/active-state
Content-Type: application/json

{
  "idempotency_key": "reference-skill-123-disable-2026-08-18",
  "is_active": false
}
```

`skill_type_assignment` and `location` do not have an `is_active` column and
therefore reject the active-state endpoint.

## G02 Catalog child importers

Discover the whitelist:

```http
GET /v1/catalog/child-types
```

Supported types:

```text
company_contact_info
company_work_mode
position_salary_range
position_skill
position_education_requirement
position_certification_requirement
```

Example:

```http
POST /v1/catalog/children/position_skill
Content-Type: application/json

{
  "idempotency_key": "position-42-skill-7-required",
  "position_id": 42,
  "skill_id": 7,
  "requirement_type": "required"
}
```

The new child row defaults to `is_active = 1`. Its active state can be changed
with:

```http
PATCH /v1/catalog/children/position_skill/88/active-state
Content-Type: application/json

{
  "idempotency_key": "position-skill-88-disable",
  "is_active": false
}
```

## Position JD and default status

`POST /v1/catalog/positions` derives status only when `position_status` is
omitted:

```text
trimmed position_jd length >= 10 -> active
missing or shorter JD             -> draft
```

An explicitly supplied status is honored except that `active` is rejected when
the JD readiness invariant is not satisfied. This invariant is protected by the
API, Catalog option query, Initial Cleaning, Workflow B, and D1 triggers.

The same rule is mandatory for an approved manual SQL insert. SQLite/D1 cannot
make a normal column `DEFAULT` depend on another column while also distinguishing
an omitted status from an explicitly supplied `draft`. Manual SQL must therefore
bind an optional status and use the canonical expression below:

```sql
CASE
  WHEN :position_status IS NOT NULL THEN :position_status
  WHEN length(trim(COALESCE(:position_jd, ''))) >= 10 THEN 'active'
  ELSE 'draft'
END
```

The resulting value is written into `position.position_status`. The D1 trigger
then rejects any resulting `active` row whose JD is missing or shorter than the
readiness threshold. Direct SQL that simply omits `position_status` without this
expression is not an approved production authoring path.

When an approved Position update makes the Position active with a ready JD, the
Operations API also finds Applications whose Workflow B is in
`waiting_position_jd` and is their latest Workflow B run, requires each
Application to remain current `processing + pending`, rotates its decision
fence, cancels the old waiting database run, and publishes one idempotent
`application.position_jd_ready` Outbox event per Application. The dispatcher
then starts a new Workflow B instance with the new fence; it never resumes an
obsolete in-memory execution.

Draft Positions remain absent from `GET /v1/catalog/options` and Workflow A
blocks them even when a trusted source references the authoritative Position
ID. Initial Cleaning distinguishes `submitted_position_not_active`,
`submitted_position_wrong_company`, and `submitted_position_jd_not_ready`.
Workflow B records `waiting_position_jd` only when a Position that was ready
during Workflow A loses readiness after the Application was created.

Draft Position example:

```json
{
  "idempotency_key": "position-hirebeat-data-analyst-draft",
  "company_id": 1,
  "position_name": "Data Analyst"
}
```

Active Position example:

```json
{
  "idempotency_key": "position-hirebeat-data-analyst-active",
  "company_id": 1,
  "position_name": "Data Analyst",
  "position_jd": "Analyze business data using SQL, Python, and dashboards."
}
```

After a change affects selectable Company, Company Work Mode, or Position
options, publish a Catalog revision through `POST /v1/catalog/revisions` so the
external Airtable/Google channel synchronization can observe the new snapshot.

## Controlled Intake recovery

Do not submit the original application a second time after Queue retries are
exhausted. First correct the underlying Secret, permission, mapping,
dependency, or code. Then an authorized member may release the existing private
R2 replay envelope:

```http
POST /v1/intake-runs/1/recover
Content-Type: application/json

{
  "idempotency_key": "staging-intake-1-google-token-fixed-v1",
  "recovery_reason": "Corrected the Google token dependency and approved replay."
}
```

The endpoint returns `202` only for a technically exhausted
`failed_terminal` run that has not published a Raw Submission. It preserves the
source identity, Submission UUID, accepted payload HMAC, immutable replay
envelope, frozen configuration release, and previous technical/audit evidence.
It rotates a recovery fence and atomically creates a Queue-targeted Outbox event
plus an audit event. Reusing the same command idempotency key cannot create a
second recovery event.

Never place a token, service-account JSON, private key, Resume text, PDF, or
complete application payload in `recovery_reason`.
