import type {
  BrowserSessionRepository,
  EvaluationRepository,
  EvaluationSubmissionRepository,
  EventRepository,
  ProviderCreateAttemptRepository,
  RunRepository,
  RunTransitionRepository,
  RuntimeCapability,
  BrowserAssertionEvidenceV1,
  EvaluationId,
  GradeResult,
  RunId,
} from "@tracegate/shared";

import {
  TracegateDatabase,
  type PersistedCleanupState,
  type PersistedEvaluationReport,
} from "./database.ts";

export interface CapabilityCheckRepository {
  upsert(capability: RuntimeCapability, signal: AbortSignal): Promise<RuntimeCapability>;
  list(signal: AbortSignal): Promise<readonly RuntimeCapability[]>;
}

export interface AssertionEvidenceRepository {
  upsert(runId: RunId, evidence: BrowserAssertionEvidenceV1, signal: AbortSignal): Promise<BrowserAssertionEvidenceV1>;
  get(runId: RunId, signal: AbortSignal): Promise<BrowserAssertionEvidenceV1 | null>;
}

export interface GradeRepository {
  get(runId: RunId, signal: AbortSignal): Promise<GradeResult | null>;
}

export interface CleanupRepository {
  get(evaluationId: EvaluationId, signal: AbortSignal): Promise<PersistedCleanupState | null>;
}

export interface ReportRepository {
  get(evaluationId: EvaluationId, signal: AbortSignal): Promise<PersistedEvaluationReport | null>;
}

export interface TracegateRepositories {
  readonly submissions: EvaluationSubmissionRepository;
  readonly evaluations: EvaluationRepository;
  readonly runs: RunRepository;
  readonly runTransitions: RunTransitionRepository;
  readonly events: EventRepository;
  readonly browserSessions: BrowserSessionRepository;
  readonly providerCreateAttempts: ProviderCreateAttemptRepository;
  readonly capabilities: CapabilityCheckRepository;
  readonly assertionEvidence: AssertionEvidenceRepository;
  readonly grades: GradeRepository;
  readonly cleanup: CleanupRepository;
  readonly reports: ReportRepository;
}

export function createTracegateRepositories(database: TracegateDatabase): TracegateRepositories {
  return {
    submissions: {
      transactionallyCreate: (input, signal) => database.transactionallyCreateSubmission(input, signal),
    },
    evaluations: {
      create: (evaluation, signal) => database.createEvaluation(evaluation, signal),
      get: (id, signal) => database.getEvaluation(id, signal),
      compareAndSetStatus: (id, expected, next, patch, signal) => database.compareAndSetEvaluationStatus(id, expected, next, patch, signal),
      listRecoverable: (signal) => database.listRecoverableEvaluations(signal),
    },
    runs: {
      create: (run, signal) => database.createRun(run, signal),
      get: (id, signal) => database.getRun(id, signal),
      compareAndSetStatus: (id, expected, next, patch, signal) => database.compareAndSetRunStatus(id, expected, next, patch, signal),
      listRecoverable: (signal) => database.listRecoverableRuns(signal),
      transactionallyFinalize: (input, signal) => database.transactionallyFinalize(input, signal),
      transactionallyCancel: (input, signal) => database.transactionallyCancel(input, signal),
    },
    runTransitions: {
      transactionallyApply: (input, signal) => database.transactionallyApplyRunTransition(input, signal),
    },
    events: {
      append: (input, signal) => database.appendEvent(input, signal),
      listAfter: (evaluationId, cursor, limit, signal) => database.listEventsAfter(evaluationId, cursor, limit, signal),
      earliestCursor: (evaluationId, signal) => database.earliestEventCursor(evaluationId, signal),
      latestCursor: (evaluationId, signal) => database.latestEventCursor(evaluationId, signal),
    },
    browserSessions: {
      upsert: (session, signal) => database.upsertBrowserSession(session, signal),
      get: (runId, signal) => database.getBrowserSession(runId, signal),
      listPotentiallyLeaked: (signal) => database.listPotentiallyLeakedBrowserSessions(signal),
    },
    providerCreateAttempts: {
      recordStarted: (record, signal) => database.recordProviderCreateAttempt(record, signal),
      transition: (runId, attemptCorrelationId, expected, next, signal) => database.transitionProviderCreateAttempt(runId, attemptCorrelationId, expected, next, signal),
      get: (runId, attemptCorrelationId, signal) => database.getProviderCreateAttempt(runId, attemptCorrelationId, signal),
      listUnresolved: (signal) => database.listUnresolvedProviderCreateAttempts(signal),
    },
    capabilities: {
      upsert: (capability, signal) => database.upsertCapability(capability, signal),
      list: (signal) => database.listCapabilities(signal),
    },
    assertionEvidence: {
      upsert: (runId, evidence, signal) => database.upsertAssertionEvidence(runId, evidence, signal),
      get: (runId, signal) => database.getAssertionEvidence(runId, signal),
    },
    grades: {
      get: (runId, signal) => database.getGradeResult(runId, signal),
    },
    cleanup: {
      get: (evaluationId, signal) => database.getEvaluationCleanup(evaluationId, signal),
    },
    reports: {
      get: (evaluationId, signal) => database.getEvaluationReport(evaluationId, signal),
    },
  };
}
