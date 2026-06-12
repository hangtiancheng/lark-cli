import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Session } from "../src/types.js";

const mockSessions: Session[] = [
  {
    id: "abc12345-1111",
    title: "Chat about TypeScript",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  },
  {
    id: "def67890-2222",
    title: "Debug React app",
    createdAt: "2025-01-02",
    updatedAt: "2025-01-02",
  },
  { id: "ghi11111-3333", title: "Code review", createdAt: "2025-01-03", updatedAt: "2025-01-03" },
];

vi.mock("../src/services/storage.js", () => ({
  createSession: vi.fn(
    (title: string): Session => ({
      id: "new-session-id",
      title,
      createdAt: "2025-06-01",
      updatedAt: "2025-06-01",
    }),
  ),
  getSessions: vi.fn(() => [...mockSessions]),
  deleteSession: vi.fn(),
}));

import {
  createNewSession,
  listSessions,
  switchSession,
  deleteSessionCommand,
} from "../src/commands/session-commands.js";
import * as storage from "../src/services/storage.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getSessions).mockReturnValue([...mockSessions]);
});

describe("createNewSession", () => {
  test("creates a session with given title", () => {
    const session = createNewSession("My Chat");
    expect(session.title).toBe("My Chat");
    expect(session.id).toBe("new-session-id");
    expect(storage.createSession).toHaveBeenCalledWith("My Chat");
  });
});

describe("listSessions", () => {
  test("returns formatted list with session info", () => {
    const result = listSessions(null);
    expect(result).toContain("Sessions:");
    expect(result).toContain("1.");
    expect(result).toContain("Chat about TypeScript");
    expect(result).toContain("abc12345");
  });

  test("marks current session", () => {
    const result = listSessions("abc12345-1111");
    expect(result).toContain("(current)");
  });

  test("returns 'No sessions' when empty", () => {
    vi.mocked(storage.getSessions).mockReturnValue([]);
    const result = listSessions(null);
    expect(result).toBe("No sessions found.");
  });
});

describe("switchSession", () => {
  test("switches by number (1-based)", () => {
    const result = switchSession("2");
    expect(result).toBeDefined();
    expect(result!.title).toBe("Debug React app");
  });

  test("switches by id prefix", () => {
    const result = switchSession("ghi");
    expect(result).toBeDefined();
    expect(result!.title).toBe("Code review");
  });

  test("returns undefined for invalid number", () => {
    const result = switchSession("99");
    expect(result).toBeUndefined();
  });

  test("returns undefined for non-matching prefix", () => {
    const result = switchSession("zzz");
    expect(result).toBeUndefined();
  });

  test("number 0 is out of range", () => {
    const result = switchSession("0");
    expect(result).toBeUndefined();
  });
});

describe("deleteSessionCommand", () => {
  test("deletes by number", () => {
    const result = deleteSessionCommand("1");
    expect(result).toBeDefined();
    expect(result!.title).toBe("Chat about TypeScript");
    expect(storage.deleteSession).toHaveBeenCalledWith("abc12345-1111");
  });

  test("deletes by id prefix", () => {
    const result = deleteSessionCommand("def");
    expect(result).toBeDefined();
    expect(result!.title).toBe("Debug React app");
    expect(storage.deleteSession).toHaveBeenCalledWith("def67890-2222");
  });

  test("returns undefined and does not call delete for non-matching", () => {
    const result = deleteSessionCommand("nonexistent");
    expect(result).toBeUndefined();
    expect(storage.deleteSession).not.toHaveBeenCalled();
  });
});
