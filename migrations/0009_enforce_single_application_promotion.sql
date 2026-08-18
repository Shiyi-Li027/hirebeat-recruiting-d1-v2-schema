-- A normalized Submission can be promoted as the primary decision input for
-- at most one Application. This makes Application-core publication safe when
-- a committed D1 batch is retried after its response was interrupted.

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_application_source_lineage_one_primary_promotion
  ON application_source_lineage (source_submission_normalized_id)
  WHERE relation_role = 'primary_decision_input';

