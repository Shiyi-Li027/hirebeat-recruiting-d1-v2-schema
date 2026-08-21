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

function hireBeatOperationsPost_(path, payload) {
  const properties = HIREBEAT_GOOGLE_FORM.properties;
  const response = UrlFetchApp.fetch(
    `${hireBeatHttpsBaseUrl_(properties.operationsBaseUrl)}${path}`,
    {
      method: "post",
      contentType: "application/json",
      headers: {
        "CF-Access-Client-Id": hireBeatRequiredProperty_(
          properties.accessClientId
        ),
        "CF-Access-Client-Secret": hireBeatRequiredProperty_(
          properties.accessClientSecret
        ),
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    },
  );

  return hireBeatParseJsonResponse_(response, "operations_post");
}

function hireBeatCatalogSyncStartCommand_(
  catalog,
  formId,
  invocationId
) {
  const catalogRevisionId = Number(catalog?.revision?.id);

  if (
    !Number.isInteger(catalogRevisionId) ||
    catalogRevisionId < 1
  ) {
    throw new Error("catalog_revision_id_missing");
  }

  const targetKey = String(formId || "").trim();
  if (!targetKey) {
    throw new Error("google_form_id_missing");
  }

  const invocationKey = String(invocationId || "").trim();
  if (!invocationKey) {
    throw new Error("catalog_sync_invocation_id_missing");
  }

  const idempotencyKey =
    `google-form-catalog-sync:${targetKey}:` +
    `${catalogRevisionId}:${invocationKey}`;

  if (idempotencyKey.length > 200) {
    throw new Error("catalog_sync_idempotency_key_too_long");
  }

  return {
    idempotency_key: idempotencyKey,
    catalog_revision_id: catalogRevisionId,
    target_type: "google_form",
    target_key: targetKey,
  };
}

function hireBeatCatalogSyncFailureStatus_(error) {
  const message = String(
    error && error.message ? error.message : error || ""
  );

  if (
    /_http_(408|425|429|5\d\d)(?:\D|$)/i.test(message) ||
    /(timed?\s*out|temporar(?:y|ily)|service\s+unavailable|network\s+error)/i.test(
      message
    )
  ) {
    return "failed_retryable";
  }

  return "failed_terminal";
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

function hireBeatCatalogSyncResultCommand_(
  targetRunId,
  invocationId,
  resultStatus,
  externalRevisionKey,
  error
) {
  const parsedTargetRunId = Number(targetRunId);
  if (
    !Number.isInteger(parsedTargetRunId) ||
    parsedTargetRunId < 1
  ) {
    throw new Error("catalog_sync_target_run_id_missing");
  }

  const invocationKey = String(invocationId || "").trim();
  if (!invocationKey) {
    throw new Error("catalog_sync_invocation_id_missing");
  }

  if (
    resultStatus !== "succeeded" &&
    resultStatus !== "failed_retryable" &&
    resultStatus !== "failed_terminal"
  ) {
    throw new Error("catalog_sync_result_status_invalid");
  }

  const idempotencyKey =
    `google-form-catalog-sync-result:` +
    `${parsedTargetRunId}:${invocationKey}`;

  if (idempotencyKey.length > 200) {
    throw new Error(
      "catalog_sync_result_idempotency_key_too_long"
    );
  }

  if (resultStatus === "succeeded") {
    return {
      idempotency_key: idempotencyKey,
      result_status: "succeeded",
      external_revision_key:
        externalRevisionKey === null ||
        externalRevisionKey === undefined
          ? null
          : String(externalRevisionKey).slice(0, 500),
      last_error_code: null,
      last_error_detail: null,
    };
  }

  const message = String(
    error && error.message ? error.message : error || ""
  ).trim();

  const errorCode =
    String(message.split(":", 1)[0] || "")
      .trim()
      .slice(0, 200) ||
    "provider_catalog_sync_failed";

  return {
    idempotency_key: idempotencyKey,
    result_status: resultStatus,
    external_revision_key: null,
    last_error_code: errorCode,
    last_error_detail:
      message.slice(0, 2000) ||
      "Provider Catalog synchronization failed.",
  };
}

/** Explicitly run this when opening/re-enabling the Google Form channel. */
function syncHireBeatCatalogOptions() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const catalog = hireBeatOperationsGet_(
      "/v1/catalog/options"
    );

    const form = FormApp.getActiveForm();
    if (!form) {
      throw new Error(
        "script_must_be_bound_to_google_form"
      );
    }

    const invocationId = Utilities.getUuid();
    const startCommand =
      hireBeatCatalogSyncStartCommand_(
        catalog,
        form.getId(),
        invocationId
      );

    const startResult = hireBeatOperationsPost_(
      "/v1/catalog-sync-runs",
      startCommand
    );

    const targetRunId = Number(
      startResult.catalog_sync_target_run_id
    );

    if (
      !Number.isInteger(targetRunId) ||
      targetRunId < 1
    ) {
      throw new Error(
        "catalog_sync_target_run_id_missing"
      );
    }

    try {
      const options =
        hireBeatCatalogOptionRows_(catalog);

      hireBeatPositionItem_(form).setChoiceValues(
        options.map((option) => option.label)
      );

      const properties =
        HIREBEAT_GOOGLE_FORM.properties;

      const syncedAt = new Date().toISOString();

      PropertiesService
        .getScriptProperties()
        .setProperties({
          [properties.latestRevision]:
            String(
              catalog.revision.revision_number
            ),
          [properties.latestSnapshotSha256]:
            String(
              catalog.revision.snapshot_sha256
            ),
          [properties.latestSyncedAt]:
            syncedAt,
        });

      const externalRevisionKey =
        `${catalog.revision.revision_number}:` +
        `${catalog.revision.snapshot_sha256}`;

      const resultCommand =
        hireBeatCatalogSyncResultCommand_(
          targetRunId,
          invocationId,
          "succeeded",
          externalRevisionKey,
          null
        );

      const result = hireBeatOperationsPost_(
        `/v1/catalog-sync-target-runs/` +
          `${targetRunId}/result`,
        resultCommand
      );

      return {
        formId: form.getId(),
        catalogRevision:
          catalog.revision.revision_number,
        optionCount: options.length,
        catalogSyncRunId:
          startResult.catalog_sync_run_id,
        catalogSyncTargetRunId:
          targetRunId,
        catalogSyncStatus:
          result.sync_status,
      };
    } catch (error) {
      const resultStatus =
        hireBeatCatalogSyncFailureStatus_(error);

      const failureCommand =
        hireBeatCatalogSyncResultCommand_(
          targetRunId,
          invocationId,
          resultStatus,
          null,
          error
        );

      try {
        hireBeatOperationsPost_(
          `/v1/catalog-sync-target-runs/` +
            `${targetRunId}/result`,
          failureCommand
        );
      } catch (reportingError) {
        const originalMessage = String(
          error && error.message
            ? error.message
            : error
        );

        const reportingMessage = String(
          reportingError &&
          reportingError.message
            ? reportingError.message
            : reportingError
        );

        throw new Error(
          `catalog_sync_result_reporting_failed:` +
          `${reportingMessage}:` +
          `original_catalog_sync_error:` +
          `${originalMessage}`
        );
      }

      throw error;
    }
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

function hireBeatSubmissionFields_(answers, selected, respondentEmail) {
  const resume = hireBeatScalar_(
    answers["🎯 Resume"]
      ?? answers["Resume"]
      ?? answers["Resume File ID"]
      ?? answers["Google Drive File ID"],
  );
  const candidateEmail = hireBeatScalar_(
    answers["🎯 Contact_Email"]
      ?? answers["Contact_Email"]
      ?? answers["Email Address"]
      ?? answers["Email"],
  ) || hireBeatScalar_(respondentEmail);
  return {
    "Company ID": selected.companyId,
    "Company Name": selected.companyName,
    "Company Work Mode ID": selected.companyWorkModeId,
    "Company Work Mode": selected.companyWorkModeName,
    "Position ID": selected.positionId,
    "Position Name": selected.positionName,
    "Candidate Name": hireBeatScalar_(
      answers["🧑‍🎓 Student"]
        ?? answers["Student"]
        ?? answers["Candidate Name"]
        ?? answers["Name"]
        ?? answers["Full Name"],
    ),
    "Email Address": candidateEmail,
    "Phone Number": hireBeatScalar_(answers["Phone Number"] ?? answers["Phone"]),
    "Start Working Date": hireBeatScalar_(
      answers["Start_Date"] ?? answers["Start Working Date"] ?? answers["Start Date"],
    ),
    "End Working Date": hireBeatScalar_(
      answers["End_Date"] ?? answers["End Working Date"] ?? answers["End Date"],
    ),
    "Work Duration": hireBeatScalar_(answers["Duration"] ?? answers["Work Duration"]),
    "Resume File ID": resume,
    "Catalog Revision": selected.revisionNumber,
  };
}

/** Install this function as the Form-specific installable submit trigger. */
function onHireBeatFormSubmit(event) {
  if (!event || !event.response || !event.source) throw new Error("google_form_submit_event_required");
  const responseId = event.response.getId();
  if (!responseId) throw new Error("google_form_response_id_missing");
  const answers = hireBeatAnswerMap_(event.response);
  const selected = hireBeatResolveSubmittedOption_(answers[HIREBEAT_GOOGLE_FORM.positionItemTitle]);
  const fields = hireBeatSubmissionFields_(
    answers,
    selected,
    event.response.getRespondentEmail(),
  );
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
