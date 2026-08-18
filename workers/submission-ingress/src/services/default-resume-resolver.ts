import type { ResumeReference } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import type { AirtablePdfDownloader } from "./airtable-pdf-downloader";
import type { GoogleDrivePdfDownloader } from "./google-drive-pdf-downloader";
import type {
  PdfDownloadPolicy,
  ResolvedResumePdf,
  ResumeResolver,
} from "./resume-resolver";

export class DefaultResumeResolver implements ResumeResolver {
  constructor(
    private readonly airtableDownloader: AirtablePdfDownloader,
    private readonly googleDriveDownloader: GoogleDrivePdfDownloader,
  ) {}

  async resolve(
    reference: ResumeReference,
    policy: PdfDownloadPolicy,
  ): Promise<ResolvedResumePdf | null> {
    if (reference.kind === "no_resume") return null;
    if (reference.source === "airtable_attachment") {
      return this.airtableDownloader.download(reference, policy);
    }
    if (reference.source === "google_drive") {
      return this.googleDriveDownloader.download(reference, policy);
    }

    throw new IngressError({
      kind: "validation",
      safeCode: "unsupported_resume_source",
      message: "The Resume source is not supported.",
      httpStatus: 422,
    });
  }
}
