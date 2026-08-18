export interface ConfigurationReleaseIdentity {
  id: number;
  key: string;
  version: number;
}

export interface SubmissionIngressConfiguration {
  release: ConfigurationReleaseIdentity;
  parserTimeoutMs: number;
  activeStaleSeconds: number;
  maxAttempts: number;
  maxResumeFileSizeBytes: number;
  outboxMaxDeliveryAttempts: number;
}

export const REQUIRED_SUBMISSION_INGRESS_KEYS = [
  "parser_timeout_ms",
  "active_stale_seconds",
  "max_attempts",
  "max_resume_file_size_bytes",
] as const;

export type RequiredSubmissionIngressKey =
  (typeof REQUIRED_SUBMISSION_INGRESS_KEYS)[number];

export const REQUIRED_OUTBOX_KEYS = ["max_delivery_attempts"] as const;
export type RequiredOutboxKey = (typeof REQUIRED_OUTBOX_KEYS)[number];
