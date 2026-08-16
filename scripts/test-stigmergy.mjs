// test-stigmergy.mjs — the assay for eo-stigmergy.ts's steering trace.
//
// The experiment: eo-gate.ts documents a gap it does not close — signal
// matching "systematically misses the rule that governs this turn without
// sharing its vocabulary" — and a model could close it, but a model in the
// pre-answer path re-opens the dead-air wound chat.ts:2637-2643 already fixed.
// The trace resolves that by moving the model out of the fast path entirely:
// turn N deposits marks after its answer, turn N+1's gate reads them
// mechanically.
//
// What this file checks is not "does it steer well" — that needs a real model
// and a real conversation. It checks the four properties that make steering
// SAFE to try at all, each of which is falsifiable without a model:
//
//   closed set   a mark can only name a fold that exists
//   additive     steering only ever adds; nothing already surfaced is displaced
//   decaying     a mark stops steering on its own, and cannot accumulate forever
//   cold start   an empty trace behaves exactly like today's gate
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-stigmergy.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  emptyTrace,
  deposit,
  evaporate,
  readSteer,
  steerUnfold,
  strengthOf,
  EVAPORATION,
  MARK_CEILING,
  MAX_UNFOLD,
  TRACE_EPSILON,
} from "../app/client/eo-stigmergy.ts";

const FOLDS = [
  { id: "core-citation-law", title: "Citation Law" },
  { id: "core-grounding", title: "What Carries a Claim" },
  { id: "citation-audit", title: "Auditing and Provenance" },
  { id: "source-scope", title: "Source Scope and Pools" },
  { id: "confidence-scale", title: "Confidence Scale" },
];
const KNOWN = new Set(FOLDS.map((f) => f.id));
const mark = (trace, foldId, turn, reason = "test") =>
  deposit(trace, { foldId, turn, reason, knownFoldIds: KNOWN });

// ── Closed set ────────────────────────────────────────────────────────────

test("a mark naming a fold that does not exist is dropped, not kept weakly", () => {
  const t = mark(emptyTrace(), "rule-i-invented", 1);
  assert.equal(t.marks.length, 0);
});

test("readSteer matches prose against the closed set, by id or title", () => {
  assert.deepEqual(
    readSteer("I think the Citation Law should have been in force here.", FOLDS),
    ["core-citation-law"],
  );
  assert.deepEqual(readSteer("core-grounding, and source-scope", FOLDS), [
    "core-grounding",
    "source-scope",
  ]);
});

test("readSteer ignores everything it cannot resolve, including invented rules", () => {
  assert.deepEqual(
    readSteer(
      'Sure! Here is my answer: {"rules": ["the honesty principle", "rule 7"]}',
      FOLDS,
    ),
    [],
    "a malformed/invented reply yields nothing — never a partial parse",
  );
});

test("readSteer does not match a fold id embedded inside a longer word", () => {
  assert.deepEqual(readSteer("core-citation-lawyer paperwork", FOLDS), []);
});

// ── Additive ──────────────────────────────────────────────────────────────

test("steering never returns a fold the mechanical pass already surfaced", () => {
  let t = emptyTrace();
  t = mark(t, "core-citation-law", 1);
  t = mark(t, "citation-audit", 1);
  const out = steerUnfold(t, {
    surfacedIds: new Set(["core-citation-law"]),
    turn: 1,
  });
  assert.deepEqual(out.unfold, ["citation-audit"]);
  assert.equal(out.alreadySurfaced, 1);
});

test("steering is bounded and says what it withheld", () => {
  let t = emptyTrace();
  for (const f of FOLDS) t = mark(t, f.id, 1);
  const out = steerUnfold(t, { surfacedIds: new Set(), turn: 1 });
  assert.equal(out.unfold.length, MAX_UNFOLD);
  assert.equal(out.withheld, FOLDS.length - MAX_UNFOLD);
});

test("every unfolded fold carries the reason that pulled it in", () => {
  const t = mark(emptyTrace(), "source-scope", 4, "answer cited a disabled source");
  const out = steerUnfold(t, { surfacedIds: new Set(), turn: 4 });
  assert.equal(out.reasons.length, 1);
  assert.match(out.reasons[0], /source-scope/);
  assert.match(out.reasons[0], /answer cited a disabled source/);
});

// ── Decaying ──────────────────────────────────────────────────────────────

test("a mark evaporates on schedule and stops steering on its own", () => {
  const t = mark(emptyTrace(), "core-grounding", 1);
  assert.equal(strengthOf(t, "core-grounding", 1), 1);
  assert.ok(Math.abs(strengthOf(t, "core-grounding", 2) - EVAPORATION) < 1e-9);

  // Far enough out it is gone entirely, not merely small.
  const gone = evaporate(t, 20);
  assert.equal(gone.marks.length, 0, "an evaporated mark is pruned, not carried as noise");
  assert.deepEqual(
    steerUnfold(t, { surfacedIds: new Set(), turn: 20 }).unfold,
    [],
  );
});

test("reinforcement accumulates but is capped, so no fold steers forever", () => {
  let t = emptyTrace();
  for (let turn = 1; turn <= 30; turn++) t = mark(t, "core-grounding", turn);
  assert.ok(
    strengthOf(t, "core-grounding", 30) <= MARK_CEILING,
    "a fold marked on thirty consecutive turns must not outweigh everything forever",
  );
});

test("a repeatedly-marked fold outranks a once-marked one", () => {
  let t = emptyTrace();
  t = mark(t, "citation-audit", 5);
  for (const turn of [3, 4, 5]) t = mark(t, "core-citation-law", turn);
  const out = steerUnfold(t, { surfacedIds: new Set(), turn: 5, max: 1 });
  assert.deepEqual(out.unfold, ["core-citation-law"]);
});

test("evaporate is pure — the original trace is never mutated", () => {
  const t = mark(emptyTrace(), "core-grounding", 1);
  const before = JSON.stringify(t);
  evaporate(t, 10);
  steerUnfold(t, { surfacedIds: new Set(), turn: 10 });
  assert.equal(JSON.stringify(t), before);
});

// ── Cold start ────────────────────────────────────────────────────────────

test("an empty trace steers nothing — turn 1 behaves exactly like today's gate", () => {
  const out = steerUnfold(emptyTrace(), {
    surfacedIds: new Set(["core-citation-law"]),
    turn: 1,
  });
  assert.deepEqual(out.unfold, []);
  assert.deepEqual(out.reasons, []);
  assert.equal(out.withheld, 0);
});

test("a model that returns nothing usable leaves the next turn untouched", () => {
  // The whole failure path end to end: the local model replies with something
  // unusable (a refusal, a JSON blob, scaffolding echo), readSteer resolves
  // nothing, no marks are deposited, and turn N+1's gate is unchanged. A
  // failed steer must cost the next turn nothing at all.
  let t = emptyTrace();
  for (const id of readSteer("I'm not sure I can help with that.", FOLDS))
    t = mark(t, id, 1);
  assert.equal(t.marks.length, 0);
  assert.deepEqual(
    steerUnfold(t, { surfacedIds: new Set(), turn: 2 }).unfold,
    [],
  );
});

// ── The whole loop, played out ────────────────────────────────────────────

test("a trail forms, steers, and fades over a run of turns", () => {
  let t = emptyTrace();
  const surfaced = new Set(["core-grounding"]);

  // Turns 1-3: the answer keeps making citation mistakes the signal-matched
  // gate never catches, because the reader never says the word "citation".
  for (let turn = 1; turn <= 3; turn++)
    for (const id of readSteer(
      "The answer made claims with no passage behind them — Citation Law belonged here.",
      FOLDS,
    ))
      t = mark(t, id, turn, "unsourced claims in the draft");

  const steering = steerUnfold(t, { surfacedIds: surfaced, turn: 3 });
  assert.deepEqual(steering.unfold, ["core-citation-law"]);
  assert.ok(strengthOf(t, "core-citation-law", 3) > 1, "three turns reinforced it");

  // Turns 4-12: the conversation moves on and nothing reinforces the mark.
  assert.deepEqual(
    steerUnfold(t, { surfacedIds: surfaced, turn: 12 }).unfold,
    [],
    "the trail fades once the conversation stops needing it — no permanent steer",
  );
  assert.ok(strengthOf(t, "core-citation-law", 12) < TRACE_EPSILON);
});
