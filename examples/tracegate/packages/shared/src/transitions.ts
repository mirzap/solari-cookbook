import { z } from "zod";
import type { ControlError } from "./errors.ts";
import { createControlError } from "./errors.ts";
import { LeaseDispositionSchema, TransitionModeSchema, type EvaluationStatus, type RunStatus } from "./states.ts";

export const EVALUATION_TRANSITIONS: Readonly<Record<EvaluationStatus, readonly EvaluationStatus[]>> = {
  queued: ["running", "cancelling", "failed"],
  running: ["cancelling", "completed", "failed"],
  cancelling: ["cancelled", "completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

const normalRunTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["acquiring_browser", "cancelled"],
  acquiring_browser: ["connecting_browser", "releasing_browser", "cancelled", "completed"],
  connecting_browser: ["discovering", "releasing_browser", "cancelled"],
  discovering: ["running_agent", "releasing_browser", "cancelled"],
  running_agent: ["grading", "releasing_browser", "cancelled"],
  grading: ["releasing_browser", "cancelled", "completed"],
  releasing_browser: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const RUN_TRANSITIONS = normalRunTransitions;

export const RunTransitionContextSchema = z.object({
  mode: TransitionModeSchema,
  leaseDisposition: LeaseDispositionSchema,
});
export type RunTransitionContext = z.infer<typeof RunTransitionContextSchema>;

export type TransitionValidation = { ok: true } | { ok: false; error: ControlError };

export function isLegalEvaluationTransition(from: EvaluationStatus, to: EvaluationStatus): boolean {
  return from !== to && EVALUATION_TRANSITIONS[from].includes(to);
}

export function validateEvaluationTransition(from: EvaluationStatus, to: EvaluationStatus): TransitionValidation {
  if (isLegalEvaluationTransition(from, to)) return { ok: true };
  return {
    ok: false,
    error: createControlError("illegal_transition", `Illegal evaluation transition: ${from} -> ${to}`, {
      category: "incorrect_state",
      phase: "evaluation_transition",
    }),
  };
}

export function isLegalRunTransition(
  from: RunStatus,
  to: RunStatus,
  context: RunTransitionContext,
): boolean {
  if (from === to || from === "completed" || from === "cancelled") return false;

  if (context.mode === "recovery" && to === "completed") {
    return context.leaseDisposition !== "may_exist";
  }

  if (!normalRunTransitions[from].includes(to)) return false;

  if (to === "releasing_browser") return context.leaseDisposition === "may_exist";
  if ((to === "completed" || to === "cancelled") && context.leaseDisposition === "may_exist") return false;
  if (from === "releasing_browser") return context.leaseDisposition === "released";
  if (from === "acquiring_browser" && to === "completed") return context.leaseDisposition === "none";
  if (from === "grading" && to === "completed") return context.leaseDisposition !== "may_exist";
  return true;
}

export function validateRunTransition(
  from: RunStatus,
  to: RunStatus,
  context: RunTransitionContext,
): TransitionValidation {
  if (isLegalRunTransition(from, to, context)) return { ok: true };
  return {
    ok: false,
    error: createControlError("illegal_transition", `Illegal run transition: ${from} -> ${to}`, {
      category: "incorrect_state",
      phase: "run_transition",
    }),
  };
}
