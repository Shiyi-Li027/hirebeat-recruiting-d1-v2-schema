/**
 * Shared SQL predicate for selecting the only Workflow B run that may be
 * resumed after a Position becomes ML-ready.
 *
 * The caller must alias application as `app` and etl_workflow_run as `w`.
 * Keeping this fragment shared prevents the protected Position command and
 * the scheduled reconciler from drifting apart.
 */
export const CURRENT_POSITION_JD_WAITER_PREDICATE = `
  app.application_lifecycle_status='processing'
  AND app.application_decision_status='pending'
  AND app.current_candidate_snapshot_id IS NOT NULL
  AND w.id=(SELECT MAX(latest.id)
            FROM etl_workflow_run latest
            WHERE latest.application_id=app.id
              AND latest.workflow_type='workflow_b')
`;
