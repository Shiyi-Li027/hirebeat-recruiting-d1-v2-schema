import type { ResolvedResumePdf } from "./resume-resolver";
import { IngressError } from "../errors/ingress-error";

export interface StoredResumeObject {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  storedAt: string;
  etag: string;
  writeOutcome: "created" | "reused_existing";
}

export interface R2ResumeStore {
  putOriginalPdf(
    submissionUuid: string,
    pdf: ResolvedResumePdf,
  ): Promise<StoredResumeObject>;
}

export function buildResumeObjectKey(
  submissionUuid: string,
  sha256: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new IngressError({
      kind: "validation",
      safeCode: "invalid_resume_pdf_sha256",
      message: "The Resume PDF hash is invalid.",
      httpStatus: 422,
    });
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      submissionUuid,
    )
  ) {
    throw new IngressError({
      kind: "validation",
      safeCode: "invalid_submission_uuid_for_r2",
      message: "The submission UUID is invalid for R2 storage.",
      httpStatus: 422,
    });
  }
  return `raw-resumes/v1/${submissionUuid.toLowerCase()}/${sha256}.pdf`;
}

export class CloudflareR2ResumeStore implements R2ResumeStore {
  constructor(private readonly bucket: R2Bucket) {}

  async putOriginalPdf(
    submissionUuid: string,
    pdf: ResolvedResumePdf,
  ): Promise<StoredResumeObject> {
    if (pdf.sizeBytes !== pdf.bytes.byteLength) {
      throw new IngressError({
        kind: "conflict",
        safeCode: "resume_pdf_size_conflict",
        message: "The Resume PDF metadata does not match its bytes.",
        httpStatus: 409,
      });
    }

    const objectKey = buildResumeObjectKey(submissionUuid, pdf.sha256);
    let written: R2Object | null;
    try {
      written = await this.bucket.put(objectKey, pdf.bytes, {
        onlyIf: new Headers({ "if-none-match": "*" }),
        httpMetadata: {
          contentType: "application/pdf",
          contentDisposition: 'attachment; filename="resume.pdf"',
        },
        customMetadata: {
          sha256: pdf.sha256,
          submissionUuid: submissionUuid.toLowerCase(),
          objectSchemaVersion: "raw-resume-pdf-v1",
        },
      });
    } catch (error) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "r2_resume_put_failed",
        message: "The original Resume PDF could not be stored in R2.",
        httpStatus: 503,
        cause: error,
      });
    }

    if (written) {
      return {
        objectKey,
        sha256: pdf.sha256,
        sizeBytes: written.size,
        storedAt: written.uploaded.toISOString(),
        etag: written.etag,
        writeOutcome: "created",
      };
    }

    let existing: R2Object | null;
    try {
      existing = await this.bucket.head(objectKey);
    } catch (error) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "r2_resume_head_failed",
        message: "The existing Resume PDF could not be verified in R2.",
        httpStatus: 503,
        cause: error,
      });
    }

    if (
      !existing ||
      existing.size !== pdf.sizeBytes ||
      existing.customMetadata?.sha256 !== pdf.sha256
    ) {
      throw new IngressError({
        kind: "conflict",
        safeCode: "r2_resume_object_conflict",
        message: "The stable R2 Resume key exists with different metadata.",
        httpStatus: 409,
      });
    }

    return {
      objectKey,
      sha256: pdf.sha256,
      sizeBytes: existing.size,
      storedAt: existing.uploaded.toISOString(),
      etag: existing.etag,
      writeOutcome: "reused_existing",
    };
  }
}
