import { describe, expect, test } from "vitest";
import { TaskManager } from "../../src/core/task/manager.js";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("TaskManager", () => {
  // Feature: Verify creating a new task assigns incrementing IDs
  // Design: Create multiple tasks, confirm IDs are sequential integers as strings
  test("create assigns incrementing IDs", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task1 = manager.create("Task 1", "Description 1");
    const task2 = manager.create("Task 2", "Description 2");
    expect(Number(task2.id)).toBeGreaterThan(Number(task1.id));
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify get returns task by ID
  // Design: Create task, retrieve by ID, confirm it's the same task
  test("get returns task by ID", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const created = manager.create("Test Task", "Test Description");
    const retrieved = manager.get(created.id);
    expect(retrieved?.subject).toBe("Test Task");
    expect(retrieved?.description).toBe("Test Description");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify get returns null for non-existent task
  // Design: Query non-existent ID, confirm null is returned
  test("get returns null for non-existent task", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const retrieved = manager.get("999");
    expect(retrieved).toBeNull();
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify list returns all tasks
  // Design: Create multiple tasks, call list(), confirm all are returned
  test("list returns all tasks", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    manager.create("Task 1", "Desc 1");
    manager.create("Task 2", "Desc 2");
    manager.create("Task 3", "Desc 3");
    const tasks = manager.list();
    expect(tasks.length).toBe(3);
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify update changes task status
  // Design: Create task, update status to in_progress, confirm change persisted
  test("update changes task status", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task = manager.create("Task", "Description");
    const updated = manager.update(task.id, { status: "in_progress" });
    expect(updated?.status).toBe("in_progress");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify tasks are persisted to disk
  // Design: Create task, create new manager instance with same dir, confirm task is loaded
  test("tasks persisted to disk", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager1 = new TaskManager(dir);
    const created = manager1.create("Persisted Task", "Persisted Description");

    const manager2 = new TaskManager(dir);
    const retrieved = manager2.get(created.id);
    expect(retrieved?.subject).toBe("Persisted Task");
    rmSync(dir, { recursive: true });
  });

  // Feature: Verify blockedBy dependencies are tracked
  // Design: Create two tasks, set second as blocked by first, confirm dependency recorded
  test("blockedBy dependencies tracked", () => {
    const dir = path.join(tmpdir(), `test-tasks-${String(Date.now())}`);
    mkdirSync(dir, { recursive: true });
    const manager = new TaskManager(dir);
    const task1 = manager.create("Task 1", "Desc 1");
    const task2 = manager.create("Task 2", "Desc 2");
    const updated = manager.update(task2.id, {
      addBlockedBy: [Number(task1.id)],
    });
    expect(updated?.blockedBy).toContain(task1.id);
    rmSync(dir, { recursive: true });
  });
});
