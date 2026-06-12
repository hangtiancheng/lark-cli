let activeSessionId: string | null = null;

export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}
