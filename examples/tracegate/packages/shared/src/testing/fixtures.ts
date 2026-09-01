import { AgentExecutionInputV2Schema, AgentRunResultSchema, UntrustedAgentObservationSchema } from "../agent.ts";
import { PublicEvaluationConfigV2Schema } from "../config.ts";
import { DiscoveryEvidenceSchema } from "../discovery.ts";
import { EvaluationSchema, RunSchema } from "../entities.ts";
import { BrowserAssertionEvidenceV1Schema, AssertionCaptureResultSchema } from "../evidence.ts";
import { FailureRecordSchema, RunWarningSchema } from "../errors.ts";
import { EventAppendInputSchema, EventEnvelopeSchema } from "../events.ts";
import { GradeResultV2Schema } from "../grading.ts";
import {
  CreateAttemptCorrelationIdSchema, DocumentIdentityHashSchema, EvidenceHashSchema,
  EventCursorSchema, EvaluationIdSchema, EventIdSchema, RunIdSchema, UtcDateTimeSchema,
} from "../ids.ts";
import { AdmittedPublicTargetSchema } from "../targets.ts";
import { UntrustedWebMcpResultV1Schema, WebMcpToolDescriptorV1Schema } from "../webmcp.ts";

export const FIXTURE_NOW = UtcDateTimeSchema.parse("2026-09-01T12:00:00.000Z");
export const FIXTURE_EVALUATION_ID = EvaluationIdSchema.parse("01890f00-0000-7000-8000-000000000001");
export const FIXTURE_RUN_ID = RunIdSchema.parse("01890f00-0000-7000-8000-000000000002");
export const FIXTURE_EVENT_ID = EventIdSchema.parse("01890f00-0000-7000-8000-000000000003");
export const FIXTURE_CREATE_ATTEMPT_ID = CreateAttemptCorrelationIdSchema.parse("create-attempt-fixture-0001");
export const FIXTURE_EVIDENCE_HASH = EvidenceHashSchema.parse("a".repeat(64));
export const FIXTURE_DOCUMENT_HASH = DocumentIdentityHashSchema.parse("b".repeat(64));
export const FIXTURE_LOADER_HASH = DocumentIdentityHashSchema.parse("c".repeat(64));
export const ASSERTION_ONLY_CANARY = "ASSERTION_ONLY_CANARY_7e2f41";

export const evaluationConfigFixture = PublicEvaluationConfigV2Schema.parse({
  schemaVersion: 2,
  target: {
    kind: "public-web",
    startUrl: "https://demo.tracegate.test/catalog",
    allowedNavigationOrigins: ["https://demo.tracegate.test"],
  },
  prompt: "Open the shirts filter and choose medium presentation state.",
  assertions: [
    { schemaVersion: 1, id: "final-url", kind: "url", operator: "origin_and_path_equals", expectedUrl: "https://demo.tracegate.test/catalog" },
    { schemaVersion: 1, id: "title", kind: "text", scope: "title", operator: "contains", expected: "Catalog", caseSensitive: false },
    { schemaVersion: 1, id: "filter", kind: "semantic", locator: { role: "combobox", accessibleName: { operator: "equals", value: "Size", caseSensitive: false } }, count: { operator: "equals", value: 1 } },
    { schemaVersion: 1, id: "selected-size", kind: "state", locator: { role: "combobox", accessibleName: { operator: "equals", value: "Size", caseSensitive: false } }, property: "value", expected: "M" },
  ],
  safetyPolicyVersion: "public-safe-v1",
  modelIds: ["deepseek/deepseek-v4-flash-0731"],
});

export const assertionCanaryConfigFixture = PublicEvaluationConfigV2Schema.parse({
  ...evaluationConfigFixture,
  assertions: [{ schemaVersion: 1, id: "canary", label: ASSERTION_ONLY_CANARY, kind: "text", scope: "title", operator: "equals", expected: ASSERTION_ONLY_CANARY, caseSensitive: true }],
});

export const observationFixture = UntrustedAgentObservationSchema.parse({
  schemaVersion: 2,
  trust: "untrusted_page_content",
  revision: 1,
  url: "https://demo.tracegate.test/catalog",
  title: "Product Catalog",
  visibleText: "Catalog Size M",
  elements: [{ ref: "e:1:1", role: "combobox", name: "Size", disabled: false, checked: null, selected: null, expanded: null, attributes: { value: "M" } }],
  discoverySummary: "One page-authored semantic control observed.",
  truncated: false,
});

export const webMcpToolDescriptorFixture = WebMcpToolDescriptorV1Schema.parse({
  schemaVersion: 1,
  id: "jobs.search.readonly",
  name: "searchJobs",
  description: "Search the current job catalog using public filters without changing page state.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 200 },
      minimumSalary: { type: "integer", minimum: 0, maximum: 1_000_000 },
    },
    required: ["query", "minimumSalary"],
    additionalProperties: false,
  },
  currentOrigin: "https://demo.tracegate.test",
  trust: "untrusted_page_capability",
  declaredReadOnly: true,
});

export const webMcpResultFixture = UntrustedWebMcpResultV1Schema.parse({
  schemaVersion: 1,
  toolId: webMcpToolDescriptorFixture.id,
  trust: "untrusted_page_tool_result",
  summary: "Three public job cards were returned by the page tool.",
  output: { count: 3, query: "senior software engineer" },
  truncated: false,
  redacted: true,
});

export const agentExecutionInputFixture = AgentExecutionInputV2Schema.parse({
  schemaVersion: 2,
  systemPolicyVersion: "public-safe-v1",
  userTask: evaluationConfigFixture.prompt,
  capabilities: {
    startOrigin: "https://demo.tracegate.test",
    allowedNavigationOrigins: ["https://demo.tracegate.test"],
    availableTools: ["inspect", "click", "select", "wait", "finish"],
    interfaceMode: "auto",
    safetySummary: "anonymous public observable-state tasks only; unknown effects are denied",
  },
  initialObservation: observationFixture,
  budgets: evaluationConfigFixture.budgets,
});

export const agentRunResultFixture = AgentRunResultSchema.parse({
  schemaVersion: 2, completedBelief: true, summary: "The requested public presentation state appears visible.",
  iterations: 2, toolCalls: 2, browserActions: 1,
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  resolvedProvider: "openrouter", warnings: [],
});

export const warningFixture = RunWarningSchema.parse({
  schemaVersion: 1, code: "webmcp_degraded", category: "unsupported_interface", phase: "discovery", retryable: false,
  message: "WebMCP is discovery-only; semantic controls remain available.", fieldIssues: [], causeChain: [],
});
export const cleanupWarningFixture = RunWarningSchema.parse({
  schemaVersion: 1, code: "cleanup_failed", category: "infrastructure", phase: "browser_release", retryable: true,
  message: "The fake browser session release was not confirmed.", fieldIssues: [], causeChain: [],
});

export const discoveryFixture = DiscoveryEvidenceSchema.parse({
  schemaVersion: 1, observationRevision: 1, semanticControlCount: 1,
  llmsTxt: { status: "not_found", sha256: null, sizeBytes: null, preview: null, truncated: false },
  jsonLdTypes: [], webMcpGate: "unavailable",
  interfaces: [{ schemaVersion: 1, kind: "semantic", name: "Size", metadata: { role: "combobox" }, discoveredAt: FIXTURE_NOW }],
  warnings: [warningFixture], truncated: false,
});

export const admittedTargetFixture = AdmittedPublicTargetSchema.parse({
  schemaVersion: 1, startUrl: evaluationConfigFixture.target.startUrl,
  allowedNavigationOrigins: evaluationConfigFixture.target.allowedNavigationOrigins,
  admittedAt: FIXTURE_NOW, expiresAt: "2026-09-01T12:05:00.000Z",
  policyVersion: "public-safe-v1", enforcement: "forced_proxy_preconnect",
});

export const failedFailureFixture = FailureRecordSchema.parse({
  schemaVersion: 1, category: "incorrect_state", code: "assertion_failed", phase: "grading", retryable: false,
  outcome: "failed", message: "At least one browser-observable assertion was false.", fieldIssues: [], causeChain: [], policyCode: null,
});
export const inconclusiveFailureFixture = FailureRecordSchema.parse({
  schemaVersion: 1, category: "grading", code: "assertion_unverifiable", phase: "grading", retryable: false,
  outcome: "inconclusive", message: "At least one required assertion was unverifiable.", fieldIssues: [], causeChain: [], policyCode: null,
});

const observedAssertions = evaluationConfigFixture.assertions.map((assertion) => ({
  assertionId: assertion.id,
  status: "observed" as const,
  observedResult: true,
  expectedSummary: assertion.kind,
  actualSummary: "observed",
  reasonCode: null,
}));
export const browserAssertionEvidenceFixture = BrowserAssertionEvidenceV1Schema.parse({
  schemaVersion: 1, capturedAt: FIXTURE_NOW, redactedDisplayUrl: "https://demo.tracegate.test/catalog",
  documentIdHash: FIXTURE_DOCUMENT_HASH, loaderIdHash: FIXTURE_LOADER_HASH,
  quietIntervalMs: 750, requiredIdenticalCaptures: 2, captureAttempts: 2, evidenceHash: FIXTURE_EVIDENCE_HASH,
  policyActivity: { passiveWarningCount: 0, agentBlockedCount: 0, codes: [] }, assertions: observedAssertions,
});

export const assertionCaptureResultFixture = AssertionCaptureResultSchema.parse({
  transient: {
    schemaVersion: 1, canonicalFinalUrl: "https://demo.tracegate.test/catalog", documentId: "document-1", loaderId: "loader-1",
    capturedAt: FIXTURE_NOW, assertionObservations: observedAssertions, evidenceHash: FIXTURE_EVIDENCE_HASH,
  },
  evidence: browserAssertionEvidenceFixture,
});

const passingAssertionResults = evaluationConfigFixture.assertions.map((assertion) => ({
  assertionId: assertion.id, status: "passed" as const, expectedSummary: assertion.kind, actualSummary: "observed", code: null,
}));
export const passingGradeFixture = GradeResultV2Schema.parse({
  schemaVersion: 2, evidenceHash: FIXTURE_EVIDENCE_HASH, safetyPolicyVersion: "public-safe-v1", outcome: "passed",
  assertions: passingAssertionResults, failure: null, gradedAt: FIXTURE_NOW,
});
export const failedGradeFixture = GradeResultV2Schema.parse({
  ...passingGradeFixture, outcome: "failed",
  assertions: passingAssertionResults.map((result, index) => index === 0 ? { ...result, status: "failed" as const } : result),
  failure: failedFailureFixture,
});
export const inconclusiveGradeFixture = GradeResultV2Schema.parse({
  ...passingGradeFixture, outcome: "inconclusive",
  assertions: passingAssertionResults.map((result, index) => index === 0 ? { ...result, status: "unverifiable" as const, code: "page_unstable" } : result),
  failure: inconclusiveFailureFixture,
});

export const evaluationFixture = EvaluationSchema.parse({
  schemaVersion: 2, id: FIXTURE_EVALUATION_ID, config: evaluationConfigFixture, status: "queued",
  createdAt: FIXTURE_NOW, startedAt: null, finishedAt: null, failure: null,
});
export const runFixture = RunSchema.parse({
  schemaVersion: 2, id: FIXTURE_RUN_ID, evaluationId: FIXTURE_EVALUATION_ID, runIndex: 0,
  modelId: "deepseek/deepseek-v4-flash-0731", resolvedProvider: null, status: "queued", outcome: null,
  createdAt: FIXTURE_NOW, startedAt: null, finishedAt: null, durationMs: null,
  iterations: 0, toolCalls: 0, browserActions: 0, usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  failure: null, grade: null, replayStatus: "not_requested", releaseStatus: "not_started", warnings: [], potentialSessionLeak: false,
});
export const eventInputFixture = EventAppendInputSchema.parse({
  schemaVersion: 1, eventId: FIXTURE_EVENT_ID, evaluationId: FIXTURE_EVALUATION_ID, runId: FIXTURE_RUN_ID,
  runSequence: 0, type: "run.queued", occurredAt: FIXTURE_NOW, payload: { runIndex: 0 },
});
export const eventEnvelopeFixture = EventEnvelopeSchema.parse({ ...eventInputFixture, cursor: EventCursorSchema.parse("1"), recordedAt: FIXTURE_NOW });
