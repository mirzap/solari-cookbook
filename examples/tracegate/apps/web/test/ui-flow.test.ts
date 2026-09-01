import assert from "node:assert/strict";
import test from "node:test";

import {
  EvaluationSnapshotSchema,
  EventEnvelopeSchema,
  EventIdSchema,
  type ModelId,
} from "@tracegate/shared";
import {
  FIXTURE_NOW,
  eventEnvelopeFixture,
  runSnapshotFixture,
} from "@tracegate/shared/testing";

import { createEvaluationRequestFromDraft, type AssertionDraft } from "../src/lib/evaluation-form.ts";
import { EvaluationProjection } from "../src/lib/event-projection.ts";

const models: readonly ModelId[] = [
  "deepseek/deepseek-v4-flash-0731",
  "mistralai/mistral-small-2603",
];

test("configure flow produces a frozen generic V2 request from all assertion-builder kinds", () => {
  const assertions: readonly AssertionDraft[] = [
    { key: 1, kind: "url", value: "https://public.example/catalog", name: "" },
    { key: 2, kind: "text", value: "Catalog", name: "" },
    { key: 3, kind: "semantic", value: "heading", name: "Catalog" },
    { key: 4, kind: "state", value: "option", name: "Medium" },
  ];
  const request = createEvaluationRequestFromDraft({
    startUrl: "https://public.example/catalog",
    allowedOriginsText: "https://public.example,\nhttps://assets.public.example",
    prompt: "Open the public catalog and select the visible medium presentation state.",
    assertions,
    modelIds: models,
    runsPerModel: 2,
    concurrency: 3,
    recordingRequested: false,
    webMcpReadOnlyEnabled: false,
  });

  assert.equal(request.schemaVersion, 2);
  assert.equal(request.target.kind, "public-web");
  assert.deepEqual(request.target.allowedNavigationOrigins, ["https://public.example", "https://assets.public.example"]);
  assert.deepEqual(request.assertions.map((assertion) => assertion.kind), ["url", "text", "semantic", "state"]);
  assert.deepEqual(request.modelIds, models);
  assert.equal(request.requestedRunsPerModel, 2);
  assert.equal(request.requestedConcurrency, 3);
});

test("configure flow rejects a non-HTTPS or non-origin target before mutation", () => {
  assert.throws(() => createEvaluationRequestFromDraft({
    startUrl: "http://127.0.0.1/private",
    allowedOriginsText: "http://127.0.0.1",
    prompt: "Inspect a private target.",
    assertions: [{ key: 1, kind: "text", value: "private", name: "" }],
    modelIds: ["deepseek/deepseek-v4-flash-0731"],
    runsPerModel: 1,
    concurrency: 1,
    recordingRequested: false,
    webMcpReadOnlyEnabled: false,
  }));
});

test("live projection advances only from persisted event envelopes and remains snapshot-recoverable", () => {
  const initial = EvaluationSnapshotSchema.parse({
    schemaVersion: 2,
    evaluationId: eventEnvelopeFixture.evaluationId,
    status: "queued" as const,
    config: createEvaluationRequestFromDraft({
      startUrl: "https://public.example/",
      allowedOriginsText: "https://public.example",
      prompt: "Inspect the public example.",
      assertions: [{ key: 1, kind: "text", value: "Example", name: "" }],
      modelIds: ["deepseek/deepseek-v4-flash-0731"],
      runsPerModel: 1,
      concurrency: 1,
      recordingRequested: false,
      webMcpReadOnlyEnabled: false,
    }),
    createdAt: FIXTURE_NOW,
    startedAt: null,
    finishedAt: null,
    aggregate: {
      requested: 1, started: 0, passed: 0, failed: 0, inconclusive: 0, cancelled: 0, nonterminal: 1, potentialLeaks: 0,
      endToEndPassRate: { numerator: 0, denominator: 1, value: 0 },
      gradeableObservableStateSuccess: { numerator: 0, denominator: 0, value: null },
    },
    runs: [runSnapshotFixture],
    latestCursor: "1",
  });
  const event = EventEnvelopeSchema.parse({
    schemaVersion: 1,
    eventId: EventIdSchema.parse("01890f00-0000-7000-8000-000000000091"),
    cursor: "2",
    evaluationId: eventEnvelopeFixture.evaluationId,
    runId: eventEnvelopeFixture.runId,
    runSequence: 1,
    type: "run.status_changed",
    occurredAt: FIXTURE_NOW,
    recordedAt: FIXTURE_NOW,
    payload: { previous: "queued", next: "acquiring_browser", mode: "normal" },
  });
  const projected = new EvaluationProjection(initial).apply(event);
  assert.equal(projected.latestCursor, "2");
  assert.equal(projected.runs[0]?.status, "acquiring_browser");
  assert.equal(new EvaluationProjection(projected).value.latestCursor, "2");
});
