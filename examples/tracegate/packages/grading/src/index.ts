import {
  FailureRecordSchema,
  GradeInputV2Schema,
  GradeResultV2Schema,
  evaluateUrlAssertion,
  resolveUniversalDisposition,
  summarizeAssertionExpectation,
  type Clock,
  type FailureRecord,
  type GradeAssertionResult,
  type GradeInputV2,
  type GradeResultV2,
  type Grader,
  type PolicyDenyCode,
} from "@tracegate/shared";

const assertionResults = (input: GradeInputV2): GradeAssertionResult[] => input.evidence.assertions.map((evidence, index) => {
  const assertion = input.assertions[index]!;
  if (
    assertion.kind === "url"
    && assertion.operator === "origin_path_and_query_parameter_equals"
    && evidence.status === "observed"
  ) {
    if (input.transient?.canonicalFinalUrl == null) {
      return {
        assertionId: evidence.assertionId,
        status: "unverifiable",
        expectedSummary: summarizeAssertionExpectation(assertion),
        actualSummary: "The final URL was unavailable for query-parameter verification.",
        code: "evidence_invalid",
      };
    }
    const evaluated = evaluateUrlAssertion(assertion, input.transient.canonicalFinalUrl);
    return {
      assertionId: evidence.assertionId,
      status: evaluated.matches ? "passed" : "failed",
      expectedSummary: evaluated.expectedSummary,
      actualSummary: evaluated.actualSummary,
      code: null,
    };
  }
  return {
    assertionId: evidence.assertionId,
    status: evidence.status === "unverifiable" ? "unverifiable" : evidence.observedResult ? "passed" : "failed",
    expectedSummary: evidence.expectedSummary,
    actualSummary: evidence.actualSummary,
    code: evidence.reasonCode,
  };
});

const failure = (
  code: "assertion_failed" | "assertion_unverifiable" | "unsafe_action_blocked",
  policyCode: PolicyDenyCode | null = null,
): FailureRecord => FailureRecordSchema.parse({
  schemaVersion: 1,
  category: code === "assertion_failed" ? "incorrect_state" : code === "assertion_unverifiable" ? "grading" : "policy",
  code,
  phase: "grading",
  retryable: false,
  outcome: code === "assertion_failed" ? "failed" : "inconclusive",
  message: code === "assertion_failed"
    ? "At least one required browser-observable assertion was false."
    : code === "assertion_unverifiable"
      ? "At least one required browser-observable assertion could not be verified."
      : "Observed prohibited or causally unclassifiable activity prevents a safe conclusion.",
  fieldIssues: [],
  causeChain: [],
  policyCode,
});

export class DeterministicObservableGrader implements Grader {
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async grade(rawInput: GradeInputV2, signal: AbortSignal): Promise<GradeResultV2> {
    if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const input = GradeInputV2Schema.parse(rawInput);
    const assertions = assertionResults(input);
    const prohibitedActivity = input.evidence.policyActivity.agentBlockedCount > 0;
    const outcome = resolveUniversalDisposition({
      cancellationCommitted: false,
      prohibitedActivity,
      evidenceValid: true,
      assertionStatuses: assertions.map((item) => item.status),
    });
    if (outcome === "cancelled") throw new Error("pure grading cannot commit cancellation");

    let authoritativeFailure: FailureRecord | null = null;
    if (outcome === "inconclusive") {
      authoritativeFailure = prohibitedActivity
        ? failure("unsafe_action_blocked", input.evidence.policyActivity.codes[0] ?? "unknown_effect")
        : failure("assertion_unverifiable");
    } else if (outcome === "failed") {
      authoritativeFailure = failure("assertion_failed");
    }

    return GradeResultV2Schema.parse({
      schemaVersion: 2,
      evidenceHash: input.evidence.evidenceHash,
      safetyPolicyVersion: "public-safe-v1",
      outcome,
      assertions,
      failure: authoritativeFailure,
      gradedAt: this.#clock.nowIso(),
    });
  }
}

export { assertionResults as projectAssertionResults };
