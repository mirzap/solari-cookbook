import { z } from "zod";
import { RunOutcomeSchema } from "./states.ts";

export const ErrorCategorySchema = z.enum([
  "navigation",
  "ambiguity",
  "tool_error",
  "timeout",
  "incorrect_state",
  "unsupported_interface",
  "infrastructure",
  "model_provider",
  "grading",
  "policy",
  "cancellation",
  "unknown",
]);

export const TerminalFailureCodeSchema = z.enum([
  "task_incorrect",
  "task_not_completed",
  "navigation_blocked",
  "budget_exhausted",
  "stale_element_exhausted",
  "latency_budget_exhausted",
  "solari_unavailable",
  "target_unavailable",
  "target_evidence_lost",
  "provider_protocol_error",
  "invalid_evidence",
]);

export const WarningCodeSchema = z.enum([
  "stale_element",
  "ambiguous_element",
  "webmcp_degraded",
  "unknown_provider_event",
  "usage_unavailable",
  "cleanup_failed",
  "replay_pending",
]);

export const ControlErrorCodeSchema = z.enum([
  "validation_failed",
  "illegal_transition",
  "not_found",
  "conflict",
  "capability_blocked",
  "service_unavailable",
  "operation_aborted",
  "user_requested",
  "internal_error",
]);

export const FieldIssueSchema = z.object({
  path: z.string().max(512),
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1_000),
});

const safeErrorBase = z.object({
  schemaVersion: z.literal(1),
  category: ErrorCategorySchema,
  phase: z.string().min(1).max(128).nullable(),
  retryable: z.boolean(),
  message: z.string().min(1).max(2_000),
  fieldIssues: z.array(FieldIssueSchema).max(50).default([]),
  causeChain: z.array(z.string().min(1).max(500)).max(8).default([]),
});

export const TERMINAL_FAILURE_SEMANTICS = {
  task_incorrect: { category: "incorrect_state", outcome: "failed" },
  task_not_completed: { category: "incorrect_state", outcome: "failed" },
  navigation_blocked: { category: "policy", outcome: "failed" },
  budget_exhausted: { category: "timeout", outcome: "failed" },
  stale_element_exhausted: { category: "tool_error", outcome: "failed" },
  latency_budget_exhausted: { category: "infrastructure", outcome: "inconclusive" },
  solari_unavailable: { category: "infrastructure", outcome: "inconclusive" },
  target_unavailable: { category: "infrastructure", outcome: "inconclusive" },
  target_evidence_lost: { category: "infrastructure", outcome: "inconclusive" },
  provider_protocol_error: { category: "model_provider", outcome: "inconclusive" },
  invalid_evidence: { category: "grading", outcome: "inconclusive" },
} as const;

export const FailureRecordSchema = safeErrorBase.extend({
  code: TerminalFailureCodeSchema,
  outcome: RunOutcomeSchema.exclude(["passed"]),
}).superRefine((value, context) => {
  const expected = TERMINAL_FAILURE_SEMANTICS[value.code];
  if (value.category !== expected.category) {
    context.addIssue({ code: "custom", path: ["category"], message: `category must be ${expected.category}` });
  }
  if (value.outcome !== expected.outcome) {
    context.addIssue({ code: "custom", path: ["outcome"], message: `outcome must be ${expected.outcome}` });
  }
});

export const RunWarningSchema = safeErrorBase.extend({
  code: WarningCodeSchema,
});

export const ControlErrorSchema = safeErrorBase.extend({
  code: ControlErrorCodeSchema,
});

export const SafeErrorSchema = z.union([FailureRecordSchema, RunWarningSchema, ControlErrorSchema]);

export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
export type TerminalFailureCode = z.infer<typeof TerminalFailureCodeSchema>;
export type FailureRecord = z.infer<typeof FailureRecordSchema>;
export type RunWarning = z.infer<typeof RunWarningSchema>;
export type ControlError = z.infer<typeof ControlErrorSchema>;
export type SafeError = z.infer<typeof SafeErrorSchema>;
export type FieldIssue = z.infer<typeof FieldIssueSchema>;

export class TraceGateError extends Error {
  readonly safe: SafeError;

  constructor(safe: SafeError, cause?: unknown) {
    super(safe.message, cause === undefined ? undefined : { cause });
    this.name = "TraceGateError";
    this.safe = SafeErrorSchema.parse(safe);
  }

  toJSON(): SafeError {
    return structuredClone(this.safe);
  }
}

export function isTraceGateError(value: unknown): value is TraceGateError {
  return value instanceof TraceGateError;
}

export function zodIssuesToFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message.slice(0, 1_000),
  }));
}

export function createControlError(
  code: z.infer<typeof ControlErrorCodeSchema>,
  message: string,
  options: Partial<Pick<ControlError, "category" | "phase" | "retryable" | "fieldIssues" | "causeChain">> = {},
): ControlError {
  return ControlErrorSchema.parse({
    schemaVersion: 1,
    category: options.category ?? "unknown",
    code,
    phase: options.phase ?? null,
    retryable: options.retryable ?? false,
    message,
    fieldIssues: options.fieldIssues ?? [],
    causeChain: options.causeChain ?? [],
  });
}
