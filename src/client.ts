import { exec } from "./exec.js";
import * as discover from "./discover.js";
import * as manage from "./manage.js";
import { simplify } from "./schema.js";
import { Provider, Tool } from "./providers/base.js";
import type { ExecOptions } from "./types.js";
import { SwytchcodeError } from "./errors.js";
import * as crypto from "node:crypto";

const MAX_TOOL_NAME_LEN = 64; // OpenAI and Anthropic strict limit

function makeAlias(cid: string, taken: Map<string, string>): string {
  const base = cid.replace(/[^a-zA-Z0-9_-]/g, "_");
  const existing = taken.get(base);
  const needsHash = base.length > MAX_TOOL_NAME_LEN || (existing && existing !== cid);
  if (!needsHash) return base;
  
  const h = crypto.createHash('sha1').update(cid).digest('hex').slice(0, 6);
  const keep = MAX_TOOL_NAME_LEN - 1 - h.length;
  return base.slice(0, keep) + "_" + h;
}

/**
 * Recursively drop keys whose value is null/undefined or an empty string ("").
 * With "expose all fields", agents often fill unused optional fields with "",
 * which APIs like Stripe reject ("empty values are an attempt to unset").
 * Only null/undefined/"" are dropped — 0, false, [], {} are preserved.
 */
function stripEmpty(v: any): any {
  if (Array.isArray(v)) return v.map(stripEmpty);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === null || val === undefined || val === "") continue;
      out[k] = stripEmpty(val);
    }
    return out;
  }
  return v;
}

/**
 * Case-insensitive match of a toolkit name against an integration string.
 * integration has shape "ProjectDisplayName.library_slug@version"
 * (e.g. "GitHub.github@1.1.4"). Compares against both project name and
 * library slug so toolkits: ["github"] matches regardless of casing.
 */
function toolkitMatches(toolkit: string, integration: string): boolean {
  const tkl = toolkit.toLowerCase();
  const atIdx = integration.indexOf("@");
  const prefix = atIdx !== -1 ? integration.slice(0, atIdx) : integration;
  const dotIdx = prefix.indexOf(".");
  const project = prefix.slice(0, dotIdx !== -1 ? dotIdx : prefix.length).toLowerCase();
  const lib = dotIdx !== -1 ? prefix.slice(dotIdx + 1).toLowerCase() : "";
  return tkl === project || tkl === lib || tkl === prefix.toLowerCase();
}



/**
 * Route flat args into body/params based on LOCATION metadata from wrekenfile.
 */
function splitByLocation(inputs: any, flatArgs: Record<string, any>): Record<string, any> {
  const body: Record<string, any> = {};
  const params: Record<string, any> = {};
  const locations: Record<string, string> = {};

  if (Array.isArray(inputs)) {
    for (const item of inputs) {
      if (item && typeof item === "object") {
        for (const [name, spec] of Object.entries(item)) {
          if (spec && typeof spec === "object") {
            const loc = ((spec as any).LOCATION || (spec as any).location || "body").toLowerCase();
            locations[name] = loc;
          }
        }
      }
    }
  } else if (inputs && typeof inputs === "object" && inputs.properties && typeof inputs.properties === "object") {
    for (const [name, spec] of Object.entries(inputs.properties)) {
      if (spec && typeof spec === "object") {
        const loc = ((spec as any).LOCATION || (spec as any).location || "body").toLowerCase();
        locations[name] = loc;
      }
    }
  }

  for (const [k, v] of Object.entries(flatArgs)) {
    const loc = locations[k] || "body";
    if (loc === "path" || loc === "query") {
      params[k] = v;
    } else {
      body[k] = v;
    }
  }

  const result: Record<string, any> = {};
  if (Object.keys(body).length > 0) result.body = body;
  if (Object.keys(params).length > 0) result.params = params;
  return result;
}

class Tools {
  // Maps a sanitized tool name (dots -> underscores) back to its canonical ID,
  // populated as tools are built. Used to reverse names in handleToolCalls
  // without a lossy "_"->"." replace.
  private _nameToId = new Map<string, string>();
  private _idToInputs = new Map<string, any>();
  constructor(private c: Swytchcode) {}

  async get(o: { toolkits?: string[]; tools?: string[]; search?: string } = {}) {
    // Sort canonical IDs lexicographically before alias assignment.
    // This ensures deterministic assignment order across runs, guaranteeing the
    // same canonical ID always receives the exact same alias (and same hash if colliding).
    const ids = this._ids(o).sort();
    const neutral = ids.map((cid) => this._tool(cid));
    return this.c.provider ? await this.c.provider.formatTools(neutral) : neutral;
  }

  execute(canonical_id: string, args: Record<string, any> = {}, options: ExecOptions & { _rawInputs?: any } = {}): Promise<any> {
    let finalArgs = { ...args };
    
    if (!("body" in finalArgs) && !("params" in finalArgs)) {
      if (options._rawInputs) {
        finalArgs = splitByLocation(options._rawInputs, finalArgs);
      } else {
        finalArgs = { body: finalArgs };
      }
    }
    
    // Drop empty optional fields (null/undefined/"") so values
    // an agent over-filled don't reach the API (e.g. Stripe rejects customer="").
    if (finalArgs.body && typeof finalArgs.body === "object") {
      finalArgs.body = stripEmpty(finalArgs.body);
    }
    if (finalArgs.params && typeof finalArgs.params === "object") {
      finalArgs.params = stripEmpty(finalArgs.params);
    }
    
    // A client bound to one end user runs every tool for that user unless the
    // call names another one itself.
    if (this.c.tenantId !== undefined && options.tenantId === undefined) {
      options = { ...options, tenantId: this.c.tenantId, tenantLabel: options.tenantLabel ?? this.c.tenantLabel };
    }
    // Forward exec options (dryRun, raw, allowRaw, cwd, env, tenantId, tenantLabel) to the CLI.
    return exec(canonical_id, finalArgs, options);
  }

  private _tool(cid: string): Tool {
    const m = discover.info(cid);
    if (!m || !m.inputs) {
      throw new Error(`Tool discovery failed for ${cid}: Invalid or missing Wrekenfile schema`);
    }

    const name = makeAlias(cid, this._nameToId);
    
    this._nameToId.set(name, cid);
    const rawInputs = m.inputs;
    this._idToInputs.set(cid, rawInputs);
    return {
      canonicalId: cid,
      name,
      description: m.summary || m.description || cid,
      inputSchema: simplify(rawInputs),
      execute: (a) => this.execute(cid, a, { _rawInputs: rawInputs })
    };
  }

  /** Reverse a sanitized tool name to its canonical ID (populated by get()). */
  nameToId(name: string): string {
    return this._nameToId.get(name) ?? name.replace(/_/g, ".");
  }
  
  getInputs(cid: string): any {
    return this._idToInputs.get(cid);
  }

  private _ids(o: { toolkits?: string[]; tools?: string[]; search?: string }): string[] {
    if (o.tools) return o.tools;
    if (o.search) return discover.search(o.search).map((t:any) => t.canonical_id);
    if (o.toolkits) {
      const res = manage.listTools("tooling");
      const found = new Set<string>();
      for (const m of (res.methods || [])) {
        const integration = m.integration || "";
        const cid = m.canonical_id;
        if (!cid) continue;
        if (o.toolkits.some((tk) => toolkitMatches(tk, integration))) {
          found.add(cid);
        }
      }
      return [...found];
    }
    return [];
  }
}

/** Options for a Swytchcode client. */
export interface SwytchcodeOptions {
  /**
   * Bind the client to one end user (tenant) of your app: every tool it runs,
   * including those an AI agent picks, uses that user's connected accounts and
   * never yours. Create one client per request, from your server's session.
   */
  tenantId?: string;
  /**
   * How approvers see that end user, for example `"Alice Smith (alice@acme.com)"`.
   * Needs `tenantId`.
   */
  tenantLabel?: string;
}

export class Swytchcode {
  tools: Tools;
  readonly tenantId?: string;
  readonly tenantLabel?: string;
  constructor(public provider?: Provider, options: SwytchcodeOptions = {}) {
    if (options.tenantId !== undefined) {
      const tenantId = options.tenantId.trim();
      // An empty id would quietly run the agent's tools on your own account.
      if (!tenantId) throw new SwytchcodeError("tenantId must be a non-empty string when set");
      this.tenantId = tenantId;
    }
    const tenantLabel = options.tenantLabel?.trim();
    if (tenantLabel) {
      if (!this.tenantId) throw new SwytchcodeError("tenantLabel needs tenantId");
      this.tenantLabel = tenantLabel;
    }
    this.tools = new Tools(this);
  }

  /**
   * Execute the tool calls in a non-agentic (Anthropic Messages) response and
   * return tool_result blocks to send back. Mirrors the Python handle_tool_calls.
   */
  async handleToolCalls(
    response: any
  ): Promise<Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }>> {
    const results: Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }> = [];
    for (const block of (response?.content ?? [])) {
      if (block?.type === "tool_use") {
        const cid = this.tools.nameToId(block.name);
        const rawInputs = this.tools.getInputs(cid) || {};
        // Isolate failures per block: Anthropic expects a tool_result for every
        // tool_use in the turn, so one failing tool must not drop the others.
        try {
          const result = await this.tools.execute(cid, block.input ?? {}, { _rawInputs: rawInputs });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        } catch (err: any) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error executing ${cid}: ${err?.message ?? String(err)}`,
            is_error: true,
          });
        }
      }
    }
    return results;
  }
}
