import { spawnSync } from "node:child_process";
import { resolveSwytchcodeBin, buildInvocation } from "./exec.js";
import { SwytchcodeError } from "./errors.js";

export function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string,string>; timeoutMs?: number; input?: string; json?: boolean } = {}
): any {
  const cmd = opts.json === false || args.includes("--json") ? args : [...args, "--json"];
  const childEnv = { ...process.env, ...opts.env };
  const bin = resolveSwytchcodeBin(opts.cwd ?? process.cwd(), childEnv);
  const inv = buildInvocation(bin, cmd);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const r = spawnSync(inv.command, inv.args, {
    cwd: opts.cwd ?? process.cwd(), env: childEnv,
    input: opts.input,
    encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
    windowsVerbatimArguments: inv.windowsVerbatimArguments,
    timeout: timeoutMs,
  });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ETIMEDOUT")
      throw new SwytchcodeError(`swytchcode command timed out after ${timeoutMs}ms`, r.error);
    throw new SwytchcodeError("Failed to spawn swytchcode; is the CLI installed?", r.error);
  }
  if (r.status !== 0) throw new SwytchcodeError((r.stderr ?? "").trim() || "command failed", r.status);
  const out = (r.stdout ?? "").trim();
  if (!out || opts.json === false) return null;
  try { return JSON.parse(out); } catch { throw new SwytchcodeError("Invalid JSON from swytchcode", out); }
}
