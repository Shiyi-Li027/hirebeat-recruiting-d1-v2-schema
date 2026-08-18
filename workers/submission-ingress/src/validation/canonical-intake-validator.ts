import type {
  CanonicalIntakeRequest,
  SubmissionSourceSystem,
  TechnicalRedeliveryMechanism,
} from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";

const SOURCE_SYSTEMS = new Set<SubmissionSourceSystem>([
  "airtable",
  "google_form",
]);

const REDELIVERY_MECHANISMS = new Set<TechnicalRedeliveryMechanism>([
  "initial_delivery",
  "network_retry",
  "webhook_redelivery",
  "queue_retry",
  "poller_replay",
  "worker_restart_recovery",
  "unknown_technical_redelivery",
]);

const UUID_V4_OR_V5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validationError(path: string, detail: string): IngressError {
  return new IngressError({
    kind: "validation",
    safeCode: "invalid_canonical_intake",
    message: `${path}: ${detail}`,
    httpStatus: 422,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError(path, "must be a JSON object");
  }
  return value;
}

function requireString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError(path, "must be a non-empty string");
  }
  if (value.length > maximumLength) {
    throw validationError(path, `must not exceed ${maximumLength} characters`);
  }
  return value;
}

function nullableString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, path, maximumLength);
}

function nullableRawString(
  value: unknown,
  path: string,
  maximumLength: number,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw validationError(path, "must be a string or null");
  }
  if (value.length > maximumLength) {
    throw validationError(path, `must not exceed ${maximumLength} characters`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw validationError(path, "must be a positive safe integer or null");
  }
  return value as number;
}

function nullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return timestamp(value, path);
}

function timestamp(value: unknown, path: string): string {
  const text = requireString(value, path, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) {
    throw validationError(path, "must be a valid ISO-8601 timestamp");
  }
  return text;
}

function validateExactKeys(
  object: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw validationError(path, `contains unknown field ${unknown[0]}`);
  }
}

export function validateCanonicalIntake(
  input: unknown,
  expectedSchemaVersion: string,
): CanonicalIntakeRequest {
  const root = requireObject(input, "$.");
  validateExactKeys(
    root,
    [
      "schemaVersion",
      "source",
      "technicalDelivery",
      "catalog",
      "applicant",
      "resume",
      "sourceFieldSnapshot",
    ],
    "$.",
  );

  const schemaVersion = requireString(root.schemaVersion, "$.schemaVersion", 64);
  if (
    schemaVersion !== "canonical-intake-v1" ||
    schemaVersion !== expectedSchemaVersion
  ) {
    throw validationError(
      "$.schemaVersion",
      `must equal ${expectedSchemaVersion}`,
    );
  }

  const source = requireObject(root.source, "$.source");
  validateExactKeys(
    source,
    [
      "sourceSystem",
      "sourceRecordId",
      "sourceEventKey",
      "submissionUuid",
      "sourceSubmittedAt",
    ],
    "$.source",
  );
  const sourceSystem = requireString(
    source.sourceSystem,
    "$.source.sourceSystem",
    32,
  ) as SubmissionSourceSystem;
  if (!SOURCE_SYSTEMS.has(sourceSystem)) {
    throw validationError(
      "$.source.sourceSystem",
      "must be airtable or google_form",
    );
  }
  const sourceRecordId = requireString(
    source.sourceRecordId,
    "$.source.sourceRecordId",
    255,
  );
  const sourceEventKey = requireString(
    source.sourceEventKey,
    "$.source.sourceEventKey",
    255,
  );
  const submissionUuid = requireString(
    source.submissionUuid,
    "$.source.submissionUuid",
    36,
  );
  if (!UUID_V4_OR_V5_PATTERN.test(submissionUuid)) {
    throw validationError(
      "$.source.submissionUuid",
      "must be an RFC 4122 version 4 or version 5 UUID",
    );
  }

  const technicalDelivery = requireObject(
    root.technicalDelivery,
    "$.technicalDelivery",
  );
  validateExactKeys(
    technicalDelivery,
    ["mechanism", "causeCode", "deliveredAt"],
    "$.technicalDelivery",
  );
  const mechanism = requireString(
    technicalDelivery.mechanism,
    "$.technicalDelivery.mechanism",
    64,
  ) as TechnicalRedeliveryMechanism;
  if (!REDELIVERY_MECHANISMS.has(mechanism)) {
    throw validationError(
      "$.technicalDelivery.mechanism",
      "contains an unsupported mechanism",
    );
  }

  const catalog = requireObject(root.catalog, "$.catalog");
  validateExactKeys(
    catalog,
    [
      "companyId",
      "companyName",
      "companyWorkModeId",
      "companyWorkModeName",
      "positionId",
      "positionName",
    ],
    "$.catalog",
  );

  const applicant = requireObject(root.applicant, "$.applicant");
  validateExactKeys(
    applicant,
    [
      "personName",
      "personEmailAddress",
      "personPhone",
      "startWorkingDate",
      "endWorkingDate",
      "workDuration",
    ],
    "$.applicant",
  );

  const resume = requireObject(root.resume, "$.resume");
  const resumeKind = requireString(resume.kind, "$.resume.kind", 32);
  let validatedResume: CanonicalIntakeRequest["resume"];
  if (resumeKind === "no_resume") {
    validateExactKeys(resume, ["kind"], "$.resume");
    validatedResume = { kind: "no_resume" };
  } else if (resumeKind === "pdf_reference") {
    validateExactKeys(
      resume,
      [
        "kind",
        "source",
        "sourceUrl",
        "sourceFileId",
        "originalFileName",
        "declaredMimeType",
      ],
      "$.resume",
    );
    const resumeSource = requireString(resume.source, "$.resume.source", 32);
    if (
      resumeSource !== "airtable_attachment" &&
      resumeSource !== "google_drive"
    ) {
      throw validationError("$.resume.source", "contains an unsupported source");
    }
    const sourceUrl = nullableString(
      resume.sourceUrl,
      "$.resume.sourceUrl",
      4096,
    );
    const sourceFileId = nullableString(
      resume.sourceFileId,
      "$.resume.sourceFileId",
      512,
    );
    if (resumeSource === "airtable_attachment" && sourceUrl === null) {
      throw validationError(
        "$.resume.sourceUrl",
        "is required for an Airtable attachment",
      );
    }
    if (resumeSource === "google_drive" && sourceFileId === null) {
      throw validationError(
        "$.resume.sourceFileId",
        "is required for a Google Drive file",
      );
    }
    validatedResume = {
      kind: "pdf_reference",
      source: resumeSource,
      sourceUrl,
      sourceFileId,
      originalFileName: nullableRawString(
        resume.originalFileName,
        "$.resume.originalFileName",
        512,
      ),
      declaredMimeType: nullableRawString(
        resume.declaredMimeType,
        "$.resume.declaredMimeType",
        255,
      ),
    };
  } else {
    throw validationError(
      "$.resume.kind",
      "must be no_resume or pdf_reference",
    );
  }

  const sourceFieldSnapshot = requireObject(
    root.sourceFieldSnapshot,
    "$.sourceFieldSnapshot",
  );

  return {
    schemaVersion: "canonical-intake-v1",
    source: {
      sourceSystem,
      sourceRecordId,
      sourceEventKey,
      submissionUuid,
      sourceSubmittedAt: nullableTimestamp(
        source.sourceSubmittedAt,
        "$.source.sourceSubmittedAt",
      ),
    },
    technicalDelivery: {
      mechanism,
      causeCode: nullableString(
        technicalDelivery.causeCode,
        "$.technicalDelivery.causeCode",
        255,
      ),
      deliveredAt: timestamp(
        technicalDelivery.deliveredAt,
        "$.technicalDelivery.deliveredAt",
      ),
    },
    catalog: {
      companyId: nullablePositiveInteger(catalog.companyId, "$.catalog.companyId"),
      companyName: nullableRawString(
        catalog.companyName,
        "$.catalog.companyName",
        512,
      ),
      companyWorkModeId: nullablePositiveInteger(
        catalog.companyWorkModeId,
        "$.catalog.companyWorkModeId",
      ),
      companyWorkModeName: nullableRawString(
        catalog.companyWorkModeName,
        "$.catalog.companyWorkModeName",
        255,
      ),
      positionId: nullablePositiveInteger(
        catalog.positionId,
        "$.catalog.positionId",
      ),
      positionName: nullableRawString(
        catalog.positionName,
        "$.catalog.positionName",
        512,
      ),
    },
    applicant: {
      personName: nullableRawString(
        applicant.personName,
        "$.applicant.personName",
        512,
      ),
      personEmailAddress: nullableRawString(
        applicant.personEmailAddress,
        "$.applicant.personEmailAddress",
        512,
      ),
      personPhone: nullableRawString(
        applicant.personPhone,
        "$.applicant.personPhone",
        128,
      ),
      startWorkingDate: nullableRawString(
        applicant.startWorkingDate,
        "$.applicant.startWorkingDate",
        64,
      ),
      endWorkingDate: nullableRawString(
        applicant.endWorkingDate,
        "$.applicant.endWorkingDate",
        64,
      ),
      workDuration: nullableRawString(
        applicant.workDuration,
        "$.applicant.workDuration",
        255,
      ),
    },
    resume: validatedResume,
    sourceFieldSnapshot,
  };
}
