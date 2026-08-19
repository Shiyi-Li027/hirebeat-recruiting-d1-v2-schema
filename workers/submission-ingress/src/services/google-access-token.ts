import { IngressError } from "../errors/ingress-error";
import type { FetchFunction } from "./pdf-download";
import { runtimeFetch } from "../../../shared/runtime-fetch";

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAtEpochSeconds: number;
}

export interface GoogleTokenSafeDiagnostic {
  event: "google_token_fetch_failed";
  failureStage: "google_oauth_token_fetch";
  failureClass: "timeout" | "fetch_type_error" | "fetch_exception";
  errorName: string;
  timeoutMs: number;
}

export function safeGoogleTokenDiagnostic(
  error: unknown,
  aborted: boolean,
  timeoutMs: number,
): GoogleTokenSafeDiagnostic {
  const errorName = error instanceof Error
    ? error.name.slice(0, 80)
    : "NonErrorThrown";
  return {
    event: "google_token_fetch_failed",
    failureStage: "google_oauth_token_fetch",
    failureClass: aborted
      ? "timeout"
      : error instanceof TypeError
        ? "fetch_type_error"
        : "fetch_exception",
    errorName,
    timeoutMs,
  };
}

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "google_private_key_missing",
      message: "The Google service-account private key is missing.",
      httpStatus: 500,
    });
  }

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch (error) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "google_private_key_invalid",
      message: "The Google service-account private key is invalid.",
      httpStatus: 500,
      cause: error,
    });
  }
}

function parseServiceAccount(value: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "google_service_account_json_invalid",
      message: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.",
      httpStatus: 500,
      cause: error,
    });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as GoogleServiceAccount).client_email !== "string" ||
    typeof (parsed as GoogleServiceAccount).private_key !== "string"
  ) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "google_service_account_fields_missing",
      message: "The Google service-account secret is missing required fields.",
      httpStatus: 500,
    });
  }

  const serviceAccount = parsed as GoogleServiceAccount;
  if (serviceAccount.token_uri && serviceAccount.token_uri !== GOOGLE_TOKEN_URI) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "google_token_uri_not_allowed",
      message: "The Google service-account token URI is not allowed.",
      httpStatus: 500,
    });
  }
  return serviceAccount;
}

export class GoogleServiceAccountTokenProvider {
  private cachedToken: CachedAccessToken | null = null;

  constructor(
    private readonly serviceAccountJson: string,
    private readonly timeoutMs: number,
    private readonly fetchFunction: FetchFunction = runtimeFetch,
    private readonly reportDiagnostic: (
      diagnostic: GoogleTokenSafeDiagnostic,
    ) => void = (diagnostic) => console.error(JSON.stringify(diagnostic)),
  ) {}

  invalidate(): void {
    this.cachedToken = null;
  }

  async getDriveReadOnlyToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAtEpochSeconds > now + 60) {
      return this.cachedToken.token;
    }

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new IngressError({
        kind: "configuration",
        safeCode: "invalid_google_token_timeout_ms",
        message: "Google token timeout must be a positive safe integer.",
        httpStatus: 500,
      });
    }

    const serviceAccount = parseServiceAccount(this.serviceAccountJson);
    const header = base64UrlEncodeText(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    );
    const claim = base64UrlEncodeText(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: GOOGLE_DRIVE_READONLY_SCOPE,
        aud: GOOGLE_TOKEN_URI,
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsignedJwt = `${header}.${claim}`;

    let privateKey: CryptoKey;
    try {
      privateKey = await crypto.subtle.importKey(
        "pkcs8",
        pemToArrayBuffer(serviceAccount.private_key),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    } catch (error) {
      if (error instanceof IngressError) throw error;
      throw new IngressError({
        kind: "configuration",
        safeCode: "google_private_key_import_failed",
        message: "The Google service-account private key could not be imported.",
        httpStatus: 500,
        cause: error,
      });
    }

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(unsignedJwt),
    );
    const assertion = `${unsignedJwt}.${base64UrlEncodeBytes(
      new Uint8Array(signature),
    )}`;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFunction(GOOGLE_TOKEN_URI, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      this.reportDiagnostic(
        safeGoogleTokenDiagnostic(
          error,
          controller.signal.aborted,
          this.timeoutMs,
        ),
      );
      throw new IngressError({
        kind: "retryable",
        safeCode: controller.signal.aborted
          ? "google_token_timeout"
          : "google_token_network_error",
        message: "A Google access token could not be obtained.",
        httpStatus: 503,
        cause: error,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      throw new IngressError({
        kind: response.status >= 500 || response.status === 429
          ? "retryable"
          : "configuration",
        safeCode: `google_token_http_${response.status}`,
        message: "Google rejected the service-account token request.",
        httpStatus: response.status >= 500 || response.status === 429 ? 503 : 500,
      });
    }

    const tokenResponse = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof tokenResponse.access_token !== "string" ||
      typeof tokenResponse.expires_in !== "number"
    ) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "google_token_response_invalid",
        message: "Google returned an invalid access-token response.",
        httpStatus: 503,
      });
    }

    this.cachedToken = {
      token: tokenResponse.access_token,
      expiresAtEpochSeconds: now + tokenResponse.expires_in,
    };
    return this.cachedToken.token;
  }
}
