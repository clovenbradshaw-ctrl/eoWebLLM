// scripts/test-horizon-law.mjs — verifies the horizon law (SEED-SPEC.md Δ2/Δ3):
// no operation reads the whole, and whatever a read withholds is reported,
// never silent. Two surfaces:
//
//   1. foldToMouth (eo-grounding.ts) — the mouth is a named budget: bounded
//      output for arbitrarily large input, withheld counted and named,
//      k < 1 refused.
//   2. defineTaskPlan (eo-task-plan.ts) — plan as sediment: each fold step
//      proposes the NEXT task only, sees only the live-task projection, and
//      the fold never runs past its declared maxSteps, so no single proposal
//      call ever holds more than the horizon.
//
// Run: node --experimental-strip-types --test scripts/test-horizon-law.mjs
// (via `npm test`, which registers the TS resolver.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { foldToMouth } from "../app/client/eo-grounding.ts";
import { defineTaskPlan } from "../app/client/eo-task-plan.ts";

// ── the mouth ─────────────────────────────────────────────────────────────

test("foldToMouth is bounded no matter how large the input", () => {
  const big = Array.from({ length: 10_000 }, (_, i) => `item-${i}`);
  const mouth = foldToMouth(big, { k: 7 });
  assert.equal(mouth.working.length, 7);
  assert.equal(mouth.withheld, 10_000 - 7);
  assert.equal(mouth.withheld_ids.length, 10_000 - 7);
  assert.deepEqual(mouth.working, big.slice(0, 7));
});

test("foldToMouth defaults to the LTWM top of range (k = 7)", () => {
  const mouth = foldToMouth(["a", "b", "c"], {});
  assert.equal(mouth.withheld, 0);
  const over = foldToMouth(Array.from({ length: 12 }, (_, i) => i), {});
  assert.equal(over.working.length, 7);
  assert.equal(over.withheld, 5);
});

test("foldToMouth refuses a non-positive or non-integer k", () => {
  assert.throws(() => foldToMouth([], { k: 0 }), /k must be a positive integer/);
  assert.throws(() => foldToMouth([], { k: -1 }), /k must be a positive integer/);
  assert.throws(() => foldToMouth([], { k: 2.5 }), /k must be a positive integer/);
});

test("withheld material is named, never silent", () => {
  const mouth = foldToMouth(["a", "b", "c", "d", "e"], { k: 3, id: (x) => x });
  assert.equal(mouth.withheld, 2);
  assert.deepEqual(mouth.withheld_ids, ["d", "e"]);
});

// ── plan as sediment ──────────────────────────────────────────────────────

/** A fake generator that pops responses in order and records every prompt it was sent. */
function scriptedGenerate(script) {
  const calls = [];
  const generate = async (_system, user) => {
    calls.push(user);
    const next = script.shift() ?? '{"tasks":[]}';
    return next;
  };
  return { generate, calls };
}

test("the fold stops on an empty proposal — the plan is whatever sedimented", async () => {
  const { generate } = scriptedGenerate(['{"tasks":[]}']);
  const plan = await defineTaskPlan("any reader request", generate);
  assert.deepEqual(plan.tasks, []);
});

test("each fold step sees only the live projection, never the whole plan", async () => {
  const script = [
    '{"tasks":[{"id":"a","goal":"gather A"}]}',
    '{"tasks":[{"id":"b","goal":"write B","dependsOn":["a"]}]}',
    '{"tasks":[{"id":"c","goal":"check C","dependsOn":["b"]}]}',
    '{"tasks":[]}',
  ];
  const { generate, calls } = scriptedGenerate(script);
  const plan = await defineTaskPlan("reader request", generate);

  assert.deepEqual(plan.tasks.map((t) => t.id), ["a", "b", "c"]);
  // Every prompt names only ids already proposed — no call ever holds the
  // whole plan, because at the time it ran the whole plan did not exist.
  for (let i = 0; i < calls.length; i += 1) {
    const listed = new Set(
      (calls[i].match(/- ([A-Za-z0-9-]+):/g) ?? []).map((s) => s.slice(2, -1)),
    );
    const proposedSoFar = plan.tasks.slice(0, i).map((t) => t.id);
    for (const id of listed)
      assert.ok(proposedSoFar.includes(id), `step ${i} saw ${id} before it was live`);
  }
});

test("a ghost dependency is refused by the controller and normalized away", async () => {
  const script = [
    '{"tasks":[{"id":"a","goal":"gather A"}]}',
    '{"tasks":[{"id":"b","goal":"write B","dependsOn":["ghost","a"]}]}',
    '{"tasks":[]}',
  ];
  const { generate } = scriptedGenerate(script);
  const plan = await defineTaskPlan("reader request", generate);
  assert.deepEqual(plan.tasks.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(plan.tasks[1].dependsOn, ["a"]);
});

test("the fold never exceeds maxSteps, so no call holds more than the horizon", async () => {
  // Always a fresh task — the only thing that stops the fold is the declared
  // budget, and the budget is the horizon.
  let n = 0;
  const calls = [];
  const generate = async (_s, u) => {
    calls.push(u);
    n += 1;
    return `{"tasks":[{"id":"t${n}","goal":"task ${n}"}]}`;
  };
  const plan = await defineTaskPlan("reader request", generate, { maxSteps: 6 });
  assert.equal(plan.tasks.length, 6);
  assert.equal(calls.length, 6);
  // And each call carried at most the running count of live tasks — never more
  // than maxSteps, which is the whole point of the horizon.
  for (const prompt of calls) {
    const listed = (prompt.match(/- /g) ?? []).length;
    assert.ok(listed <= 6, `a proposal call held ${listed} live tasks`);
  }
});

test("a response proposing two tasks yields only the first — one next task per step", async () => {
  const script = [
    '{"tasks":[{"id":"a","goal":"gather A"},{"id":"b","goal":"sneak B"}]}',
    '{"tasks":[]}',
  ];
  const { generate } = scriptedGenerate(script);
  const plan = await defineTaskPlan("reader request", generate);
  assert.deepEqual(plan.tasks.map((t) => t.id), ["a"]);
});

test("a malformed proposal is refused, not thrown — the sediment stands", async () => {
  // Garbage and empty-goal proposals are refusals: they stop the fold and the
  // controller never throws. What already sedimented stands.
  const garbage = scriptedGenerate(["not json at all"]);
  assert.deepEqual(
    (await defineTaskPlan("reader request", garbage.generate)).tasks,
    [],
  );

  const emptyFirst = scriptedGenerate([
    '{"tasks":[{"id":"a","goal":""}]}', // normalized away: nothing new
    '{"tasks":[{"id":"b","goal":"real task"}]}',
  ]);
  assert.deepEqual(
    (await defineTaskPlan("reader request", emptyFirst.generate)).tasks,
    [],
  );

  const midFold = scriptedGenerate([
    '{"tasks":[{"id":"a","goal":"gather A"}]}',
    '{"tasks":[{"id":"b","goal":""}]}', // refused mid-fold: fold stops
    '{"tasks":[{"id":"c","goal":"never reached"}]}',
  ]);
  assert.deepEqual(
    (await defineTaskPlan("reader request", midFold.generate)).tasks.map(
      (t) => t.id,
    ),
    ["a"],
  );
});
