import assert from "node:assert/strict";
import test from "node:test";

import * as sharedExports from "../src/index.ts";
import {
  AgentExecutionInputV2Schema,
  AgentTraceEventSchema,
  AdmittedPublicTargetSchema,
  AssertionCaptureResultSchema,
  AssertionSetV1Schema,
  BrowserAssertionEvidenceV1Schema,
  BrowserProviderConcurrencyLimitErrorSchema,
  EffectDecisionSchema,
  EvaluationAggregateV2Schema,
  EvaluationConfigSchema,
  EventAppendInputSchema,
  EventTypeSchema,
  FailureRecordSchema,
  GradeInputV2Schema,
  GradeResultSchema,
  PolicyDenyCodeSchema,
  ProviderCapacityStateSchema,
  ReleaseResultSchema,
  SafeAgentToolExchangeSchema,
  PublicEvaluationConfigV2Schema,
  PublicHttpsOriginSchema,
  PublicHttpsUrlSchema,
  RunStatusSchema,
  ServerEnvSchema,
  TERMINAL_FAILURE_SEMANTICS,
  UntrustedAgentObservationSchema,
  UntrustedWebMcpResultV1Schema,
  WebMcpToolDescriptorV1Schema,
  buildAgentExecutionInputV2,
  createBrowserProviderConcurrencyLimitError,
  isBrowserProviderConcurrencyLimitError,
  redactJson,
  resolveUniversalDisposition,
} from "../src/index.ts";
import {
  ASSERTION_ONLY_CANARY,
  admittedTargetFixture,
  agentExecutionInputFixture,
  assertionCanaryConfigFixture,
  assertionCaptureResultFixture,
  browserAssertionEvidenceFixture,
  eventEnvelopeFixture,
  evaluationConfigFixture,
  failedFailureFixture,
  failedGradeFixture,
  inconclusiveGradeFixture,
  observationFixture,
  passingGradeFixture,
  runFixture,
  webMcpResultFixture,
  webMcpToolDescriptorFixture,
} from "../src/testing/index.ts";

test("canonical V2 fixtures satisfy authoritative schemas", () => {
  assert.equal(EvaluationConfigSchema.parse(evaluationConfigFixture).schemaVersion, 2);
  assert.equal(UntrustedAgentObservationSchema.parse(observationFixture).trust, "untrusted_page_content");
  assert.equal(GradeResultSchema.parse(passingGradeFixture).outcome, "passed");
  assert.equal(BrowserAssertionEvidenceV1Schema.parse(browserAssertionEvidenceFixture).requiredIdenticalCaptures, 2);
  assert.equal(eventEnvelopeFixture.cursor, "1");
  assert.equal(runFixture.status, "queued");
});

test("public target and config are bounded, exact-origin, and V2-only", () => {
  assert.equal(PublicEvaluationConfigV2Schema.parse(evaluationConfigFixture).assertions.length, 4);
  assert.equal(PublicEvaluationConfigV2Schema.parse(evaluationConfigFixture).webMcpReadOnlyEnabled, false);
  assert.equal(PublicEvaluationConfigV2Schema.parse({ ...evaluationConfigFixture, webMcpReadOnlyEnabled: true }).webMcpReadOnlyEnabled, true);
  assert.equal(PublicHttpsUrlSchema.safeParse("http://example.test").success, false);
  assert.equal(PublicHttpsUrlSchema.safeParse("https://127.0.0.1/path").success, false);
  assert.equal(PublicHttpsOriginSchema.safeParse("https://example.test/path").success, false);
  assert.equal(PublicEvaluationConfigV2Schema.safeParse({ ...evaluationConfigFixture, schemaVersion: 1 }).success, false);
  assert.equal(PublicEvaluationConfigV2Schema.safeParse({
    ...evaluationConfigFixture,
    assertions: [...evaluationConfigFixture.assertions, ...evaluationConfigFixture.assertions.slice(0, 1)],
  }).success, false, "duplicate assertion IDs are rejected");
  assert.equal(PublicEvaluationConfigV2Schema.safeParse({
    ...evaluationConfigFixture,
    assertions: [{ ...evaluationConfigFixture.assertions[0], expectedUrl: "https://other.test/path" }],
  }).success, false, "URL assertion origin must be declared");
  assert.equal(AdmittedPublicTargetSchema.safeParse({
    schemaVersion: 1,
    startUrl: "https://example.test/path",
    allowedNavigationOrigins: ["https://example.test"],
    admittedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-09-01T12:05:00.000Z",
    policyVersion: "public-safe-v1",
    enforcement: "practical_best_effort",
    practicalControls: {
      dnsPreflight: "public_answers_only",
      serviceWorkers: "blocked",
      requestInterception: "get_head_only_observable",
      limitations: ["no_provider_preconnect_ip_enforcement", "dns_rebinding_not_fully_prevented"],
    },
  }).success, true);
  assert.equal(AdmittedPublicTargetSchema.safeParse({
    ...admittedTargetFixture,
    enforcement: "practical_best_effort",
    practicalControls: null,
  }).success, false);
});

test("assertion DSL variants are closed and bounded", () => {
  assert.equal(new Set(evaluationConfigFixture.assertions.map((item) => item.kind)).size, 4);
  assert.equal(AssertionSetV1Schema.safeParse([]).success, false);
  assert.equal(AssertionSetV1Schema.safeParse(Array.from({ length: 21 }, (_, index) => ({
    schemaVersion: 1, id: `a${index}`, kind: "text", scope: "title", operator: "contains", expected: "x", caseSensitive: false,
  }))).success, false);
  assert.equal(AssertionSetV1Schema.safeParse([{ schemaVersion: 1, id: "x", kind: "backend", expected: true }]).success, false);
});

test("assertion evidence separates transient raw URL from redacted durable evidence", () => {
  assert.equal(assertionCaptureResultFixture.transient.canonicalFinalUrl, "https://demo.tracegate.test/catalog");
  assert.equal("canonicalFinalUrl" in browserAssertionEvidenceFixture, false);
  assert.equal("documentId" in browserAssertionEvidenceFixture, false);
  assert.equal(BrowserAssertionEvidenceV1Schema.safeParse({
    ...browserAssertionEvidenceFixture,
    canonicalFinalUrl: assertionCaptureResultFixture.transient.canonicalFinalUrl,
  }).success, false);
});

test("assertion-only canary cannot flow into assertion-free agent DTO or agent trace events", () => {
  assert.equal(JSON.stringify(assertionCanaryConfigFixture.assertions).includes(ASSERTION_ONLY_CANARY), true);
  const projected = buildAgentExecutionInputV2(
    assertionCanaryConfigFixture,
    observationFixture,
    agentExecutionInputFixture.capabilities.availableTools,
  );
  const serializedInput = JSON.stringify(AgentExecutionInputV2Schema.parse(projected));
  assert.equal(serializedInput.includes(ASSERTION_ONLY_CANARY), false);
  assert.equal(AgentExecutionInputV2Schema.safeParse({
    ...agentExecutionInputFixture,
    assertions: assertionCanaryConfigFixture.assertions,
  }).success, false);
  assert.equal(AgentTraceEventSchema.safeParse({
    type: "run.agent.message",
    payload: { role: "assistant", summary: "bounded", assertionCanary: ASSERTION_ONLY_CANARY },
  }).success, false);
  const lexicalCoincidence = buildAgentExecutionInputV2(
    PublicEvaluationConfigV2Schema.parse({ ...evaluationConfigFixture, prompt: `Inspect visible text ${ASSERTION_ONLY_CANARY}` }),
    observationFixture,
    ["inspect", "finish"],
  );
  assert.equal(lexicalCoincidence.userTask.includes(ASSERTION_ONLY_CANARY), true, "user-authored lexical overlap is not an assertion-provenance failure");
});

test("WebMCP contracts expose only admitted bounded read-only capabilities and untrusted results", () => {
  assert.equal(WebMcpToolDescriptorV1Schema.parse(webMcpToolDescriptorFixture).declaredReadOnly, true);
  assert.equal(UntrustedWebMcpResultV1Schema.parse(webMcpResultFixture).trust, "untrusted_page_tool_result");
  assert.equal(WebMcpToolDescriptorV1Schema.safeParse({ ...webMcpToolDescriptorFixture, declaredReadOnly: false }).success, false);
  assert.equal(WebMcpToolDescriptorV1Schema.safeParse({
    ...webMcpToolDescriptorFixture,
    inputSchema: { type: "object", properties: { destinationUrl: { type: "string" } }, required: [], additionalProperties: false },
  }).success, false);
  assert.equal(WebMcpToolDescriptorV1Schema.safeParse({
    ...webMcpToolDescriptorFixture,
    inputSchema: { ...webMcpToolDescriptorFixture.inputSchema, additionalProperties: true },
  }).success, false);
  assert.equal(UntrustedWebMcpResultV1Schema.safeParse({ ...webMcpResultFixture, redacted: false }).success, false);
  assert.equal(JSON.stringify(webMcpToolDescriptorFixture).includes(ASSERTION_ONLY_CANARY), false);
  assert.equal(JSON.stringify(webMcpResultFixture).includes(ASSERTION_ONLY_CANARY), false);
  assert.equal(SafeAgentToolExchangeSchema.safeParse({
    action: { kind: "invokeWebMcpReadOnly", toolCallId: "tool-webmcp", observationRevision: 1, toolId: webMcpToolDescriptorFixture.id, input: { query: "engineer", minimumSalary: 150_000 } },
    result: {
      schemaVersion: 1, toolCallId: "tool-webmcp", tool: "invokeWebMcpReadOnly",
      decision: { decision: "allow", effect: "admitted_read_only_webmcp", observationRevision: 1 },
      observation: observationFixture, finishedBelief: null, summary: "Read-only page capability completed.", webMcpResult: webMcpResultFixture,
    },
  }).success, true);
});

test("universal outcome precedence is cancellation, policy, unverifiable, false, pass", () => {
  assert.equal(resolveUniversalDisposition({ cancellationCommitted: true, prohibitedActivity: true, evidenceValid: false, assertionStatuses: ["failed"] }), "cancelled");
  assert.equal(resolveUniversalDisposition({ cancellationCommitted: false, prohibitedActivity: true, evidenceValid: true, assertionStatuses: ["passed"] }), "inconclusive");
  assert.equal(resolveUniversalDisposition({ cancellationCommitted: false, prohibitedActivity: false, evidenceValid: true, assertionStatuses: ["failed", "unverifiable"] }), "inconclusive");
  assert.equal(resolveUniversalDisposition({ cancellationCommitted: false, prohibitedActivity: false, evidenceValid: true, assertionStatuses: ["failed"] }), "failed");
  assert.equal(resolveUniversalDisposition({ cancellationCommitted: false, prohibitedActivity: false, evidenceValid: true, assertionStatuses: ["passed"] }), "passed");
});

test("grades bind exact evidence, support universal policy override, and reject contradictions", () => {
  assert.equal(GradeInputV2Schema.safeParse({ assertions: evaluationConfigFixture.assertions, evidence: browserAssertionEvidenceFixture }).success, true);
  assert.equal(AssertionCaptureResultSchema.safeParse({
    ...assertionCaptureResultFixture,
    evidence: { ...assertionCaptureResultFixture.evidence, assertions: assertionCaptureResultFixture.evidence.assertions.map((item, index) => index === 0 ? { ...item, actualSummary: "contradiction" } : item) },
  }).success, false);
  const policyFailure = FailureRecordSchema.parse({
    ...failedFailureFixture,
    category: "policy", code: "unsafe_action_blocked", outcome: "inconclusive", policyCode: "unknown_effect",
  });
  assert.equal(GradeResultSchema.safeParse({ ...passingGradeFixture, outcome: "inconclusive", failure: policyFailure }).success, true);
  assert.equal(GradeResultSchema.parse(failedGradeFixture).outcome, "failed");
  assert.equal(GradeResultSchema.parse(inconclusiveGradeFixture).outcome, "inconclusive");
  assert.equal(GradeResultSchema.safeParse({ ...passingGradeFixture, outcome: "failed" }).success, false);
  assert.equal(GradeResultSchema.safeParse({ ...failedGradeFixture, outcome: "passed", failure: null }).success, false);
});

test("lifecycle, capacity, aggregate, event, status, policy and effect variants are closed", () => {
  assert.equal(ReleaseResultSchema.safeParse({ status: "released", confirmation: "unconfirmed", releasedAt: null, warning: null }).success, false);
  assert.equal(ProviderCapacityStateSchema.safeParse({ configuredMaximum: 3, effectiveCapacity: 4, retryAfterMs: null }).success, false);
  assert.equal(EvaluationAggregateV2Schema.safeParse({
    requested: 1, started: 1, passed: 1, failed: 0, inconclusive: 0, cancelled: 0, nonterminal: 0, potentialLeaks: 0,
    endToEndPassRate: { numerator: 1, denominator: 1, value: 0.5 },
    gradeableObservableStateSuccess: { numerator: 1, denominator: 1, value: 1 },
  }).success, false);
  assert.equal(SafeAgentToolExchangeSchema.safeParse({
    action: { kind: "inspect", toolCallId: "tool-contract", observationRevision: 1 },
    result: { schemaVersion: 1, toolCallId: "tool-contract", tool: "inspect", decision: { decision: "allow", effect: "passive_wait", observationRevision: 1 }, observation: observationFixture, finishedBelief: null, summary: "wrong effect" },
  }).success, false);
  assert.equal(EventTypeSchema.safeParse("run.evidence.captured").success, true);
  assert.equal(EventTypeSchema.safeParse("run.secret_leaked").success, false);
  assert.equal(RunStatusSchema.safeParse("retrying").success, false);
  assert.equal(PolicyDenyCodeSchema.safeParse("unknown_allow").success, false);
  assert.equal(EffectDecisionSchema.safeParse({ decision: "allow", effect: "unknown", code: null, rationale: "x" }).success, false);
  assert.equal(EventAppendInputSchema.safeParse({
    ...eventEnvelopeFixture,
    cursor: undefined,
    recordedAt: undefined,
    runId: null,
    runSequence: null,
  }).success, false);
});

test("terminal failures and capacity limits are exhaustive and typed", () => {
  for (const [code, semantics] of Object.entries(TERMINAL_FAILURE_SEMANTICS)) {
    const policyCode = code === "unsafe_action_blocked" ? "unknown_effect" : null;
    assert.equal(FailureRecordSchema.safeParse({ ...failedFailureFixture, code, category: semantics.category, outcome: semantics.outcome, policyCode }).success, true, code);
  }
  const error = createBrowserProviderConcurrencyLimitError(999_999);
  assert.equal(isBrowserProviderConcurrencyLimitError(error), true);
  assert.equal(BrowserProviderConcurrencyLimitErrorSchema.parse(error.safe).retryAfterMs, 300_000);
  assert.equal(BrowserProviderConcurrencyLimitErrorSchema.safeParse({ ...error.safe, retryCurrentCreate: true }).success, false);
});

test("central redactor removes known and patterned secrets and bounds output", () => {
  const redacted = redactJson({
    authorization: "Bearer should-never-persist",
    nested: { apiKey: "known-secret", note: "prefix known-secret suffix" },
    url: "wss://provider.invalid/connect?token=secret-value",
    credentialsUrl: "https://user:password@example.invalid/path",
    long: "x".repeat(20),
  }, { knownSecrets: ["known-secret"], maxStringLength: 8 });
  const serialized = JSON.stringify(redacted);
  for (const secret of ["known-secret", "should-never-persist", "secret-value", "password"]) assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[TRUNCATED]"), true);
});

test("production root exports contain no Demo admin/challenge/cart grading contract", () => {
  const names = Object.keys(sharedExports);
  assert.equal(names.some((name) => /DemoAdmin|DemoChallenge|CartGrade|ChallengeId/.test(name)), false);
});

test("P0 environment is loopback-only and local-file-only", () => {
  const base = {
    OPENROUTER_API_KEY: "openrouter-test-key",
    SOLARI_API_KEY: "solari-test-key",
    DATABASE_URL: "file:tracegate.db",
    TRACEGATE_BIND_HOST: "127.0.0.1",
  };
  assert.equal(ServerEnvSchema.safeParse(base).success, true);
  assert.equal(ServerEnvSchema.safeParse({ ...base, SOLARI_API_KEY: " padded " }).success, false);
  assert.equal(ServerEnvSchema.safeParse({ ...base, DATABASE_URL: "https://remote.invalid/db" }).success, false);
  assert.equal(ServerEnvSchema.safeParse({ ...base, TRACEGATE_BIND_HOST: "0.0.0.0" }).success, false);
});
