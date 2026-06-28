import type { ToolRegistry } from "./registry.js";
import {
  type Tool,
  type ToolCategory,
  type ToolContext,
  type ToolResult,
  type ToolSchema,
} from "./types.js";
import { intArg, strArg } from "../utils/index.js";

export class ToolSearchTool implements Tool {
  name = "ToolSearch";
  description = "Search for and load deferred tools by name or keyword.";
  category: ToolCategory = "read";
  system = true;

  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  schema(): ToolSchema {
    const inputSchema = {
      type: "object" as const,
      properties: {
        query: {
          type: "string" as const,
          description:
            'Search query. Use "select:name1,name2" to load specific tools by name, or keywords to search.',
        },
        max_results: {
          type: "integer" as const,
          description: "Max results to return",
          default: 5,
        },
      },
      required: ["query"],
    };
    return {
      name: this.name,
      description: this.description,
      input_schema: inputSchema,
    };
  }

  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = strArg(args, "query");
    const maxResults = intArg(args, "max_results", 5);

    if (!query) {
      return Promise.resolve({
        output: "Error: query is required",
        isError: true,
      });
    }
    // Handle "select:name1,name2" syntax
    if (query.startsWith("select:")) {
      const names = query
        .slice("select:".length)
        .split(",")
        .map((n) => n.trim());
      const tools = this.registry.findDeferredByNames(names);
      for (const t of tools) {
        this.registry.markDiscovered(t.name);
      }
      if (tools.length === 0) {
        return Promise.resolve({
          output: `No deferred tools found matching: ${names.join(", ")}`,
          isError: false,
        });
      }
      const schemas = tools.map((t) => JSON.stringify(t.schema(), null, 2));
      return Promise.resolve({
        output: schemas.join("\n\n"),
        isError: false,
      });
    }

    // Keyword search
    const tools = this.registry.searchDeferred(query, maxResults);
    if (tools.length === 0) {
      return Promise.resolve({
        output: "No deferred tools matched the query.",
        isError: false,
      });
    }

    const lines = tools.map((t) => `- ${t.name}: ${t.description.slice(0, 100)}`);
    return Promise.resolve({
      output: lines.join("\n"),
      isError: false,
    });
  }
}
