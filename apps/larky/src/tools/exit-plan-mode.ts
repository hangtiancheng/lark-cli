import type {
  Tool,
  ToolCategory,
  ToolContext,
  ToolResult,
  ToolSchema,
} from "./types.js";

export class ExitPlanModeTool implements Tool {
  name = ExitPlanModeTool.name.replace("Tool", "");
  description = `
  Exit plan mode and present the plan for user approval.
  Call this when your plan is complete and written to the plan file.
  `;
  category: ToolCategory = "read";
  deferred = false;

  isPlanMode: (() => boolean) | null = null;
  planExists: (() => boolean) | null = null;
  schema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: "object",
        properties: {},
      },
    };
  }

  execute(
    _ctx: ToolContext,
    _args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (this.isPlanMode && !this.isPlanMode()) {
      return Promise.resolve({
        output:
          "You are not in plan mode. This tool is only for exiting plan mode after writing a plan.",
        isError: true,
      });
    }

    if (this.planExists && !this.planExists()) {
      return Promise.resolve({
        output:
          "No plan file found. Please write your plan to the plan file before calling ExitPlanMode.",
        isError: true,
      });
    }

    return Promise.resolve({
      output:
        "Plan mode will be exited after this turn. The user will be shown the plan approval dialog. Do not call any more tools — end your turn now.",
      isError: false,
    });
  }
}
