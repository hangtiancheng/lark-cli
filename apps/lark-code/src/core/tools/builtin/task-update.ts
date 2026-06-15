// TaskUpdateTool: update task status or dependencies
import type { BaseTool, ToolResult } from "../base.js";
import { toolError, toolSuccess } from "../base.js";
import type { TaskManager } from "../../task/manager.js";

export class TaskUpdateTool implements BaseTool {
  readonly name = "task_update";
  readonly description =
    "Update a task's status or dependency list. " +
    "Set status to 'in_progress' when starting work on a task, " +
    "'completed' when finished (automatically clears it from other tasks' blocked_by). " +
    "Returns the updated task as JSON.";
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      task_id: {
        type: "integer",
        description: "ID of the task to update.",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed"],
        description: "New status for the task.",
      },
      add_blocked_by: {
        type: "array",
        items: { type: "integer" },
        description: "Task IDs to add to blocked_by.",
      },
      remove_blocked_by: {
        type: "array",
        items: { type: "integer" },
        description: "Task IDs to remove from blocked_by.",
      },
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
      const statusRaw = params["status"];
      const status =
        statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed"
          ? statusRaw
          : undefined;

      const addRaw = params["add_blocked_by"];
      const addBlocked = Array.isArray(addRaw) ? addRaw.map((x) => Number(String(x))) : undefined;

      const removeRaw = params["remove_blocked_by"];
      const removeBlocked = Array.isArray(removeRaw)
        ? removeRaw.map((x) => Number(String(x)))
        : undefined;

      const task = this._manager.update(taskId, {
        ...(status !== undefined ? { status } : {}),
        ...(addBlocked !== undefined ? { addBlockedBy: addBlocked } : {}),
        ...(removeBlocked !== undefined ? { removeBlockedBy: removeBlocked } : {}),
      });
      return Promise.resolve(toolSuccess(JSON.stringify(task)));
    } catch (e) {
      return Promise.resolve(toolError(String(e), "runtime_error"));
    }
  }
}
