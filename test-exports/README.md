# Test exports

This directory is the fixed workspace root for on-demand, read-only D1 inspection
exports. It is not an ETL input and export failure must never fail Workflow A or B.

## Directory contract

```text
test-exports/
└── <environment>/
    └── <YYYY-MM-DD>/
        └── <workflow_run_uuid>/
            ├── 00_export_manifest.csv
            ├── raw_submission.csv
            ├── submission_normalized.csv
            ├── application.csv
            └── ...
```

Every file for one inspection run belongs in the same run directory. The manifest
records the table or query, filter, row count, checksum, exporter version, and time.

## Security boundary

Generated CSV files can contain resumes, email addresses, phone numbers, and other
candidate PII. `.gitignore` therefore excludes generated contents from Git history.
Do not force-add them with `git add -f`.

For team sharing, a manually triggered GitHub Actions workflow may upload one run
directory as a private, time-limited Actions Artifact. Only synthetic or explicitly
redacted samples may be committed to the repository.

Production code must never read these files. Every production step reads D1/R2 and
writes the appropriate D1/R2 records directly.
