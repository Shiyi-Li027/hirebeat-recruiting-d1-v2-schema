import type {
  CanonicalIntakeRequest,
  TechnicalRedeliveryMechanism,
} from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";

const encoder = new TextEncoder();

export interface NativeSourceEnvelope {
  sourceRecordId: string;
  sourceEventKey?: string | null;
  submissionUuid?: string | null;
  sourceSubmittedAt?: string | null;
  deliveredAt?: string | null;
  technicalRedeliveryMechanism?: TechnicalRedeliveryMechanism | null;
  technicalRedeliveryCauseCode?: string | null;
  fields: Record<string, unknown>;
}

export interface ExplicitFieldMapping {
  companyId: readonly string[];
  companyName: readonly string[];
  companyWorkModeId: readonly string[];
  companyWorkModeName: readonly string[];
  positionId: readonly string[];
  positionName: readonly string[];
  personName: readonly string[];
  personEmailAddress: readonly string[];
  personPhone: readonly string[];
  startWorkingDate: readonly string[];
  endWorkingDate: readonly string[];
  workDuration: readonly string[];
  resume: readonly string[];
}

function sourceError(code: string, message: string): IngressError {
  return new IngressError({
    kind: "validation",
    safeCode: code,
    message,
    httpStatus: 422,
  });
}

export function requireNativeEnvelope(input: unknown): NativeSourceEnvelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw sourceError("invalid_native_source_envelope", "Source event must be a JSON object.");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.sourceRecordId !== "string" || value.sourceRecordId.trim() === "") {
    throw sourceError("source_record_id_missing", "sourceRecordId is required.");
  }
  if (typeof value.fields !== "object" || value.fields === null || Array.isArray(value.fields)) {
    throw sourceError("source_fields_missing", "fields must be a JSON object.");
  }
  return {
    sourceRecordId: value.sourceRecordId.trim(),
    sourceEventKey: optionalString(value.sourceEventKey),
    submissionUuid: optionalString(value.submissionUuid),
    sourceSubmittedAt: optionalString(value.sourceSubmittedAt),
    deliveredAt: optionalString(value.deliveredAt),
    technicalRedeliveryMechanism:
      (optionalString(value.technicalRedeliveryMechanism) as TechnicalRedeliveryMechanism | null),
    technicalRedeliveryCauseCode: optionalString(value.technicalRedeliveryCauseCode),
    fields: value.fields as Record<string, unknown>,
  };
}

export function optionalString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return String(value);
  return value.trim() === "" ? null : value.trim();
}

export function mappedValue(
  fields: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(fields, alias)) return fields[alias];
  }
  return null;
}

export function mappedText(
  fields: Record<string, unknown>,
  aliases: readonly string[],
): string | null {
  const value = mappedValue(fields, aliases);
  if (Array.isArray(value)) {
    return value.length === 0 ? null : optionalString(value[0]);
  }
  return optionalString(value);
}

export function mappedPositiveInteger(
  fields: Record<string, unknown>,
  aliases: readonly string[],
): number | null {
  const raw = mappedValue(fields, aliases);
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw sourceError("invalid_mapped_catalog_id", `${aliases[0]} must be a positive integer.`);
  }
  return value;
}

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw sourceError("invalid_uuid_namespace", "UUID namespace is invalid.");
  }
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function uuidV5(namespace: string, name: string): Promise<string> {
  const namespaceBytes = parseUuidBytes(namespace);
  const nameBytes = encoder.encode(name);
  const combined = new Uint8Array(namespaceBytes.length + nameBytes.length);
  combined.set(namespaceBytes);
  combined.set(nameBytes, namespaceBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", combined));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export async function resolveSubmissionUuid(options: {
  supplied: string | null;
  namespace: string;
  sourceSystem: string;
  sourceRecordId: string;
}): Promise<string> {
  if (options.supplied) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.supplied)) {
      throw sourceError("invalid_source_submission_uuid", "submissionUuid must be UUIDv4 or UUIDv5.");
    }
    return options.supplied.toLowerCase();
  }
  return uuidV5(
    options.namespace,
    `${options.sourceSystem}:${options.sourceRecordId}`,
  );
}

export function baseCanonicalRequest(options: {
  sourceSystem: "airtable" | "google_form";
  sourceSchemaVersion: "canonical-intake-v1";
  envelope: NativeSourceEnvelope;
  submissionUuid: string;
  sourceEventKey: string;
  mapping: ExplicitFieldMapping;
  resume: CanonicalIntakeRequest["resume"];
}): CanonicalIntakeRequest {
  const fields = options.envelope.fields;
  return {
    schemaVersion: options.sourceSchemaVersion,
    source: {
      sourceSystem: options.sourceSystem,
      sourceRecordId: options.envelope.sourceRecordId,
      sourceEventKey: options.sourceEventKey,
      submissionUuid: options.submissionUuid,
      sourceSubmittedAt: options.envelope.sourceSubmittedAt,
    },
    technicalDelivery: {
      mechanism: options.envelope.technicalRedeliveryMechanism ?? "initial_delivery",
      causeCode: options.envelope.technicalRedeliveryCauseCode,
      deliveredAt: options.envelope.deliveredAt ?? new Date().toISOString(),
    },
    catalog: {
      companyId: mappedPositiveInteger(fields, options.mapping.companyId),
      companyName: mappedText(fields, options.mapping.companyName),
      companyWorkModeId: mappedPositiveInteger(fields, options.mapping.companyWorkModeId),
      companyWorkModeName: mappedText(fields, options.mapping.companyWorkModeName),
      positionId: mappedPositiveInteger(fields, options.mapping.positionId),
      positionName: mappedText(fields, options.mapping.positionName),
    },
    applicant: {
      personName: mappedText(fields, options.mapping.personName),
      personEmailAddress: mappedText(fields, options.mapping.personEmailAddress),
      personPhone: mappedText(fields, options.mapping.personPhone),
      startWorkingDate: mappedText(fields, options.mapping.startWorkingDate),
      endWorkingDate: mappedText(fields, options.mapping.endWorkingDate),
      workDuration: mappedText(fields, options.mapping.workDuration),
    },
    resume: options.resume,
    sourceFieldSnapshot: fields,
  };
}
