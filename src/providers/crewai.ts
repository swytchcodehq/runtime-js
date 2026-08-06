import { Provider, Tool } from "./base.js";
import { toZod } from "../schema.js";

// crewai-ts (@0.2.0) BaseTool shape: zod schema + execute() -> ToolExecutionResult.
// The legacy `crewai` npm package is a non-functional placeholder, so crewai-ts
// is the only working TypeScript target.
export class CrewAIProvider extends Provider {
  formatTool(t: Tool) {
    const schema = toZod(t.inputSchema);
    return {
      name: t.name,
      description: t.description,
      schema,
      verbose: false,
      cacheResults: false,
      execute: async (input: Record<string, any>) => {
        try {
          return { success: true, result: await t.execute(input) };
        } catch (e: any) {
          return { success: false, result: null, error: String(e?.message ?? e) };
        }
      },
      getMetadata: () => ({ name: t.name, description: t.description, schema }),
    };
  }
}
