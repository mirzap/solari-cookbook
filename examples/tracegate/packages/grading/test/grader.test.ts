import assert from "node:assert/strict";
import test from "node:test";

import { BrowserAssertionEvidenceV1Schema } from "@tracegate/shared";
import {
  DeterministicClock,
  browserAssertionEvidenceFixture,
  evaluationConfigFixture,
} from "@tracegate/shared/testing";
import { DeterministicObservableGrader } from "../src/index.ts";

const signal = () => new AbortController().signal;
const grader = () => new DeterministicObservableGrader(new DeterministicClock());

test("all complete true observations pass", async () => {
  const result = await grader().grade({ assertions: evaluationConfigFixture.assertions, evidence: browserAssertionEvidenceFixture }, signal());
  assert.equal(result.outcome, "passed");
  assert.equal(result.failure, null);
  assert.equal(result.assertions.every((item) => item.status === "passed"), true);
});

test("a complete false observation fails authoritatively", async () => {
  const evidence = BrowserAssertionEvidenceV1Schema.parse({
    ...browserAssertionEvidenceFixture,
    assertions: browserAssertionEvidenceFixture.assertions.map((item, index) => index === 1
      ? { ...item, observedResult: false, actualSummary: "Title did not contain Catalog" }
      : item),
  });
  const result = await grader().grade({ assertions: evaluationConfigFixture.assertions, evidence }, signal());
  assert.equal(result.outcome, "failed");
  assert.equal(result.failure?.code, "assertion_failed");
  assert.equal(result.assertions[1]?.status, "failed");
});

for (const [index, kind] of evaluationConfigFixture.assertions.map((assertion, index) => [index, assertion.kind] as const)) {
  test(`${kind} assertion false evidence maps deterministically to FAIL`, async () => {
    const evidence = BrowserAssertionEvidenceV1Schema.parse({
      ...browserAssertionEvidenceFixture,
      assertions: browserAssertionEvidenceFixture.assertions.map((item, candidate) => candidate === index
        ? { ...item, observedResult: false, actualSummary: `${kind} observation was false` }
        : item),
    });
    const result = await grader().grade({ assertions: evaluationConfigFixture.assertions, evidence }, signal());
    assert.equal(result.outcome, "failed");
    assert.equal(result.assertions[index]?.status, "failed");
    assert.equal(result.failure?.code, "assertion_failed");
  });
}

test("unverifiable evidence outranks a false observation", async () => {
  const evidence = BrowserAssertionEvidenceV1Schema.parse({
    ...browserAssertionEvidenceFixture,
    assertions: browserAssertionEvidenceFixture.assertions.map((item, index) => index === 0
      ? { ...item, status: "unverifiable", observedResult: null, reasonCode: "page_unstable", actualSummary: "Page did not stabilize" }
      : index === 1 ? { ...item, observedResult: false } : item),
  });
  const result = await grader().grade({ assertions: evaluationConfigFixture.assertions, evidence }, signal());
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.failure?.code, "assertion_unverifiable");
});

test("observed prohibited activity overrides otherwise passing assertions", async () => {
  const evidence = BrowserAssertionEvidenceV1Schema.parse({
    ...browserAssertionEvidenceFixture,
    policyActivity: { passiveWarningCount: 0, agentBlockedCount: 1, codes: ["non_idempotent_request"] },
  });
  const result = await grader().grade({ assertions: evaluationConfigFixture.assertions, evidence }, signal());
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.failure?.code, "unsafe_action_blocked");
  assert.equal(result.failure?.policyCode, "non_idempotent_request");
});

test("grading honors cancellation before doing work", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(grader().grade({ assertions: evaluationConfigFixture.assertions, evidence: browserAssertionEvidenceFixture }, controller.signal), { name: "AbortError" });
});
