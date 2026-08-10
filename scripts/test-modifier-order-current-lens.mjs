// scripts/test-modifier-order-current-lens.mjs — MODIFIER_SCOPE_CURRENT_LENS
// folds the master log's append-only trail (SEG.narrow / SEG.revise /
// SEG.confirm) down to one edge per (subject, object), whichever ticked
// last -- the "current state" projection, as opposed to
// MODIFIER_SCOPE_LENS's unfolded history. Also exercises buildReading's
// new `lenses` param end-to-end against a real re-read.
//
// Run: node --test scripts/test-modifier-order-current-lens.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLog, tick } from "../app/client/eo-binary/event_log.js";
import {
  MODIFIER_SCOPE_LENS,
  MODIFIER_SCOPE_CURRENT_LENS,
} from "../app/client/eo-binary/modifier-order-lens.js";
import { buildReading } from "../app/client/reading-pipeline.js";

test("MODIFIER_SCOPE_CURRENT_LENS.project folds synthetic narrow/revise/confirm events to latest-per-node", () => {
  const events = [
    { type: "SEG.narrow", subject: "cat::black", object: "cat", class: "shape", polarity: "+", event_id: "e1" },
    { type: "SEG.narrow", subject: "cat::fat", object: "cat", class: "quality", polarity: "+", event_id: "e2" },
    { type: "SEG.revise", subject: "cat::black", object: "cat", class: "color", polarity: "+", supersedes: "e1", event_id: "e3" },
    { type: "SEG.confirm", subject: "cat::fat", object: "cat", class: "quality", polarity: "+", confirms: "e2", event_id: "e4" },
  ];
  const view = MODIFIER_SCOPE_CURRENT_LENS.project(events);
  assert.equal(view.length, 2);

  const black = view.find((e) => e.subject === "cat::black");
  assert.equal(black.class, "color");
  assert.equal(black.revised, true);
  assert.equal(black.event_id, "e3");

  const fat = view.find((e) => e.subject === "cat::fat");
  assert.equal(fat.class, "quality");
  assert.equal(fat.revised, false);
  assert.equal(fat.event_id, "e4");
});

test("buildReading with lenses: [MODIFIER_SCOPE_CURRENT_LENS] returns the folded current state after a real revision, unlike the default historical lens", () => {
  const log = createLog();
  buildReading("I saw the fat black cat.", { log });
  tick(log, { type: "SEG.narrow", subject: "cat::black", object: "cat", class: "shape", polarity: "+" });
  buildReading("I saw the fat black cat.", { log }); // ticks the SEG.revise back to "color"

  const currentLensOpt = [{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }];
  const currentReading = buildReading("I saw the fat black cat.", { log, lenses: currentLensOpt });
  const currentView = currentReading.reading.lenses.find((l) => l.terrain === "Link").view;
  // 2 nodes total (cat::black, cat::fat), folded to one edge each --
  // regardless of how many narrow/revise/confirm ticks accumulated.
  assert.equal(currentView.length, 2);
  assert.equal(currentView.find((e) => e.subject === "cat::black").class, "color");

  const historicalReading = buildReading("I saw the fat black cat.", { log }); // default lens
  const historicalView = historicalReading.reading.lenses.find((l) => l.terrain === "Link").view;
  // the default MODIFIER_SCOPE_LENS only ever reads SEG.narrow, so it
  // never sees SEG.revise/SEG.confirm at all -- it's the unfolded, purely
  // historical view.
  assert.ok(historicalView.length >= 2);
});
