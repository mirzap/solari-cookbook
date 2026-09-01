import type { Client } from "@libsql/client";

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  entity_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  run_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT,
  created_at TEXT NOT NULL,
  entity_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_evaluation_run_index_unique ON runs(evaluation_id, run_index);
CREATE INDEX IF NOT EXISTS runs_evaluation_index ON runs(evaluation_id);

CREATE TABLE IF NOT EXISTS run_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  observation_revision INTEGER,
  duration_ms INTEGER,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS run_steps_run_sequence_unique ON run_steps(run_id, sequence);
CREATE INDEX IF NOT EXISTS run_steps_run_index ON run_steps(run_id);

CREATE TABLE IF NOT EXISTS events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  event_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  run_sequence INTEGER,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS events_event_id_unique ON events(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_run_sequence_unique ON events(run_id, run_sequence);
CREATE INDEX IF NOT EXISTS events_evaluation_cursor_index ON events(evaluation_id, cursor);
CREATE INDEX IF NOT EXISTS events_run_sequence_index ON events(run_id, run_sequence);
`;

export async function migrateTracegateDatabase(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.executeMultiple(INITIAL_SCHEMA_SQL);
}
