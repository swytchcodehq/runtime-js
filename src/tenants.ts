import { runCli } from "./cli.js";
import { SwytchcodeError } from "./errors.js";

/** Who a connection belongs to: one end user (tenant) of your app, for one provider. */
export interface TenantOptions {
  /** Provider slug, as in `swytchcode auth connect <provider>` (e.g. "google"). */
  provider: string;
  /** Your own id for the end user, taken from your server's session, never from the browser. */
  tenantId: string;
  /** Working directory of the Swytchcode project. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables merged with `process.env`. */
  env?: Record<string, string>;
}

/** Result of `connect()`. */
export interface ConnectResult {
  /** Link the end user opens (in a popup, from their click) to connect their account. */
  url: string;
  connectedAccountUuid: string;
}

function tenantArgs(o: TenantOptions): string[] {
  const provider = o.provider?.trim();
  const tenantId = o.tenantId?.trim();
  if (!provider) throw new SwytchcodeError("provider must be a non-empty string");
  // An empty tenant id would act on the developer's own account.
  if (!tenantId) throw new SwytchcodeError("tenantId must be a non-empty string");
  return [provider, "--tenant", tenantId];
}

/**
 * Start an OAuth connection for one end user and return the link they open. The
 * account is ready once they finish in the popup; the first `exec()` with this
 * `tenantId` picks it up. The provider app used (Swytchcode's or your own) is the
 * one you chose with `swytchcode auth connect`.
 */
export function connect(o: TenantOptions): ConnectResult {
  const out = runCli(["auth", "connect", ...tenantArgs(o), "--json"], { cwd: o.cwd, env: o.env });
  if (!out || typeof out.authorization_url !== "string" || !out.authorization_url) {
    throw new SwytchcodeError(
      `${o.provider} does not connect with OAuth; collect the end user's key in your app and save it with saveKey()`,
      out
    );
  }
  return { url: out.authorization_url, connectedAccountUuid: out.connected_account_uuid ?? "" };
}

/**
 * Save an end user's API key for a provider that uses keys. The key is stored
 * encrypted on this machine only and never sent to Swytchcode; the end user is
 * recorded (without the key) toward your plan's end-user limit, so this needs a
 * login or API key, and at the limit it throws and nothing is saved.
 */
export function saveKey(o: TenantOptions & { key: string }): void {
  const key = o.key?.trim();
  if (!key) throw new SwytchcodeError("key must be a non-empty string");
  const out = runCli(["auth", "connect", ...tenantArgs(o), "--json"], { cwd: o.cwd, env: o.env, input: key + "\n" });
  if (!out || out.stored !== "local") {
    throw new SwytchcodeError(`${o.provider} does not use an API key; use connect() instead`, out);
  }
}

/**
 * Save an end user's credentials for a provider whose requests are signed (crypto
 * exchanges): several fields, such as `{ api_key, secret_key, passphrase }`, named
 * as the provider's signing recipe names them (`swytchcode info` shows the auth
 * block). They are stored encrypted on this machine only, never sent to
 * Swytchcode; the CLI signs each of this end user's requests with them. Like
 * `saveKey()`, this counts the end user toward your plan's end-user limit.
 */
export function saveCredentials(o: TenantOptions & { credentials: Record<string, string> }): void {
  const creds = o.credentials;
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) {
    throw new SwytchcodeError("credentials must be an object of field names to values");
  }
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(creds)) {
    if (typeof value !== "string") throw new SwytchcodeError(`credential ${name} must be a string`);
    if (value.trim()) fields[name] = value.trim();
  }
  if (Object.keys(fields).length === 0) throw new SwytchcodeError("credentials must not be empty");
  // One JSON line on stdin: the values never appear in the process arguments.
  const out = runCli(["auth", "connect", ...tenantArgs(o), "--json"], {
    cwd: o.cwd,
    env: o.env,
    input: JSON.stringify(fields) + "\n",
  });
  if (!out || out.stored !== "local" || out.auth_type !== "request_signature") {
    throw new SwytchcodeError(`${o.provider} does not use signed requests; use saveKey() or connect() instead`, out);
  }
}

/** Remove one end user's account for a provider, on this machine and on Swytchcode. */
export function disconnect(o: TenantOptions): void {
  runCli(["auth", "disconnect", ...tenantArgs(o)], { cwd: o.cwd, env: o.env, json: false });
}
