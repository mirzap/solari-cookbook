import { z } from "zod";
import { CreateAttemptCorrelationIdSchema } from "./ids.ts";
import { PolicyDenyCodeSchema } from "./policy.ts";
import { AdmissionReasonCodeSchema } from "./targets.ts";
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
  "assertion_failed",
  "assertion_unverifiable",
  "unsafe_action_blocked",
  "target_admission_failed",
  "budget_exhausted",
  "stale_element_exhausted",
  "solari_unavailable",
  "target_unavailable",
  "target_evidence_lost",
  "provider_protocol_error",
  "invalid_evidence",
  "session_create_ambiguous",
  "session_release_unconfirmed",
  "unexpected_run_error",
]);

export const WarningCodeSchema = z.enum([
  "stale_element",
  "ambiguous_element",
  "webmcp_degraded",
  "unknown_provider_event",
  "usage_unavailable",
  "passive_policy_blocked",
  "execution_error_after_grade",
  "cleanup_failed",
  "replay_pending",
]);

export const ControlErrorCodeSchema = z.enum([
  "validation_failed",
  "target_admission_failed",
  "unsafe_prompt_rejected",
  "sensitive_input_rejected",
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
}).strict();

const safeErrorBase = z.object({
  schemaVersion: z.literal(1),
  category: ErrorCategorySchema,
  phase: z.string().min(1).max(128).nullable(),
  retryable: z.boolean(),
  message: z.string().min(1).max(2_000),
  fieldIssues: z.array(FieldIssueSchema).max(50).default([]),
  causeChain: z.array(z.string().min(1).max(500)).max(8).default([]),
}).strict();

export const TERMINAL_FAILURE_SEMANTICS = {
  assertion_failed: { category: "incorrect_state", outcome: "failed" },
  assertion_unverifiable: { category: "grading", outcome: "inconclusive" },
  unsafe_action_blocked: { category: "policy", outcome: "inconclusive" },
  target_admission_failed: { category: "infrastructure", outcome: "inconclusive" },
  budget_exhausted: { category: "timeout", outcome: "inconclusive" },
  stale_element_exhausted: { category: "tool_error", outcome: "inconclusive" },
  solari_unavailable: { category: "infrastructure", outcome: "inconclusive" },
  target_unavailable: { category: "infrastructure", outcome: "inconclusive" },
  target_evidence_lost: { category: "infrastructure", outcome: "inconclusive" },
  provider_protocol_error: { category: "model_provider", outcome: "inconclusive" },
  invalid_evidence: { category: "grading", outcome: "inconclusive" },
  session_create_ambiguous: { category: "infrastructure", outcome: "inconclusive" },
  session_release_unconfirmed: { category: "infrastructure", outcome: "inconclusive" },
  unexpected_run_error: { category: "unknown", outcome: "inconclusive" },
} as const;

export const FailureRecordSchema = safeErrorBase.extend({
  code: TerminalFailureCodeSchema,
  outcome: RunOutcomeSchema.exclude(["passed"]),
  policyCode: PolicyDenyCodeSchema.nullable().default(null),
}).superRefine((value, context) => {
  const expected = TERMINAL_FAILURE_SEMANTICS[value.code];
  if (value.category !== expected.category) context.addIssue({ code: "custom", path: ["category"], message: `category must be ${expected.category}` });
  if (value.outcome !== expected.outcome) context.addIssue({ code: "custom", path: ["outcome"], message: `outcome must be ${expected.outcome}` });
  if ((value.code === "unsafe_action_blocked") !== (value.policyCode !== null)) {
    context.addIssue({ code: "custom", path: ["policyCode"], message: "policy code is required only for unsafe_action_blocked" });
  }
});

export const RunWarningSchema = safeErrorBase.extend({ code: WarningCodeSchema });
export const ControlErrorSchema = safeErrorBase.extend({
  code: ControlErrorCodeSchema,
  admissionReason: AdmissionReasonCodeSchema.exclude(["admitted"]).nullable().default(null),
}).superRefine((value, context) => {
  if ((value.code === "target_admission_failed") !== (value.admissionReason !== null)) {
    context.addIssue({ code: "custom", path: ["admissionReason"], message: "admission reason is required only for target admission failure" });
  }
});

export const MAX_SAFE_PROVIDER_RETRY_AFTER_MS = 300_000;
export const BrowserProviderConcurrencyLimitErrorSchema = z.object({
  schemaVersion: z.literal(1),
  category: z.literal("infrastructure"),
  code: z.literal("concurrency_limit_exceeded"),
  phase: z.literal("browser_acquire"),
  sessionCreation: z.literal("definitively_not_created"),
  retryCurrentCreate: z.literal(false),
  message: z.literal("Browser provider concurrency limit exceeded"),
  retryAfterMs: z.number().int().min(0).max(MAX_SAFE_PROVIDER_RETRY_AFTER_MS).nullable(),
  fieldIssues: z.tuple([]),
  causeChain: z.tuple([]),
}).strict();

export const BrowserProviderCreateAmbiguousErrorSchema = z.object({
  schemaVersion: z.literal(1),
  category: z.literal("infrastructure"),
  code: z.literal("session_create_ambiguous"),
  phase: z.literal("browser_acquire"),
  retryCurrentCreate: z.literal(false),
  potentialSessionLeak: z.literal(true),
  attemptCorrelationId: CreateAttemptCorrelationIdSchema,
  message: z.literal("Browser session creation outcome is ambiguous"),
  fieldIssues: z.tuple([]),
  causeChain: z.tuple([]),
}).strict();

export const SafeErrorSchema = z.union([
  FailureRecordSchema,
  RunWarningSchema,
  ControlErrorSchema,
  BrowserProviderConcurrencyLimitErrorSchema,
  BrowserProviderCreateAmbiguousErrorSchema,
]);

export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;
export type TerminalFailureCode = z.infer<typeof TerminalFailureCodeSchema>;
export type FailureRecord = z.infer<typeof FailureRecordSchema>;
export type RunWarning = z.infer<typeof RunWarningSchema>;
export type ControlError = z.infer<typeof ControlErrorSchema>;
export type BrowserProviderConcurrencyLimitError = z.infer<typeof BrowserProviderConcurrencyLimitErrorSchema>;
export type BrowserProviderCreateAmbiguousError = z.infer<typeof BrowserProviderCreateAmbiguousErrorSchema>;
export type SafeError = z.infer<typeof SafeErrorSchema>;
export type FieldIssue = z.infer<typeof FieldIssueSchema>;

export class TraceGateError extends Error {
  readonly safe: SafeError;
  constructor(safe: SafeError, cause?: unknown) {
    super(safe.message, cause === undefined ? undefined : { cause });
    this.name = "TraceGateError";
    this.safe = SafeErrorSchema.parse(safe);
  }
  toJSON(): SafeError { return structuredClone(this.safe); }
}

export function isTraceGateError(value: unknown): value is TraceGateError { return value instanceof TraceGateError; }

export function normalizeProviderRetryAfterMs(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(MAX_SAFE_PROVIDER_RETRY_AFTER_MS, Math.max(0, Math.ceil(value)));
}

export function createBrowserProviderConcurrencyLimitError(retryAfterMs: number | null): TraceGateError {
  return new TraceGateError(BrowserProviderConcurrencyLimitErrorSchema.parse({
    schemaVersion: 1,
    category: "infrastructure",
    code: "concurrency_limit_exceeded",
    phase: "browser_acquire",
    sessionCreation: "definitively_not_created",
    retryCurrentCreate: false,
    message: "Browser provider concurrency limit exceeded",
    retryAfterMs: normalizeProviderRetryAfterMs(retryAfterMs),
    fieldIssues: [],
    causeChain: [],
  }));
}

export function isBrowserProviderConcurrencyLimitError(value: unknown): value is TraceGateError & { readonly safe: BrowserProviderConcurrencyLimitError } {
  return value instanceof TraceGateError && BrowserProviderConcurrencyLimitErrorSchema.safeParse(value.safe).success;
}

export function zodIssuesToFieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message.slice(0, 1_000) }));
}

export function createControlError(
  code: z.infer<typeof ControlErrorCodeSchema>,
  message: string,
  options: Partial<Pick<ControlError, "category" | "phase" | "retryable" | "fieldIssues" | "causeChain" | "admissionReason">> = {},
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
    admissionReason: options.admissionReason ?? null,
  });
}
