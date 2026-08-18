import type { IngressEnv } from "./env";
import { adaptAirtableEvent } from "./adapters/airtable-adapter";
import { adaptGoogleFormEvent } from "./adapters/google-form-adapter";
import type { CanonicalIntakeRequest } from "./contracts/canonical-intake";
import { IngressError } from "./errors/ingress-error";
import { SystemConfigurationRepository } from "./repositories/system-configuration-repository";
import { D1IntakeRunRepository } from "./repositories/intake-run-repository";
import { D1RawSubmissionRepository } from "./repositories/raw-submission-repository";
import { AirtablePdfDownloader } from "./services/airtable-pdf-downloader";
import { DefaultResumeResolver } from "./services/default-resume-resolver";
import { GoogleServiceAccountTokenProvider } from "./services/google-access-token";
import { GoogleDrivePdfDownloader } from "./services/google-drive-pdf-downloader";
import { ProductionIntakeService } from "./services/production-intake-service";
import { HttpParserClient } from "./services/parser-client";
import { CloudflareR2ResumeStore } from "./services/r2-resume-store";
import { D1RawPublisher } from "./services/raw-publisher";
import { requireInternalAuthentication } from "./services/internal-auth";
import { WebCryptoPayloadHmacService } from "./services/payload-hmac";
import { validateCanonicalIntake } from "./validation/canonical-intake-validator";

const SERVICE_NAME = "hirebeat-submission-ingress";
const SERVICE_VERSION = "1.0.0-production-ingress";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new IngressError({
      kind: "validation",
      safeCode: "unsupported_content_type",
      message: "Content-Type must be application/json.",
      httpStatus: 415,
    });
  }

  try {
    return await request.json();
  } catch (cause) {
    throw new IngressError({
      kind: "validation",
      safeCode: "invalid_json_body",
      message: "The request body must contain valid JSON.",
      httpStatus: 400,
      cause,
    });
  }
}

function safeErrorResponse(
  error: unknown,
  requestId: string,
  writesEnabled: boolean,
): Response {
  if (error instanceof IngressError) {
    return jsonResponse(
      {
        error: error.safeCode,
        message: error.message,
        requestId,
        writesEnabled,
      },
      error.httpStatus,
    );
  }

  return jsonResponse(
    {
      error: "internal_error",
      message: "The request could not be processed.",
      requestId,
      writesEnabled,
    },
    500,
  );
}

function buildProductionService(env: IngressEnv): ProductionIntakeService {
  const configurations = new SystemConfigurationRepository(env.DB);
  const googleTokenProvider = new GoogleServiceAccountTokenProvider(
    env.GOOGLE_SERVICE_ACCOUNT_JSON,
    30_000,
  );
  return new ProductionIntakeService(
    new D1IntakeRunRepository(env.DB),
    new D1RawSubmissionRepository(env.DB),
    configurations,
    new WebCryptoPayloadHmacService(env.SUBMISSION_HMAC_KEY_V1),
    new DefaultResumeResolver(
      new AirtablePdfDownloader(),
      new GoogleDrivePdfDownloader(googleTokenProvider),
    ),
    new CloudflareR2ResumeStore(env.hirebeat_hr_raw_resumes_pdf_r2_v1),
    (configuration) =>
      new HttpParserClient(
        env.PARSER_SERVICE_URL,
        env.PARSER_SERVICE_AUTH_TOKEN,
        configuration.parserTimeoutMs,
      ),
    new D1RawPublisher(env.DB),
  );
}

async function receiveCanonical(
  intake: CanonicalIntakeRequest,
  env: IngressEnv,
  requestId: string,
): Promise<Response> {
  const receipt = await buildProductionService(env).receive(intake);
  return jsonResponse(
    { status: receipt.outcome, requestId, ...receipt, writesEnabled: true },
    receipt.outcome === "succeeded"
      ? 201
      : receipt.outcome === "existing_in_progress"
        ? 202
        : 200,
  );
}

export default {
  async fetch(request: Request, env: IngressEnv): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        status: "running",
        deploymentStage: env.DEPLOYMENT_STAGE,
        writesEnabled: true,
      });
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      try {
        await requireInternalAuthentication(
          request,
          env.INGRESS_INTERNAL_AUTH_TOKEN,
        );
        const configuration =
          await new SystemConfigurationRepository(
            env.DB,
          ).loadActiveSubmissionIngressConfiguration();
        return jsonResponse({
          service: SERVICE_NAME,
          status: "ready",
          configurationRelease: configuration.release,
          writesEnabled: true,
        });
      } catch (error) {
        return safeErrorResponse(error, requestId, true);
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/internal/v1/submissions/intake"
    ) {
      try {
        await requireInternalAuthentication(
          request,
          env.INGRESS_INTERNAL_AUTH_TOKEN,
        );

        const intake = validateCanonicalIntake(
          await readJsonBody(request),
          env.SOURCE_SCHEMA_VERSION,
        );
        return receiveCanonical(intake, env, requestId);
      } catch (error) {
        return safeErrorResponse(error, requestId, true);
      }
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/internal/v1/sources/airtable" ||
        url.pathname === "/internal/v1/sources/google-form")
    ) {
      try {
        await requireInternalAuthentication(request, env.INGRESS_INTERNAL_AUTH_TOKEN);
        const nativeEvent = await readJsonBody(request);
        const adapterOptions = {
          uuidNamespace: env.SUBMISSION_UUID_NAMESPACE,
          sourceSchemaVersion: env.SOURCE_SCHEMA_VERSION as "canonical-intake-v1",
        };
        const intake = url.pathname.endsWith("airtable")
          ? await adaptAirtableEvent(nativeEvent, adapterOptions)
          : await adaptGoogleFormEvent(nativeEvent, adapterOptions);
        return receiveCanonical(
          validateCanonicalIntake(intake, env.SOURCE_SCHEMA_VERSION),
          env,
          requestId,
        );
      } catch (error) {
        return safeErrorResponse(error, requestId, true);
      }
    }

    return jsonResponse({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<IngressEnv>;
