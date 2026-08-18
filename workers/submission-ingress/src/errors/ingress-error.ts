export type IngressErrorKind =
  | "retryable"
  | "terminal"
  | "conflict"
  | "authentication"
  | "validation"
  | "configuration"
  | "not_implemented";

export class IngressError extends Error {
  readonly kind: IngressErrorKind;
  readonly safeCode: string;
  readonly httpStatus: number;

  constructor(options: {
    kind: IngressErrorKind;
    safeCode: string;
    message: string;
    httpStatus: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "IngressError";
    this.kind = options.kind;
    this.safeCode = options.safeCode;
    this.httpStatus = options.httpStatus;
  }
}
