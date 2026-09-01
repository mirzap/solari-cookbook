import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_TRANSITIONS,
  EvaluationStatusSchema,
  RunStatusSchema,
  isLegalEvaluationTransition,
  isLegalRunTransition,
  validateRunTransition,
} from "../src/index.ts";

test("evaluation transition table exactly matches the plan", () => {
  assert.deepEqual(EVALUATION_TRANSITIONS, {
    queued: ["running", "cancelling", "failed"],
    running: ["cancelling", "completed", "failed"],
    cancelling: ["cancelled", "completed", "failed"],
    completed: [],
    cancelled: [],
    failed: [],
  });
  for (const from of EvaluationStatusSchema.options) {
    for (const to of EvaluationStatusSchema.options) {
      assert.equal(isLegalEvaluationTransition(from, to), EVALUATION_TRANSITIONS[from].includes(to) && from !== to);
    }
  }
});

test("normal run path is legal with lease guards", () => {
  assert.equal(isLegalRunTransition("queued", "acquiring_browser", { mode: "normal", leaseDisposition: "none" }), true);
  assert.equal(isLegalRunTransition("acquiring_browser", "connecting_browser", { mode: "normal", leaseDisposition: "may_exist" }), true);
  assert.equal(isLegalRunTransition("connecting_browser", "discovering", { mode: "normal", leaseDisposition: "may_exist" }), true);
  assert.equal(isLegalRunTransition("discovering", "running_agent", { mode: "normal", leaseDisposition: "may_exist" }), true);
  assert.equal(isLegalRunTransition("running_agent", "grading", { mode: "normal", leaseDisposition: "may_exist" }), true);
  assert.equal(isLegalRunTransition("grading", "releasing_browser", { mode: "normal", leaseDisposition: "may_exist" }), true);
  assert.equal(isLegalRunTransition("releasing_browser", "completed", { mode: "normal", leaseDisposition: "released" }), true);
});

test("ordinary orchestration rejects recovery edges and unsafe terminal commits", () => {
  assert.equal(isLegalRunTransition("queued", "completed", { mode: "normal", leaseDisposition: "none" }), false);
  assert.equal(isLegalRunTransition("connecting_browser", "completed", { mode: "normal", leaseDisposition: "may_exist" }), false);
  assert.equal(isLegalRunTransition("grading", "completed", { mode: "normal", leaseDisposition: "may_exist" }), false);
  assert.equal(isLegalRunTransition("releasing_browser", "completed", { mode: "normal", leaseDisposition: "may_exist" }), false);
  assert.equal(validateRunTransition("completed", "queued", { mode: "recovery", leaseDisposition: "none" }).ok, false);
});

test("reserved recovery completion requires no possible lease", () => {
  for (const status of RunStatusSchema.options) {
    const expected = status !== "completed" && status !== "cancelled";
    assert.equal(isLegalRunTransition(status, "completed", { mode: "recovery", leaseDisposition: "none" }), expected);
    assert.equal(isLegalRunTransition(status, "completed", { mode: "recovery", leaseDisposition: "may_exist" }), false);
  }
});
