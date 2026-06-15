// IPC event broadcaster: manages subscriptions and fans out events to matching clients
import { randomUUID } from "node:crypto";
import type net from "node:net";

import picomatch from "picomatch";

import type { Event } from "../bus/events.js";
import type { TraceWriter } from "../trace/writer.js";

interface Subscription {
  subId: string;
  socket: net.Socket;
  topics: string[];
  scope: string;
  matchers: picomatch.Matcher[];
}

// Write a JSON line to a socket
function writeLine(socket: net.Socket, data: unknown): boolean {
  return socket.write(JSON.stringify(data) + "\n", "utf-8");
}

export class IpcEventBroadcaster {
  private _subscriptions: Subscription[] = [];
  private _trace: TraceWriter | undefined;

  constructor(options?: { trace?: TraceWriter }) {
    this._trace = options?.trace;
  }

  // Register a client subscription; returns subscription_id
  subscribe(socket: net.Socket, topics: string[], scope = "global"): string {
    const subId = `sub-${randomUUID().slice(0, 8)}`;
    const matchers = topics.map((t) => picomatch(t));
    const sub: Subscription = { subId, socket, topics, scope, matchers };
    this._subscriptions.push(sub);
    return subId;
  }

  // Remove all subscriptions for a given socket
  unsubscribe(socket: net.Socket): void {
    this._subscriptions = this._subscriptions.filter((s) => s.socket !== socket);
  }

  // Push event to all matching subscribers; clean up dead connections on write failure
  async handle(event: Event): Promise<void> {
    const eventType = event.type;
    const runId = "run_id" in event ? event.run_id : undefined;

    const dead: net.Socket[] = [];

    for (const sub of [...this._subscriptions]) {
      if (!this._matchesTopic(eventType, sub.matchers)) continue;
      if (!this._matchesScope(runId, sub.scope)) continue;

      try {
        const envelope = { kind: "event" as const, event };
        const ok = writeLine(sub.socket, envelope);
        if (!ok) {
          // Backpressure: wait for drain
          await new Promise<void>((resolve) => sub.socket.once("drain", resolve));
        }
        // Trace: CORE->CLIENT push
        if (this._trace) {
          this._trace.emit({
            ts: new Date().toISOString(),
            direction: "CORE→CLIENT",
            layer: "ipc",
            kind: "push",
            run_id: typeof runId === "string" ? runId : null,
            step: null,
            client_id: sub.subId,
            data: { event_type: eventType },
          });
        }
      } catch {
        dead.push(sub.socket);
      }
    }

    for (const socket of dead) {
      this.unsubscribe(socket);
    }
  }

  // Check if event type matches any of the subscription's topic matchers
  private _matchesTopic(eventType: string, matchers: picomatch.Matcher[]): boolean {
    return matchers.some((m) => m(eventType));
  }

  // Check if the event's run_id matches the subscription scope
  private _matchesScope(runId: string | undefined, scope: string): boolean {
    if (scope === "global") return true;
    if (scope.startsWith("run:")) return runId === scope.slice(4);
    return false;
  }
}
