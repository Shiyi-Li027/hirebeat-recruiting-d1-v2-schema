import assert from "node:assert/strict";
import test from "node:test";

import { IngressError } from "../../src/errors/ingress-error";
import { HttpParserClient } from "../../src/services/parser-client";
import type { ResolvedResumePdf } from "../../src/services/resume-resolver";

const pdf: ResolvedResumePdf = {
  bytes: new TextEncoder().encode("%PDF-test").buffer,
  originalFileName: "resume.pdf",
  parserFileName: "resume.pdf",
  mimeType: "application/pdf",
  sourceUrl: "https://example.test/resume.pdf",
  sourceFileId: null,
  sha256: "a".repeat(64),
  sizeBytes: 9,
};

test("Parser preserves whitespace and appends parse-pdf endpoint", async () => {
  let requestedUrl = "";
  const originalText = "EDUCATION\n  New York University\n\nEXPERIENCE\nRole  ";
  const client = new HttpParserClient(
    "https://parser.example.test/api",
    "test-token",
    1_000,
    async (input, init) => {
      requestedUrl = String(input);
      assert.equal(init?.method, "POST");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-token",
      );
      assert.ok(init?.body instanceof FormData);
      return Response.json({
        text: originalText,
        parser_name: "PyMuPDF",
        parser_version: "1.26.0",
      });
    },
  );

  const result = await client.parsePdf(pdf);
  assert.equal(requestedUrl, "https://parser.example.test/api/parse-pdf");
  assert.equal(result.text, originalText);
  assert.equal(result.parserName, "PyMuPDF");
  assert.equal(result.parserVersion, "1.26.0");
});

test("Parser 429 is retryable", async () => {
  const client = new HttpParserClient(
    "https://parser.example.test/parse-pdf",
    "test-token",
    1_000,
    async () => new Response(null, { status: 429 }),
  );
  await assert.rejects(
    () => client.parsePdf(pdf),
    (error: unknown) =>
      error instanceof IngressError &&
      error.kind === "retryable" &&
      error.safeCode === "parser_http_429",
  );
});

test("Parser empty text is terminal", async () => {
  const client = new HttpParserClient(
    "https://parser.example.test/parse-pdf",
    "test-token",
    1_000,
    async () => Response.json({ text: "   " }),
  );
  await assert.rejects(
    () => client.parsePdf(pdf),
    (error: unknown) =>
      error instanceof IngressError &&
      error.kind === "terminal" &&
      error.safeCode === "parser_empty_resume_text",
  );
});
