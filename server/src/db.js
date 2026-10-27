import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite"; // built into Node 22.13+: no native compile step, works on Windows without Visual Studio
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "studio.db"));
// WAL is faster but unsafe on network/mapped drives, so it is opt-in (SQLITE_WAL=true).
if (process.env.SQLITE_WAL === "true") db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

// Minimal replacement for better-sqlite3's db.transaction(): supports nesting via savepoints.
let txDepth = 0;
db.transaction = (fn) => (...args) => {
  const outer = txDepth === 0;
  const sp = `sp_${txDepth}`;
  db.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const result = fn(...args);
    txDepth--;
    db.exec(outer ? "COMMIT" : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    txDepth--;
    db.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  error TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_conv ON runs(conversation_id);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (conversation_id, filename)
);
CREATE TABLE IF NOT EXISTS payments (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pack_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Anything still "running" at boot belongs to a process that died.
db.prepare("UPDATE runs SET status='failed', error='Server restarted during run', finished_at=datetime('now') WHERE status='running'").run();

/** Atomically change a user's credits and write the ledger. Returns the new balance, or null if it would go negative. */
export const adjustCredits = db.transaction((userId, delta, reason, ref = null) => {
  const row = db.prepare("SELECT credits FROM users WHERE id=?").get(userId);
  if (!row) return null;
  const next = row.credits + delta;
  if (next < 0) return null;
  db.prepare("UPDATE users SET credits=? WHERE id=?").run(next, userId);
  db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES (?,?,?,?)").run(userId, delta, reason, ref);
  return next;
});
