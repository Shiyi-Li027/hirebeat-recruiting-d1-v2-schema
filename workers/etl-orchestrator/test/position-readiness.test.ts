import assert from "node:assert/strict";
import test from "node:test";

import { positionAdmissionReason, positionAllowsApplicationIntake, positionIsReadyForMl } from "../src/position-readiness";

test("draft Position is blocked before Application publication and is not ML-ready",()=>{
  assert.equal(positionAllowsApplicationIntake("draft",null),false);
  assert.equal(positionAllowsApplicationIntake("draft","A sufficiently detailed JD"),false);
  assert.equal(positionIsReadyForMl("draft",null),false);
  assert.equal(positionIsReadyForMl("draft","A sufficiently detailed JD"),false);
});

test("only an active Position with a ready JD may enter Application processing or ML",()=>{
  assert.equal(positionAllowsApplicationIntake("active",null),false);
  assert.equal(positionAllowsApplicationIntake("active"," short "),false);
  assert.equal(positionAllowsApplicationIntake("active","A sufficiently detailed JD"),true);
  assert.equal(positionIsReadyForMl("active",null),false);
  assert.equal(positionIsReadyForMl("active"," short "),false);
  assert.equal(positionIsReadyForMl("active","A sufficiently detailed JD"),true);
});

test("paused, closed and archived Positions are blocked before Application publication",()=>{
  for(const status of ["paused","closed","archived",null]){
    assert.equal(positionAllowsApplicationIntake(status,"A sufficiently detailed JD"),false);
    assert.equal(positionIsReadyForMl(status,"A sufficiently detailed JD"),false);
  }
});

test("Workflow A reports distinct Position admission reasons",()=>{
  const base={submittedPositionId:8,submittedCompanyId:3,positionCompanyId:3,positionStatus:"active",positionJd:"A sufficiently detailed JD"};
  assert.equal(positionAdmissionReason({...base,positionStatus:"draft"}),"submitted_position_not_active");
  assert.equal(positionAdmissionReason({...base,positionCompanyId:4}),"submitted_position_wrong_company");
  assert.equal(positionAdmissionReason({...base,positionJd:"short"}),"submitted_position_jd_not_ready");
  assert.equal(positionAdmissionReason(base),null);
});
