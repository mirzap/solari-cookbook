import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BrowserSessionSummarySchema,
  EvaluationSchema,
  EventAppendInputSchema,
  EventIdSchema,
  ProviderCreateAttemptRecordSchema,
  RunQueuedEventAppendInputSchema,
} from "@tracegate/shared";
import {
  FIXTURE_CREATE_ATTEMPT_ID,
  FIXTURE_NOW,
  browserAssertionEvidenceFixture,
  evaluationFixture,
  eventInputFixture,
  runFixture,
} from "@tracegate/shared/testing";

import { TracegateDatabase, createTracegateRepositories } from "../dist/index.js";

test("V2 repository adapters persist atomic submission, cleanup, and ambiguous-create evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tracegate-db-v2-"));
  const database = await TracegateDatabase.open({ url: `file:${join(directory, "tracegate.db")}`, now: () => new Date(FIXTURE_NOW) });
  const signal = new AbortController().signal;
  try {
    const repositories = createTracegateRepositories(database);
    const evaluation = EvaluationSchema.parse({
      ...evaluationFixture,
      config: { ...evaluationFixture.config, requestedRunsPerModel: 1, requestedConcurrency: 1 },
    });
    const submitted = await repositories.submissions.transactionallyCreate({
      evaluation,
      runs: [runFixture],
      queuedEvents: [RunQueuedEventAppendInputSchema.parse(eventInputFixture)],
    }, signal);
    assert.equal(submitted.created, true);
    await repositories.assertionEvidence.upsert(runFixture.id, browserAssertionEvidenceFixture, signal);
    assert.deepEqual(await repositories.assertionEvidence.get(runFixture.id, signal), browserAssertionEvidenceFixture);

    const cancelled = await repositories.runs.transactionallyCancel({
      runId: runFixture.id,
      expectedStatus: "queued",
      context: { mode: "normal", leaseDisposition: "none" },
      reason: null,
      finishedAt: FIXTURE_NOW,
      releaseStatus: "not_started",
      warnings: [],
      potentialSessionLeak: false,
      event: EventAppendInputSchema.parse({
        schemaVersion: 1,
        eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000091"),
        evaluationId: evaluation.id,
        runId: runFixture.id,
        runSequence: 1,
        type: "run.cancelled",
        occurredAt: FIXTURE_NOW,
        payload: { reason: null },
      }),
    }, signal);
    assert.equal(cancelled.applied, true);
    assert.equal(cancelled.run?.status, "cancelled");
    assert.equal(cancelled.event?.type, "run.cancelled");

    const startedAttempt = ProviderCreateAttemptRecordSchema.parse({
      schemaVersion: 1,
      runId: runFixture.id,
      attemptCorrelationId: FIXTURE_CREATE_ATTEMPT_ID,
      status: "started",
      providerSessionId: null,
      potentialSessionLeak: false,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    });
    await repositories.providerCreateAttempts.recordStarted(startedAttempt, signal);
    const unresolved = ProviderCreateAttemptRecordSchema.parse({
      ...startedAttempt,
      status: "unresolved",
      potentialSessionLeak: true,
    });
    assert.equal(await repositories.providerCreateAttempts.transition(
      runFixture.id,
      FIXTURE_CREATE_ATTEMPT_ID,
      "started",
      unresolved,
      signal,
    ), true);
    assert.deepEqual(await repositories.providerCreateAttempts.listUnresolved(signal), [unresolved]);

    const session = BrowserSessionSummarySchema.parse({
      schemaVersion: 2,
      runId: runFixture.id,
      providerSessionId: "solari-session-v2",
      region: null,
      acquiredAt: FIXTURE_NOW,
      releasedAt: null,
      releaseStatus: "failed",
      releaseConfirmed: false,
      replayStatus: "not_requested",
      recordingRequested: false,
    });
    await repositories.browserSessions.upsert(session, signal);
    assert.deepEqual(await repositories.browserSessions.listPotentiallyLeaked(signal), [session]);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
