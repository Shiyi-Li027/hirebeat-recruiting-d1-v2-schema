-- Freeze the first successfully downloaded PDF content identity on an Intake.
-- The nullable column keeps no-resume and pre-resolution rows valid.

ALTER TABLE raw_submission_intake_run
  ADD COLUMN accepted_resume_file_sha256 TEXT
  CHECK (
    accepted_resume_file_sha256 IS NULL
    OR length(accepted_resume_file_sha256) = 64
  );
