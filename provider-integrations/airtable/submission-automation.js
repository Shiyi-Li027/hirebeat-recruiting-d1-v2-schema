/**
 * Airtable Automation "Run a script" action for HireBeat submission intake.
 *
 * Input variables: recordId, tableId, ingressBaseUrl.
 * Secret: INGRESS_INTERNAL_AUTH_TOKEN.
 */

const config = input.config();
const ingressToken = input.secret.INGRESS_INTERNAL_AUTH_TOKEN;

function requiredText(value, code) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text) throw new Error(code);
  return text;
}

function scalar(value) {
  if (Array.isArray(value)) return value.length ? scalar(value[0]) : null;
  if (value && typeof value === "object") {
    if ("name" in value) return scalar(value.name);
    if ("value" in value) return scalar(value.value);
  }
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

const table = base.getTable(requiredText(config.tableId, "table_id_required"));
const recordId = requiredText(config.recordId, "record_id_required");
const record = await table.selectRecordAsync(recordId);
if (!record) throw new Error("trigger_record_not_found");

const field = (name) => record.getCellValue(name);
const fields = {
  "Company ID": scalar(field("Company ID")),
  "Company Name": scalar(field("Company Name")),
  "Company Work Mode ID": scalar(field("Company Work Mode ID")),
  "Company Work Mode": scalar(field("Company Work Mode")),
  "Position ID": scalar(field("Position ID")),
  "Position Name": scalar(field("Position Name")),
  "Candidate Name": scalar(field("Candidate Name")),
  "Email Address": scalar(field("Email Address")),
  "Phone Number": scalar(field("Phone Number")),
  "Start Working Date": scalar(field("Start Working Date")),
  "End Working Date": scalar(field("End Working Date")),
  "Work Duration": scalar(field("Work Duration")),
  "Resume": field("Resume"),
};

const baseId = requiredText(config.baseId, "base_id_required");
const ingressBaseUrl = requiredText(config.ingressBaseUrl, "ingress_base_url_required").replace(/\/$/, "");
if (!/^https:\/\/[^/]+/i.test(ingressBaseUrl)) throw new Error("ingress_base_url_invalid");
if (!ingressToken || String(ingressToken).length < 32) throw new Error("ingress_secret_missing");

const sourceRecordId = `base:${baseId}:table:${table.id}:record:${record.id}`;
const response = await fetch(`${ingressBaseUrl}/internal/v1/sources/airtable`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${ingressToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    sourceRecordId,
    sourceEventKey: `airtable-record:${baseId}:${table.id}:${record.id}`,
    sourceSubmittedAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
    technicalRedeliveryMechanism: "initial_delivery",
    fields,
  }),
});
const responseText = await response.text();
if (!response.ok) throw new Error(`hirebeat_ingress_http_${response.status}:${responseText.slice(0, 500)}`);
const result = JSON.parse(responseText);
output.set("hirebeatSubmissionUuid", result.submissionUuid);
output.set("hirebeatRequestId", result.requestId);
output.set("hirebeatStatus", result.status);
