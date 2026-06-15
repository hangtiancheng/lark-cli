import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PermissionManager } from "../../src/core/permissions/manager.js";
import type { ToolPolicy } from "../../src/core/permissions/policy.js";

// Helper: create a manager with custom options, no filesystem side effects by default
function makeManager(opts?: {
  policies?: Record<string, ToolPolicy>;
  policyFile?: string;
  timeoutS?: number;
}): PermissionManager {
  return new PermissionManager(opts);
}

// Helper: no-op event emitter that records calls
function makeEmitter(): {
  emit: (event: Record<string, unknown>) => Promise<void>;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  return {
    emit: (event: Record<string, unknown>) => {
      events.push(event);
      return Promise.resolve();
    },
    events,
  };
}

describe("PermissionManager", () => {
  // --- Static evaluate() delegation ---

  test("evaluate delegates to policy for allowed tools", () => {
    const mgr = makeManager();
    expect(mgr.evaluate("read_file", { path: "test.txt" })).toBe("allow");
  });

  test("evaluate returns ask for bash", () => {
    const mgr = makeManager();
    expect(mgr.evaluate("bash", { command: "echo hello" })).toBe("ask");
  });

  test("evaluate returns ask for unknown tools", () => {
    const mgr = makeManager();
    expect(mgr.evaluate("unknown_tool", {})).toBe("ask");
  });

  // --- checkAndWait: ALLOW path ---

  test("checkAndWait returns auto_allow for tools with default allow", async () => {
    const mgr = makeManager();
    const emitter = makeEmitter();
    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-1",
      "read_file",
      { path: "test.txt" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(true);
    expect(decision).toBe("auto_allow");
    expect(emitter.events).toHaveLength(0); // No event emitted for auto_allow
  });

  // --- checkAndWait: ASK path with respond ---

  test("checkAndWait emits event and waits for respond allow_once", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    // Schedule respond after a short delay
    setTimeout(() => {
      mgr.respond("tool-use-ask-1", "allow_once");
    }, 20);

    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-ask-1",
      "bash",
      { command: "echo hello" },
      "session-1",
      emitter.emit,
    );

    expect(allowed).toBe(true);
    expect(decision).toBe("allow_once");
    expect(emitter.events).toHaveLength(1);
    expect(emitter.events[0]["type"]).toBe("permission.requested");
    expect(emitter.events[0]["tool_use_id"]).toBe("tool-use-ask-1");
  });

  test("checkAndWait respond deny_once returns false", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    setTimeout(() => {
      mgr.respond("tool-use-deny-1", "deny_once");
    }, 20);

    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-deny-1",
      "bash",
      { command: "rm -rf /" },
      "session-1",
      emitter.emit,
    );

    expect(allowed).toBe(false);
    expect(decision).toBe("deny_once");
  });

  // --- always_allow caching ---

  test("always_allow caches to session and skips future ask", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    // First call: respond with always_allow
    setTimeout(() => {
      mgr.respond("tool-use-aa-1", "always_allow");
    }, 20);
    await mgr.checkAndWait(
      "tool-use-aa-1",
      "bash",
      { command: "echo hello" },
      "session-1",
      emitter.emit,
    );
    expect(emitter.events).toHaveLength(1);

    // Second call: should hit session cache, no new event
    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-aa-2",
      "bash",
      { command: "echo world" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(true);
    expect(decision).toBe("auto_allow");
    expect(emitter.events).toHaveLength(1); // Still 1, no new event
  });

  test("always_allow is shared across sessions via persistent cache", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    // Session 1: respond always_allow for bash
    setTimeout(() => {
      mgr.respond("tool-use-s1", "always_allow");
    }, 20);
    await mgr.checkAndWait(
      "tool-use-s1",
      "bash",
      { command: "echo test" },
      "session-1",
      emitter.emit,
    );

    // Session 2: bash should auto_allow via persistent in-memory cache
    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-s2",
      "bash",
      { command: "echo test" },
      "session-2",
      emitter.emit,
    );
    expect(allowed).toBe(true);
    expect(decision).toBe("auto_allow"); // Persistent cache shared across sessions
    expect(emitter.events).toHaveLength(1); // Only first call emitted event
  });

  // --- always_deny caching ---

  test("always_deny caches and returns auto_deny on subsequent calls", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    setTimeout(() => {
      mgr.respond("tool-use-ad-1", "always_deny");
    }, 20);
    await mgr.checkAndWait(
      "tool-use-ad-1",
      "bash",
      { command: "rm -rf /" },
      "session-1",
      emitter.emit,
    );

    // Second call: should hit cache
    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-ad-2",
      "bash",
      { command: "ls" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(false);
    expect(decision).toBe("auto_deny");
    expect(emitter.events).toHaveLength(1); // Only first call emitted event
  });

  // --- cancelSession ---

  test("cancelSession resolves pending requests as deny_once", async () => {
    const mgr = makeManager({ timeoutS: 10 });
    const emitter = makeEmitter();

    // Start checkAndWait without responding
    const pending = mgr.checkAndWait(
      "tool-use-cancel-1",
      "bash",
      { command: "echo test" },
      "session-1",
      emitter.emit,
    );

    // Cancel after a short delay
    setTimeout(() => {
      mgr.cancelSession("session-1");
    }, 20);

    const [allowed, decision] = await pending;
    expect(allowed).toBe(false);
    expect(decision).toBe("deny_once");
  });

  test("cancelSession only affects target session", async () => {
    const mgr = makeManager({ timeoutS: 10 });
    const emitter = makeEmitter();

    // Session 1: start pending
    const pending1 = mgr.checkAndWait(
      "tool-use-iso-1",
      "bash",
      { command: "echo s1" },
      "session-1",
      emitter.emit,
    );

    // Session 2: start pending
    const pending2 = mgr.checkAndWait(
      "tool-use-iso-2",
      "bash",
      { command: "echo s2" },
      "session-2",
      emitter.emit,
    );

    // Cancel only session 1
    setTimeout(() => {
      mgr.cancelSession("session-1");
    }, 20);
    // Respond to session 2
    setTimeout(() => {
      mgr.respond("tool-use-iso-2", "allow_once");
    }, 40);

    const [r1, r2] = await Promise.all([pending1, pending2]);
    expect(r1[1]).toBe("deny_once"); // cancelled
    expect(r2[1]).toBe("allow_once"); // responded normally
  });

  // --- Timeout ---

  test("checkAndWait returns false with timeout decision", async () => {
    const mgr = makeManager({ timeoutS: 0.05 }); // 50ms timeout
    const emitter = makeEmitter();

    // Never respond
    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-timeout-1",
      "bash",
      { command: "echo test" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(false);
    expect(decision).toBe("timeout");
  });

  test("late respond after timeout is a no-op", async () => {
    const mgr = makeManager({ timeoutS: 0.05 });
    const emitter = makeEmitter();

    const [, decision] = await mgr.checkAndWait(
      "tool-use-late-1",
      "bash",
      { command: "echo test" },
      "session-1",
      emitter.emit,
    );
    expect(decision).toBe("timeout");

    // Late respond should not throw
    mgr.respond("tool-use-late-1", "allow_once");
    // No crash = success
  });

  // --- respond unknown ID ---

  test("respond with unknown tool_use_id is silently ignored", () => {
    const mgr = makeManager();
    // Should not throw
    mgr.respond("nonexistent-id", "allow_once");
  });

  // --- OUTSIDE_CWD bypass prevention ---

  test("always_allow does not bypass OUTSIDE_CWD check", async () => {
    const mgr = makeManager({ timeoutS: 5 });
    const emitter = makeEmitter();

    // First: respond always_allow for bash with safe command
    setTimeout(() => {
      mgr.respond("tool-use-outside-1", "always_allow");
    }, 20);
    await mgr.checkAndWait(
      "tool-use-outside-1",
      "bash",
      { command: "echo safe" },
      "session-1",
      emitter.emit,
    );

    // Second: bash with OUTSIDE_CWD command should still ASK (not hit cache)
    setTimeout(() => {
      mgr.respond("tool-use-outside-2", "allow_once");
    }, 20);
    const [, decision] = await mgr.checkAndWait(
      "tool-use-outside-2",
      "bash",
      { command: "cd /tmp && echo hacked" },
      "session-1",
      emitter.emit,
    );
    expect(decision).toBe("allow_once"); // Not auto_allow from cache
    expect(emitter.events).toHaveLength(2); // Second call also emitted event
  });

  // --- Persistent policy file ---

  test("persistent always_allow written and reloaded from file", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "perm-test-"));
    const policyFile = path.join(tmpDir, "policy.toml");

    try {
      // First manager: respond always_allow
      const mgr1 = makeManager({ policyFile, timeoutS: 5 });
      const emitter = makeEmitter();
      setTimeout(() => {
        mgr1.respond("tool-use-persist-1", "always_allow");
      }, 20);
      await mgr1.checkAndWait(
        "tool-use-persist-1",
        "bash",
        { command: "echo test" },
        "session-1",
        emitter.emit,
      );

      // Second manager: load same file, should auto_allow
      const mgr2 = makeManager({ policyFile, timeoutS: 5 });
      const emitter2 = makeEmitter();
      const [allowed, decision] = await mgr2.checkAndWait(
        "tool-use-persist-2",
        "bash",
        { command: "echo test" },
        "session-2",
        emitter2.emit,
      );
      expect(allowed).toBe(true);
      expect(decision).toBe("auto_allow");
      expect(emitter2.events).toHaveLength(0); // No event for cached
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- deny_patterns auto-deny ---

  test("checkAndWait auto_deny for commands matching deny_patterns", async () => {
    const policies: Record<string, ToolPolicy> = {
      bash: {
        default: "ask",
        allowPatterns: [],
        denyPatterns: ["rm\\s+-rf"],
      },
    };
    const mgr = makeManager({ policies });
    const emitter = makeEmitter();

    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-dp-1",
      "bash",
      { command: "rm -rf /" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(false);
    expect(decision).toBe("auto_deny");
    expect(emitter.events).toHaveLength(0); // No event for auto_deny
  });

  // --- allow_patterns auto-allow ---

  test("checkAndWait auto_allow for commands matching allow_patterns", async () => {
    const policies: Record<string, ToolPolicy> = {
      bash: {
        default: "ask",
        allowPatterns: ["^echo\\s"],
        denyPatterns: [],
      },
    };
    const mgr = makeManager({ policies });
    const emitter = makeEmitter();

    const [allowed, decision] = await mgr.checkAndWait(
      "tool-use-ap-1",
      "bash",
      { command: "echo hello" },
      "session-1",
      emitter.emit,
    );
    expect(allowed).toBe(true);
    expect(decision).toBe("auto_allow");
    expect(emitter.events).toHaveLength(0); // No event for auto_allow
  });
});
