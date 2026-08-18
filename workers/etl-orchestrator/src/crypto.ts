const encoder = new TextEncoder();

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function keyedHmac(value: string, secret: string): Promise<string> {
  if (secret.length < 32) throw new Error("identity_hmac_key_not_configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function normalizeWhitespace(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized === "" ? null : normalized;
}

export function normalizeEmail(value: string | null): string | null {
  const normalized = normalizeWhitespace(value)?.toLowerCase() ?? null;
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

export function normalizePhone(value: string | null): string | null {
  if (value === null) return null;
  const plus = value.trim().startsWith("+") ? "+" : "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? `${plus}${digits}` : null;
}

export function normalizedUrl(value: string): string | null {
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(candidate);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function splitName(value: string): {
  normalizedName: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
} {
  const normalizedName = normalizeWhitespace(value)?.toLowerCase() ?? "";
  const parts = normalizedName.split(" ").filter(Boolean);
  return {
    normalizedName,
    firstName: parts[0] ?? null,
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : null,
    lastName: parts.length > 1 ? parts.at(-1) ?? null : null,
  };
}

export function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

export function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 255)
    : "unknown_error";
}
