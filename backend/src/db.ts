import Database from "better-sqlite3";

const databasePath = process.env.DATABASE_PATH ?? "./telemetry.db";
export const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initializeDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      prompt_snippet TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK(status IN ('SUCCEEDED', 'FAILED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      diff_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('DIFF_RENDERED', 'ACCEPTED', 'REJECTED', 'ITERATED')),
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_diff_id ON events(diff_id);
    CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_task_diff_type_unique ON events(task_id, diff_id, type);
  `);

  // Backfill for older DBs created before the `status` column existed.
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (!taskColumns.some((column) => column.name === "status")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK(status IN ('SUCCEEDED', 'FAILED'));
    `);
  }
}

export function resetTelemetryDb(): void {
  db.exec("DELETE FROM events; DELETE FROM tasks;");
}
