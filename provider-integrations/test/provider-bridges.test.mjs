import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root=path.resolve(import.meta.dirname,"..");
const googleSource=fs.readFileSync(path.join(root,"google-form","Code.js"),"utf8");

function loadGoogleHelpers(){
  const context=vm.createContext({});
  vm.runInContext(`${googleSource}\n;globalThis.__hirebeatTest={catalogRows:hireBeatCatalogOptionRows_,marker:HIREBEAT_GOOGLE_FORM.optionMarker,submissionFields:hireBeatSubmissionFields_};`,context);
  return context.__hirebeatTest;
}

test("Google Form options freeze revision and stable relational IDs in the submitted label",()=>{
  const helpers=loadGoogleHelpers();
  const rows=helpers.catalogRows({
    revision:{revision_number:7,snapshot_sha256:"a".repeat(64)},
    companies:[{id:1,company_name:"AGS Logistics"}],
    company_work_modes:[{company_work_mode_id:3,company_id:1,work_mode_name:"On-site"}],
    positions:[{id:4,company_id:1,position_name:"Data Quality Analyst"}],
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0].label,"AGS Logistics — Data Quality Analyst — On-site [HB:r7:p4:w3]");
  assert.deepEqual(Array.from(rows[0].label.match(helpers.marker),String).slice(1),["7","4","3"]);
});

test("Google Form bridge rejects an empty selectable Catalog",()=>{
  const helpers=loadGoogleHelpers();
  assert.throws(()=>helpers.catalogRows({
    revision:{revision_number:7},companies:[],company_work_modes:[],positions:[],
  }),/catalog_has_no_selectable_options/);
});

test("Google Form bridge maps Airtable-aligned visible titles into canonical Intake fields",()=>{
  const helpers=loadGoogleHelpers();
  const fields=helpers.submissionFields({
    "🧑‍🎓 Student":"Alex Morgan",
    "🎯 Contact_Email":"alex.morgan.synthetic@example.com",
    "Duration":"2 months",
    "🎯 Resume":["google-drive-file-id"],
    "Start_Date":"2026-09-01",
    "End_Date":"2026-11-01",
  },{
    revisionNumber:7,
    companyId:1,
    companyName:"AGS Logistics",
    companyWorkModeId:1,
    companyWorkModeName:"On-site",
    positionId:4,
    positionName:"Data Quality Analyst",
  },null);
  assert.equal(fields["Candidate Name"],"Alex Morgan");
  assert.equal(fields["Email Address"],"alex.morgan.synthetic@example.com");
  assert.equal(fields["Work Duration"],"2 months");
  assert.equal(fields["Resume File ID"],"google-drive-file-id");
  assert.equal(fields["Start Working Date"],"2026-09-01");
  assert.equal(fields["End Working Date"],"2026-11-01");
  assert.equal(fields["Phone Number"],null);
  assert.equal(fields["Catalog Revision"],7);
});

test("Google Form bridge preserves legacy question-title aliases",()=>{
  const helpers=loadGoogleHelpers();
  const fields=helpers.submissionFields({
    "Candidate Name":"Taylor Kim",
    "Email Address":"taylor.kim.synthetic@example.com",
    "Work Duration":"ongoing",
    "Resume":"legacy-drive-file-id",
    "Start Working Date":"2026-09-15",
  },{
    revisionNumber:7,
    companyId:1,
    companyName:"AGS Logistics",
    companyWorkModeId:1,
    companyWorkModeName:"On-site",
    positionId:1,
    positionName:"Operations Data Analyst",
  },null);
  assert.equal(fields["Candidate Name"],"Taylor Kim");
  assert.equal(fields["Email Address"],"taylor.kim.synthetic@example.com");
  assert.equal(fields["Work Duration"],"ongoing");
  assert.equal(fields["Resume File ID"],"legacy-drive-file-id");
  assert.equal(fields["Start Working Date"],"2026-09-15");
});

test("provider templates contain placeholders but no deployed credential values",()=>{
  const files=[
    path.join(root,"google-form","Code.js"),
    path.join(root,"airtable","submission-automation.js"),
    path.join(root,"airtable","catalog-sync-automation.js"),
  ];
  for(const file of files){
    const source=fs.readFileSync(file,"utf8");
    assert.doesNotMatch(source,/shiyilidorothy\.workers\.dev/);
    assert.doesNotMatch(source,/[a-f0-9]{64}/i);
  }
});

test("Apps Script manifest keeps Eastern business display time and explicit scopes",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"google-form","appsscript.json"),"utf8"));
  assert.equal(manifest.timeZone,"America/New_York");
  assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/script.external_request"));
  assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/forms.currentonly"));
});
