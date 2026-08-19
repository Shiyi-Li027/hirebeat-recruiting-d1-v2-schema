/**
 * HireBeat Google Form bridge.
 *
 * Copy this file into a script bound to the application Google Form. Configure
 * the required Script Properties in the Apps Script project settings; never
 * paste credentials into this source file.
 */

const HIREBEAT_GOOGLE_FORM = Object.freeze({
  positionItemTitle: "Position",
  optionMarker: /\s\[HB:r(\d+):p(\d+):w(\d+)\]$/,
  properties: Object.freeze({
    ingressBaseUrl: "HIREBEAT_INGRESS_BASE_URL",
    ingressToken: "HIREBEAT_INGRESS_INTERNAL_AUTH_TOKEN",
    operationsBaseUrl: "HIREBEAT_OPERATIONS_BASE_URL",
    accessClientId: "HIREBEAT_CF_ACCESS_CLIENT_ID",
    accessClientSecret: "HIREBEAT_CF_ACCESS_CLIENT_SECRET",
    latestRevision: "HIREBEAT_LATEST_CATALOG_REVISION",
    latestSnapshotSha256: "HIREBEAT_LATEST_CATALOG_SNAPSHOT_SHA256",
    latestSyncedAt: "HIREBEAT_LATEST_CATALOG_SYNCED_AT",
  }),
});

function hireBeatRequiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value || !String(value).trim()) throw new Error(`missing_script_property:${name}`);
  return String(value).trim();
}

function hireBeatHttpsBaseUrl_(name) {
  const value = hireBeatRequiredProperty_(name).replace(/\/$/, "");
  if (!/^https:\/\/[^/]+/i.test(value)) throw new Error(`invalid_https_base_url:${name}`);
  return value;
}

function hireBeatParseJsonResponse_(response, operation) {
  const status = response.getResponseCode();
  const text = response.getContentText("UTF-8");
  if (status < 200 || status >= 300) {
    throw new Error(`${operation}_http_${status}:${text.slice(0, 500)}`);
  }
  try { return JSON.parse(text); } catch (error) {
    throw new Error(`${operation}_invalid_json`);
  }
}

function hireBeatOperationsGet_(path) {
  const properties = HIREBEAT_GOOGLE_FORM.properties;
  const response = UrlFetchApp.fetch(
    `${hireBeatHttpsBaseUrl_(properties.operationsBaseUrl)}${path}`,
    {
      method: "get",
      headers: {
        "CF-Access-Client-Id": hireBeatRequiredProperty_(properties.accessClientId),
        "CF-Access-Client-Secret": hireBeatRequiredProperty_(properties.accessClientSecret),
      },
      muteHttpExceptions: true,
    },
  );
  return hireBeatParseJsonResponse_(response, "operations_get");
}

function hireBeatCatalogOptionRows_(catalog) {
  const revisionNumber = Number(catalog?.revision?.revision_number);
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    throw new Error("catalog_revision_missing");
  }
  const companies = new Map((catalog.companies || []).map((row) => [Number(row.id), row]));
  const workModesByCompany = new Map();
  for (const row of catalog.company_work_modes || []) {
    const companyId = Number(row.company_id);
    const rows = workModesByCompany.get(companyId) || [];
    rows.push(row);
    workModesByCompany.set(companyId, rows);
  }
  const options = [];
  for (const position of catalog.positions || []) {
    const companyId = Number(position.company_id);
    const positionId = Number(position.id);
    const company = companies.get(companyId);
    if (!company || !Number.isInteger(positionId)) continue;
    for (const workMode of workModesByCompany.get(companyId) || []) {
      const companyWorkModeId = Number(workMode.company_work_mode_id);
      if (!Number.isInteger(companyWorkModeId)) continue;
      options.push({
        revisionNumber,
        companyId,
        companyName: String(company.company_name),
        companyWorkModeId,
        companyWorkModeName: String(workMode.work_mode_name),
        positionId,
        positionName: String(position.position_name),
        label: `${company.company_name} — ${position.position_name} — ${workMode.work_mode_name} [HB:r${revisionNumber}:p${positionId}:w${companyWorkModeId}]`,
      });
    }
  }
  options.sort((left, right) => left.label.localeCompare(right.label));
  if (options.length === 0) throw new Error("catalog_has_no_selectable_options");
  return options;
}

function hireBeatPositionItem_(form) {
  const matches = form.getItems().filter(
    (item) => item.getTitle().trim() === HIREBEAT_GOOGLE_FORM.positionItemTitle,
  );
  if (matches.length !== 1) throw new Error("position_item_must_exist_exactly_once");
  const item = matches[0];
  const type = item.getType().toString();
  if (type === "LIST") return item.asListItem();
  if (type === "MULTIPLE_CHOICE") return item.asMultipleChoiceItem();
  throw new Error("position_item_must_be_list_or_multiple_choice");
}

/** Explicitly run this when opening/re-enabling the Google Form channel. */
function syncHireBeatCatalogOptions() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const catalog = hireBeatOperationsGet_("/v1/catalog/options");
    const options = hireBeatCatalogOptionRows_(catalog);
    const form = FormApp.getActiveForm();
    if (!form) throw new Error("script_must_be_bound_to_google_form");
    hireBeatPositionItem_(form).setChoiceValues(options.map((option) => option.label));
    const properties = HIREBEAT_GOOGLE_FORM.properties;
    PropertiesService.getScriptProperties().setProperties({
      [properties.latestRevision]: String(catalog.revision.revision_number),
      [properties.latestSnapshotSha256]: String(catalog.revision.snapshot_sha256),
      [properties.latestSyncedAt]: new Date().toISOString(),
    });
    return {
      formId: form.getId(),
      catalogRevision: catalog.revision.revision_number,
      optionCount: options.length,
    };
  } finally {
    lock.releaseLock();
  }
}

function hireBeatAnswerMap_(formResponse) {
  const answers = {};
  for (const itemResponse of formResponse.getItemResponses()) {
    answers[itemResponse.getItem().getTitle().trim()] = itemResponse.getResponse();
  }
  return answers;
}

function hireBeatScalar_(value) {
  if (Array.isArray(value)) return value.length ? hireBeatScalar_(value[0]) : null;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function hireBeatResolveSubmittedOption_(label) {
  const match = String(label || "").match(HIREBEAT_GOOGLE_FORM.optionMarker);
  if (!match) throw new Error("submitted_position_option_marker_missing");
  const revisionNumber = Number(match[1]);
  const positionId = Number(match[2]);
  const companyWorkModeId = Number(match[3]);
  const catalog = hireBeatOperationsGet_(`/v1/catalog/revisions/${revisionNumber}/options`);
  const position = (catalog.positions || []).find((row) => Number(row.id) === positionId);
  const workMode = (catalog.company_work_modes || []).find(
    (row) => Number(row.company_work_mode_id) === companyWorkModeId,
  );
  const company = position && (catalog.companies || []).find(
    (row) => Number(row.id) === Number(position.company_id),
  );
  if (!position || !workMode || !company) throw new Error("submitted_catalog_option_not_found");
  if (Number(workMode.company_id) !== Number(position.company_id)) {
    throw new Error("submitted_catalog_option_company_mismatch");
  }
  return {
    revisionNumber,
    companyId: Number(company.id),
    companyName: String(company.company_name),
    companyWorkModeId: Number(workMode.company_work_mode_id),
    companyWorkModeName: String(workMode.work_mode_name),
    positionId: Number(position.id),
    positionName: String(position.position_name),
  };
}

/** Install this function as the Form-specific installable submit trigger. */
function onHireBeatFormSubmit(event) {
  if (!event || !event.response || !event.source) throw new Error("google_form_submit_event_required");
  const responseId = event.response.getId();
  if (!responseId) throw new Error("google_form_response_id_missing");
  const answers = hireBeatAnswerMap_(event.response);
  const selected = hireBeatResolveSubmittedOption_(answers[HIREBEAT_GOOGLE_FORM.positionItemTitle]);
  const resume = hireBeatScalar_(answers["Resume"] ?? answers["Resume File ID"] ?? answers["Google Drive File ID"]);
  const candidateEmail = hireBeatScalar_(answers["Email Address"] ?? answers["Email"])
    || hireBeatScalar_(event.response.getRespondentEmail());
  const fields = {
    "Company ID": selected.companyId,
    "Company Name": selected.companyName,
    "Company Work Mode ID": selected.companyWorkModeId,
    "Company Work Mode": selected.companyWorkModeName,
    "Position ID": selected.positionId,
    "Position Name": selected.positionName,
    "Candidate Name": hireBeatScalar_(answers["Candidate Name"] ?? answers["Name"] ?? answers["Full Name"]),
    "Email Address": candidateEmail,
    "Phone Number": hireBeatScalar_(answers["Phone Number"] ?? answers["Phone"]),
    "Start Working Date": hireBeatScalar_(answers["Start Working Date"] ?? answers["Start Date"]),
    "End Working Date": hireBeatScalar_(answers["End Working Date"] ?? answers["End Date"]),
    "Work Duration": hireBeatScalar_(answers["Work Duration"] ?? answers["Duration"]),
    "Resume File ID": resume,
    "Catalog Revision": selected.revisionNumber,
  };
  const formId = event.source.getId();
  const sourceRecordId = `form:${formId}:response:${responseId}`;
  const properties = HIREBEAT_GOOGLE_FORM.properties;
  const response = UrlFetchApp.fetch(
    `${hireBeatHttpsBaseUrl_(properties.ingressBaseUrl)}/internal/v1/sources/google-form`,
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${hireBeatRequiredProperty_(properties.ingressToken)}` },
      payload: JSON.stringify({
        sourceRecordId,
        sourceEventKey: `google-form-submit:${formId}:${responseId}`,
        sourceSubmittedAt: event.response.getTimestamp().toISOString(),
        deliveredAt: new Date().toISOString(),
        technicalRedeliveryMechanism: "initial_delivery",
        fields,
      }),
      muteHttpExceptions: true,
    },
  );
  return hireBeatParseJsonResponse_(response, "ingress_post");
}

/** Run once after copying the script to create the correct installable trigger. */
function installHireBeatFormSubmitTrigger() {
  const form = FormApp.getActiveForm();
  if (!form) throw new Error("script_must_be_bound_to_google_form");
  const existing = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === "onHireBeatFormSubmit",
  );
  if (existing.length > 1) throw new Error("duplicate_hirebeat_submit_triggers");
  if (existing.length === 0) {
    ScriptApp.newTrigger("onHireBeatFormSubmit").forForm(form).onFormSubmit().create();
  }
  return { formId: form.getId(), triggerCreated: existing.length === 0 };
}
