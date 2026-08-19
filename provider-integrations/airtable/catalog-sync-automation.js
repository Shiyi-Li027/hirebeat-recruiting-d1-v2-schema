/**
 * Airtable Automation "Run a script" action that mirrors the latest published
 * D1 Catalog into an Airtable Positions table. Old rows are deactivated, never
 * deleted, so an already-open/stale submission keeps its original linkage.
 *
 * Input variables: positionsTableId, operationsBaseUrl.
 * Secrets: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
 */

const config = input.config();
const accessClientId = input.secret.CF_ACCESS_CLIENT_ID;
const accessClientSecret = input.secret.CF_ACCESS_CLIENT_SECRET;

function requiredText(value, code) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text) throw new Error(code);
  return text;
}

async function mutateInBatches(rows, operation) {
  for (let index = 0; index < rows.length; index += 50) {
    await operation(rows.slice(index, index + 50));
  }
}

const operationsBaseUrl = requiredText(config.operationsBaseUrl, "operations_base_url_required").replace(/\/$/, "");
if (!/^https:\/\/[^/]+/i.test(operationsBaseUrl)) throw new Error("operations_base_url_invalid");
if (!accessClientId || !accessClientSecret) throw new Error("cloudflare_access_secrets_missing");

const response = await fetch(`${operationsBaseUrl}/v1/catalog/options`, {
  headers: {
    "CF-Access-Client-Id": accessClientId,
    "CF-Access-Client-Secret": accessClientSecret,
  },
});
const responseText = await response.text();
if (!response.ok) throw new Error(`catalog_http_${response.status}:${responseText.slice(0, 500)}`);
const catalog = JSON.parse(responseText);
const revisionNumber = Number(catalog?.revision?.revision_number);
if (!Number.isInteger(revisionNumber) || revisionNumber < 1) throw new Error("catalog_revision_missing");

const companies = new Map((catalog.companies || []).map((row) => [Number(row.id), row]));
const workModesByCompany = new Map();
for (const row of catalog.company_work_modes || []) {
  const companyId = Number(row.company_id);
  const rows = workModesByCompany.get(companyId) || [];
  rows.push(row);
  workModesByCompany.set(companyId, rows);
}
const desired = new Map();
for (const position of catalog.positions || []) {
  const companyId = Number(position.company_id);
  const company = companies.get(companyId);
  if (!company) continue;
  for (const workMode of workModesByCompany.get(companyId) || []) {
    const key = `position:${position.id}:work_mode:${workMode.company_work_mode_id}`;
    desired.set(key, {
      "HireBeat Option Key": key,
      "Display Label": `${company.company_name} — ${position.position_name} — ${workMode.work_mode_name}`,
      "Company ID": Number(company.id),
      "Company Name": String(company.company_name),
      "Company Work Mode ID": Number(workMode.company_work_mode_id),
      "Company Work Mode": String(workMode.work_mode_name),
      "Position ID": Number(position.id),
      "Position Name": String(position.position_name),
      "Catalog Revision": revisionNumber,
      "Is Active": true,
    });
  }
}
if (desired.size === 0) throw new Error("catalog_has_no_selectable_options");

const table = base.getTable(requiredText(config.positionsTableId, "positions_table_id_required"));
const query = await table.selectRecordsAsync({ fields: ["HireBeat Option Key", "Is Active"] });
const existingByKey = new Map();
for (const record of query.records) {
  const key = String(record.getCellValueAsString("HireBeat Option Key") || "").trim();
  if (!key) continue;
  if (existingByKey.has(key)) throw new Error(`duplicate_airtable_option_key:${key}`);
  existingByKey.set(key, record);
}

const creates = [];
const updates = [];
for (const [key, fields] of desired) {
  const existing = existingByKey.get(key);
  if (existing) updates.push({ id: existing.id, fields });
  else creates.push({ fields });
}
for (const [key, record] of existingByKey) {
  if (!desired.has(key) && record.getCellValue("Is Active")) {
    updates.push({ id: record.id, fields: { "Is Active": false } });
  }
}
await mutateInBatches(creates, (batch) => table.createRecordsAsync(batch));
await mutateInBatches(updates, (batch) => table.updateRecordsAsync(batch));

output.set("catalogRevision", revisionNumber);
output.set("catalogSnapshotSha256", String(catalog.revision.snapshot_sha256));
output.set("activeOptionCount", desired.size);
output.set("createdRecordCount", creates.length);
output.set("updatedRecordCount", updates.length);
