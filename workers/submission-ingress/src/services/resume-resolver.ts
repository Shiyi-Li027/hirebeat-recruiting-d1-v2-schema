import type { ResumeReference } from "../contracts/canonical-intake";

export interface PdfDownloadPolicy {
  maximumBytes: number;
  timeoutMs: number;
}

export interface ResolvedResumePdf {
  bytes: ArrayBuffer;
  originalFileName: string | null;
  parserFileName: string;
  mimeType: "application/pdf";
  sourceUrl: string | null;
  sourceFileId: string | null;
  sha256: string;
  sizeBytes: number;
}

export interface ResumeResolver {
  resolve(
    reference: ResumeReference,
    policy: PdfDownloadPolicy,
  ): Promise<ResolvedResumePdf | null>;
}
