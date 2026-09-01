import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentObservationSchema,
  EvaluationConfigSchema,
  EventAppendInputSchema,
  EventTypeSchema,
  DemoChallengeProvisionSchema,
  DemoGradeEvidenceEnvelopeSchema,
  DemoMutationRevisionSchema,
  ObservationRevisionSchema,
  FinalizeRunInputSchema,
  GradeResultSchema,
  PublicEvaluationConfigInputSchema,
  RunStatusSchema,
  RunSchema,
  ServerEnvSchema,
  TERMINAL_FAILURE_SEMANTICS,
  FailureRecordSchema,
  redactJson,
} from "../src/index.ts";
import {
  discoveryFixture,
  eventEnvelopeFixture,
  evaluationConfigFixture,
  failedFailureFixture,
  gradeEvidenceFixture,
  demoChallengeFixture,
  demoGradeEvidenceEnvelopeFixture,
  observationFixture,
  passingGradeFixture,
  runFixture,
} from "../src/testing/index.ts";

test("canonical fixtures satisfy authoritative schemas", () => {
  assert.equal(EvaluationConfigSchema.parse(evaluationConfigFixture).schemaVersion, 1);
  assert.equal(AgentObservationSchema.parse(observationFixture).revision, 1);
  assert.equal(discoveryFixture.observationRevision, observationFixture.revision);
  assert.equal(GradeResultSchema.parse(passingGradeFixture).outcome, "passed");
  assert.equal(gradeEvidenceFixture.cart[0]?.variant.size, "M");
  assert.equal(eventEnvelopeFixture.cursor, "1");
  assert.equal(runFixture.status, "queued");
});

test("evaluation config applies bounded defaults and public input excludes admin URL", () => {
  const { adminBaseUrl: _adminBaseUrl, ...publicTarget } = evaluationConfigFixture.target;
  const parsed = PublicEvaluationConfigInputSchema.parse({
    schemaVersion: 1,
    target: publicTarget,
    goal: evaluationConfigFixture.goal,
    successCriterion: evaluationConfigFixture.successCriterion,
    modelIds: evaluationConfigFixture.modelIds,
    allowedOrigins: evaluationConfigFixture.allowedOrigins,
  });
  assert.equal(parsed.requestedRunsPerModel, 3);
  assert.equal(parsed.budgets.wallClockMs, 120_000);
  assert.equal("adminBaseUrl" in parsed.target, false);
  assert.throws(() => PublicEvaluationConfigInputSchema.parse({ ...parsed, allowedOrigins: ["https://other.invalid"] }));
});

test("event and status variants are closed and enforce event scope", () => {
  assert.equal(EventTypeSchema.safeParse("run.passed").success, true);
  assert.equal(EventTypeSchema.safeParse("run.secret_leaked").success, false);
  assert.equal(RunStatusSchema.safeParse("retrying").success, false);
  assert.equal(EventAppendInputSchema.safeParse({
    ...eventEnvelopeFixture,
    cursor: undefined,
    recordedAt: undefined,
    runId: null,
    runSequence: null,
  }).success, false);
});

test("terminal failure taxonomy permits exactly its frozen category/outcome pair", () => {
  for (const [code, semantics] of Object.entries(TERMINAL_FAILURE_SEMANTICS)) {
    const valid = FailureRecordSchema.safeParse({
      ...failedFailureFixture,
      code,
      category: semantics.category,
      outcome: semantics.outcome,
    });
    assert.equal(valid.success, true, code);
    const wrongOutcome = semantics.outcome === "failed" ? "inconclusive" : "failed";
    assert.equal(FailureRecordSchema.safeParse({
      ...failedFailureFixture,
      code,
      category: semantics.category,
      outcome: wrongOutcome,
    }).success, false, `${code} wrong outcome`);
  }
});

test("grades reject contradictory predicates and evidence", () => {
  assert.equal(GradeResultSchema.safeParse({
    ...passingGradeFixture,
    predicates: passingGradeFixture.predicates.map((predicate, index) => index === 0 ? { ...predicate, passed: false } : predicate),
  }).success, false);
  assert.equal(GradeResultSchema.safeParse({ ...passingGradeFixture, outcome: "inconclusive", failure: null }).success, false);
});

test("trusted demo mutation revisions are independent from DOM observation revisions", () => {
  assert.equal(DemoMutationRevisionSchema.parse(0), 0);
  assert.equal(ObservationRevisionSchema.safeParse(0).success, false);
  assert.equal(gradeEvidenceFixture.revision, 2);
  assert.equal(observationFixture.revision, 1);
  assert.equal(DemoGradeEvidenceEnvelopeSchema.parse(demoGradeEvidenceEnvelopeFixture).runId, runFixture.id);
  assert.equal(DemoGradeEvidenceEnvelopeSchema.safeParse({
    ...demoGradeEvidenceEnvelopeFixture,
    challengeId: "different-challenge-id",
  }).success, false);
});

test("challenge navigation is an ephemeral HTTPS server-only value", () => {
  assert.equal(DemoChallengeProvisionSchema.parse(demoChallengeFixture).navigationUrl.startsWith("https://"), true);
  assert.equal(DemoChallengeProvisionSchema.safeParse({ ...demoChallengeFixture, navigationUrl: "http://remote.invalid/run/token" }).success, false);
  assert.equal(DemoChallengeProvisionSchema.safeParse({ ...demoChallengeFixture, navigationUrl: "https://user:password@demo.tracegate.test/run/token" }).success, false);
  assert.equal(DemoChallengeProvisionSchema.safeParse({ ...demoChallengeFixture, navigationUrl: "https://demo.tracegate.test/run/token#" }).success, false);
  assert.equal(DemoChallengeProvisionSchema.safeParse({ ...demoChallengeFixture, navigationUrl: "https://demo.tracegate.test/run/token#section" }).success, false);
});

test("completed run and finalization contracts reject contradictory outcomes", () => {
  assert.equal(RunSchema.safeParse({
    ...runFixture,
    status: "completed",
    outcome: "passed",
    grade: { ...passingGradeFixture, outcome: "failed" },
    finishedAt: runFixture.createdAt,
  }).success, false);
  assert.equal(FinalizeRunInputSchema.safeParse({
    runId: runFixture.id,
    expectedStatus: "grading",
    outcome: "passed",
    grade: passingGradeFixture,
    failure: failedFailureFixture,
    warnings: [],
    finishedAt: runFixture.createdAt,
    event: { ...eventEnvelopeFixture, cursor: undefined, recordedAt: undefined, type: "run.failed", payload: { outcome: "failed", failure: failedFailureFixture } },
  }).success, false);
});

test("observation refs cannot cross revisions", () => {
  const invalid = structuredClone(observationFixture);
  invalid.elements[0]!.ref = "e:2:1" as typeof invalid.elements[0]["ref"];
  assert.equal(AgentObservationSchema.safeParse(invalid).success, false);
});

test("central redactor removes known and patterned secrets and bounds output", () => {
  const redacted = redactJson({
    authorization: "Bearer should-never-persist",
    basic: "Authorization: Basic dXNlcjpwYXNzd29yZA==",
    nested: { apiKey: "known-secret", note: "prefix known-secret suffix" },
    url: "wss://provider.invalid/connect?token=secret-value",
    credentialsUrl: "https://user:password@example.invalid/path",
    signedUrl: "https://replay.invalid/view?signature=secret-signature&challenge=secret-challenge",
    long: "x".repeat(20),
  }, { knownSecrets: ["known-secret"], maxStringLength: 8 });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("known-secret"), false);
  assert.equal(serialized.includes("should-never-persist"), false);
  assert.equal(serialized.includes("secret-value"), false);
  assert.equal(serialized.includes("dXNlcjpwYXNzd29yZA"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("secret-signature"), false);
  assert.equal(serialized.includes("secret-challenge"), false);
  assert.equal(serialized.includes("[TRUNCATED]"), true);
});

test("environment rejects secret whitespace, credentials, and remote plaintext admin URLs", () => {
  const base = {
    OPENROUTER_API_KEY: "openrouter-test-key",
    SOLARI_API_KEY: "solari-test-key",
    DATABASE_URL: "file:tracegate.db",
    TRACEGATE_PUBLIC_BASE_URL: "https://demo.tracegate.test",
    TRACEGATE_ADMIN_BASE_URL: "http://127.0.0.1:3000",
  };
  assert.equal(ServerEnvSchema.safeParse(base).success, true);
  assert.equal(ServerEnvSchema.safeParse({ ...base, SOLARI_API_KEY: " padded " }).success, false);
  assert.equal(ServerEnvSchema.safeParse({ ...base, TRACEGATE_PUBLIC_BASE_URL: "https://user:password@demo.tracegate.test" }).success, false);
  assert.equal(ServerEnvSchema.safeParse({ ...base, TRACEGATE_ADMIN_BASE_URL: "http://remote.invalid" }).success, false);
});
