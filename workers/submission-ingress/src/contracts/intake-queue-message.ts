export interface IntakeQueueMessage {
  schemaVersion: "intake-queue-message-v1" | "intake-queue-message-v2";
  submissionUuid: string;
  acceptedPayloadHmac: string;
  replayEnvelopeKey: string;
  requestId: string;
  enqueuedAt: string;
  recoveryFenceToken?: string | null;
  deliveryKind?: "initial" | "controlled_recovery";
}

export function isIntakeQueueMessage(value: unknown): value is IntakeQueueMessage {
  if (value === null || typeof value !== "object") return false;
  const message = value as Partial<IntakeQueueMessage>;
  const commonFieldsAreValid =
    (message.schemaVersion === "intake-queue-message-v1" ||
      message.schemaVersion === "intake-queue-message-v2") &&
    typeof message.submissionUuid === "string" &&
    message.submissionUuid.length > 0 &&
    typeof message.acceptedPayloadHmac === "string" &&
    /^[a-f0-9]{64}$/.test(message.acceptedPayloadHmac) &&
    typeof message.replayEnvelopeKey === "string" &&
    message.replayEnvelopeKey.length > 0 &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    typeof message.enqueuedAt === "string" &&
    !Number.isNaN(Date.parse(message.enqueuedAt));
  if (!commonFieldsAreValid) return false;

  if (message.schemaVersion === "intake-queue-message-v1") {
    return (
      message.recoveryFenceToken === undefined &&
      message.deliveryKind === undefined
    );
  }

  if (message.deliveryKind === "controlled_recovery") {
    return (
      typeof message.recoveryFenceToken === "string" &&
      message.recoveryFenceToken.length > 0
    );
  }
  return (
    message.deliveryKind === "initial" &&
    (message.recoveryFenceToken === undefined ||
      message.recoveryFenceToken === null)
  );
}
