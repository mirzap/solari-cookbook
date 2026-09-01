import {
  FailureRecordSchema,
  TERMINAL_FAILURE_SEMANTICS,
  TraceGateError,
  createControlError,
  redactError,
  type PolicyDenyCode,
  type TerminalFailureCode,
} from "@tracegate/shared";

export function terminalError(
  code: TerminalFailureCode,
  message: string,
  phase: string,
  options: { readonly cause?: unknown; readonly policyCode?: PolicyDenyCode } = {},
): TraceGateError {
  const semantics = TERMINAL_FAILURE_SEMANTICS[code];
  const safeCause = options.cause === undefined ? [] : [redactError(options.cause).message.slice(0, 500)];
  return new TraceGateError(FailureRecordSchema.parse({
    schemaVersion: 1,
    category: semantics.category,
    code,
    outcome: semantics.outcome,
    phase,
    retryable: code === "provider_protocol_error",
    message: String(redactError(message).message).slice(0, 2_000),
    fieldIssues: [],
    causeChain: safeCause,
    policyCode: options.policyCode ?? null,
  }), options.cause);
}

export function abortedError(phase: string): TraceGateError {
  return new TraceGateError(createControlError("operation_aborted", "Agent operation was cancelled", {
    category: "cancellation",
    phase,
  }));
}

export function throwIfAborted(signal: AbortSignal, phase: string): void {
  if (signal.aborted) throw abortedError(phase);
}
