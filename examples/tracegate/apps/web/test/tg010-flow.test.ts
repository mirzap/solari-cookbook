import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TracegateDatabase, createTracegateRepositories } from "@tracegate/db";
import {
  EventAppendInputSchema,
  EventIdSchema,
  RunStatusChangedEventAppendInputSchema,
  RuntimeCapabilitySchema,
} from "@tracegate/shared";
import {
  ASSERTION_ONLY_CANARY,
  FIXTURE_NOW,
  assertionCanaryConfigFixture,
} from "@tracegate/shared/testing";

import { EvaluationProjection } from "../src/lib/event-projection.ts";
import { assertLoopbackMutationRequest } from "../src/server/http.ts";
import { TracegateServer } from "../src/server/tracegate-server.ts";

const nodePath = (path: string): string => `file:${path}`;
const signal = new AbortController().signal;

async function seedCapabilities(database: TracegateDatabase) {
  for (const capability of [
    RuntimeCapabilitySchema.parse({
      schemaVersion: 1, kind: "model", subject: "deepseek/deepseek-v4-flash-0731", status: "verified",
      details: { provider: "openrouter", evidence: "credentialed-spike" }, checkedAt: FIXTURE_NOW, error: null,
    }),
    RuntimeCapabilitySchema.parse({
      schemaVersion: 1, kind: "solari", subject: "browser-session", status: "verified",
      details: { lifecycle: "measured" }, checkedAt: FIXTURE_NOW, error: null,
    }),
    RuntimeCapabilitySchema.parse({
      schemaVersion: 1, kind: "webmcp", subject: "read-only-adapter", status: "unsupported",
      details: { fallback: "semantic" }, checkedAt: FIXTURE_NOW, error: null,
    }),
  ]) await database.upsertCapability(capability, signal);
}

test("loopback mutation policy rejects public hosts and cross-origin requests", () => {
  assert.doesNotThrow(() => assertLoopbackMutationRequest(new Request("http://127.0.0.1:3000/api/evaluations", {
    method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  })));
  assert.throws(() => assertLoopbackMutationRequest(new Request("https://tracegate.example/api/evaluations", { method: "POST" })), /loopback control-plane host/);
  assert.throws(() => assertLoopbackMutationRequest(new Request("http://localhost:3000/api/evaluations", {
    method: "POST", headers: { origin: "https://attacker.example" },
  })), /Unexpected mutation Origin header/);
});

test("generic V2 create persists canonical config and separates assertion-blind trace from grading report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tracegate-v2-flow-"));
  const databasePath = join(directory, "tracegate.db");
  let database = await TracegateDatabase.open({ url: nodePath(databasePath), now: () => new Date(FIXTURE_NOW) });

  try {
    await seedCapabilities(database);
    const server = new TracegateServer(database, { now: () => new Date(FIXTURE_NOW) });
    const request = { ...assertionCanaryConfigFixture, webMcpReadOnlyEnabled: true };
    const created = await server.createEvaluation(request, signal);
    assert.equal(created.status, "queued");
    assert.equal(created.runIds.length, 3);

    const snapshot = await server.getSnapshot(created.evaluationId, signal);
    assert.ok(snapshot);
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal(snapshot.config.target.kind, "public-web");
    assert.equal(snapshot.config.webMcpReadOnlyEnabled, true);
    assert.equal("scenarioId" in snapshot.config.target, false);

    const repositories = createTracegateRepositories(database);
    assert.equal((await repositories.evaluations.get(created.evaluationId, signal))?.id, created.evaluationId);
    assert.equal(await repositories.events.earliestCursor(created.evaluationId, signal), "1");
    assert.equal(await repositories.events.latestCursor(created.evaluationId, signal), "3");

    const runId = created.runIds[0];
    assert.ok(runId);
    const transitionEvent = RunStatusChangedEventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000080"),
      evaluationId: created.evaluationId,
      runId,
      runSequence: 1,
      type: "run.status_changed",
      occurredAt: FIXTURE_NOW,
      payload: { previous: "queued", next: "acquiring_browser", mode: "normal" },
    });
    const transition = await server.applyRunTransition({
      runId,
      expectedStatus: "queued",
      nextStatus: "acquiring_browser",
      context: { mode: "normal", leaseDisposition: "none" },
      patch: { startedAt: FIXTURE_NOW },
      event: transitionEvent,
    }, signal);
    assert.equal(transition.applied, true);
    assert.ok(transition.event);
    assert.deepEqual(await repositories.events.listAfter(created.evaluationId, "3", 10, signal), [transition.event]);

    const agentEvent = EventAppendInputSchema.parse({
      schemaVersion: 1,
      eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000081"),
      evaluationId: created.evaluationId,
      runId,
      runSequence: 2,
      type: "run.agent.message",
      occurredAt: FIXTURE_NOW,
      payload: { role: "assistant", summary: "Inspected the public page without access to grading assertions." },
    });
    await server.appendEvent(agentEvent, signal);
    const eventPage = await server.getEvents(created.evaluationId, "3", signal);
    assert.ok(eventPage);
    assert.deepEqual(eventPage.events.map((event) => event.cursor), ["4", "5"]);
    assert.equal(eventPage.latestCursor, "5");

    const report = await server.getReport(created.evaluationId, signal);
    const trace = await server.getAgentTrace(created.evaluationId, null, signal);
    assert.ok(report);
    assert.ok(trace);
    assert.match(JSON.stringify(report.assertions), new RegExp(ASSERTION_ONLY_CANARY));
    assert.doesNotMatch(JSON.stringify(trace), new RegExp(ASSERTION_ONLY_CANARY));
    assert.equal(trace.items.length, 1);
    assert.equal(trace.items[0]?.event.type, "run.agent.message");
    const nextTracePage = await server.getAgentTrace(created.evaluationId, trace.items[0]?.cursor ?? null, signal);
    assert.ok(nextTracePage);
    assert.deepEqual(nextTracePage.items, []);
    assert.equal(report.observableStateLimitation, "PASS proves declared browser-observable assertions only, not arbitrary backend business truth.");

    const projected = new EvaluationProjection(snapshot).apply(transition.event);
    assert.equal(projected.runs[0]?.status, "acquiring_browser");

    await database.close();
    database = await TracegateDatabase.open({ url: nodePath(databasePath), now: () => new Date(FIXTURE_NOW) });
    const recovered = await new TracegateServer(database).getSnapshot(created.evaluationId, signal);
    assert.ok(recovered);
    assert.equal(recovered.latestCursor, "5");
    assert.equal(recovered.runs[0]?.status, "acquiring_browser");
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
