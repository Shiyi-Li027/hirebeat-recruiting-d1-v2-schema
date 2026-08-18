# Private staging source data

Place local Airtable/Google exports, Resume datasets and external Catalog
source CSV files in this directory only for controlled staging preparation.
Git ignores every file in this directory except this README because source
rows may contain candidate PII or data with separate licensing terms.

Rules:

- never commit candidate names, emails, Resume text, attachment URLs or source
  record identifiers;
- never bulk-load these files directly into D1;
- normalize, validate and deduplicate Catalog rows before invoking the
  production importer;
- use generated synthetic applicants for automated acceptance tests;
- retain a local manifest of source hashes and row counts outside Git when an
  audited import is required.

Run `npm run data:preflight` from the repository root after placing all six
reviewed source files here. Aggregate quality metrics plus Git-ignored Catalog
and Skill candidate JSON files are written to
`test-exports/staging/source-preflight/`. The command is read-only with respect
to D1, R2 and every external service.
