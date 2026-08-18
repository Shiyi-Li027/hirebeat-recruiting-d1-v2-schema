import { downloadPdf } from "../../src/services/pdf-download";
import { extractGoogleDriveFileId } from "../../src/services/google-drive-pdf-downloader";
import {
  buildResumeObjectKey,
  CloudflareR2ResumeStore,
} from "../../src/services/r2-resume-store";
import { IngressError } from "../../src/errors/ingress-error";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function expectIngressCode(
  operation: () => Promise<unknown>,
  safeCode: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof IngressError, "expected an IngressError");
    assert(error.safeCode === safeCode, `expected ${safeCode}, got ${error.safeCode}`);
    return;
  }
  throw new Error(`Expected ${safeCode}, but the operation succeeded.`);
}

const syntheticPdf = new TextEncoder().encode(
  "%PDF-1.7\nsynthetic HireBeat test object\n%%EOF",
);
const policy = { maximumBytes: 1_024, timeoutMs: 1_000 };

const resolved = await downloadPdf(
  "https://example.invalid/resume.pdf",
  { method: "GET" },
  {
    originalFileName: "candidate/resume",
    sourceUrl: "https://example.invalid/resume.pdf",
    sourceFileId: null,
  },
  policy,
  async () =>
    new Response(syntheticPdf, {
      status: 200,
      headers: { "content-type": "application/pdf" },
    }),
);

assert(resolved.sizeBytes === syntheticPdf.byteLength, "PDF size must match");
assert(resolved.parserFileName === "candidate_resume.pdf", "filename must be safe");
assert(/^[0-9a-f]{64}$/.test(resolved.sha256), "SHA-256 must be hexadecimal");

await expectIngressCode(
  () =>
    downloadPdf(
      "https://example.invalid/not-pdf",
      {},
      { originalFileName: null, sourceUrl: null, sourceFileId: null },
      policy,
      async () =>
        new Response("<html>not a PDF</html>", {
          headers: { "content-type": "text/html" },
        }),
    ),
  "resume_file_is_not_pdf",
);

await expectIngressCode(
  () =>
    downloadPdf(
      "https://example.invalid/large.pdf",
      {},
      { originalFileName: null, sourceUrl: null, sourceFileId: null },
      { maximumBytes: 4, timeoutMs: 1_000 },
      async () =>
        new Response(syntheticPdf, {
          headers: {
            "content-type": "application/pdf",
            "content-length": String(syntheticPdf.byteLength),
          },
        }),
    ),
  "resume_pdf_too_large",
);

await expectIngressCode(
  () =>
    downloadPdf(
      "https://example.invalid/slow.pdf",
      {},
      { originalFileName: null, sourceUrl: null, sourceFileId: null },
      { maximumBytes: 1_024, timeoutMs: 5 },
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ),
  "resume_download_timeout",
);

assert(
  extractGoogleDriveFileId("https://drive.google.com/open?id=abc_DEF-123") ===
    "abc_DEF-123",
  "open?id URL must resolve",
);
assert(
  extractGoogleDriveFileId(
    "https://drive.google.com/file/d/abc_DEF-123/view?usp=sharing",
  ) === "abc_DEF-123",
  "/file/d URL must resolve",
);

const submissionUuid = "5d3d871c-93e5-4444-b796-6e26291c0ea7";
const expectedKey =
  `raw-resumes/v1/${submissionUuid}/${resolved.sha256}.pdf`;
assert(
  buildResumeObjectKey(submissionUuid, resolved.sha256) === expectedKey,
  "R2 key must be stable and content addressed",
);

const uploadedAt = new Date("2026-08-18T12:00:00.000Z");
const object = {
  key: expectedKey,
  version: "test-version",
  size: resolved.sizeBytes,
  etag: "test-etag",
  httpEtag: '"test-etag"',
  checksums: {},
  uploaded: uploadedAt,
  storageClass: "Standard",
  customMetadata: { sha256: resolved.sha256 },
};

let putReturnsObject = true;
const mockBucket = {
  async put() {
    return putReturnsObject ? object : null;
  },
  async head() {
    return object;
  },
} as unknown as R2Bucket;

const store = new CloudflareR2ResumeStore(mockBucket);
const created = await store.putOriginalPdf(submissionUuid, resolved);
assert(created.writeOutcome === "created", "first write must be created");

putReturnsObject = false;
const reused = await store.putOriginalPdf(submissionUuid, resolved);
assert(
  reused.writeOutcome === "reused_existing",
  "conditional redelivery must reuse the verified object",
);

console.log("Resume acquisition unit tests passed.");
