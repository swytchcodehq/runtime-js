export { exec } from "./exec.js";
export { connect, saveKey, disconnect } from "./tenants.js";
export type { ConnectResult, TenantOptions } from "./tenants.js";
export type { ExecArgs, ExecOptions, ExecResult, OutputMode } from "./types.js";
export { SwytchcodeError, isSwytchcodeError } from "./errors.js";
export { TOOL_USE_INSTRUCTIONS } from "./prompts.js";

export { Swytchcode } from "./client.js";
export type { SwytchcodeOptions } from "./client.js";
