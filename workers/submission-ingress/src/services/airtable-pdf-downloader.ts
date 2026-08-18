import type { PdfResumeReference } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import { downloadPdf, type FetchFunction } from "./pdf-download";
import type {
  PdfDownloadPolicy,
  ResolvedResumePdf,
} from "./resume-resolver";

export class AirtablePdfDownloader {
  constructor(private readonly fetchFunction: FetchFunction = fetch) {}

  async download(
    reference: PdfResumeReference,
    policy: PdfDownloadPolicy,
  ): Promise<ResolvedResumePdf> {
    if (reference.source !== "airtable_attachment" || !reference.sourceUrl) {
      throw new IngressError({
        kind: "validation",
        safeCode: "invalid_airtable_resume_reference",
        message: "The Airtable Resume reference requires an attachment URL.",
        httpStatus: 422,
      });
    }

    let sourceUrl: URL;
    try {
      sourceUrl = new URL(reference.sourceUrl);
    } catch (error) {
      throw new IngressError({
        kind: "validation",
        safeCode: "invalid_airtable_attachment_url",
        message: "The Airtable attachment URL is invalid.",
        httpStatus: 422,
        cause: error,
      });
    }

    if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) {
      throw new IngressError({
        kind: "validation",
        safeCode: "unsafe_airtable_attachment_url",
        message: "The Airtable attachment URL must use HTTPS without credentials.",
        httpStatus: 422,
      });
    }

    return downloadPdf(
      sourceUrl.toString(),
      { method: "GET", redirect: "follow" },
      {
        originalFileName: reference.originalFileName,
        sourceUrl: reference.sourceUrl,
        sourceFileId: null,
      },
      policy,
      this.fetchFunction,
    );
  }
}
