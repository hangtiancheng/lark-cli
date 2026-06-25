import type Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "./types.js";
import type { FunctionTool as OpenAITool } from "openai/resources/responses/responses";

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private discovered = new Set<string>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listTools(): Tool[] {
    return [...this.tools.values()];
  }

  getAllSchemas(protocol?: "anthropic"): Anthropic.Tool[];
  getAllSchemas(protocol: "openai" | "openai-compat"): OpenAITool[];
  getAllSchemas(
    protocol: "anthropic" | "openai" | "openai-compat" = "anthropic",
  ): (Anthropic.Tool | OpenAITool)[] {
    const result: (Anthropic.Tool | OpenAITool)[] = [];
    for (const tool of this.tools.values()) {
      if (tool.deferred && !this.discovered.has(tool.name)) {
        continue;
      }
      const s = tool.schema();
      if (protocol === "anthropic") {
        result.push({
          name: s.name,
          description: s.description,
          input_schema: {
            type: "object",
            properties: s.input_schema.properties,
            required: s.input_schema.required ?? [],
          },
        });
      } else {
        // openai and openai-compat both use FunctionTool shape
        result.push({
          strict: null, // Whether to enforce strict parameter validation. Default true.
          type: "function",
          name: s.name,
          description: s.description,
          parameters: s.input_schema,
        });
      }
    }
    return result;
  }

  getDeferredToolNames(): string[] {
    const names: string[] = [];
    for (const tool of this.tools.values()) {
      if (tool.deferred && !this.discovered.has(tool.name)) {
        names.push(tool.name);
      }
    }
    return names;
  }

  getDeferredTools(): Tool[] {
    return [...this.tools.values()].filter((t) => t.deferred && !this.discovered.has(t.name));
  }

  searchDeferred(query: string, maxResults = 5): Tool[] {
    const lower = query.toLowerCase();
    const matches: Tool[] = [];
    for (const tool of this.tools.values()) {
      if (!tool.deferred || this.discovered.has(tool.name)) {
        continue;
      }
      if (
        tool.name.toLowerCase().includes(lower) ||
        tool.description.toLowerCase().includes(lower)
      ) {
        matches.push(tool);
        if (matches.length >= maxResults) {
          break;
        }
      }
    }
    return matches;
  }

  findDeferredByNames(names: string[]): Tool[] {
    return names.map((n) => this.tools.get(n)).filter((t): t is Tool => t?.deferred ?? false);
  }

  markDiscovered(name: string): void {
    this.discovered.add(name);
  }

  isDiscovered(name: string): boolean {
    return this.discovered.has(name);
  }
}
