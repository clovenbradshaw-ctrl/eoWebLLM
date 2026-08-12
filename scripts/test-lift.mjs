// scripts/test-lift.mjs — verifies the lift rule (SEED-SPEC.md Δ4): a
// recurring, validated composition of operator cells becomes a citeable unit.
// The signature is the SHAPE of the work — the ordered operator.grain pairs of
// the controller's own events — never its content, and only a fully-closed
// controller (operational-closure) may lift. Held controllers are refusals:
// reported, never lifted.
//
// Run: node --experimental-strip-types --test scripts/test-lift.mjs
// (via `npm test`, which registers the TS resolver.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLiftRegistry,
  liftSignature,
  liftIfValidated,
} from "../app/client/eo-lift.ts";
import {
  createTaskController,
  startTask,
  finishTask,
} from "../app/client/eo-task-controller.ts";

function closedChain() {
  // The shape under test: SEG a, SEG b, CON, start, EVA, start, EVA, SYN.
  const c = createTaskController([
    { id: "a", goal: "gather" },
    { id: "b", goal: "write", dependsOn: ["a"] },
  ]);
  startTask(c, "a");
  finishTask(c, "a", "gathered", true);
  startTask(c, "b");
  finishTask(c, "b", "written", true);
  return c;
}

test("the signature is the shape of the work, never its content", () => {
  const first = closedChain();
  const second = closedChain();
  second.tasks[0].goal = "utterly different wording";
  second.tasks[1].goal = "and yet the same cells";
  assert.equal(liftSignature(first), liftSignature(second));
});

test("different shapes produce different signatures", () => {
  const chain = closedChain();
  const single = createTaskController([{ id: "x", goal: "one" }]);
  startTask(single, "x");
  finishTask(single, "x", "done", true);
  assert.notEqual(liftSignature(chain), liftSignature(single));
});

test("a validated shape lifts on its second witnessed closure", () => {
  const registry = createLiftRegistry();
  const first = liftIfValidated(registry, closedChain(), { now: 1 });
  assert.equal(first.isNew, true);
  assert.equal(first.unit, null); // one closure is not yet a recurrence

  const second = liftIfValidated(registry, closedChain(), { now: 2 });
  assert.equal(second.isNew, false);
  assert.ok(second.unit, "the second validated closure lifts the unit");
  assert.equal(second.unit.count, 2);
  assert.equal(second.unit.first_seen, 1);
  assert.equal(second.unit.last_seen, 2);

  const third = liftIfValidated(registry, closedChain(), { now: 3 });
  assert.equal(third.unit.count, 3);
});

test("a held controller is a refusal and never lifts", () => {
  const registry = createLiftRegistry();
  // A chain whose second task fails review: the controller holds, not closes.
  const held = createTaskController([
    { id: "a", goal: "gather" },
    { id: "b", goal: "write", dependsOn: ["a"] },
  ]);
  startTask(held, "a");
  finishTask(held, "a", "gathered", true);
  startTask(held, "b");
  finishTask(held, "b", "unsupported", false);
  assert.equal(held.closed, false);
  assert.equal(held.halted_by, "open-gaps-remain");

  const result = liftIfValidated(registry, held, { now: 1 });
  assert.equal(result.unit, null);
  assert.equal(result.isNew, false);
  assert.deepEqual(registry.records, {}, "nothing was witnessed for a refusal");
});
