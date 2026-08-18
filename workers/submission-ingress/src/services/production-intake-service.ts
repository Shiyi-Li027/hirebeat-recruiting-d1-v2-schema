import type { SubmissionIngressConfiguration } from "../config/runtime-configuration";
import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import type { IntakeRunRepositoryPort } from "../repositories/intake-run-repository";
import type { RawSubmissionRepository } from "../repositories/raw-submission-repository";
import type { SystemConfigurationRepository } from "../repositories/system-configuration-repository";
import { DefaultIdempotencyService } from "./idempotency-service";
import { IntakeRunCoordinator } from "./intake-run-coordinator";
import type { IntakeReceipt, IntakeService } from "./intake-service";
import type { ParserClient } from "./parser-client";
import type { PayloadHmacService } from "./payload-hmac";
import type { R2ResumeStore } from "./r2-resume-store";
import type { RawPublisher, ResumePublishOutcome } from "./raw-publisher";
import type { ResumeResolver } from "./resume-resolver";

function staleCutoff(now: string, staleSeconds: number): string {
  return new Date(Date.parse(now) - staleSeconds * 1000).toISOString();
}

function terminalResumeFailure(error: IngressError): ResumePublishOutcome {
  return {
    kind: "parse_failed_terminal",
    errorCode: error.safeCode,
    errorDetail: error.message,
  };
}

export class ProductionIntakeService implements IntakeService {
  private readonly identityService = new DefaultIdempotencyService();
  private readonly coordinator: IntakeRunCoordinator;

  constructor(
    private readonly intakeRuns: IntakeRunRepositoryPort,
    private readonly rawSubmissions: RawSubmissionRepository,
    private readonly configurations: SystemConfigurationRepository,
    private readonly payloadHmacService: PayloadHmacService,
    private readonly resumeResolver: ResumeResolver,
    private readonly resumeStore: R2ResumeStore,
    private readonly parserClientFactory: (
      configuration: SubmissionIngressConfiguration,
    ) => ParserClient,
    private readonly rawPublisher: RawPublisher,
  ) {
    this.coordinator = new IntakeRunCoordinator(intakeRuns);
  }

  private async configurationFor(
    request: CanonicalIntakeRequest,
  ): Promise<SubmissionIngressConfiguration> {
    const identity = this.identityService.resolveIdentity(request);
    const matches = await this.intakeRuns.findByAnyIdentity(identity);
    if (matches.length === 0) {
      return this.configurations.loadActiveSubmissionIngressConfiguration();
    }
    if (matches.length === 1) {
      return this.configurations.loadSubmissionIngressConfigurationByReleaseId(
        matches[0].configurationReleaseId,
      );
    }
    throw new IngressError({
      kind: "conflict",
      safeCode: "idempotency_identity_conflict",
      message: "The supplied identities match multiple intake runs.",
      httpStatus: 409,
    });
  }

  async receive(request: CanonicalIntakeRequest): Promise<IntakeReceipt> {
    const configuration = await this.configurationFor(request);
    const payloadHmac = await this.payloadHmacService.calculate(request);
    const reserved = await this.coordinator.reserve({
      request,
      payloadHmac,
      configuration,
    });

    if (reserved.outcome === "duplicate_skipped") {
      const raw = await this.rawSubmissions.findBySubmissionUuid(
        request.source.submissionUuid,
      );
      if (!raw) {
        throw new IngressError({
          kind: "retryable",
          safeCode: "succeeded_intake_missing_raw_submission",
          message: "The completed intake is missing its Raw Submission.",
          httpStatus: 503,
        });
      }
      return {
        submissionUuid: request.source.submissionUuid,
        intakeRunId: reserved.intakeRun.id,
        rawSubmissionId: raw.id,
        outboxEventId: null,
        outcome: "duplicate_skipped",
      };
    }
    if (reserved.outcome === "existing_in_progress") {
      return {
        submissionUuid: request.source.submissionUuid,
        intakeRunId: reserved.intakeRun.id,
        rawSubmissionId: null,
        outboxEventId: null,
        outcome: "existing_in_progress",
      };
    }

    const now = new Date().toISOString();
    const claim = await this.intakeRuns.claimProcessingAttempt({
      intakeRunId: reserved.intakeRun.id,
      maximumAttempts: configuration.maxAttempts,
      staleBefore: staleCutoff(now, configuration.activeStaleSeconds),
      now,
    });
    if (!claim) {
      return {
        submissionUuid: request.source.submissionUuid,
        intakeRunId: reserved.intakeRun.id,
        rawSubmissionId: null,
        outboxEventId: null,
        outcome: "existing_in_progress",
      };
    }

    try {
      let resumeObject = null;
      let resumeOutcome: ResumePublishOutcome;
      if (request.resume.kind === "no_resume") {
        resumeOutcome = { kind: "no_resume" };
      } else {
        try {
          const pdf = await this.resumeResolver.resolve(request.resume, {
            maximumBytes: configuration.maxResumeFileSizeBytes,
            timeoutMs: configuration.parserTimeoutMs,
          });
          if (!pdf) {
            resumeOutcome = { kind: "no_resume" };
          } else {
            const hashFreeze = await this.intakeRuns.freezeResolvedResumeFileHash({
              intakeRunId: claim.intakeRunId,
              attemptNumber: claim.attemptNumber,
              sha256: pdf.sha256,
              now: new Date().toISOString(),
            });
            if (hashFreeze === "conflict") {
              throw new IngressError({
                kind: "conflict",
                safeCode: "resume_file_changed_during_redelivery",
                message: "The Resume PDF content changed for the same intake identity.",
                httpStatus: 409,
              });
            }
            if (hashFreeze === "fence_lost") {
              throw new IngressError({
                kind: "conflict",
                safeCode: "intake_attempt_fence_lost",
                message: "This Worker no longer owns the active intake attempt.",
                httpStatus: 409,
              });
            }
            resumeObject = await this.resumeStore.putOriginalPdf(
              request.source.submissionUuid,
              pdf,
            );
            try {
              const parsed = await this.parserClientFactory(
                configuration,
              ).parsePdf(pdf);
              resumeOutcome = { kind: "available", parsed };
            } catch (error) {
              if (error instanceof IngressError && error.kind === "terminal") {
                resumeOutcome = terminalResumeFailure(error);
              } else {
                throw error;
              }
            }
          }
        } catch (error) {
          if (error instanceof IngressError && error.kind === "terminal") {
            resumeOutcome = terminalResumeFailure(error);
          } else {
            throw error;
          }
        }
      }

      const publishStartedAt = new Date().toISOString();
      const ownsAttempt = await this.intakeRuns.markPersisting({
        intakeRunId: claim.intakeRunId,
        attemptNumber: claim.attemptNumber,
        now: publishStartedAt,
      });
      if (!ownsAttempt) {
        throw new IngressError({
          kind: "conflict",
          safeCode: "intake_attempt_fence_lost",
          message: "This Worker no longer owns the active intake attempt.",
          httpStatus: 409,
        });
      }
      const result = await this.rawPublisher.publish({
        intakeRunId: claim.intakeRunId,
        attemptNumber: claim.attemptNumber,
        request,
        resumeObject,
        resumeOutcome,
        payloadHmac: payloadHmac.hmacHex,
        payloadHmacKeyVersion: payloadHmac.keyVersion,
        outboxMaxDeliveryAttempts: configuration.outboxMaxDeliveryAttempts,
        now: new Date().toISOString(),
      });
      return {
        submissionUuid: request.source.submissionUuid,
        intakeRunId: claim.intakeRunId,
        rawSubmissionId: result.rawSubmissionId,
        outboxEventId: result.outboxEventId,
        outcome: "succeeded",
      };
    } catch (error) {
      const ingressError =
        error instanceof IngressError
          ? error
          : new IngressError({
              kind: "retryable",
              safeCode: "ingress_unexpected_failure",
              message: "The Ingress attempt failed unexpectedly.",
              httpStatus: 503,
              cause: error,
            });
      const exhausted = claim.attemptNumber >= configuration.maxAttempts;
      await this.intakeRuns.markFailure({
        intakeRunId: claim.intakeRunId,
        attemptNumber: claim.attemptNumber,
        terminal: ingressError.kind !== "retryable" || exhausted,
        errorCode: exhausted
          ? `retry_exhausted:${ingressError.safeCode}`
          : ingressError.safeCode,
        errorDetail: ingressError.message,
        now: new Date().toISOString(),
      });
      throw ingressError;
    }
  }
}
