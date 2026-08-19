import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";

export interface IntakeFaultInjector {
  beforeResumeResolve(
    request: CanonicalIntakeRequest,
    attemptNumber: number,
  ): void;
  beforeParser(
    request: CanonicalIntakeRequest,
    attemptNumber: number,
  ): void;
}

export const NOOP_INTAKE_FAULT_INJECTOR: IntakeFaultInjector = {
  beforeResumeResolve() {},
  beforeParser() {},
};

type FaultMode =
  | "source-download-retry-once"
  | "parser-429-retry-once"
  | "parser-timeout-retry-once"
  | "parser-empty-terminal";

const FAULT_SOURCE_PATTERN =
  /^staging-google-fault-(source-download-retry-once|parser-429-retry-once|parser-timeout-retry-once|parser-empty-terminal)-[a-z0-9-]+$/;

function faultMode(request: CanonicalIntakeRequest): FaultMode | null {
  const match = FAULT_SOURCE_PATTERN.exec(request.source.sourceRecordId);
  return (match?.[1] as FaultMode | undefined) ?? null;
}

export class StagingIntakeFaultInjector implements IntakeFaultInjector {
  private readonly enabled: boolean;

  constructor(deploymentStage: string, explicitEnablement: string | undefined) {
    this.enabled =
      deploymentStage === "staging" && explicitEnablement === "enabled";
  }

  beforeResumeResolve(
    request: CanonicalIntakeRequest,
    attemptNumber: number,
  ): void {
    if (!this.enabled || attemptNumber !== 1) return;
    if (faultMode(request) !== "source-download-retry-once") return;
    throw new IngressError({
      kind: "retryable",
      safeCode: "staging_fault_source_download_503",
      message: "Synthetic staging source-download failure.",
      httpStatus: 503,
    });
  }

  beforeParser(
    request: CanonicalIntakeRequest,
    attemptNumber: number,
  ): void {
    if (!this.enabled) return;
    const mode = faultMode(request);
    if (mode === "parser-empty-terminal") {
      throw new IngressError({
        kind: "terminal",
        safeCode: "parser_empty_resume_text",
        message: "The Parser returned empty Resume text.",
        httpStatus: 422,
      });
    }
    if (attemptNumber !== 1) return;
    if (mode === "parser-429-retry-once") {
      throw new IngressError({
        kind: "retryable",
        safeCode: "parser_http_429",
        message: "Synthetic staging Parser rate limit.",
        httpStatus: 503,
      });
    }
    if (mode === "parser-timeout-retry-once") {
      throw new IngressError({
        kind: "retryable",
        safeCode: "parser_timeout",
        message: "Synthetic staging Parser timeout.",
        httpStatus: 503,
      });
    }
  }
}
