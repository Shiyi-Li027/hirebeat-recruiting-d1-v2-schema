import { NonRetryableError } from "cloudflare:workflows";

const NON_RETRYABLE_MARKERS = [
  "invalid",
  "unsupported",
  "constraint failed",
  "configuration_missing",
  "not_configured",
  "attempt_limit_exhausted",
  "fence_invalid_or_superseded",
] as const;

export function isNonRetryableWorkflowError(error: unknown): boolean {
  return error instanceof NonRetryableError || error instanceof Error &&
    error.name === "NonRetryableError";
}

export function classifyWorkflowError(error: unknown): "terminal" | "transient" {
  if (isNonRetryableWorkflowError(error)) return "terminal";
  const text = error instanceof Error
    ? `${error.name}:${error.message}`.toLowerCase()
    : String(error).toLowerCase();
  return NON_RETRYABLE_MARKERS.some((marker) => text.includes(marker))
    ? "terminal"
    : "transient";
}

export function toWorkflowThrowable(error: unknown): unknown {
  if (classifyWorkflowError(error) === "transient") return error;
  if (isNonRetryableWorkflowError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new NonRetryableError(message.slice(0, 240));
}
