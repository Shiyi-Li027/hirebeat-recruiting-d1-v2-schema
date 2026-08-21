import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root=path.resolve(import.meta.dirname,"..");
const googleSource=fs.readFileSync(path.join(root,"google-form","Code.js"),"utf8");

function loadGoogleHelpers(overrides={}){
  const context=vm.createContext({...overrides});
  vm.runInContext(`${googleSource}\n;globalThis.__hirebeatTest={catalogRows:hireBeatCatalogOptionRows_,marker:HIREBEAT_GOOGLE_FORM.optionMarker,submissionFields:hireBeatSubmissionFields_,catalogSyncStartCommand:hireBeatCatalogSyncStartCommand_,catalogSyncResultCommand:hireBeatCatalogSyncResultCommand_,catalogSyncFailureStatus:hireBeatCatalogSyncFailureStatus_,syncCatalogOptions:syncHireBeatCatalogOptions};`,context);
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

test("Google Form Catalog Sync commands freeze the target and revision",()=>{
  const helpers=loadGoogleHelpers();
  const command=helpers.catalogSyncStartCommand({
    revision:{
      id:17,
      revision_number:7,
      snapshot_sha256:"snapshot-sha256",
    },
  },"form-123","invocation-456");

  assert.equal(
    command.idempotency_key,
    "google-form-catalog-sync:form-123:17:invocation-456",
  );
  assert.equal(command.catalog_revision_id,17);
  assert.equal(command.target_type,"google_form");
  assert.equal(command.target_key,"form-123");

  assert.throws(
    ()=>helpers.catalogSyncStartCommand(
      {revision:{revision_number:7}},
      "form-123",
      "invocation-456",
    ),
    /catalog_revision_id_missing/,
  );
});

test("Google Form Catalog Sync classifies retryable provider failures",()=>{
  const helpers=loadGoogleHelpers();

  assert.equal(
    helpers.catalogSyncFailureStatus(
      new Error("operations_post_http_503"),
    ),
    "failed_retryable",
  );

  assert.equal(
    helpers.catalogSyncFailureStatus(
      new Error("operations_post_http_429"),
    ),
    "failed_retryable",
  );

  assert.equal(
    helpers.catalogSyncFailureStatus(
      new Error("Network error"),
    ),
    "failed_retryable",
  );

  assert.equal(
    helpers.catalogSyncFailureStatus(
      new Error("position_item_must_exist_exactly_once"),
    ),
    "failed_terminal",
  );
});

function googleJsonResponse(value,status=200){
  return {
    getResponseCode:()=>status,
    getContentText:()=>JSON.stringify(value),
  };
}

function googleCatalogSyncFixture({
  setChoiceValues=()=>{},
}={}){
  const requests=[];
  const propertyWrites=[];
  const lockEvents=[];

  const catalog={
    revision:{
      id:17,
      revision_number:7,
      snapshot_sha256:"a".repeat(64),
    },
    companies:[
      {
        id:1,
        company_name:"AGS Logistics",
      },
    ],
    company_work_modes:[
      {
        company_work_mode_id:3,
        company_id:1,
        work_mode_name:"On-site",
      },
    ],
    positions:[
      {
        id:4,
        company_id:1,
        position_name:"Data Quality Analyst",
      },
    ],
  };

  const runtime={
    LockService:{
      getScriptLock:()=>({
        waitLock:(milliseconds)=>{
          lockEvents.push(["wait",milliseconds]);
        },
        releaseLock:()=>{
          lockEvents.push(["release"]);
        },
      }),
    },

    Utilities:{
      getUuid:()=>"invocation-456",
    },

    PropertiesService:{
      getScriptProperties:()=>({
        getProperty:(name)=>{
          const values={
            HIREBEAT_OPERATIONS_BASE_URL:
              "https://operations.example.com",
            HIREBEAT_CF_ACCESS_CLIENT_ID:
              "access-client-id",
            HIREBEAT_CF_ACCESS_CLIENT_SECRET:
              "access-client-secret",
          };
          return values[name]??null;
        },
        setProperties:(values)=>{
          propertyWrites.push(values);
        },
      }),
    },

    FormApp:{
      getActiveForm:()=>({
        getId:()=>"form-123",
        getItems:()=>[
          {
            getTitle:()=>"Position",
            getType:()=>({
              toString:()=>"LIST",
            }),
            asListItem:()=>({
              setChoiceValues,
            }),
          },
        ],
      }),
    },

    UrlFetchApp:{
      fetch:(url,options)=>{
        const request={
          url,
          method:String(
            options?.method??"get"
          ).toLowerCase(),
          payload:options?.payload
            ? JSON.parse(options.payload)
            : null,
        };

        requests.push(request);

        if (
          request.method==="get" &&
          url.endsWith("/v1/catalog/options")
        ){
          return googleJsonResponse(catalog);
        }

        if (
          request.method==="post" &&
          url.endsWith("/v1/catalog-sync-runs")
        ){
          return googleJsonResponse(
            {
              catalog_sync_run_id:41,
              catalog_sync_run_uuid:
                "catalog-sync-run-uuid",
              catalog_revision_id:17,
              sync_status:"running",
              catalog_sync_target_run_id:52,
              target_type:"google_form",
              target_key:"form-123",
              target_status:"pending",
            },
            201,
          );
        }

        if (
          request.method==="post" &&
          url.endsWith(
            "/v1/catalog-sync-target-runs/52/result"
          )
        ){
          return googleJsonResponse({
            catalog_sync_run_id:41,
            catalog_sync_target_run_id:52,
            target_status:
              request.payload.result_status,
            sync_status:
              request.payload.result_status,
          });
        }

        return googleJsonResponse(
          {error:"unexpected_test_request"},
          500,
        );
      },
    },
  };

  return {
    runtime,
    requests,
    propertyWrites,
    lockEvents,
  };
}

test(
  "Google Form Catalog Sync result commands preserve idempotent evidence",
  ()=>{
    const helpers=loadGoogleHelpers();

    const success=helpers.catalogSyncResultCommand(
      52,
      "invocation-456",
      "succeeded",
      "7:snapshot-sha256",
      null,
    );

    assert.equal(
      success.idempotency_key,
      "google-form-catalog-sync-result:52:invocation-456",
    );
    assert.equal(success.result_status,"succeeded");
    assert.equal(
      success.external_revision_key,
      "7:snapshot-sha256",
    );
    assert.equal(success.last_error_code,null);
    assert.equal(success.last_error_detail,null);

    const failure=helpers.catalogSyncResultCommand(
      52,
      "invocation-456",
      "failed_retryable",
      null,
      new Error(
        "operations_post_http_503:unavailable"
      ),
    );

    assert.equal(
      failure.result_status,
      "failed_retryable",
    );
    assert.equal(
      failure.last_error_code,
      "operations_post_http_503",
    );
    assert.match(
      failure.last_error_detail,
      /unavailable/,
    );
  },
);

test(
  "Google Form Catalog Sync records a successful provider update",
  ()=>{
    const choices=[];
    const fixture=googleCatalogSyncFixture({
      setChoiceValues:(values)=>{
        choices.push(...values);
      },
    });

    const helpers=loadGoogleHelpers(
      fixture.runtime
    );

    const result=helpers.syncCatalogOptions();

    assert.equal(fixture.requests.length,3);

    assert.equal(
      fixture.requests[0].method,
      "get",
    );

    assert.equal(
      fixture.requests[1].url,
      "https://operations.example.com/v1/catalog-sync-runs",
    );

    assert.equal(
      fixture.requests[1].payload.catalog_revision_id,
      17,
    );

    assert.equal(
      fixture.requests[1].payload.target_type,
      "google_form",
    );

    assert.equal(
      fixture.requests[2].payload.result_status,
      "succeeded",
    );

    assert.equal(
      fixture.requests[2].payload.last_error_code,
      null,
    );

    assert.equal(choices.length,1);
    assert.match(choices[0],/\[HB:r7:p4:w3\]$/);

    assert.equal(fixture.propertyWrites.length,1);
    assert.equal(
      fixture.propertyWrites[0]
        .HIREBEAT_LATEST_CATALOG_REVISION,
      "7",
    );

    assert.equal(result.catalogSyncRunId,41);
    assert.equal(result.catalogSyncTargetRunId,52);
    assert.equal(result.catalogSyncStatus,"succeeded");

    assert.deepEqual(
      fixture.lockEvents,
      [["wait",30000],["release"]],
    );
  },
);

test(
  "Google Form Catalog Sync records retryable provider failure",
  ()=>{
    const fixture=googleCatalogSyncFixture({
      setChoiceValues:()=>{
        throw new Error("Network error");
      },
    });

    const helpers=loadGoogleHelpers(
      fixture.runtime
    );

    assert.throws(
      ()=>helpers.syncCatalogOptions(),
      /Network error/,
    );

    assert.equal(fixture.requests.length,3);

    const failureRequest=fixture.requests[2];

    assert.equal(
      failureRequest.url,
      "https://operations.example.com/v1/catalog-sync-target-runs/52/result",
    );

    assert.equal(
      failureRequest.payload.result_status,
      "failed_retryable",
    );

    assert.equal(
      failureRequest.payload.last_error_code,
      "Network error",
    );

    assert.equal(
      fixture.propertyWrites.length,
      0,
    );

    assert.deepEqual(
      fixture.lockEvents,
      [["wait",30000],["release"]],
    );
  },
);
