// TaskGetTool: retrieve full task details by ID
import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";

export class TaskGetTool implements BaseTool {
  readonly name = "task_get";
  readonly description = "Get full details of a task by its integer ID. Returns the task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      task_id: { type: "integer", description: "ID of the task to retrieve." },
    },
    required: ["task_id"],
  };

  private _manager: TaskManager;

  constructor(manager: TaskManager) {
    this._manager = manager;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const taskId = Number(String(params["task_id"]));
      const task = this._manager.get(taskId);
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
