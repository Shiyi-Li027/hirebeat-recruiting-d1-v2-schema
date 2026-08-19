import {
  runtimeFetch,
  type RuntimeFetch,
} from "./runtime-fetch";

export type GoogleTokenFetch = RuntimeFetch;

interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

interface CachedIdToken {
  token: string;
  expiresAtEpochSeconds: number;
}

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("google_id_token_invalid_jwt");
  const padded = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    return JSON.parse(atob(`${padded}${padding}`)) as Record<string, unknown>;
  } catch {
    throw new Error("google_id_token_invalid_payload");
  }
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error("google_cloud_run_private_key_missing");
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
  } catch {
    throw new Error("google_cloud_run_private_key_invalid");
  }
}

function parseServiceAccount(value: string): GoogleServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("google_cloud_run_service_account_json_invalid");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as GoogleServiceAccount).client_email !== "string" ||
    typeof (parsed as GoogleServiceAccount).private_key !== "string"
  ) {
    throw new Error("google_cloud_run_service_account_fields_missing");
  }
  const serviceAccount = parsed as GoogleServiceAccount;
  if (serviceAccount.token_uri && serviceAccount.token_uri !== GOOGLE_TOKEN_URI) {
    throw new Error("google_cloud_run_token_uri_not_allowed");
  }
  return serviceAccount;
}

function normalizeAudience(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("google_cloud_run_audience_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("google_cloud_run_audience_invalid");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("google_cloud_run_audience_must_be_service_url");
  }
  return url.origin;
}

export interface CloudRunIdTokenProvider {
  getIdToken(audience: string): Promise<string>;
}

export class GoogleServiceAccountCloudRunIdTokenProvider
  implements CloudRunIdTokenProvider
{
  private readonly cachedTokens = new Map<string, CachedIdToken>();

  constructor(
    private readonly serviceAccountJson: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchFunction: GoogleTokenFetch = runtimeFetch,
  ) {}

  invalidate(audience?: string): void {
    if (audience) this.cachedTokens.delete(normalizeAudience(audience));
    else this.cachedTokens.clear();
  }

  async getIdToken(audienceValue: string): Promise<string> {
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("google_cloud_run_token_timeout_invalid");
    }
    const audience = normalizeAudience(audienceValue);
    const now = Math.floor(Date.now() / 1000);
    const cached = this.cachedTokens.get(audience);
    if (cached && cached.expiresAtEpochSeconds > now + 60) return cached.token;

    const serviceAccount = parseServiceAccount(this.serviceAccountJson);
    const header = base64UrlEncodeText(
      JSON.stringify({
        alg: "RS256",
        typ: "JWT",
        ...(serviceAccount.private_key_id
          ? { kid: serviceAccount.private_key_id }
          : {}),
      }),
    );
    const claim = base64UrlEncodeText(
      JSON.stringify({
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: GOOGLE_TOKEN_URI,
        target_audience: audience,
        iat: now,
        exp: now + 3600,
      }),
    );
    const unsignedJwt = `${header}.${claim}`;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(serviceAccount.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(unsignedJwt),
    );
    const assertion = `${unsignedJwt}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
      throw new Error(
        controller.signal.aborted
          ? "google_cloud_run_token_timeout"
          : "google_cloud_run_token_network_error",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`google_cloud_run_token_http_${response.status}`);

    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string") {
      throw new Error("google_cloud_run_token_response_invalid");
    }
    const payload = decodeJwtPayload(body.id_token);
    if (payload.aud !== audience || typeof payload.exp !== "number" || payload.exp <= now) {
      throw new Error("google_cloud_run_token_claims_invalid");
    }
    this.cachedTokens.set(audience, {
      token: body.id_token,
      expiresAtEpochSeconds: payload.exp,
    });
    return body.id_token;
  }
}
