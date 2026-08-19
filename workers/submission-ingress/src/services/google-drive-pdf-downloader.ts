import type { PdfResumeReference } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import { downloadPdf, type FetchFunction } from "./pdf-download";
import { GoogleServiceAccountTokenProvider } from "./google-access-token";
import type {
  PdfDownloadPolicy,
  ResolvedResumePdf,
} from "./resume-resolver";
import { runtimeFetch } from "../../../shared/runtime-fetch";

export function extractGoogleDriveFileId(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{3,256}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const queryId = url.searchParams.get("id");
    if (queryId && /^[A-Za-z0-9_-]{3,256}$/.test(queryId)) return queryId;
    const pathMatch = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{3,256})/);
    return pathMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

export class GoogleDrivePdfDownloader {
  constructor(
    private readonly tokenProvider: GoogleServiceAccountTokenProvider,
    private readonly fetchFunction: FetchFunction = runtimeFetch,
  ) {}

  async download(
    reference: PdfResumeReference,
    policy: PdfDownloadPolicy,
  ): Promise<ResolvedResumePdf> {
    if (reference.source !== "google_drive") {
      throw new IngressError({
        kind: "validation",
        safeCode: "invalid_google_drive_resume_reference",
        message: "The Google Drive downloader requires a Drive reference.",
        httpStatus: 422,
      });
    }

    const fileId = extractGoogleDriveFileId(
      reference.sourceFileId ?? reference.sourceUrl ?? "",
    );
    if (!fileId) {
      throw new IngressError({
        kind: "validation",
        safeCode: "google_drive_file_id_missing",
        message: "The Google Drive Resume reference has no valid file ID.",
        httpStatus: 422,
      });
    }

    const accessToken = await this.tokenProvider.getDriveReadOnlyToken();
    const downloadUrl =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      "?alt=media";

    return downloadPdf(
      downloadUrl,
      {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
        redirect: "follow",
      },
      {
        originalFileName: reference.originalFileName,
        sourceUrl: reference.sourceUrl,
        sourceFileId: fileId,
      },
      policy,
      this.fetchFunction,
    );
  }
}
