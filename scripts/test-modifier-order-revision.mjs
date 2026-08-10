// scripts/test-modifier-order-revision.mjs — unit tests for
// app/client/eo-binary/modifier-order-revision.js's pure revision core:
// foldNarrowState (fold a tick-ordered slice to latest-per-node) and
// resolveAgainstLedger (classify a fresh candidate as new/noop/revise).
//
// Run: node --test scripts/test-modifier-order-revision.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { isGap } from "../app/client/eo-binary/nul.js";
import {
  foldNarrowState,
  resolveAgainstLedger,
} from "../app/client/eo-binary/modifier-order-revision.js";

const narrow = (subject, object, cls, event_id, polarity = "+") => ({
  type: "SEG.narrow",
  subject,
  object,
  class: cls,
  polarity,
  event_id,
});

test("foldNarrowState keeps only the latest event per (subject, object)", () => {
  const events = [
    narrow("cat::black", "cat", "color", "e1"),
    narrow("cat::fat", "cat", "quality", "e2"),
    { ...narrow("cat::black", "cat", "shape", "e3"), type: "SEG.revise", supersedes: "e1" },
  ];
  const state = foldNarrowState(events);
  assert.equal(state.size, 2);
  assert.equal(state.get("cat::black␟cat").class, "shape");
  assert.equal(state.get("cat::fat␟cat").class, "quality");
});

test("foldNarrowState folds SEG.confirm in too -- it changes who last vouched for a node, not the fold's size", () => {
  const events = [
    narrow("cat::black", "cat", "color", "e1"),
    { ...narrow("cat::black", "cat", "color", "e2"), type: "SEG.confirm", confirms: "e1" },
  ];
  const state = foldNarrowState(events);
  assert.equal(state.size, 1);
  assert.equal(state.get("cat::black␟cat").event_id, "e2");
  assert.equal(state.get("cat::black␟cat").type, "SEG.confirm");
});

test("foldNarrowState ignores unrelated event types", () => {
  const state = foldNarrowState([{ type: "OTHER.thing", subject: "x", object: "y" }]);
  assert.equal(state.size, 0);
});

test("resolveAgainstLedger: no prior entry -> new", () => {
  const state = foldNarrowState([]);
  const result = resolveAgainstLedger(state, narrow("cat::black", "cat", "color", "e1"));
  assert.equal(result.action, "new");
  assert.equal(result.event.subject, "cat::black");
});

test("resolveAgainstLedger: identical class/polarity -> confirm, a real tickable event pointing back at what it confirmed", () => {
  const state = foldNarrowState([narrow("cat::black", "cat", "color", "e1")]);
  const result = resolveAgainstLedger(state, narrow("cat::black", "cat", "color", "e2"));
  assert.equal(result.action, "confirm");
  assert.equal(result.event.type, "SEG.confirm");
  assert.equal(result.event.confirms, "e1");
  assert.equal(result.event.class, "color");
  assert.ok(Object.isFrozen(result.event));
});

test("resolveAgainstLedger: differing class -> revise, carries supersedes + prior fields", () => {
  const state = foldNarrowState([narrow("cat::black", "cat", "shape", "e1")]);
  const result = resolveAgainstLedger(state, narrow("cat::black", "cat", "color", "e2"));
  assert.equal(result.action, "revise");
  assert.equal(result.event.type, "SEG.revise");
  assert.equal(result.event.supersedes, "e1");
  assert.equal(result.event.class, "color");
  assert.equal(result.event.priorClass, "shape");
  assert.ok(Object.isFrozen(result.event));
});

test("resolveAgainstLedger: differing polarity alone also triggers revise", () => {
  const state = foldNarrowState([narrow("cat::black", "cat", "color", "e1", "+")]);
  const result = resolveAgainstLedger(
    state,
    narrow("cat::black", "cat", "color", "e2", "-"),
  );
  assert.equal(result.action, "revise");
  assert.equal(result.event.priorPolarity, "+");
  assert.equal(result.event.polarity, "-");
});

test("resolveAgainstLedger refuses a non-SEG.narrow candidate rather than guessing", () => {
  const state = foldNarrowState([]);
  const result = resolveAgainstLedger(state, { type: "SEG.revise", subject: "x", object: "y" });
  assert.ok(isGap(result));
  assert.equal(result.gap, "undeclared");
});
