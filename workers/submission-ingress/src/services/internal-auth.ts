import { IngressError } from "../errors/ingress-error";

const encoder = new TextEncoder();

async function constantTimeTokenMatch(
  providedToken: string,
  expectedToken: string,
): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(providedToken)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);

  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = providedBytes.length ^ expectedBytes.length;

  const comparisonLength = Math.max(
    providedBytes.length,
    expectedBytes.length,
  );
  for (let index = 0; index < comparisonLength; index += 1) {
    difference |=
      (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

export async function requireInternalAuthentication(
  request: Request,
  expectedToken: string,
): Promise<void> {
  if (!expectedToken || expectedToken.length < 32) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "internal_auth_secret_not_configured",
      message: "The internal authentication secret is not configured safely.",
      httpStatus: 503,
    });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new IngressError({
      kind: "authentication",
      safeCode: "missing_internal_authentication",
      message: "A valid internal bearer token is required.",
      httpStatus: 401,
    });
  }

  const providedToken = authorization.slice("Bearer ".length);
  if (
    providedToken.length === 0 ||
    providedToken.length > 4096 ||
    !(await constantTimeTokenMatch(providedToken, expectedToken))
  ) {
    throw new IngressError({
      kind: "authentication",
      safeCode: "invalid_internal_authentication",
      message: "A valid internal bearer token is required.",
      httpStatus: 401,
    });
  }
}
