import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";

export interface PayloadHmacResult {
  keyVersion: "v1";
  hmacHex: string;
}

export interface PayloadHmacService {
  calculate(request: CanonicalIntakeRequest): Promise<PayloadHmacResult>;
}

const encoder = new TextEncoder();

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function acceptedPayloadProjection(request: CanonicalIntakeRequest): unknown {
  return {
    schemaVersion: request.schemaVersion,
    source: {
      sourceSystem: request.source.sourceSystem,
      sourceRecordId: request.source.sourceRecordId,
      submissionUuid: request.source.submissionUuid,
      sourceSubmittedAt: request.source.sourceSubmittedAt,
    },
    catalog: request.catalog,
    applicant: request.applicant,
    resume:
      request.resume.kind === "no_resume"
        ? { kind: "no_resume" }
        : {
            kind: request.resume.kind,
            source: request.resume.source,
            sourceFileId: request.resume.sourceFileId,
            originalFileName: request.resume.originalFileName,
            declaredMimeType: request.resume.declaredMimeType,
          },
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class WebCryptoPayloadHmacService implements PayloadHmacService {
  constructor(private readonly secret: string) {}

  async calculate(
    request: CanonicalIntakeRequest,
  ): Promise<PayloadHmacResult> {
    if (!this.secret || this.secret.length < 32) {
      throw new IngressError({
        kind: "configuration",
        safeCode: "payload_hmac_secret_not_configured",
        message: "The payload HMAC secret is not configured safely.",
        httpStatus: 503,
      });
    }

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(stableJson(acceptedPayloadProjection(request))),
    );

    return {
      keyVersion: "v1",
      hmacHex: bytesToHex(new Uint8Array(signature)),
    };
  }
}
