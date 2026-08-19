-- Add a recovery-generation fence for controlled replays of technically
-- exhausted Submission Intake runs. Existing and initial deliveries use NULL;
-- each approved recovery receives a new UUID fence.

ALTER TABLE raw_submission_intake_run
ADD COLUMN recovery_fence_token TEXT
  CHECK (
    recovery_fence_token IS NULL
    OR length(trim(recovery_fence_token)) > 0
  );
