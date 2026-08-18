# Production runtime comparison: v2 vs legacy Colab vs teammate Worker

This document records implementation differences introduced by the production v2 runtime. It supplements the table-level comparison CSV and prevents the three systems from being mistaken for interchangeable implementations.

| Area | New v2 production runtime | Legacy Colab/database flow | Teammate Worker project |
|---|---|---|---|
| Execution unit | One source submission per authenticated request; technical redelivery is idempotent | Usually CSV/batch oriented; later cells were narrowed to current CSV subset | Polls Airtable/Google and writes its own compact schema |
| Source contract | Both sources adapt to one versioned canonical envelope | Column names and Drive CSV paths form an implicit contract | Provider fields are resolved with exact/normalized aliases |
| Source identity | `submission_uuid`, `(source_system, source_record_id)`, `source_event_key`, plus keyed payload HMAC | Batch ID and CSV row mappings | `wasAlreadySynced()` primarily checks provider record ID |
| PDF storage | Original bytes first preserved in private R2 under a content-hash key | Resume text generally already existed; original PDF was outside D1 | Downloads PDF and forwards it to Parser; did not originally preserve it in R2 |
| PDF parsing | Authenticated PyMuPDF service; `sort=True`; line breaks retained; nullable terminal result | Consumes existing Resume text | FastAPI/PyMuPDF integration; failed text remains NULL |
| Atomic Raw publication | One D1 `batch()` publishes Raw, Resume metadata/text, succeeded intake and Workflow A Outbox | Multiple notebook cells and CSV/database writes | Direct updates to teammate-specific application tables |
| Technical retry | Attempt fence, stale takeover, retryable/terminal status, frozen config release | Cell rerun and later idempotent import logic | Provider-record skip plus parser status; less detailed attempt fencing |
| Workflow orchestration | Outbox lease plus Cloudflare Workflow A and Workflow B | Human-ordered Colab cells | Single Worker synchronization/parser flow |
| Normalization | Reads only D1, versions normalized output, no CSV dependency | Generated/overwrote intermediate CSVs | Raw and normalized concerns mostly combined |
| Dedup grouping | Company + Position + requested start `YYYY-MM`; compares current group against historical D1 submissions | Same evolved rule, originally batch files | Same applicant + role + submission calendar month |
| Dedup evidence | Positive matched pairs and keyed-HMAC identity evidence; admission decision separate | CSV evidence and union-find processing | Compact duplicate flag; no equivalent evidence graph |
| Application publication | Dedicated lineage, immutable Candidate snapshot, resubmission fence, old Application superseded | Application importer/backfill cells | Compact applicants/applications model |
| Candidate facts | Person fact history plus append-only Candidate bridges; zero child rows are valid | Multiple extraction/import cells and full-library repairs | Not equivalent to full v2 fact/history model |
| ML | Internal authenticated service; complete Resume/JD; all-MiniLM-L6-v2 cosine; fixed threshold | Same model logic evolved from anomaly/KMeans/PCA/scorecard prototype | No equivalent v2 recommendation pipeline |
| Final decision | Anomaly exclusion -> no offer; otherwise fixed similarity threshold; one D1 batch records ML/stages/rejected or Offer draft | CSV Offer selector originally used group top percentage, later revised | No equivalent integrated ML/Offer decision |
| Hiring flow | Versioned 13-stage graph; v1 automatic route is Application received -> ML recommendation -> Offer process/Rejected | Pipeline tables and importer were created after ML CSV | No equivalent flexible stage graph |
| Offer | One Offer master/application, immutable terms versions, validated status state machine | Offer records imported from result CSV | No equivalent Offer version/lifecycle implementation |
| Async handoff | Transactional Outbox with lease, at-least-once dispatch and idempotent consumer identities | Notebook sequencing | Direct Worker calls/updates |
| Operations security | Cloudflare Access JWT verification for team Author commands | Colab/DB credentials | Worker tokens/provider credentials |
| Catalog | Authoritative Company -> optional Company Work Mode -> Position; revision snapshots | Catalog tables, earlier fuzzy mappings and unknown cycles | `findOrCreateCompany/Role` could create catalog values from submission text |
| Inspection CSV | Read-only on-demand export to ignored `test-exports`, private short-lived artifact | CSV was a production step dependency | Provider/D1 inspection rather than v2 export bundle |
| Deployment | Immutable migrations, schema validation, Worker dry-run CI, isolated staging/production resources | Interactive Colab execution | Independently deployed Worker and separate schema |

## Changes deliberately inherited from the teammate implementation

- Airtable attachment URL and Google Drive file ID are the two supported Resume acquisition paths.
- Google service-account JWT authentication is compatible with the Worker runtime.
- Parser failures leave Resume text NULL and use explicit status/error data.
- PyMuPDF output retains line/section structure.
- Provider field aliases remain an adapter concern, never a database matching rule.

## Changes deliberately not inherited

- v2 does not call `findOrCreateCompany()` or `findOrCreateRole()` from applicant text; Catalog IDs must be authoritative and Initial Cleaning validates existence, ownership and active state.
- v2 does not use submission calendar month as the recruiting dedup cycle.
- v2 does not merge Raw and normalized data into one table.
- v2 does not treat `wasAlreadySynced()` as sufficient end-to-end idempotency; it protects all stable source identities and the payload HMAC.
- v2 does not expose provider credentials or service-account JSON in committed files.

## Changes from the legacy Colab implementation

- Every production runtime step reads D1/R2 or its authenticated service input; no prior CSV or notebook variable is required.
- CSV becomes a read-only testing artifact, not the data bus.
- Failed technical attempts do not overwrite successful historical records.
- D1 short transactions and cross-step compensation/fencing replace the idea of one long database rollback.
- Batch-only KMeans, PCA, subjective scorecard and group-top-ratio selection are excluded from production v1.
