// scripts/test-reading-diff.mjs — verifies multi-cursor projection:
// readAtCursors reads the SAME log at two different named cursors, and
// diffLinkViews correctly separates what's new/removed/changed/unchanged
// between them. This is the "compare the same ledger's projection over
// time" capability that was structurally possible (cursor was always a
// named, received parameter) but never exercised before this.
//
// Run: node --test scripts/test-reading-diff.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLog, tick } from "../app/client/eo-binary/event_log.js";
import { MODIFIER_SCOPE_CURRENT_LENS } from "../app/client/eo-binary/modifier-order-lens.js";
import { isGap } from "../app/client/eo-binary/nul.js";
import { readAtCursors, diffLinkViews } from "../app/client/eo-binary/reading-diff.js";
import { buildReading } from "../app/client/reading-pipeline.js";

const LINK = [{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }];

test("readAtCursors refuses named-cursor input that isn't named", () => {
  const log = createLog();
  assert.ok(isGap(readAtCursors(log, LINK, [])));
  assert.ok(isGap(readAtCursors(log, LINK, [{ cursor: 0 }])));
  assert.ok(isGap(readAtCursors(log, LINK, [{ name: "", cursor: 0 }])));
});

test("readAtCursors + diffLinkViews separate added/removed/changed/unchanged between two named cursors on one ledger", () => {
  const log = createLog();
  // ticks cat::black -> cat (color), then cat::black::fat -> cat::black
  // (quality) -- modifier stacks nest incrementally, so "fat"'s subject
  // is nested under "black", not a sibling of it.
  buildReading("I saw the fat black cat.", { log });
  const cursorA = log.tick;

  // a genuine revision -- simulate a stale prior claim, then re-read
  tick(log, { type: "SEG.narrow", subject: "cat::black", object: "cat", class: "shape", polarity: "+" });
  const { revisions } = buildReading("I saw the fat black cat.", { log });
  assert.equal(revisions.length, 1);

  // a brand-new node the ledger didn't have at cursorA
  const second = buildReading("So they went up to the Mock Turtle.", { log });
  assert.equal(second.refused.length, 0);
  const cursorB = log.tick;

  const readings = readAtCursors(log, LINK, [
    { name: "before", cursor: cursorA },
    { name: "after", cursor: cursorB },
  ]);
  assert.equal(readings.length, 2);
  assert.equal(readings[0].name, "before");
  assert.equal(readings[1].name, "after");

  const viewA = readings[0].lenses.find((l) => l.terrain === "Link").view;
  const viewB = readings[1].lenses.find((l) => l.terrain === "Link").view;

  const diff = diffLinkViews(viewA, viewB);

  // cat::black::fat was ticked before cursorA and never revised -- unchanged
  assert.ok(diff.unchanged.some((e) => e.subject === "cat::black::fat"));

  // cat::black was "color" at cursorA, revised to "color" again by
  // cursorB via the simulated-stale-claim path -- net class is the same
  // ("color") but the identity of the ticking event differs; the fold at
  // cursorA already reflects the manual stale tick that happened before
  // cursorA was captured only if it preceded cursorA -- it did not
  // (ticked after), so cat::black at cursorA is "color" and at cursorB
  // is "color" again (the revision corrected it back) -- assert it is
  // NOT reported as a spurious change.
  assert.ok(!diff.changed.some((e) => e.subject === "cat::black"));
  assert.ok(diff.unchanged.some((e) => e.subject === "cat::black"));

  // turtle::Mock did not exist at cursorA -- added by cursorB
  assert.ok(diff.added.some((e) => e.subject === "turtle::Mock"));

  // nothing present at cursorA is absent from cursorB in this scenario
  assert.equal(diff.removed.length, 0);
});

test("diffLinkViews reports a genuine class change as `changed`, with both the from and to edge", () => {
  const viewA = [{ subject: "cat::black", object: "cat", class: "shape", polarity: "+" }];
  const viewB = [{ subject: "cat::black", object: "cat", class: "color", polarity: "+" }];
  const diff = diffLinkViews(viewA, viewB);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].from.class, "shape");
  assert.equal(diff.changed[0].to.class, "color");
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.unchanged.length, 0);
});
