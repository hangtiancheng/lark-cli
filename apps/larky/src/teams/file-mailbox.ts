import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync,
  openSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import z, { parse, safeParse } from "zod";

const FileMailMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  timestamp: z.string(),
});

export type FileMailMessage = z.infer<typeof FileMailMessageSchema>;

// ---------------------------------------------------------------------------
// File-based lock
//
// Uses exclusive-create (wx flag) on a .lock file.  Retries up to maxAttempts
// times with a small random back-off.  Stale locks (older than staleLockMs)
// are automatically removed so a crashed process cannot block others forever.
// ---------------------------------------------------------------------------

const LOCK_MAX_ATTEMPTS = 10;
const LOCK_STALE_MS = 10_000; // 10 seconds
const LOCK_RETRY_MIN_MS = 5;
const LOCK_RETRY_MAX_MS = 100;

const ErrnoExceptionSchema = z.looseObject({
  errno: z.number().optional(),
  code: z.string().optional(),
  path: z.string().optional(),
  syscall: z.string().optional(),
});

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockFile: string): void {
  let lastErr: unknown;
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY — fails if the file already exists.
      const fd = openSync(lockFile, "wx");
      closeSync(fd);
      return; // lock acquired
    } catch (err: unknown) {
      const { data, success } = safeParse(ErrnoExceptionSchema, err);
      let code = "";
      if (success && data.code) {
        code = data.code;
      }
      if (code !== "EEXIST") {
        throw err; // unexpected filesystem error
      }
      lastErr = err;

      // Lock file exists — check if it is stale.
      try {
        const info = statSync(lockFile);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(lockFile);
          } catch {
            // another process may have removed it already
          }
        }
      } catch {
        // stat failed — file may have been removed between our open and stat
      }

      // Random back-off before retrying (5–100 ms, matching Go implementation).
      const delayMs =
        LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1));
      sleepSync(delayMs);
    }
  }
  throw lastErr; // could not acquire lock after all attempts
}

function releaseLock(lockFile: string): void {
  try {
    unlinkSync(lockFile);
  } catch {
    // best-effort — file may already be gone
  }
}

/** Execute `fn` while holding an exclusive .lock file for `filePath`. */
function withLock<T>(filePath: string, fn: () => T): T {
  const lockFile = filePath + ".lock";
  acquireLock(lockFile);
  try {
    return fn();
  } finally {
    releaseLock(lockFile);
  }
}

// ---------------------------------------------------------------------------

export class FileMailbox {
  private filePath: string;
  private readStatePath: string;
  private lastReadLines: number;

  constructor(dir: string, memberName: string) {
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, `${memberName}.jsonl`);
    this.readStatePath = join(dir, `${memberName}.read`);
    // Persist the read cursor so a restarted / different process resumes from
    // where it left off instead of re-reading the whole mailbox from line 0.
    this.lastReadLines = this.loadReadState();
  }

  private loadReadState(): number {
    try {
      return parseInt(readFileSync(this.readStatePath, "utf-8").trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private saveReadState(): void {
    try {
      writeFileSync(this.readStatePath, String(this.lastReadLines), "utf-8");
    } catch {
      // best-effort
    }
  }

  private allLines(): string[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    return readFileSync(this.filePath, "utf-8").trim().split("\n").filter(Boolean);
  }

  send(from: string, text: string): Promise<void> {
    const msg: FileMailMessage = {
      from,
      text,
      timestamp: new Date().toISOString(),
    };
    withLock(this.filePath, () => {
      writeFileSync(this.filePath, JSON.stringify(msg) + "\n", {
        flag: "a",
        encoding: "utf-8",
      });
    });

    return Promise.resolve();
  }

  // Consume and return unread messages, advancing (and persisting) the cursor.
  receiveSync(): FileMailMessage[] {
    return withLock(this.filePath, () => {
      const lines = this.allLines();
      const newLines = lines.slice(this.lastReadLines);
      this.lastReadLines = lines.length;
      this.saveReadState();

      const out: FileMailMessage[] = [];
      for (const line of newLines) {
        try {
          const raw: unknown = JSON.parse(line);
          const parsed = parse(FileMailMessageSchema, raw);
          out.push(parsed);
        } catch {
          // skip malformed line
        }
      }
      return out;
    });
  }

  receive(): Promise<FileMailMessage[]> {
    return Promise.resolve(this.receiveSync());
  }

  // Number of unread messages without consuming them.
  unreadCount(): number {
    return Math.max(0, this.allLines().length - this.lastReadLines);
  }

  // Mark everything currently in the mailbox as read without returning it.
  markAllRead(): void {
    withLock(this.filePath, () => {
      this.lastReadLines = this.allLines().length;
      this.saveReadState();
    });
  }

  async *poll(intervalMs = 1000): AsyncGenerator<FileMailMessage> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const messages = await this.receive();
      for (const msg of messages) {
        yield msg;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
