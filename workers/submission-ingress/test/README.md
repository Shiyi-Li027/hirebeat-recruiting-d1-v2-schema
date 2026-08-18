# Test layout

The next implementation stage will use Cloudflare's Workers Vitest integration so tests execute in the Workers runtime through Miniflare.

Planned suites:

- `fixtures/`: sanitized Airtable and Google Form source events plus small synthetic PDFs;
- `unit/`: adapter mapping, canonicalization, stable HMAC input, error classification, configuration parsing, and object-key generation;
- `integration/`: local D1 transaction behavior, local R2 writes, idempotent redelivery, stale-run takeover, Parser timeout, and Outbox creation.

`unit/resume-acquisition.test.ts` now covers synthetic PDF validation, size rejection,
Google Drive ID extraction, stable R2 keys, and conditional R2 redelivery behavior.
It never connects to remote D1, remote R2, Airtable, Google, or the production Parser.

The two current JSON fixtures are synthetic examples for the runtime validation gate. They intentionally demonstrate both populated and empty Raw business fields.
