import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";
import type { Message, Session } from "../types.js";

let db: Database.Database | null = null;

export function initDb(): void {
  const config = getConfig();
  getLogger().debug({ dbPath: config.dbPath }, "storage.initDb");
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_user INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
}

function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function createSession(title: string): Session {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, title, now, now);
  getLogger().debug({ sessionId: id, title }, "storage.createSession");
  return { id, title, createdAt: now, updatedAt: now };
}

export function getSessions(): Session[] {
  const rows = getDb()
    .prepare("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
    .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getSession(sessionId: string): Session | undefined {
  const row = getDb()
    .prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?")
    .get(sessionId) as
    | { id: string; title: string; created_at: string; updated_at: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteSession(sessionId: string): void {
  getDb().prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb()
    .prepare("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, sessionId);
}

export function saveMessage(sessionId: string, content: string, isUser: boolean): void {
  getDb()
    .prepare("INSERT INTO messages (session_id, content, is_user) VALUES (?, ?, ?)")
    .run(sessionId, content, isUser ? 1 : 0);
  getDb().prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
}

export function getMessages(sessionId: string): Message[] {
  const rows = getDb()
    .prepare(
      "SELECT id, session_id, content, is_user, created_at FROM messages WHERE session_id = ? ORDER BY id ASC",
    )
    .all(sessionId) as Array<{
    id: number;
    session_id: string;
    content: string;
    is_user: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    content: r.content,
    isUser: r.is_user === 1,
    createdAt: r.created_at,
  }));
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
