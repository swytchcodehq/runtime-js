/** Output mode: JSON (default), raw string, or stream (not supported in this runtime). */
export type OutputMode = "json" | "raw" | "stream";

export interface ExecOptions {
  /** Working directory for the swytchcode process. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables merged with `process.env`. */
  env?: Record<string, string>;
  /**
   * Output mode. Default is `"json"` (stdout must be valid JSON; parse failure throws).
   * Use `"raw"` to get stdout as a string. `"stream"` is not supported; use the CLI directly.
   */
  output?: OutputMode;
  /** If true, same as `output: "raw"`. Kept for backward compatibility. */
  raw?: boolean;
  /** If true, pass `--dry-run` to the CLI; request details are output instead of calling the server. */
  dryRun?: boolean;
  /** If true, pass `--allow-raw` to the CLI; required for executing raw methods (disabled by default in kernel). */
  allowRaw?: boolean;
  /** If true, log spawn/capture details to process.stderr (for debugging). */
  debug?: boolean;
  /**
   * Optional max time (ms) for the underlying subprocess. Unset means no timeout
   * (a real API call may legitimately be slow); set it to bound a hung CLI on the
   * agent tool-call hot path.
   */
  timeoutMs?: number;
  /**
   * Run the call for one end user (tenant) of your app, with their own connected
   * account (passes `--tenant`). Use your own id for the logged-in user, taken from
   * your server's session. The call never falls back to your own account: if this
   * user has not connected the provider, it fails with category `tenant_not_connected`.
   */
  tenantId?: string;
  /**
   * How approvers see this end user when a policy asks for human approval, for
   * example `"Alice Smith (alice@acme.com)"` (passes `--tenant-label`). Needs
   * `tenantId`. Only reaches the approval message; the approver sees the
   * `tenantId` alone without it.
   */
  tenantLabel?: string;
}

/** Result of `exec()` in JSON mode: parsed stdout. In raw mode the result is a string. */
export type ExecResult = unknown;

/**
 * Tool arguments sent to the kernel on stdin (matches `swytchcode exec` JSON stdin).
 * - `body`: Request body (object).
 * - `params`: Query/path params (object).
 * - `Authorization`: Auth header value (e.g. "Bearer token").
 * - `headers`: Additional request headers (map of header name to value).
 * - Other top-level keys are passed as query params.
 */
export interface ExecArgs {
  body?: unknown;
  params?: Record<string, string>;
  Authorization?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}
