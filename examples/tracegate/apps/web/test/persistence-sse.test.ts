import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TracegateDatabase } from "@tracegate/db";
import {
  EventAppendInputSchema,
  EventIdSchema,
  RunSchema,
  RunStepSchema,
} from "@tracegate/shared";
import {
  FIXTURE_EVALUATION_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  evaluationFixture,
  eventInputFixture,
  runFixture,
} from "@tracegate/shared/testing";

import { PersistenceSpikeServer } from "../src/server/persistence-spike.ts";
import * as persistenceSurface from "../src/server/persistence-spike.ts";
import * as sseSurface from "../src/server/sse.ts";

const nodePath = (path: string): string => `file:${path}`;

test("does not expose an arbitrary or unpersisted milestone publication surface", () => {
  const server = new PersistenceSpikeServer({} as TracegateDatabase);

  assert.deepEqual(Object.keys(persistenceSurface), ["PersistenceSpikeServer"]);
  assert.deepEqual(Object.keys(sseSurface), ["createMilestoneSseResponse"]);
  assert.equal("publish" in server, false);
  assert.equal("publishCommittedForTest" in server, false);
  assert.equal("milestones" in server, false);
  assert.deepEqual(Reflect.ownKeys(server), ["database"]);
});

test("persists ordered milestones, streams committed events, and recovers a disconnect from a fresh snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tracegate-tg005-"));
  const databasePath = join(directory, "persistence.db");
  const secret = "solari_test_secret_123456789";
  const signal = new AbortController().signal;
  const database = await TracegateDatabase.open({
    url: nodePath(databasePath),
    knownSecrets: [secret],
    now: () => new Date(FIXTURE_NOW),
  });
  const server = new PersistenceSpikeServer(database);

  try {
    const evaluationCreated = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000004"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: null,
      runSequence: null,
      type: "evaluation.created",
      occurredAt: FIXTURE_NOW,
      payload: { requestedRuns: 1 },
    });
    const createdEvents = await database.createEvaluationGraph({
      evaluation: evaluationFixture,
      runs: [runFixture],
      events: [evaluationCreated, eventInputFixture],
    }, signal);
    assert.deepEqual(createdEvents.map((event) => event.cursor), ["1", "2"]);

    const initialSnapshot = await server.getSnapshot(FIXTURE_EVALUATION_ID, signal);
    assert.ok(initialSnapshot);
    assert.equal(initialSnapshot.latestCursor, "2");
    assert.equal(initialSnapshot.runs[0]?.status, "queued");
    assert.equal("adminBaseUrl" in initialSnapshot.config.target, false, "server-only target data must not enter the public snapshot");

    const streamAbort = new AbortController();
    const response = server.eventStream(FIXTURE_EVALUATION_ID, streamAbort.signal, { heartbeatMs: 50 });
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(server.subscriberCount(FIXTURE_EVALUATION_ID), 1);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const firstChunk = await reader.read();
    assert.match(new TextDecoder().decode(firstChunk.value), /retry: 1000/);

    const acquiringRun = RunSchema.parse({
      ...runFixture,
      status: "acquiring_browser",
      startedAt: FIXTURE_NOW,
    });
    const acquiringStep = RunStepSchema.parse({
      schemaVersion: 1,
      runId: FIXTURE_RUN_ID,
      sequence: 1,
      kind: "browser_action",
      payload: {
        summary: "Requesting an isolated browser lease.",
        authorization: `Bearer ${secret}`,
      },
      interactionMode: "system",
      observationRevision: null,
      durationMs: 4,
      occurredAt: FIXTURE_NOW,
    });
    const acquiringEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000005"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 1,
      type: "run.status_changed",
      occurredAt: FIXTURE_NOW,
      payload: { previous: "queued", next: "acquiring_browser", mode: "normal" },
    });

    const firstMilestone = await server.persistMilestone({
      expectedStatus: "queued",
      run: acquiringRun,
      transition: { mode: "normal", leaseDisposition: "none" },
      step: acquiringStep,
      event: acquiringEvent,
    }, signal);
    assert.equal(firstMilestone.event.cursor, "3");
    assert.equal(firstMilestone.step.payload.authorization, "[REDACTED]");
    const durableBeforeLiveRead = await database.listEventsAfter(
      FIXTURE_EVALUATION_ID,
      initialSnapshot.latestCursor,
      10,
      signal,
    );
    assert.deepEqual(durableBeforeLiveRead, [firstMilestone.event], "the live envelope must already exist durably");

    const liveChunk = await reader.read();
    const liveText = new TextDecoder().decode(liveChunk.value);
    assert.match(liveText, /id: 3/);
    assert.match(liveText, /event: milestone/);
    assert.doesNotMatch(liveText, new RegExp(secret));

    streamAbort.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(server.subscriberCount(FIXTURE_EVALUATION_ID), 0);

    const connectingRun = RunSchema.parse({ ...acquiringRun, status: "connecting_browser" });
    const connectingStep = RunStepSchema.parse({
      schemaVersion: 1,
      runId: FIXTURE_RUN_ID,
      sequence: 2,
      kind: "browser_action",
      payload: { summary: "Connecting over CDP." },
      interactionMode: "system",
      observationRevision: null,
      durationMs: 7,
      occurredAt: FIXTURE_NOW,
    });
    const connectingEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000006"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 2,
      type: "run.status_changed",
      occurredAt: FIXTURE_NOW,
      payload: { previous: "acquiring_browser", next: "connecting_browser", mode: "normal" },
    });
    await server.persistMilestone({
      expectedStatus: "acquiring_browser",
      run: connectingRun,
      transition: { mode: "normal", leaseDisposition: "may_exist" },
      step: connectingStep,
      event: connectingEvent,
    }, signal);

    const recoveredSnapshot = await server.getSnapshot(FIXTURE_EVALUATION_ID, signal);
    assert.ok(recoveredSnapshot);
    assert.equal(recoveredSnapshot.latestCursor, "4");
    assert.equal(recoveredSnapshot.runs[0]?.status, "connecting_browser");

    const reconnectAbort = new AbortController();
    const reconnectResponse = server.eventStream(FIXTURE_EVALUATION_ID, reconnectAbort.signal, { heartbeatMs: 50 });
    const reconnectReader = reconnectResponse.body?.getReader();
    assert.ok(reconnectReader);
    await reconnectReader.read();

    const discoveringRun = RunSchema.parse({ ...connectingRun, status: "discovering" });
    const discoveringStep = RunStepSchema.parse({
      schemaVersion: 1,
      runId: FIXTURE_RUN_ID,
      sequence: 3,
      kind: "discovery",
      payload: { summary: "Discovering bounded interfaces." },
      interactionMode: "system",
      observationRevision: null,
      durationMs: 6,
      occurredAt: FIXTURE_NOW,
    });
    const discoveringEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000007"),
      evaluationId: FIXTURE_EVALUATION_ID,
      runId: FIXTURE_RUN_ID,
      runSequence: 3,
      type: "run.status_changed",
      occurredAt: FIXTURE_NOW,
      payload: { previous: "connecting_browser", next: "discovering", mode: "normal" },
    });
    const reconnectedMilestone = await server.persistMilestone({
      expectedStatus: "connecting_browser",
      run: discoveringRun,
      transition: { mode: "normal", leaseDisposition: "may_exist" },
      step: discoveringStep,
      event: discoveringEvent,
    }, signal);
    assert.equal(reconnectedMilestone.event.cursor, "5");
    assert.match(new TextDecoder().decode((await reconnectReader.read()).value), /id: 5/);
    reconnectAbort.abort();

    const steps = await database.listRunSteps(FIXTURE_RUN_ID, signal);
    assert.deepEqual(steps.map((step) => step.sequence), [1, 2, 3]);
    assert.equal(steps[0]?.payload.authorization, "[REDACTED]");
    const missedEvents = await database.listEventsAfter(FIXTURE_EVALUATION_ID, initialSnapshot.latestCursor, 10, signal);
    assert.deepEqual(missedEvents.map((event) => event.cursor), ["3", "4", "5"]);
    const eventsAfterRecovery = await database.listEventsAfter(FIXTURE_EVALUATION_ID, recoveredSnapshot.latestCursor, 10, signal);
    assert.deepEqual(eventsAfterRecovery.map((event) => event.cursor), ["5"]);
  } finally {
    await database.close();
    const files = await readdir(directory);
    const persistedBytes = Buffer.concat(await Promise.all(files.map((file) => readFile(join(directory, file))))).toString("utf8");
    assert.doesNotMatch(persistedBytes, new RegExp(secret), "known secrets must never be bound into SQLite or its WAL");
    await rm(directory, { recursive: true, force: true });
  }
});
