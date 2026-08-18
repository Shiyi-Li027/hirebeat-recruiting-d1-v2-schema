import { IngressError } from "../errors/ingress-error";
import type {
  PdfDownloadPolicy,
  ResolvedResumePdf,
} from "./resume-resolver";

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PdfSourceMetadata {
  originalFileName: string | null;
  sourceUrl: string | null;
  sourceFileId: string | null;
}

function requirePositiveSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new IngressError({
      kind: "configuration",
      safeCode: `invalid_${fieldName}`,
      message: `${fieldName} must be a positive safe integer.`,
      httpStatus: 500,
    });
  }
}

function classifyHttpFailure(status: number): "retryable" | "terminal" {
  return status === 408 || status === 425 || status === 429 || status >= 500
    ? "retryable"
    : "terminal";
}

function sanitizePdfFileName(value: string | null): string {
  const cleaned = (value ?? "resume.pdf")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const nonEmpty = cleaned || "resume.pdf";
  return nonEmpty.toLowerCase().endsWith(".pdf")
    ? nonEmpty
    : `${nonEmpty}.pdf`;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "resume_pdf_too_large",
        message: "The source PDF exceeds the configured size limit.",
        httpStatus: 413,
      });
    }
  }

  if (response.body === null) {
    throw new IngressError({
      kind: "retryable",
      safeCode: "resume_pdf_empty_response_body",
      message: "The PDF source returned no response body.",
      httpStatus: 502,
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("configured PDF size limit exceeded");
        throw new IngressError({
          kind: "terminal",
          safeCode: "resume_pdf_too_large",
          message: "The source PDF exceeds the configured size limit.",
          httpStatus: 413,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new IngressError({
      kind: "terminal",
      safeCode: "resume_pdf_empty",
      message: "The source PDF is empty.",
      httpStatus: 422,
    });
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

function validatePdfBytes(bytes: ArrayBuffer, response: Response): void {
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") {
    throw new IngressError({
      kind: "terminal",
      safeCode: "resume_file_is_not_pdf",
      message: "The downloaded file does not have a valid PDF signature.",
      httpStatus: 422,
    });
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType &&
    contentType !== "application/pdf" &&
    contentType !== "application/octet-stream"
  ) {
    throw new IngressError({
      kind: "terminal",
      safeCode: "resume_pdf_invalid_content_type",
      message: "The source returned a non-PDF content type.",
      httpStatus: 422,
    });
  }
}

export async function downloadPdf(
  url: string,
  requestInit: RequestInit,
  metadata: PdfSourceMetadata,
  policy: PdfDownloadPolicy,
  fetchFunction: FetchFunction = fetch,
): Promise<ResolvedResumePdf> {
  requirePositiveSafeInteger(policy.maximumBytes, "maximum_pdf_bytes");
  requirePositiveSafeInteger(policy.timeoutMs, "pdf_download_timeout_ms");

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), policy.timeoutMs);

  try {
    const response = await fetchFunction(url, {
      ...requestInit,
      signal: controller.signal,
    });
    if (!response.ok) {
      const kind = classifyHttpFailure(response.status);
      throw new IngressError({
        kind,
        safeCode: `resume_download_http_${response.status}`,
        message: "The PDF source rejected the download request.",
        httpStatus: kind === "retryable" ? 503 : 422,
      });
    }

    const bytes = await readBoundedBody(response, policy.maximumBytes);
    validatePdfBytes(bytes, response);
    const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));

    return {
      bytes,
      originalFileName: metadata.originalFileName,
      parserFileName: sanitizePdfFileName(metadata.originalFileName),
      mimeType: "application/pdf",
      sourceUrl: metadata.sourceUrl,
      sourceFileId: metadata.sourceFileId,
      sha256,
      sizeBytes: bytes.byteLength,
    };
  } catch (error) {
    if (error instanceof IngressError) throw error;
    const timedOut =
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    throw new IngressError({
      kind: "retryable",
      safeCode: timedOut
        ? "resume_download_timeout"
        : "resume_download_network_error",
      message: timedOut
        ? "The PDF source download timed out."
        : "The PDF source download failed because of a network error.",
      httpStatus: 503,
      cause: error,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
