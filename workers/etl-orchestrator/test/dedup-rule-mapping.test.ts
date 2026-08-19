import assert from "node:assert/strict";
import test from "node:test";
import { primaryMatchRule } from "../src/workflow-a-dedup";

test("dedup primary-rule codes match the database CHECK constraint", () => {
  assert.equal(primaryMatchRule({email_count:1,phone_count:1,linkedin_count:1,github_count:1}),"email_exact_match");
  assert.equal(primaryMatchRule({email_count:0,phone_count:1,linkedin_count:1,github_count:1}),"phone_last_10_exact_match");
  assert.equal(primaryMatchRule({email_count:0,phone_count:0,linkedin_count:1,github_count:1}),"linkedin_exact_match");
  assert.equal(primaryMatchRule({email_count:0,phone_count:0,linkedin_count:0,github_count:1}),"github_exact_match_with_same_normalized_last_name");
  assert.throws(
    ()=>primaryMatchRule({email_count:0,phone_count:0,linkedin_count:0,github_count:0}),
    /dedup_match_has_no_supported_primary_rule/,
  );
});
