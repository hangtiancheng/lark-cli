import type { Tool, ToolCategory, ToolContext, ToolResult, ToolSchema } from "./types.js";

export class ExitPlanModeTool implements Tool {
  name = ExitPlanModeTool.name.replace("Tool", "");
  description = `
  Exit plan mode and present the plan for user approval.
  Call this when your plan is complete and written to the plan file.
  `;
  category: ToolCategory = 'read';
  deferred = false;


  isPlanMode: (() => boolean) | null = null;
  planExists: (() => boolean) | null = null;
  schema(): ToolSchema {
    throw new Error("Method not implemented.");
  }
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    throw new Error("Method not implemented.");
  }
  
}
