import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { CURRENT_POSITION_JD_WAITER_PREDICATE } from "../../shared/src/position-jd-waiter-policy";

test("only the current processing and pending Application's latest Workflow B waiter is recoverable",()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE application (
      id INTEGER PRIMARY KEY,
      application_lifecycle_status TEXT NOT NULL,
      application_decision_status TEXT NOT NULL,
      current_candidate_snapshot_id INTEGER
    );
    CREATE TABLE etl_workflow_run (
      id INTEGER PRIMARY KEY,
      application_id INTEGER NOT NULL,
      workflow_type TEXT NOT NULL,
      workflow_status TEXT NOT NULL,
      current_step_key TEXT
    );

    -- Historical waiter: a newer Application superseded it.
    INSERT INTO application VALUES (1,'superseded','pending',101);
    INSERT INTO etl_workflow_run VALUES (11,1,'workflow_b','waiting','waiting_position_jd');

    -- The single current waiter that is eligible for recovery.
    INSERT INTO application VALUES (2,'processing','pending',102);
    INSERT INTO etl_workflow_run VALUES (21,2,'workflow_b','waiting','waiting_position_jd');

    -- A historical waiting row followed by a newer running Workflow B.
    INSERT INTO application VALUES (3,'processing','pending',103);
    INSERT INTO etl_workflow_run VALUES (31,3,'workflow_b','waiting','waiting_position_jd');
    INSERT INTO etl_workflow_run VALUES (32,3,'workflow_b','running','run_ml_recommendation');

    -- Terminal and incomplete candidates are never recovery targets.
    INSERT INTO application VALUES (4,'completed','offer_created',104);
    INSERT INTO etl_workflow_run VALUES (41,4,'workflow_b','waiting','waiting_position_jd');
    INSERT INTO application VALUES (5,'processing','rejected',105);
    INSERT INTO etl_workflow_run VALUES (51,5,'workflow_b','waiting','waiting_position_jd');
    INSERT INTO application VALUES (6,'processing','pending',NULL);
    INSERT INTO etl_workflow_run VALUES (61,6,'workflow_b','waiting','waiting_position_jd');
  `);

  const rows=db.prepare(`
    SELECT app.id application_id
    FROM application app
    JOIN etl_workflow_run w ON w.application_id=app.id
      AND w.workflow_type='workflow_b'
      AND w.workflow_status='waiting'
      AND w.current_step_key='waiting_position_jd'
    WHERE ${CURRENT_POSITION_JD_WAITER_PREDICATE}
    ORDER BY app.id
  `).all() as Array<{application_id:number}>;

  assert.deepEqual(rows.map((row)=>row.application_id),[2]);
  db.close();
});
