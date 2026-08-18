import type { ResolvedResumePdf } from "./resume-resolver";
import { IngressError } from "../errors/ingress-error";
import type { FetchFunction } from "./pdf-download";
import type { CloudRunIdTokenProvider } from "../../../shared/google-cloud-run-id-token";

export interface ParsedResumeText {
  text: string;
  parserName: string;
  parserVersion: string | null;
  parsedAt: string;
}

export interface ParserClient {
  parsePdf(pdf: ResolvedResumePdf): Promise<ParsedResumeText>;
}

interface ParserResponseBody {
  text?: unknown;
  parser_name?: unknown;
  parserName?: unknown;
  parser_version?: unknown;
  parserVersion?: unknown;
}

function parserEndpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "invalid_parser_service_url",
      message: "The Parser service URL is invalid.",
      httpStatus: 503,
      cause,
    });
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new IngressError({
      kind: "configuration",
      safeCode: "insecure_parser_service_url",
      message: "The Parser service URL must use HTTPS.",
      httpStatus: 503,
    });
  }
  if (!url.pathname.endsWith("/parse-pdf")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/parse-pdf`;
  }
  return url.toString();
}

function parserAudience(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch (cause) {
    throw new IngressError({
      kind: "configuration",
      safeCode: "invalid_parser_service_url",
      message: "The Parser service URL is invalid.",
      httpStatus: 503,
      cause,
    });
  }
}

export class HttpParserClient implements ParserClient {
  constructor(
    private readonly serviceUrl: string,
    private readonly authToken: string,
    private readonly cloudRunIdTokenProvider: CloudRunIdTokenProvider,
    private readonly timeoutMs: number,
    private readonly fetchFunction: FetchFunction = fetch,
  ) {}

  async parsePdf(pdf: ResolvedResumePdf): Promise<ParsedResumeText> {
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new IngressError({
        kind: "configuration",
        safeCode: "invalid_parser_timeout_ms",
        message: "Parser timeout must be a positive safe integer.",
        httpStatus: 503,
      });
    }
    if (this.authToken.length === 0) {
      throw new IngressError({
        kind: "configuration",
        safeCode: "missing_parser_auth_token",
        message: "Parser authentication is not configured.",
        httpStatus: 503,
      });
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([pdf.bytes], { type: "application/pdf" }),
      pdf.parserFileName,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const cloudRunIdToken = await this.cloudRunIdTokenProvider.getIdToken(
        parserAudience(this.serviceUrl),
      );
      const response = await this.fetchFunction(parserEndpoint(this.serviceUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.authToken}`,
          "x-serverless-authorization": `Bearer ${cloudRunIdToken}`,
        },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new IngressError({
          kind: retryable ? "retryable" : "terminal",
          safeCode: `parser_http_${response.status}`,
          message: "The Resume Parser rejected the request.",
          httpStatus: retryable ? 503 : 422,
        });
      }

      let body: ParserResponseBody;
      try {
        body = (await response.json()) as ParserResponseBody;
      } catch (cause) {
        throw new IngressError({
          kind: "retryable",
          safeCode: "parser_invalid_json_response",
          message: "The Resume Parser returned an invalid response.",
          httpStatus: 502,
          cause,
        });
      }
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        throw new IngressError({
          kind: "terminal",
          safeCode: "parser_empty_resume_text",
          message: "The Resume Parser returned no usable text.",
          httpStatus: 422,
        });
      }
      const parserName = body.parser_name ?? body.parserName;
      const parserVersion = body.parser_version ?? body.parserVersion;
      return {
        text: body.text,
        parserName:
          typeof parserName === "string" && parserName.length > 0
            ? parserName
            : "upstream_parser",
        parserVersion:
          typeof parserVersion === "string" && parserVersion.length > 0
            ? parserVersion
            : null,
        parsedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof IngressError) throw error;
      const timedOut = controller.signal.aborted;
      throw new IngressError({
        kind: "retryable",
        safeCode: timedOut ? "parser_timeout" : "parser_network_error",
        message: timedOut
          ? "The Resume Parser timed out."
          : "The Resume Parser could not be reached.",
        httpStatus: 503,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
