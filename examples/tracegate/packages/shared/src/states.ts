import { z } from "zod";

export const EvaluationStatusSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
]);

export const RunStatusSchema = z.enum([
  "queued",
  "acquiring_browser",
  "connecting_browser",
  "discovering",
  "running_agent",
  "grading",
  "releasing_browser",
  "completed",
  "cancelled",
]);

export const RunOutcomeSchema = z.enum(["passed", "failed", "inconclusive"]);
export const ReplayStatusSchema = z.enum([
  "not_requested",
  "unsupported",
  "recording",
  "pending",
  "ready",
  "failed",
]);
export const ReleaseStatusSchema = z.enum([
  "not_started",
  "releasing",
  "released",
  "failed",
  "unknown",
]);
export const TransitionModeSchema = z.enum(["normal", "recovery"]);
export const LeaseDispositionSchema = z.enum(["none", "may_exist", "released"]);

export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;
export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>;
export type TransitionMode = z.infer<typeof TransitionModeSchema>;
export type LeaseDisposition = z.infer<typeof LeaseDispositionSchema>;

export const TERMINAL_EVALUATION_STATUSES: ReadonlySet<EvaluationStatus> = new Set([
  "completed",
  "cancelled",
  "failed",
]);
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "cancelled",
]);
