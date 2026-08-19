import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root=path.resolve(import.meta.dirname,"..");
const googleSource=fs.readFileSync(path.join(root,"google-form","Code.js"),"utf8");

function loadGoogleHelpers(){
  const context=vm.createContext({});
  vm.runInContext(`${googleSource}\n;globalThis.__hirebeatTest={catalogRows:hireBeatCatalogOptionRows_,marker:HIREBEAT_GOOGLE_FORM.optionMarker};`,context);
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
