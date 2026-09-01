import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const capabilityChecks = sqliteTable("capability_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  detailsJson: text("details_json").notNull(),
  checkedAt: text("checked_at").notNull(),
  errorJson: text("error_json"),
}, (table) => [
  uniqueIndex("capability_checks_kind_subject_unique").on(table.kind, table.subject),
  index("capability_checks_checked_at_index").on(table.checkedAt),
]);

export const evaluations = sqliteTable("evaluations", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  specificationHash: text("specification_hash").notNull(),
  targetStartUrl: text("target_start_url").notNull(),
  allowedNavigationOriginsJson: text("allowed_navigation_origins_json").notNull(),
  prompt: text("prompt").notNull(),
  assertionsJson: text("assertions_json").notNull(),
  configJson: text("config_json").notNull(),
  entityJson: text("entity_json").notNull(),
}, (table) => [index("evaluations_status_created_index").on(table.status, table.createdAt)]);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  evaluationId: text("evaluation_id").notNull().references(() => evaluations.id, { onDelete: "cascade" }),
  schemaVersion: integer("schema_version").notNull(),
  runIndex: integer("run_index").notNull(),
  modelId: text("model_id").notNull(),
  status: text("status").notNull(),
  outcome: text("outcome"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  evidenceHash: text("evidence_hash"),
  releaseStatus: text("release_status").notNull(),
  potentialSessionLeak: integer("potential_session_leak", { mode: "boolean" }).notNull(),
  entityJson: text("entity_json").notNull(),
}, (table) => [
  uniqueIndex("runs_evaluation_run_index_unique").on(table.evaluationId, table.runIndex),
  index("runs_evaluation_index").on(table.evaluationId),
  index("runs_status_index").on(table.status),
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
]);

export const discoveredInterfaces = sqliteTable("discovered_interfaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  metadataJson: text("metadata_json").notNull(),
  discoveredAt: text("discovered_at").notNull(),
}, (table) => [index("discovered_interfaces_run_index").on(table.runId)]);

export const browserSessions = sqliteTable("browser_sessions", {
  runId: text("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  providerSessionId: text("provider_session_id").notNull(),
  region: text("region"),
  acquiredAt: text("acquired_at").notNull(),
  releasedAt: text("released_at"),
  releaseStatus: text("release_status").notNull(),
  releaseConfirmed: integer("release_confirmed", { mode: "boolean" }).notNull(),
  replayStatus: text("replay_status").notNull(),
  recordingRequested: integer("recording_requested", { mode: "boolean" }).notNull(),
}, (table) => [
  uniqueIndex("browser_sessions_provider_session_unique").on(table.providerSessionId),
  index("browser_sessions_release_index").on(table.releaseStatus),
]);

export const assertionEvidence = sqliteTable("assertion_evidence", {
  runId: text("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  evidenceHash: text("evidence_hash").notNull(),
  capturedAt: text("captured_at").notNull(),
  redactedDisplayUrl: text("redacted_display_url"),
  documentIdHash: text("document_id_hash").notNull(),
  loaderIdHash: text("loader_id_hash").notNull(),
  unverifiableCount: integer("unverifiable_count").notNull(),
  evidenceJson: text("evidence_json").notNull(),
}, (table) => [
  index("assertion_evidence_captured_index").on(table.capturedAt),
  index("assertion_evidence_hash_index").on(table.evidenceHash),
]);

export const gradeResults = sqliteTable("grade_results", {
  runId: text("run_id").primaryKey().references(() => runs.id, { onDelete: "cascade" }),
  evidenceHash: text("evidence_hash").notNull(),
  outcome: text("outcome").notNull(),
  assertionResultsJson: text("assertion_results_json").notNull(),
  gradedAt: text("graded_at").notNull(),
  resultJson: text("result_json").notNull(),
}, (table) => [index("grade_results_outcome_index").on(table.outcome)]);

export const providerCreateAttempts = sqliteTable("provider_create_attempts", {
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  attemptCorrelationId: text("attempt_correlation_id").notNull(),
  status: text("status").notNull(),
  providerSessionId: text("provider_session_id"),
  potentialSessionLeak: integer("potential_session_leak", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  recordJson: text("record_json").notNull(),
}, (table) => [
  uniqueIndex("provider_create_attempts_run_correlation_unique").on(table.runId, table.attemptCorrelationId),
  index("provider_create_attempts_unresolved_index").on(table.status, table.updatedAt),
]);

export const tracegateSchema = {
  capabilityChecks,
  evaluations,
  runs,
  runSteps,
  events,
  discoveredInterfaces,
  browserSessions,
  assertionEvidence,
  gradeResults,
  providerCreateAttempts,
};
