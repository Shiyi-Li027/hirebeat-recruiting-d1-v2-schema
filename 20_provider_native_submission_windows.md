# Provider-native Airtable and Google Form submission windows

Version date: 2026-08-19
Status: implementation foundation complete; external provider objects not yet enabled

## 1. Confirmed boundary

This stage connects the already-tested D1 pipeline to native provider windows.
It does not change the frozen database rules:

- D1 remains authoritative for Company, Company Work Mode and Position IDs.
- Only `active` Positions with a trimmed JD of at least 10 characters appear in
  a newly synchronized provider window.
- An already-open form page may submit the revision it originally loaded.
- Raw intake preserves those submitted IDs and names.
- Workflow A revalidates the IDs, Company ownership, current Position status
  and JD readiness before creating an Application.
- Provider code never creates a Company, Work Mode or Position on mismatch.
- Provider credentials are configured outside Git and are never returned to an
  applicant browser.

The Google Form presents one combined Position choice:

```text
Company — Position — Work Mode [HB:r<revision>:p<position_id>:w<company_work_mode_id>]
```

This is a native-form presentation choice, not a database-model change. It
prevents an applicant from combining a Position belonging to one Company with
a Work Mode belonging to another. The marker also lets a stale page identify
the exact historical Catalog revision. It is not an authentication secret.

## 2. Implemented repository components

| Component | Purpose |
|---|---|
| `provider-integrations/google-form/Code.js` | Synchronizes native choices and posts a Form submit event to the authenticated Google adapter. |
| `provider-integrations/google-form/appsscript.json` | Pins the Apps Script V8 runtime, Eastern business timezone and minimum explicit scopes. |
| `provider-integrations/airtable/submission-automation.js` | Reads the triggering Airtable record and posts it to the authenticated Airtable adapter. |
| `provider-integrations/airtable/catalog-sync-automation.js` | Mirrors the latest Catalog into an Airtable Position-options table without deleting stale rows. |
| `GET /v1/catalog/revisions/:revision_number/options` | Returns the immutable historical option snapshot needed to resolve a stale Google Form choice. |

No migration or table change is introduced in this stage.

## 3. Google Form object contract

Create or select a Google Form owned by the staging Workspace account. The
bound script expects exactly one `Position` item of type Dropdown or Multiple
choice. The applicant-facing questions should use these titles:

| Title | Recommended native type | Required by provider bridge |
|---|---|---:|
| `Position` | Dropdown | Yes |
| `Candidate Name` | Short answer | Yes |
| `Email Address` | Short answer, or enable email collection | Yes |
| `Phone Number` | Short answer | According to current intake policy |
| `Start Working Date` | Date | Optional |
| `End Working Date` | Date | Optional |
| `Work Duration` | Short answer | Optional |
| `Resume` | File upload, PDF only, one file | According to current intake policy |

Configure these Script Properties through Apps Script **Project Settings**:

| Property | Value |
|---|---|
| `HIREBEAT_INGRESS_BASE_URL` | Staging submission-ingress HTTPS origin, without a trailing slash. |
| `HIREBEAT_INGRESS_INTERNAL_AUTH_TOKEN` | The same current secret configured on the staging ingress Worker. |
| `HIREBEAT_OPERATIONS_BASE_URL` | Staging Operations API HTTPS origin, without a trailing slash. |
| `HIREBEAT_CF_ACCESS_CLIENT_ID` | Dedicated provider-sync Cloudflare Access service-token Client ID. |
| `HIREBEAT_CF_ACCESS_CLIENT_SECRET` | Its Client Secret. |

Keep Form and script editor access minimal. Script Properties are shared
project configuration; they are not applicant-visible, but editors of the
script project are trusted operators. The Cloudflare service token must be
accepted only by a `Service Auth` policy for the Operations application.

Installation order:

1. bind an Apps Script project to the Form;
2. copy `Code.js` and `appsscript.json`;
3. configure the five Script Properties;
4. run `syncHireBeatCatalogOptions()` manually and inspect the returned Form ID,
   revision and option count;
5. run `installHireBeatFormSubmitTrigger()` once and grant the requested scopes;
6. submit one synthetic response while the Form is not publicly advertised;
7. verify one Intake run, Raw row, published Outbox event and Workflow A run;
8. only then open the staging channel.

The submit trigger uses the provider response ID to create:

```text
source_record_id = form:<form_id>:response:<response_id>
```

Retrying the same response therefore reaches the existing intake idempotency
fence instead of creating another logical submission.

## 4. Airtable object contract

Use two tables:

- an application-submission table containing applicant input;
- a Position-options mirror table whose active view is used by the native Form
  linked-record field.

The Position-options mirror table requires these exact fields for the first
deployment:

```text
Display Label                single line text / primary field
HireBeat Option Key          single line text
Company ID                   number
Company Name                 single line text
Company Work Mode ID         number
Company Work Mode            single line text
Position ID                  number
Position Name                single line text
Catalog Revision             number
Is Active                    checkbox
```

Create an `Active application options` view filtered to `Is Active = checked`.
The submission table's Position linked-record field must limit selection to
that view. Use lookup fields on the submission record to expose the exact
Company/Work Mode/Position ID and name fields expected by the bridge.

The submission table requires these exact bridge-facing fields (applicant-only
fields may be editable; relational values should be lookups from the selected
Position-options record):

```text
Company ID
Company Name
Company Work Mode ID
Company Work Mode
Position ID
Position Name
Candidate Name
Email Address
Phone Number
Start Working Date
End Working Date
Work Duration
Resume
```

Catalog sync Automation:

- trigger: only when an operator opens/re-enables the channel, or an equivalent
  controlled scheduled/manual event;
- action: Run a script using `catalog-sync-automation.js`;
- inputs: `positionsTableId`, `operationsBaseUrl`;
- secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.

Submission Automation:

- trigger: when the native Airtable Form creates a submission record;
- action: Run a script using `submission-automation.js`;
- inputs: the trigger's actual Airtable `recordId`, `tableId`, `baseId`, and the
  staging `ingressBaseUrl`;
- secret: `INGRESS_INTERNAL_AUTH_TOKEN`.

The script namespaces the provider record identity as:

```text
source_record_id = base:<base_id>:table:<table_id>:record:<record_id>
```

The catalog script updates existing option rows, creates missing rows and marks
removed rows inactive. It never deletes a prior option row, so old submission
lineage remains understandable.

## 5. Security and failure rules

- Never put a bearer token, Access Client Secret, Form ID or Base ID into Git.
- Never call Ingress directly from applicant-side JavaScript.
- Use a dedicated provider-sync Access service token; do not reuse a human
  Access session or a Google Drive service-account credential.
- Provider HTTP failures fail the Automation/trigger execution visibly. They do
  not write a synthetic success flag into Airtable or Google.
- Invalid/missing revision markers fail before Intake. Unknown or stale but
  well-formed IDs are still preserved and then rejected precisely by Workflow A.
- Store all D1 timestamps in UTC. Apps Script uses `America/New_York` only as
  the business/display timezone.

## 6. Remaining activation work

Repository bridge code is now available, but provider-native staging is not yet
truthfully active. Activation still requires:

1. the actual staging Google Form edit link or Form ID;
2. the actual staging Airtable Base ID, submission Table ID, Position mirror
   Table ID and field review;
3. a dedicated Cloudflare Access service token and Service Auth policy;
4. secrets entered into Apps Script/Airtable through their protected settings;
5. one synthetic submission from each real provider and D1 evidence;
6. wiring `catalog_sync_run` / `catalog_sync_target_run` command reporting before
   production enablement, so each target has durable retry and completion
   evidence.

The last item is intentionally not faked by the templates: a provider window
must not claim a successful D1 sync target until the external option mutation
actually completed.
