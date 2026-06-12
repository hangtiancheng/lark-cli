import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TaskCreateTool } from "../../src/core/tools/builtin/task-create.js";
import { TaskGetTool } from "../../src/core/tools/builtin/task-get.js";
import { TaskListTool } from "../../src/core/tools/builtin/task-list.js";
import { TaskUpdateTool } from "../../src/core/tools/builtin/task-update.js";
import { TaskManager } from "../../src/core/task/manager.js";
import { isRecord } from "../../src/core/bus/envelope.js";

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "lark-test-"));
}

function parseJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error("expected object");
  return parsed;
}

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function strArr(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  return Array.isArray(v) ? v.map(String) : [];
}

describe("Task Builtin Tools", () => {
  // Feature: TaskCreateTool creates a new task
  // Design: Invoke with subject, verify success and task data
  test("task_create creates task", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const tool = new TaskCreateTool(mgr);

      expect(tool.name).toBe("task_create");

      const result = await tool.invoke({
        subject: "Fix bug",
        description: "Fix the login bug",
      });
      expect(result.isError).toBe(false);

      const task = parseJson(result.content);
      expect(str(task, "subject")).toBe("Fix bug");
      expect(str(task, "description")).toBe("Fix the login bug");
      expect(str(task, "status")).toBe("pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskCreateTool creates task with blocked_by
  // Design: Create two tasks, second blocked by first
  test("task_create with blocked_by", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const tool = new TaskCreateTool(mgr);

      const r1 = await tool.invoke({ subject: "First" });
      const t1 = parseJson(r1.content);

      const r2 = await tool.invoke({
        subject: "Second",
        blocked_by: [Number(str(t1, "id"))],
      });
      const t2 = parseJson(r2.content);
      expect(strArr(t2, "blockedBy")).toContain(str(t1, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskGetTool retrieves task by ID
  // Design: Create a task, then get it by ID
  test("task_get retrieves task", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const getTool = new TaskGetTool(mgr);

      expect(getTool.name).toBe("task_get");

      const created = await createTool.invoke({ subject: "Test" });
      const task = parseJson(created.content);

      const result = await getTool.invoke({ task_id: Number(str(task, "id")) });
      expect(result.isError).toBe(false);

      const retrieved = parseJson(result.content);
      expect(str(retrieved, "subject")).toBe("Test");
      expect(str(retrieved, "id")).toBe(str(task, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskListTool returns formatted task list
  // Design: Create tasks, list them, verify format
  test("task_list returns formatted output", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const listTool = new TaskListTool(mgr);

      expect(listTool.name).toBe("task_list");

      await createTool.invoke({ subject: "Task A" });
      await createTool.invoke({ subject: "Task B" });

      const result = await listTool.invoke({});
      expect(result.isError).toBe(false);
      expect(result.content).toContain("Task A");
      expect(result.content).toContain("Task B");
      expect(result.content).toContain("[pending]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskListTool returns 'No tasks.' when empty
  // Design: List with no tasks, verify empty message
  test("task_list returns empty message when no tasks", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const listTool = new TaskListTool(mgr);

      const result = await listTool.invoke({});
      expect(result.content).toBe("No tasks.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskUpdateTool updates task status
  // Design: Create task, update to in_progress, verify change
  test("task_update changes status", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      expect(updateTool.name).toBe("task_update");

      const created = await createTool.invoke({ subject: "Work" });
      const task = parseJson(created.content);

      const result = await updateTool.invoke({
        task_id: Number(str(task, "id")),
        status: "in_progress",
      });
      expect(result.isError).toBe(false);

      const updated = parseJson(result.content);
      expect(str(updated, "status")).toBe("in_progress");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Feature: TaskUpdateTool completing task clears dependencies
  // Design: Create two tasks with dependency, complete first, verify second unblocked
  test("task_update completing clears blocked_by", async () => {
    const dir = tmpDir();
    try {
      const mgr = new TaskManager(path.join(dir, "tasks"));
      const createTool = new TaskCreateTool(mgr);
      const updateTool = new TaskUpdateTool(mgr);

      const r1 = await createTool.invoke({ subject: "First" });
      const t1 = parseJson(r1.content);

      const r2 = await createTool.invoke({
        subject: "Second",
        blocked_by: [Number(str(t1, "id"))],
      });
      const t2 = parseJson(r2.content);
      expect(strArr(t2, "blockedBy")).toContain(str(t1, "id"));

      await updateTool.invoke({
        task_id: Number(str(t1, "id")),
        status: "completed",
      });

      const getTool = new TaskGetTool(mgr);
      const r3 = await getTool.invoke({ task_id: Number(str(t2, "id")) });
      const t2After = parseJson(r3.content);
      expect(strArr(t2After, "blockedBy")).not.toContain(str(t1, "id"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
