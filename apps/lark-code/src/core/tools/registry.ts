// ToolRegistry: maps tool names to BaseTool instances
import type Anthropic from "@anthropic-ai/sdk";

import type { BaseTool } from "./base.js";

export class ToolRegistry {
  private _tools = new Map<string, BaseTool>();

  // Register a tool; same-name overwrites
  register(tool: BaseTool): void {
    this._tools.set(tool.name, tool);
  }

  // Look up tool by name; returns undefined if not found
  get(name: string): BaseTool | undefined {
    return this._tools.get(name);
  }

  // Return all tool schemas in Anthropic ToolUnion format
  toolSchemas(): Anthropic.ToolUnion[] {
    return Array.from(this._tools.values()).map(
      (tool): Anthropic.ToolUnion => ({
        name: tool.name,
        description: tool.description,
        input_schema: { ...tool.inputSchema, type: "object" },
      }),
    );
  }
}
