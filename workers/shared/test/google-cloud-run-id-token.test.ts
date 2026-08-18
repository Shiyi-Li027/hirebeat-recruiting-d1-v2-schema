import assert from "node:assert/strict";
import test from "node:test";

import { GoogleServiceAccountCloudRunIdTokenProvider } from "../google-cloud-run-id-token";

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value))
    .toString("base64url");
}

function pem(bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

test("exchanges a signed assertion for an audience-bound ID token and caches it", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const audience = "https://service-123.us-east1.run.app";
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const idToken = `${base64UrlJson({ alg: "RS256" })}.${base64UrlJson({ aud: audience, exp: expiresAt })}.signature`;
  let requests = 0;

  const provider = new GoogleServiceAccountCloudRunIdTokenProvider(
    JSON.stringify({
      client_email: "worker-invoker@example.iam.gserviceaccount.com",
      private_key: pem(privateKey),
      token_uri: "https://oauth2.googleapis.com/token",
    }),
    1_000,
    async (_input, init) => {
      requests += 1;
      const params = new URLSearchParams(String(init?.body));
      const assertion = params.get("assertion");
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.ok(assertion);
      const claim = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
      assert.equal(claim.target_audience, audience);
      assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
      return Response.json({ id_token: idToken });
    },
  );

  assert.equal(await provider.getIdToken(`${audience}/`), idToken);
  assert.equal(await provider.getIdToken(audience), idToken);
  assert.equal(requests, 1);
});

test("rejects an ID token issued for a different audience", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const token = `${base64UrlJson({ alg: "RS256" })}.${base64UrlJson({ aud: "https://wrong.example", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
  const provider = new GoogleServiceAccountCloudRunIdTokenProvider(
    JSON.stringify({ client_email: "test@example.iam.gserviceaccount.com", private_key: pem(privateKey) }),
    1_000,
    async () => Response.json({ id_token: token }),
  );
  await assert.rejects(
    () => provider.getIdToken("https://service.example"),
    /google_cloud_run_token_claims_invalid/,
  );
});
