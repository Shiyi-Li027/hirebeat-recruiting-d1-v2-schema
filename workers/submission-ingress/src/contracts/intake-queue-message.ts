export interface IntakeQueueMessage {
  schemaVersion: "intake-queue-message-v1";
  submissionUuid: string;
  acceptedPayloadHmac: string;
  replayEnvelopeKey: string;
  requestId: string;
  enqueuedAt: string;
}

export function isIntakeQueueMessage(value: unknown): value is IntakeQueueMessage {
  if (value === null || typeof value !== "object") return false;
  const message = value as Partial<IntakeQueueMessage>;
  return (
    message.schemaVersion === "intake-queue-message-v1" &&
    typeof message.submissionUuid === "string" &&
    message.submissionUuid.length > 0 &&
    typeof message.acceptedPayloadHmac === "string" &&
    /^[a-f0-9]{64}$/.test(message.acceptedPayloadHmac) &&
    typeof message.replayEnvelopeKey === "string" &&
    message.replayEnvelopeKey.length > 0 &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    typeof message.enqueuedAt === "string"
  );
}
