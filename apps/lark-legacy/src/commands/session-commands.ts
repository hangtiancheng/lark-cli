import type { Session } from "../types.js";
import * as storage from "../services/storage.js";

export function createNewSession(title: string): Session {
  return storage.createSession(title);
}

export function listSessions(currentSessionId: string | null): string {
  const sessions = storage.getSessions();
  if (sessions.length === 0) {
    return "No sessions found.";
  }
  const list = sessions
    .map(
      (s, i) =>
        `${i + 1}. [${s.id.slice(0, 8)}] ${s.title}${s.id === currentSessionId ? " (current)" : ""}`,
    )
    .join("\n");
  return `Sessions:\n${list}`;
}

export function switchSession(args: string): Session | undefined {
  const sessions = storage.getSessions();
  const num = parseInt(args, 10);
  if (!isNaN(num) && num >= 1 && num <= sessions.length) {
    return sessions[num - 1];
  }
  return sessions.find((s) => s.id.startsWith(args));
}

export function deleteSessionCommand(args: string): Session | undefined {
  const sessions = storage.getSessions();
  const num = parseInt(args, 10);
  let target: Session | undefined;
  if (!isNaN(num) && num >= 1 && num <= sessions.length) {
    target = sessions[num - 1];
  } else {
    target = sessions.find((s) => s.id.startsWith(args));
  }
  if (target) {
    storage.deleteSession(target.id);
  }
  return target;
}
