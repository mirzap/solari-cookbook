import {
  AGENT_COMPLETION_DISPOSITION_MESSAGES,
  FailureRecordSchema,
  GradeInputV2Schema,
  GradeResultV2Schema,
  resolveUniversalDisposition,
  type AgentCompletionDisposition,
  type Clock,
  type FailureRecord,
  type GradeAssertionResult,
  type GradeInputV2,
  type GradeResultV2,
  type Grader,
  type PolicyDenyCode,
} from "@tracegate/shared";

const assertionResults = (input: GradeInputV2): GradeAssertionResult[] => input.evidence.assertions.map((evidence) => ({
  assertionId: evidence.assertionId,
  status: evidence.status === "unverifiable" ? "unverifiable" : evidence.observedResult ? "passed" : "failed",
  expectedSummary: evidence.expectedSummary,
  actualSummary: evidence.actualSummary,
  code: evidence.reasonCode,
}));

type GradingFailureCode =
  | "assertion_failed"
  | "assertion_unverifiable"
  | "unsafe_action_blocked"
  | "agent_policy_refused"
  | "agent_blocked"
  | "agent_needs_input";

const completionFailureCode = (disposition: Exclude<AgentCompletionDisposition, "completed">): GradingFailureCode => ({
  policy_refused: "agent_policy_refused",
  blocked: "agent_blocked",
  needs_input: "agent_needs_input",
})[disposition] as GradingFailureCode;

const failure = (
  code: GradingFailureCode,
  policyCode: PolicyDenyCode | null = null,
): FailureRecord => {
  const category = code === "assertion_failed"
    ? "incorrect_state"
    : code === "assertion_unverifiable"
      ? "grading"
      : code === "agent_blocked" || code === "agent_needs_input"
        ? "ambiguity"
        : "policy";
  const message = code === "assertion_failed"
    ? "At least one required browser-observable assertion was false."
    : code === "assertion_unverifiable"
      ? "At least one required browser-observable assertion could not be verified."
      : code === "unsafe_action_blocked"
        ? "Observed prohibited or causally unclassifiable activity prevents a safe conclusion."
        : AGENT_COMPLETION_DISPOSITION_MESSAGES[
            code === "agent_policy_refused" ? "policy_refused" : code === "agent_needs_input" ? "needs_input" : "blocked"
          ];
  return FailureRecordSchema.parse({
    schemaVersion: 1,
    category,
    code,
    phase: "grading",
    retryable: false,
    outcome: code === "assertion_failed" ? "failed" : "inconclusive",
    message,
    fieldIssues: [],
    causeChain: [],
    policyCode,
  });
};

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
      agentCompletionDisposition: input.agentCompletionDisposition,
      prohibitedActivity,
      evidenceValid: true,
      assertionStatuses: assertions.map((item) => item.status),
    });
    if (outcome === "cancelled") throw new Error("pure grading cannot commit cancellation");

    let authoritativeFailure: FailureRecord | null = null;
    if (outcome === "inconclusive") {
      authoritativeFailure = prohibitedActivity
        ? failure("unsafe_action_blocked", input.evidence.policyActivity.codes[0] ?? "unknown_effect")
        : input.agentCompletionDisposition !== "completed"
          ? failure(completionFailureCode(input.agentCompletionDisposition))
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
