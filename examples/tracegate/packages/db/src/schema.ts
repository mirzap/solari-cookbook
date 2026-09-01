import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const evaluations = sqliteTable("evaluations", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  entityJson: text("entity_json").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  runIndex: integer("run_index").notNull(),
  status: text("status").notNull(),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
  entityJson: text("entity_json").notNull(),
}, (table) => [
  uniqueIndex("runs_evaluation_run_index_unique").on(table.evaluationId, table.runIndex),
  index("runs_evaluation_index").on(table.evaluationId),
]);

export const runSteps = sqliteTable("run_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  payloadJson: text("payload_json").notNull(),
  interactionMode: text("interaction_mode").notNull(),
  observationRevision: integer("observation_revision"),
  durationMs: integer("duration_ms"),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  uniqueIndex("run_steps_run_sequence_unique").on(table.runId, table.sequence),
  index("run_steps_run_index").on(table.runId),
]);

export const events = sqliteTable("events", {
  cursor: integer("cursor").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
  runSequence: integer("run_sequence"),
  type: text("type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  recordedAt: text("recorded_at").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [
  uniqueIndex("events_event_id_unique").on(table.eventId),
  uniqueIndex("events_run_sequence_unique").on(table.runId, table.runSequence),
  index("events_evaluation_cursor_index").on(table.evaluationId, table.cursor),
  index("events_run_sequence_index").on(table.runId, table.runSequence),
]);

export const tracegateSchema = { evaluations, runs, runSteps, events };
