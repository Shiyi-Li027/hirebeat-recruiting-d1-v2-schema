import assert from "node:assert/strict";
import test from "node:test";

import { classifySkillCandidates } from "../src/resume-rule-extractor";

const resume = `
TAYLOR KIM

SKILLS
Python, SQL, Git, Synthetic Unmapped Tool, Python

EXPERIENCE
Synthetic Data Lab
Data Analyst
2024 - Present
Used Python outside the Skills section.
`;

const catalog = [
  { id: 1, skill_name: "Python", normalized_skill_name: "python" },
  { id: 2, skill_name: "SQL", normalized_skill_name: "sql" },
  { id: 3, skill_name: "Git", normalized_skill_name: "git" },
];

test("skill extraction publishes catalog matches and preserves unmapped evidence", () => {
  const candidates = classifySkillCandidates(resume, catalog);
  const eligible = candidates.filter(
    (candidate) => candidate.extractionEligibilityStatus === "eligible",
  );
  const rejected = candidates.filter(
    (candidate) => candidate.extractionEligibilityStatus === "rejected_unmapped_skill",
  );

  assert.deepEqual(eligible.map((candidate) => candidate.skillId), [1, 2, 3]);
  assert.equal(eligible.filter((candidate) => candidate.skillId === 1).length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].rawSkillText, "Synthetic Unmapped Tool");
  assert.equal(rejected[0].skillId, null);
  assert.equal(
    rejected[0].rejectionReasonDetail,
    "active_skill_catalog_match_not_found",
  );
});

test("an empty active catalog rejects each distinct Skills token without dropping it", () => {
  const candidates = classifySkillCandidates(resume, []);

  assert.equal(candidates.length, 4);
  assert.ok(candidates.every(
    (candidate) => candidate.extractionEligibilityStatus === "rejected_unmapped_skill",
  ));
  assert.ok(candidates.every((candidate) => candidate.skillId === null));
});

test("skill extraction is limited to the Skills section", () => {
  const candidates = classifySkillCandidates(
    "EXPERIENCE\nSynthetic Lab\nPython\n2024 - Present",
    catalog,
  );

  assert.deepEqual(candidates, []);
});
