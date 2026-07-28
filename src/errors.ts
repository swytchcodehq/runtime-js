/**
 * Structured detail parsed from the CLI's classified JSON error (always written to
 * stderr as JSON regardless of --json/--raw output mode). Present only when the CLI
 * exited non-zero with a recognizable classified error; undefined for spawn errors,
 * signals, or CLI versions that predate this format.
 */
export interface SwytchcodeErrorDetails {
  category?: string;
  retryable?: boolean;
  suggestedAction?: string;
  docsUrl?: string;
}

/**
 * Thrown when `exec()` fails: spawn error, non-zero exit, signal, or invalid JSON output.
 */
export class SwytchcodeError extends Error {
  public readonly cause?: unknown;
  public readonly details?: SwytchcodeErrorDetails;

  constructor(message: string, cause?: unknown, details?: SwytchcodeErrorDetails) {
    super(message);
    this.name = "SwytchcodeError";
    this.cause = cause;
    this.details = details;
    Object.setPrototypeOf(this, SwytchcodeError.prototype);
  }
}

/**
 * Type guard for SwytchcodeError.
 */
export function isSwytchcodeError(e: unknown): e is SwytchcodeError {
  return e instanceof SwytchcodeError;
}
