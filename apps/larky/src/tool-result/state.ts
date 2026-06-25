export class ContentReplacementState {
  private seenIds = new Set<string>();
  private replacements = new Map<string, string>();

  record(toolUseId: string, original: string, replaced: string): void {
    this.seenIds.add(toolUseId);
    if (original !== replaced) {
      this.replacements.set(toolUseId, replaced);
    }
  }

  has(toolUseId: string): boolean {
    return this.seenIds.has(toolUseId);
  }

  getReplacement(toolUseId: string): string | undefined {
    return this.replacements.get(toolUseId);
  }

  clone(): ContentReplacementState {
    const c = new ContentReplacementState();
    for (const id of this.seenIds) {
      c.seenIds.add(id);
    }
    for (const [k, v] of this.replacements) {
      c.replacements.set(k, v);
    }
    return c;
  }

  size(): number {
    return this.seenIds.size;
  }
}
