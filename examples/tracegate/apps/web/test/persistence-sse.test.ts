import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TracegateDatabase } from "@tracegate/db";
import { EvaluationSchema, EventAppendInputSchema, EventIdSchema, RunQueuedEventAppendInputSchema, RunSchema, RunStepSchema } from "@tracegate/shared";
import {
  FIXTURE_EVALUATION_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  evaluationFixture,
  eventInputFixture,
  runFixture,
} from "@tracegate/shared/testing";

import { TracegateServer } from "../src/server/tracegate-server.ts";
import * as serverSurface from "../src/server/tracegate-server.ts";
import * as sseSurface from "../src/server/sse.ts";

const nodePath = (path: string): string => `file:${path}`;

test("does not expose arbitrary or unpersisted milestone publication", () => {
  const server = new TracegateServer({} as TracegateDatabase);
  assert.deepEqual(Object.keys(serverSurface), ["TracegateServer"]);
  assert.deepEqual(Object.keys(sseSurface), ["createMilestoneSseResponse"]);
  assert.equal("publish" in server, false);
  assert.equal("publishCommittedForTest" in server, false);
  assert.deepEqual(Reflect.ownKeys(server), ["database"]);
});

test("clean V2 database commits before SSE publication and recovers from authoritative snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tracegate-v2-persistence-"));
  const databasePath = join(directory, "tracegate.db");
  const secret = "solari_test_secret_123456789";
  const signal = new AbortController().signal;
  const database = await TracegateDatabase.open({ url: nodePath(databasePath), knownSecrets: [secret], now: () => new Date(FIXTURE_NOW) });
  const server = new TracegateServer(database, { now: () => new Date(FIXTURE_NOW) });

  try {
    const singleRunEvaluation = EvaluationSchema.parse({
      ...evaluationFixture,
      config: { ...evaluationFixture.config, requestedRunsPerModel: 1, requestedConcurrency: 1 },
    });
    const submitted = await database.transactionallyCreateSubmission({
      evaluation: singleRunEvaluation,
      runs: [runFixture],
      queuedEvents: [RunQueuedEventAppendInputSchema.parse(eventInputFixture)],
    }, signal);
    assert.equal(submitted.created, true);
    assert.deepEqual(submitted.queuedEvents.map((event) => event.cursor), ["1"]);

    const initial = await server.getSnapshot(FIXTURE_EVALUATION_ID, signal);
    assert.ok(initial);
    assert.equal(initial.schemaVersion, 2);
    assert.equal(initial.aggregate.requested, 1);
    assert.equal(initial.aggregate.nonterminal, 1);
    assert.equal(initial.config.target.kind, "public-web");
    assert.equal("scenarioId" in initial.config.target, false);

    const streamAbort = new AbortController();
    const response = await server.eventStream(FIXTURE_EVALUATION_ID, streamAbort.signal, { heartbeatMs: 50 });
    assert.ok(response);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const ready = new TextDecoder().decode((await reader.read()).value);
    assert.match(ready, /event: ready/);
    assert.equal(server.subscriberCount(FIXTURE_EVALUATION_ID), 1);

    const acquiringRun = RunSchema.parse({ ...runFixture, status: "acquiring_browser", startedAt: FIXTURE_NOW });
    const event = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000005"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 1,
      type: "run.status_changed",
      occurredAt: FIXTURE_NOW,
      payload: { previous: "queued", next: "acquiring_browser", mode: "normal" },
    });
    const milestone = await server.persistMilestone({
      expectedStatus: "queued",
      run: acquiringRun,
      transition: { mode: "normal", leaseDisposition: "none" },
      step: RunStepSchema.parse({
        schemaVersion: 2,
        runId: FIXTURE_RUN_ID,
        sequence: 1,
        kind: "browser_action",
        payload: { summary: "Acquire fresh anonymous browser.", authorization: `Bearer ${secret}` },
        interactionMode: "system",
        observationRevision: null,
        durationMs: 4,
        occurredAt: FIXTURE_NOW,
      }),
      event,
    }, signal);
    assert.equal(milestone.event.cursor, "2");
    assert.equal(milestone.step.payload.authorization, "[REDACTED]");
    assert.deepEqual(await database.listEventsAfter(FIXTURE_EVALUATION_ID, "1", 10, signal), [milestone.event]);

    const live = new TextDecoder().decode((await reader.read()).value);
    assert.match(live, /id: 2/);
    assert.doesNotMatch(live, new RegExp(secret));
    streamAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.subscriberCount(FIXTURE_EVALUATION_ID), 0);

    const recovered = await server.getSnapshot(FIXTURE_EVALUATION_ID, signal);
    assert.ok(recovered);
    assert.equal(recovered.latestCursor, "2");
    assert.equal(recovered.runs[0]?.status, "acquiring_browser");
    assert.equal(recovered.runs[0]?.startedAt, FIXTURE_NOW);
  } finally {
    await database.close();
    const files = await readdir(directory);
    const bytes = Buffer.concat(await Promise.all(files.map((file) => readFile(join(directory, file)).catch(() => Buffer.alloc(0))))).toString("utf8");
    assert.doesNotMatch(bytes, new RegExp(secret));
    await rm(directory, { recursive: true, force: true });
  }
});
