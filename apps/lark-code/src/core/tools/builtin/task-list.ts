// TaskListTool: list all tasks with status and dependencies
import type { BaseTool, ToolResult } from "../base.js";
import { toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";

export class TaskListTool implements BaseTool {
  readonly name = "task_list";
  readonly description =
    "List all tasks with their current status and blocking dependencies. " +
    "Use this to check what work remains and what can be started next.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {},
    required: [],
  };

  private _manager: TaskManager;

  constructor(manager: TaskManager) {
    this._manager = manager;
  }

  invoke(_params: Record<string, unknown>): Promise<ToolResult> {
    return Promise.resolve(toolSuccess(this._manager.formatList()));
  }
}
