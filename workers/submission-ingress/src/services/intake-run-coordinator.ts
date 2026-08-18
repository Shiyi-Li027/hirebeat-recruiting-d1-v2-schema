import type { SubmissionIngressConfiguration } from "../config/runtime-configuration";
import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import type {
  IntakeRunRecord,
  IntakeRunRepositoryPort,
} from "../repositories/intake-run-repository";
import { DefaultIdempotencyService } from "./idempotency-service";
import type { PayloadHmacResult } from "./payload-hmac";

export type IntakeReservationOutcome =
  | "created_received"
  | "duplicate_skipped"
  | "existing_in_progress"
  | "retry_eligible"
  | "stale_takeover_eligible";

export interface IntakeReservation {
  intakeRun: IntakeRunRecord;
  outcome: IntakeReservationOutcome;
}

function identityMatches(
  run: IntakeRunRecord,
  request: CanonicalIntakeRequest,
): boolean {
  return (
    run.submissionUuid === request.source.submissionUuid &&
    run.sourceSystem === request.source.sourceSystem &&
    run.sourceRecordId === request.source.sourceRecordId &&
    run.sourceEventKey === request.source.sourceEventKey
  );
}

function staleCutoff(now: string, staleSeconds: number): string {
  return new Date(Date.parse(now) - staleSeconds * 1000).toISOString();
}

export class IntakeRunCoordinator {
  private readonly identityService = new DefaultIdempotencyService();

  constructor(private readonly repository: IntakeRunRepositoryPort) {}

  async reserve(options: {
    request: CanonicalIntakeRequest;
    payloadHmac: PayloadHmacResult;
    configuration: SubmissionIngressConfiguration;
    now?: string;
  }): Promise<IntakeReservation> {
    const now = options.now ?? new Date().toISOString();
    const identity = this.identityService.resolveIdentity(options.request);
    let matches = await this.repository.findByAnyIdentity(identity);

    if (matches.length === 0) {
      try {
        const created = await this.repository.createReceived({
          request: options.request,
          identity,
          payloadHmac: options.payloadHmac,
          release: options.configuration.release,
          now,
        });
        return { intakeRun: created, outcome: "created_received" };
      } catch (cause) {
        matches = await this.repository.findByAnyIdentity(identity);
        if (matches.length === 0) {
          throw new IngressError({
            kind: "retryable",
            safeCode: "intake_run_reservation_failed",
            message: "The intake identity could not be reserved.",
            httpStatus: 503,
            cause,
          });
        }
      }
    }

    if (matches.length !== 1 || !identityMatches(matches[0], options.request)) {
      throw new IngressError({
        kind: "conflict",
        safeCode: "idempotency_identity_conflict",
        message:
          "Submission UUID, source event, and source record do not identify the same intake run.",
        httpStatus: 409,
      });
    }

    const existing = matches[0];
    if (
      existing.configurationReleaseId !== options.configuration.release.id
    ) {
      throw new IngressError({
        kind: "configuration",
        safeCode: "frozen_configuration_release_mismatch",
        message:
          "The caller must reload the configuration release frozen on the existing intake run.",
        httpStatus: 503,
      });
    }
    if (
      existing.acceptedPayloadHmac !== options.payloadHmac.hmacHex ||
      existing.payloadHmacKeyVersion !== options.payloadHmac.keyVersion
    ) {
      await this.repository.recordPayloadConflict({
        intakeRunId: existing.id,
        receivedPayloadHmac: options.payloadHmac,
        now,
      });
      throw new IngressError({
        kind: "conflict",
        safeCode: "idempotency_payload_conflict",
        message:
          "The same source identity was received with different payload content.",
        httpStatus: 409,
      });
    }

    const redeliveryMechanism =
      options.request.technicalDelivery.mechanism === "initial_delivery"
        ? "unknown_technical_redelivery"
        : options.request.technicalDelivery.mechanism;
    const redeliveryCause =
      options.request.technicalDelivery.mechanism === "initial_delivery"
        ? "repeated_identity_marked_initial_delivery"
        : options.request.technicalDelivery.causeCode;

    await this.repository.recordTechnicalRedelivery({
      intakeRunId: existing.id,
      payloadHmac: options.payloadHmac,
      mechanism: redeliveryMechanism,
      causeCode: redeliveryCause,
      now,
    });

    if (existing.intakeStatus === "succeeded") {
      return { intakeRun: existing, outcome: "duplicate_skipped" };
    }
    if (
      existing.intakeStatus === "failed_terminal" ||
      existing.intakeStatus === "cancelled"
    ) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "intake_run_not_retryable",
        message: "The existing intake run cannot be retried automatically.",
        httpStatus: 409,
      });
    }
    if (existing.attemptCount >= options.configuration.maxAttempts) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "intake_attempts_exhausted",
        message: "The existing intake run exhausted its configured attempts.",
        httpStatus: 409,
      });
    }
    if (existing.intakeStatus === "failed_retryable") {
      return { intakeRun: existing, outcome: "retry_eligible" };
    }
    if (
      (existing.intakeStatus === "resolving_resume_text" ||
        existing.intakeStatus === "persisting_raw") &&
      (existing.lastAttemptStartedAt ?? existing.updatedAt) <=
        staleCutoff(now, options.configuration.activeStaleSeconds)
    ) {
      return { intakeRun: existing, outcome: "stale_takeover_eligible" };
    }
    return { intakeRun: existing, outcome: "existing_in_progress" };
  }
}
