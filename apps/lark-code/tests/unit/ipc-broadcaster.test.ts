// Feature: Verify IpcEventBroadcaster subscription, topic matching, scope filtering, disconnect cleanup
// Design: Use mock net.Socket to capture write data, avoiding real TCP connection complexity
import net from "node:net";

import { describe, expect, test } from "vitest";

import type { Event } from "../../src/core/bus/events.js";
import { IpcEventBroadcaster } from "../../src/core/transport/ipc-broadcaster.js";
import { isRecord } from "../../src/core/bus/envelope.js";

// Write tracker to capture socket write calls without type assertions
interface WriteTracker {
  data: string[];
}

// WeakMap to associate sockets with their write trackers
const trackerRegistry = new WeakMap<net.Socket, WriteTracker>();

// Create mock socket for testing — uses real Socket instance for type safety
function makeMockSocket(): net.Socket {
  const socket = new net.Socket();
  const tracker: WriteTracker = { data: [] };
  socket.write = (chunk: string | Uint8Array): boolean => {
    tracker.data.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  trackerRegistry.set(socket, tracker);
  return socket;
}

// Create RunStartedEvent for testing
function makeRunStarted(runId = "r1"): Event {
  return {
    type: "run.started",
    run_id: runId,
    goal: "test",
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// Create StepStartedEvent for testing
function makeStepStarted(runId = "r1"): Event {
  return {
    type: "step.started",
    run_id: runId,
    step: 1,
    timestamp: "2026-01-01T00:00:00Z",
  };
}

// Retrieve the write tracker for a socket
function getTracker(socket: net.Socket): WriteTracker {
  const tracker = trackerRegistry.get(socket);
  if (!tracker) throw new Error("no tracker registered for socket");
  return tracker;
}

// Type-safe helper to parse the first write call as JSON
function getWriteCallData(socket: net.Socket): Record<string, unknown> | null {
  const tracker = getTracker(socket);
  if (tracker.data.length === 0) return null;
  const first = tracker.data[0];
  const parsed: unknown = JSON.parse(first.trim());
  if (!isRecord(parsed)) return null;
  return parsed;
}

// Type-safe helper to get write call count
function getWriteCallCount(socket: net.Socket): number {
  return getTracker(socket).data.length;
}

describe("IpcEventBroadcaster", () => {
  // Feature: Verify subscribe then handle writes matching topic events to socket
  // Design: Use mock socket to capture write data, deserialize and assert kind and event.type
  test("subscriber receives matching event", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"]);

    await broadcaster.handle(makeRunStarted());

    expect(getWriteCallCount(socket)).toBe(1);
    const data = getWriteCallData(socket);
    if (!data) throw new Error("write not called");
    expect(data["kind"]).toBe("event");
    const event = data["event"];
    expect(isRecord(event) ? event["type"] : undefined).toBe("run.started");
  });

  // Feature: Verify handle does not write to any socket when no subscriptions exist
  // Design: Create broadcaster without subscribing, call handle and assert write was never called
  test("no subscription means no write", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();

    await broadcaster.handle(makeRunStarted());

    expect(getWriteCallCount(socket)).toBe(0);
  });

  // Feature: Verify topic glob "step.*" matches step.started but not run.started
  // Design: Publish both event types to same broadcaster, assert write called only once
  test("topic glob matches step but not run", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["step.*"]);

    await broadcaster.handle(makeStepStarted());
    await broadcaster.handle(makeRunStarted());

    expect(getWriteCallCount(socket)).toBe(1);
  });

  // Feature: Verify scope="global" subscription receives events from any run_id
  // Design: Publish two events with different run_ids, assert both writes occur
  test("scope global receives all run_ids", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"], "global");

    await broadcaster.handle(makeRunStarted("r1"));
    await broadcaster.handle(makeRunStarted("r2"));

    expect(getWriteCallCount(socket)).toBe(2);
  });

  // Feature: Verify scope="run:<id>" only receives events with matching run_id
  // Design: Subscribe with scope="run:abc", publish run_id="abc" and run_id="xyz", assert only one write
  test("scope run:<id> filters other run_ids", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"], "run:abc");

    await broadcaster.handle(makeRunStarted("abc"));
    await broadcaster.handle(makeRunStarted("xyz"));

    expect(getWriteCallCount(socket)).toBe(1);
  });

  // Feature: Verify unsubscribe stops handle from sending events to that socket
  // Design: Subscribe then unsubscribe, call handle, assert write was never called
  test("unsubscribe stops delivery", async () => {
    const broadcaster = new IpcEventBroadcaster();
    const socket = makeMockSocket();
    broadcaster.subscribe(socket, ["run.*"]);
    broadcaster.unsubscribe(socket);

    await broadcaster.handle(makeRunStarted());

    expect(getWriteCallCount(socket)).toBe(0);
  });
});
