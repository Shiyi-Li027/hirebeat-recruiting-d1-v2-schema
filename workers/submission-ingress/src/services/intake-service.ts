import type { CanonicalIntakeRequest } from "../contracts/canonical-intake";

export interface IntakeReceipt {
  submissionUuid: string;
  intakeRunId: number;
  rawSubmissionId: number | null;
  outboxEventId: number | null;
  outcome: "succeeded" | "duplicate_skipped" | "existing_in_progress";
}

export interface IntakeService {
  receive(request: CanonicalIntakeRequest): Promise<IntakeReceipt>;
}
