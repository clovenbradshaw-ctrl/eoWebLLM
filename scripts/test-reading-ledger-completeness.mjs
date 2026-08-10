// scripts/test-reading-ledger-completeness.mjs — the master log is meant
// to hold everything the system did while reading, not only its
// successful narrows. Verifies a refusal (an inverted modifier stack) is
// a real SEG.refuse tick in log.events, not only a transient entry in the
// `refused` return array -- so it survives independently of that array
// (e.g. once only the log itself is persisted, per reading-pipeline.js's
// buildReading docs).
//
// Run: node --test scripts/test-reading-ledger-completeness.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReading } from "../app/client/reading-pipeline.js";
import { readLens } from "../app/client/eo-binary/lens.js";
import { MODIFIER_SCOPE_LENS } from "../app/client/eo-binary/modifier-order-lens.js";

test("a refused stack ticks a real SEG.refuse event into the log, in addition to the `refused` array", () => {
  const { refused, log, reading } = buildReading("I saw the black fat cat.");
  assert.equal(refused.length, 1);

  const refuseEvents = log.events.filter((e) => e.type === "SEG.refuse");
  assert.equal(refuseEvents.length, 1);
  assert.equal(refuseEvents[0].head, refused[0].head);
  assert.equal(refuseEvents[0].gap, refused[0].gap);
  // it is a real ledger entry: stamped like any other tick
  assert.ok(refuseEvents[0].event_id);
  assert.equal(typeof refuseEvents[0].tick, "number");
  assert.ok(refuseEvents[0].tick < reading.cursor);
});

test("SEG.refuse never contaminates the Link-terrain narrowing view, but is honestly reported as discarded", () => {
  const { log, reading } = buildReading("I saw the black fat cat.");
  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  assert.equal(linkLens.view.length, 0, "a refused stack contributes no narrowing edges");

  const read = readLens(log, MODIFIER_SCOPE_LENS, log.tick);
  assert.ok(
    read.discardedTypes.includes("SEG.refuse"),
    "a lens that only reads SEG.narrow honestly reports SEG.refuse as discarded, never silently absorbed",
  );
});

test("the log alone (with no access to the `refused` array) is enough to recover that a refusal happened", () => {
  const { log } = buildReading("I saw the black fat cat.");
  // simulate: only log.events survives (e.g. reloaded from a persisted
  // ledger) -- refused itself was never serialized alongside it.
  const reconstructedRefusals = log.events.filter((e) => e.type === "SEG.refuse");
  assert.equal(reconstructedRefusals.length, 1);
  assert.equal(reconstructedRefusals[0].head, "cat");
  assert.equal(reconstructedRefusals[0].gap, "unstable");
});
