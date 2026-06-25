import { statSync } from "fs";

interface CacheEntry {
  content: string;
  lastModifiedTimeMs: number;
}

export class FileStateCache {
  private cache = new Map<string, CacheEntry>();

  /** Called after a successful ReadFile to register the file as "seen". */
  record(filePath: string, content: string, lastModifiedTimeMs: number) {
    this.cache.set(filePath, {
      content,
      lastModifiedTimeMs,
    });
  }

  /**
   * Gate check before EditFile / WriteFile
   */
  check(filePath: string): { ok: true } | { ok: false; error: string } {
    const entry = this.cache.get(filePath);
    if (!entry) {
      return {
        ok: false,
        error: "Error: file has not been read yet, read it first before editing.",
      };
    }

    let currentModifiedTime: number;
    try {
      /** mtimeMs: modification time in milliseconds */
      currentModifiedTime = statSync(filePath).mtimeMs;
    } catch (err) {
      // File may have been deleted between read and edit
      // -- let the calling tool surface a more specific error later
      console.error(err);
      return { ok: true };
    }

    if (currentModifiedTime > entry.lastModifiedTimeMs) {
      // Modified!

      return {
        ok: false,
        error: "Error: file has been modified since last read, read it again before editing.",
      };
    }
    return { ok: true };
  }

  /**
   * Called after a successful edit / write to keep the cache in sync
   * with the new on-disk state
   */
  update(filePath: string, newContent: string): void {
    let lastModifiedTimeMs: number;
    try {
      lastModifiedTimeMs = statSync(filePath).mtimeMs;
    } catch (err) {
      // If we can't stat (shouldn't happen right after a write),
      // just remove the entry so next edit requires a fresh read
      console.error(err);
      this.cache.delete(filePath);

      return;
    }

    this.cache.set(filePath, {
      content: newContent,
      lastModifiedTimeMs,
    });
  }
}
