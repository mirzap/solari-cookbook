import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DiscoveredInterfaceSchema,
  EvaluationSchema,
  EventAppendInputSchema,
  EventIdSchema,
  RunSchema,
} from "@tracegate/shared";
import {
  FIXTURE_EVALUATION_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  browserAssertionEvidenceFixture,
  evaluationFixture,
  eventInputFixture,
  passingGradeFixture,
  runFixture,
} from "@tracegate/shared/testing";

import { TracegateDatabase } from "../src/database.ts";
import { createTracegateRepositories } from "../src/repositories.ts";

const signal = new AbortController().signal;
const nodePath = (path: string): string => `file:${path}`;

test("clean V2 migration persists canonical evidence, grades, cleanup and report projections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tracegate-db-v2-"));
  const databasePath = join(directory, "tracegate.db");
  const secret = "provider_secret_must_not_persist_123";
  const database = await TracegateDatabase.open({
    url: nodePath(databasePath),
    knownSecrets: [secret],
    now: () => new Date(FIXTURE_NOW),
  });

  try {
    const evaluation = EvaluationSchema.parse({
      ...evaluationFixture,
      config: { ...evaluationFixture.config, requestedRunsPerModel: 1, requestedConcurrency: 1 },
    });
    const run = RunSchema.parse({ ...runFixture, status: "grading", startedAt: FIXTURE_NOW });
    const [queued] = await database.createEvaluationGraph({ evaluation, runs: [run], events: [eventInputFixture] }, signal);
    assert.equal(queued?.cursor, "1");

    const missingEvidenceEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000089"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 1,
      type: "run.passed",
      occurredAt: FIXTURE_NOW,
      payload: { outcome: "passed" },
    });
    await assert.rejects(database.transactionallyFinalize({
      runId: FIXTURE_RUN_ID,
      expectedStatus: "grading",
      context: { mode: "normal", leaseDisposition: "none" },
      outcome: "passed",
      grade: passingGradeFixture,
      failure: null,
      warnings: [],
      finishedAt: FIXTURE_NOW,
      event: missingEvidenceEvent,
    }, signal), /committed canonical assertion evidence/);

    const evidence = {
      ...browserAssertionEvidenceFixture,
      assertions: browserAssertionEvidenceFixture.assertions.map((observation, index) => index === 0
        ? { ...observation, actualSummary: `public observation ${secret}` }
        : observation),
    };
    const repositories = createTracegateRepositories(database);
    await assert.rejects(
      repositories.assertionEvidence.upsert(FIXTURE_RUN_ID, evidence, signal),
      /redacted before its evidence hash is computed/,
    );
    assert.equal(await repositories.assertionEvidence.get(FIXTURE_RUN_ID, signal), null);
    const committedEvidence = await repositories.assertionEvidence.upsert(
      FIXTURE_RUN_ID,
      browserAssertionEvidenceFixture,
      signal,
    );
    assert.deepEqual(committedEvidence, browserAssertionEvidenceFixture);
    const [redactedInterface] = await database.replaceDiscoveredInterfaces(FIXTURE_RUN_ID, [
      DiscoveredInterfaceSchema.parse({
        schemaVersion: 1,
        kind: "semantic",
        name: `Public control ${secret}`,
        metadata: { providerToken: secret },
        discoveredAt: FIXTURE_NOW,
      }),
    ], signal);
    assert.equal(redactedInterface?.name, "Public control [REDACTED]");
    assert.deepEqual(redactedInterface?.metadata, { providerToken: "[REDACTED]" });

    const terminalEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000090"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 1,
      type: "run.passed",
      occurredAt: FIXTURE_NOW,
      payload: { outcome: "passed" },
    });
    const finalized = await database.transactionallyFinalize({
      runId: FIXTURE_RUN_ID,
      expectedStatus: "grading",
      context: { mode: "normal", leaseDisposition: "none" },
      outcome: "passed",
      grade: passingGradeFixture,
      failure: null,
      warnings: [],
      finishedAt: FIXTURE_NOW,
      event: terminalEvent,
    }, signal);
    assert.equal(finalized.applied, true);
    assert.deepEqual(await repositories.grades.get(FIXTURE_RUN_ID, signal), passingGradeFixture);

    const cleanup = await repositories.cleanup.get(FIXTURE_EVALUATION_ID, signal);
    assert.ok(cleanup);
    assert.deepEqual(cleanup.potentialLeakRunIds, []);

    const report = await repositories.reports.get(FIXTURE_EVALUATION_ID, signal);
    assert.ok(report);
    assert.match(report.specificationHash, /^[a-f0-9]{64}$/);
    assert.equal(report.evidence[0]?.evidenceHash, passingGradeFixture.evidenceHash);
    assert.equal(report.interfaces[0]?.name, "Public control [REDACTED]");
    assert.equal(report.grades[0]?.outcome, "passed");
    assert.equal(report.snapshot.runs[0]?.outcome, "passed");
    assert.equal(report.events.at(-1)?.cursor, "2");
  } finally {
    await database.close();
    const files = await readdir(directory);
    const bytes = Buffer.concat(await Promise.all(files.map((file) => readFile(join(directory, file)).catch(() => Buffer.alloc(0))))).toString("utf8");
    assert.doesNotMatch(bytes, new RegExp(secret));
    await rm(directory, { recursive: true, force: true });
  }
});
