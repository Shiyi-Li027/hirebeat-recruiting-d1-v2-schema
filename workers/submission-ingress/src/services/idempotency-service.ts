import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";

export interface IdempotencyIdentity {
  submissionUuid: string;
  sourceSystem: string;
  sourceRecordId: string;
  sourceEventKey: string;
}

export interface IdempotencyService {
  resolveIdentity(request: CanonicalIntakeRequest): IdempotencyIdentity;
}

export class DefaultIdempotencyService implements IdempotencyService {
  resolveIdentity(request: CanonicalIntakeRequest): IdempotencyIdentity {
    return Object.freeze({
      submissionUuid: request.source.submissionUuid,
      sourceSystem: request.source.sourceSystem,
      sourceRecordId: request.source.sourceRecordId,
      sourceEventKey: request.source.sourceEventKey,
    });
  }
}
