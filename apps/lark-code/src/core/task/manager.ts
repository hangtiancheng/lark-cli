// TaskManager: file-based task CRUD with dependency tracking
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Task } from "./model.js";
import { isRecord } from "../bus/envelope.js";

let _nextId = 1;

function generateId(): string {
  return String(_nextId++);
}

function now(): string {
  return new Date().toISOString();
}

export class TaskManager {
  private _dir: string;
  private _tasks = new Map<string, Task>();

  constructor(dir: string) {
    this._dir = dir;
    mkdirSync(this._dir, { recursive: true });
    this._loadAll();
  }

  // Create a new task with optional blocked_by dependencies
  create(subject: string, description = "", blockedBy: number[] = []): Task {
    const id = generateId();
    const ts = now();

    // Validate blocked_by references
    for (const depId of blockedBy) {
      if (!this._tasks.has(String(depId))) {
        throw new Error(`blocked_by task ${String(depId)} does not exist`);
      }
    }

    const task: Task = {
      id,
      subject,
      description,
      status: "pending",
      blockedBy: blockedBy.map(String),
      blocks: [],
      createdAt: ts,
      updatedAt: ts,
    };
    this._tasks.set(id, task);

    // Update reverse links: each dependency now blocks this task
    for (const depId of blockedBy) {
      const dep = this._tasks.get(String(depId));
      if (dep) {
        dep.blocks.push(id);
        this._save(dep);
      }
    }

    this._save(task);
    return task;
  }

  // Update task status, subject, description, or dependency lists
  update(
    id: string | number,
    updates: {
      subject?: string;
      description?: string;
      status?: string;
      addBlockedBy?: number[];
      removeBlockedBy?: number[];
    },
  ): Task | null {
    const taskId = String(id);
    const task = this._tasks.get(taskId);
    if (!task) return null;

    if (updates.subject !== undefined) task.subject = updates.subject;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.status !== undefined) {
      const s = updates.status;
      if (s === "pending" || s === "in_progress" || s === "completed") {
        task.status = s;
      }
    }

    // Add blocked_by dependencies
    if (updates.addBlockedBy) {
      for (const depId of updates.addBlockedBy) {
        const depStr = String(depId);
        if (!task.blockedBy.includes(depStr)) {
          task.blockedBy.push(depStr);
          const dep = this._tasks.get(depStr);
          if (dep && !dep.blocks.includes(taskId)) {
            dep.blocks.push(taskId);
            this._save(dep);
          }
        }
      }
    }

    // Remove blocked_by dependencies
    if (updates.removeBlockedBy) {
      const removeSet = new Set(updates.removeBlockedBy.map(String));
      task.blockedBy = task.blockedBy.filter((b) => !removeSet.has(b));
      for (const depId of updates.removeBlockedBy) {
        const dep = this._tasks.get(String(depId));
        if (dep) {
          dep.blocks = dep.blocks.filter((b) => b !== taskId);
          this._save(dep);
        }
      }
    }

    // When completing, auto-clear this task from other tasks' blocked_by
    if (updates.status === "completed") {
      for (const other of this._tasks.values()) {
        if (other.blockedBy.includes(taskId)) {
          other.blockedBy = other.blockedBy.filter((b) => b !== taskId);
          this._save(other);
        }
      }
      task.blocks = [];
    }

    task.updatedAt = now();
    this._save(task);
    return task;
  }

  // Get a task by ID
  get(id: string | number): Task | null {
    return this._tasks.get(String(id)) ?? null;
  }

  // List all tasks
  list(): Task[] {
    return Array.from(this._tasks.values());
  }

  // Format all tasks as a human-readable summary string
  formatList(): string {
    const tasks = this.list();
    if (tasks.length === 0) return "No tasks.";

    const lines: string[] = [];
    for (const t of tasks) {
      const parts = [`#${t.id} [${t.status}] ${t.subject}`];
      if (t.blockedBy.length > 0) {
        parts.push(`(blocked by: ${t.blockedBy.join(", ")})`);
      }
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }

  private _save(task: Task): void {
    const filePath = path.join(this._dir, `task_${task.id}.json`);
    writeFileSync(filePath, JSON.stringify(task, null, 2) + "\n", "utf-8");
  }

  private _loadAll(): void {
    if (!existsSync(this._dir)) return;
    for (const file of readdirSync(this._dir)) {
      if (!file.startsWith("task_") || !file.endsWith(".json")) continue;
      try {
        const parsed: unknown = JSON.parse(readFileSync(path.join(this._dir, file), "utf-8"));
        if (!isRecord(parsed)) continue;
        const data = parsed;
        const id = typeof data["id"] === "string" ? data["id"] : "";
        if (!id) continue;
        const subject = typeof data["subject"] === "string" ? data["subject"] : "";
        const description = typeof data["description"] === "string" ? data["description"] : "";
        const statusRaw = data["status"];
        const status =
          statusRaw === "pending" || statusRaw === "in_progress" || statusRaw === "completed"
            ? statusRaw
            : "pending";
        const createdAt = typeof data["createdAt"] === "string" ? data["createdAt"] : "";
        const updatedAt = typeof data["updatedAt"] === "string" ? data["updatedAt"] : "";
        const blockedByRaw = data["blockedBy"];
        const blocksRaw = data["blocks"];
        this._tasks.set(id, {
          id,
          subject,
          description,
          status,
          blockedBy: Array.isArray(blockedByRaw) ? blockedByRaw.map(String) : [],
          blocks: Array.isArray(blocksRaw) ? blocksRaw.map(String) : [],
          createdAt,
          updatedAt,
        });
        const numId = Number(id);
        if (numId >= _nextId) _nextId = numId + 1;
      } catch {
        continue;
      }
    }
  }
}
