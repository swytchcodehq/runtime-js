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

/** Remove one end user's account for a provider, on this machine and on Swytchcode. */
export function disconnect(o: TenantOptions): void {
  runCli(["auth", "disconnect", ...tenantArgs(o)], { cwd: o.cwd, env: o.env, json: false });
}
