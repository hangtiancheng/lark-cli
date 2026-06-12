// TaskCreateTool: create a new tracked task
import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";

export class TaskCreateTool implements BaseTool {
  readonly name = "task_create";
  readonly description =
    "Create a new task to track a unit of work. " +
    "Use this to break down a complex goal into smaller, trackable steps. " +
    "Returns the created task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      subject: { type: "string", description: "Short title for the task." },
      description: {
        type: "string",
        description: "Optional longer description of what needs to be done.",
      },
      blocked_by: {
        type: "array",
        items: { type: "integer" },
        description: "IDs of tasks that must be completed before this one.",
      },
    },
    required: ["subject"],
  };

  private _manager: TaskManager;

  constructor(manager: TaskManager) {
    this._manager = manager;
  }

  invoke(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const subject = String(params["subject"]);
      const descRaw = params["description"];
      const description = typeof descRaw === "string" ? descRaw : "";
      const blockedByRaw = params["blocked_by"];
      const blockedBy = Array.isArray(blockedByRaw)
        ? blockedByRaw.map((x) => Number(String(x)))
        : [];

      const task = this._manager.create(subject, description, blockedBy);
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
