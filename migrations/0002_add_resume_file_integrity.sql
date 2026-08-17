-- Add integrity metadata for original resume files stored in Cloudflare R2.
-- The file hash is intentionally not UNIQUE: the same PDF may be submitted in
-- more than one legitimate business submission. The R2 object key is unique
-- because every submission writes to its own immutable object path.

ALTER TABLE raw_submission_resume
  ADD COLUMN resume_file_sha256 TEXT
    CHECK (resume_file_sha256 IS NULL OR length(resume_file_sha256) = 64);

CREATE UNIQUE INDEX uq_raw_submission_resume_r2_object_key
  ON raw_submission_resume (resume_r2_object_key)
  WHERE resume_r2_object_key IS NOT NULL;
