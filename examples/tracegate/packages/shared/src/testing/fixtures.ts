import { AgentObservationSchema } from "../agent.ts";
import { EvaluationConfigSchema } from "../config.ts";
import { DiscoveryEvidenceSchema } from "../discovery.ts";
import { EvaluationSchema, RunSchema } from "../entities.ts";
import { FailureRecordSchema, RunWarningSchema } from "../errors.ts";
import { EventAppendInputSchema, EventEnvelopeSchema } from "../events.ts";
import { DemoGradeEvidenceSchema, GradeResultSchema } from "../grading.ts";
import {
  ChallengeIdSchema,
  EventCursorSchema,
  EvaluationIdSchema,
  EventIdSchema,
  RunIdSchema,
  UtcDateTimeSchema,
} from "../ids.ts";

export const FIXTURE_NOW = UtcDateTimeSchema.parse("2026-09-01T12:00:00.000Z");
export const FIXTURE_EVALUATION_ID = EvaluationIdSchema.parse("01890f00-0000-7000-8000-000000000001");
export const FIXTURE_RUN_ID = RunIdSchema.parse("01890f00-0000-7000-8000-000000000002");
export const FIXTURE_EVENT_ID = EventIdSchema.parse("01890f00-0000-7000-8000-000000000003");
export const FIXTURE_CHALLENGE_ID = ChallengeIdSchema.parse("challenge-fixture-0001");

export const evaluationConfigFixture = EvaluationConfigSchema.parse({
  schemaVersion: 1,
  target: {
    kind: "tracegate-demo-store",
    publicBaseUrl: "https://demo.tracegate.test",
    adminBaseUrl: "http://127.0.0.1:3000",
    scenarioId: "classic-tee-size-m-v1",
  },
  goal: "Add one Classic Tee in size M to the cart.",
  successCriterion: "The server-side cart contains exactly one Classic Tee, size M, quantity one.",
  modelIds: ["deepseek/deepseek-v4-flash-0731"],
  allowedOrigins: ["https://demo.tracegate.test"],
});

export const observationFixture = AgentObservationSchema.parse({
  schemaVersion: 1,
  revision: 1,
  url: "https://demo.tracegate.test/products/classic-tee",
  title: "Classic Tee",
  visibleText: "Classic Tee Size M Add to cart",
  nativeTools: [],
  elements: [{
    ref: "e:1:1",
    role: "button",
    name: "Add to cart",
    disabled: false,
    checked: null,
    selected: null,
    expanded: null,
    attributes: {},
  }],
  discoverySummary: "One semantic button found.",
  truncated: false,
});

export const warningFixture = RunWarningSchema.parse({
  schemaVersion: 1,
  code: "webmcp_degraded",
  category: "unsupported_interface",
  phase: "discovery",
  retryable: true,
  message: "WebMCP unavailable; semantic controls remain available.",
  occurredAt: FIXTURE_NOW,
});

export const cleanupWarningFixture = RunWarningSchema.parse({
  schemaVersion: 1,
  code: "cleanup_failed",
  category: "infrastructure",
  phase: "browser_release",
  retryable: true,
  message: "The fake browser session release failed.",
});

export const discoveryFixture = DiscoveryEvidenceSchema.parse({
  schemaVersion: 1,
  observationRevision: 1,
  semanticControlCount: 1,
  llmsTxt: { status: "not_found", sha256: null, sizeBytes: null, preview: null, truncated: false },
  jsonLdTypes: [],
  webMcpGate: "unavailable",
  interfaces: [{
    schemaVersion: 1,
    kind: "semantic",
    name: "Add to cart",
    metadata: { role: "button" },
    discoveredAt: FIXTURE_NOW,
  }],
  warnings: [warningFixture],
  truncated: false,
});

export const failedFailureFixture = FailureRecordSchema.parse({
  schemaVersion: 1,
  category: "incorrect_state",
  code: "task_incorrect",
  phase: "grading",
  retryable: false,
  outcome: "failed",
  message: "Trusted cart evidence did not match the expected state.",
  causeChain: [],
  occurredAt: FIXTURE_NOW,
});

export const inconclusiveFailureFixture = FailureRecordSchema.parse({
  schemaVersion: 1,
  category: "grading",
  code: "invalid_evidence",
  phase: "grading",
  retryable: true,
  outcome: "inconclusive",
  message: "Evidence revision did not match the expected revision.",
  causeChain: [],
  occurredAt: FIXTURE_NOW,
});

export const gradeEvidenceFixture = DemoGradeEvidenceSchema.parse({
  schemaVersion: 1,
  challengeId: FIXTURE_CHALLENGE_ID,
  revision: 2,
  cart: [{ productSlug: "classic-tee", productName: "Classic Tee", variant: { size: "M" }, quantity: 1 }],
  capturedAt: FIXTURE_NOW,
});

export const passingGradeFixture = GradeResultSchema.parse({
  schemaVersion: 1,
  scenarioId: "classic-tee-size-m-v1",
  evidenceRevision: 2,
  outcome: "passed",
  predicates: [
    { name: "exactly_one_line_item", passed: true, expected: "1", actual: "1" },
    { name: "product_is_classic_tee", passed: true, expected: "classic-tee", actual: "classic-tee" },
    { name: "size_is_m", passed: true, expected: "M", actual: "M" },
    { name: "quantity_is_one", passed: true, expected: "1", actual: "1" },
  ],
  failure: null,
  gradedAt: FIXTURE_NOW,
});

export const evaluationFixture = EvaluationSchema.parse({
  schemaVersion: 1,
  id: FIXTURE_EVALUATION_ID,
  config: evaluationConfigFixture,
  status: "queued",
  createdAt: FIXTURE_NOW,
  startedAt: null,
  finishedAt: null,
  failure: null,
});

export const runFixture = RunSchema.parse({
  schemaVersion: 1,
  id: FIXTURE_RUN_ID,
  evaluationId: FIXTURE_EVALUATION_ID,
  runIndex: 0,
  modelId: "deepseek/deepseek-v4-flash-0731",
  resolvedProvider: null,
  status: "queued",
  outcome: null,
  createdAt: FIXTURE_NOW,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  iterations: 0,
  toolCalls: 0,
  browserActions: 0,
  usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  failure: null,
  grade: null,
  replayStatus: "not_requested",
  releaseStatus: "not_started",
  warnings: [],
  potentialSessionLeak: false,
});

export const eventInputFixture = EventAppendInputSchema.parse({
  schemaVersion: 1,
  eventId: FIXTURE_EVENT_ID,
  evaluationId: FIXTURE_EVALUATION_ID,
  runId: FIXTURE_RUN_ID,
  runSequence: 0,
  type: "run.queued",
  occurredAt: FIXTURE_NOW,
  payload: { runIndex: 0 },
});

export const eventEnvelopeFixture = EventEnvelopeSchema.parse({
  ...eventInputFixture,
  cursor: EventCursorSchema.parse("1"),
  recordedAt: FIXTURE_NOW,
});
