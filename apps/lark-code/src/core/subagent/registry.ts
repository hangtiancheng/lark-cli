// Background task registry: track async subagent tasks with their execution context
import type { ExecutionContext } from "../context.js";

interface TaskEntry {
  promise: Promise<void>;
  context: ExecutionContext;
}

export class BackgroundTaskRegistry {
  private _tasks = new Map<string, TaskEntry>();

  register(taskId: string, promise: Promise<void>, context: ExecutionContext): void {
    this._tasks.set(taskId, { promise, context });
  }

  get(taskId: string): TaskEntry | undefined {
    return this._tasks.get(taskId);
  }

  all(): [string, TaskEntry][] {
    return [...this._tasks.entries()];
  }

  remove(taskId: string): void {
    this._tasks.delete(taskId);
  }
}
