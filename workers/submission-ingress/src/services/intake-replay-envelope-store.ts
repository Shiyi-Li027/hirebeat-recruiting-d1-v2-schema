import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";
import { IngressError } from "../errors/ingress-error";
import { validateCanonicalIntake } from "../validation/canonical-intake-validator";

const PREFIX = "intake-replay-envelopes/v1";

export function replayEnvelopeKey(
  submissionUuid: string,
  acceptedPayloadHmac: string,
): string {
  return `${PREFIX}/${submissionUuid}/${acceptedPayloadHmac}.json`;
}

export class IntakeReplayEnvelopeStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly expectedSchemaVersion: string,
  ) {}

  async put(
    request: CanonicalIntakeRequest,
    acceptedPayloadHmac: string,
  ): Promise<string> {
    const key = replayEnvelopeKey(
      request.source.submissionUuid,
      acceptedPayloadHmac,
    );
    await this.bucket.put(key, JSON.stringify(request), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        schemaVersion: "intake-replay-envelope-v1",
        submissionUuid: request.source.submissionUuid,
        acceptedPayloadHmac,
      },
    });
    return key;
  }

  async get(key: string): Promise<CanonicalIntakeRequest> {
    if (!key.startsWith(`${PREFIX}/`)) {
      throw new IngressError({
        kind: "terminal",
        safeCode: "invalid_replay_envelope_key",
        message: "The queued replay envelope key is invalid.",
        httpStatus: 400,
      });
    }
    const object = await this.bucket.get(key);
    if (!object) {
      throw new IngressError({
        kind: "retryable",
        safeCode: "replay_envelope_not_found",
        message: "The queued intake replay envelope is not available yet.",
        httpStatus: 503,
      });
    }
    try {
      return validateCanonicalIntake(
        JSON.parse(await object.text()),
        this.expectedSchemaVersion,
      );
    } catch (cause) {
      if (cause instanceof IngressError) throw cause;
      throw new IngressError({
        kind: "terminal",
        safeCode: "invalid_replay_envelope",
        message: "The queued intake replay envelope is invalid.",
        httpStatus: 400,
        cause,
      });
    }
  }
}
