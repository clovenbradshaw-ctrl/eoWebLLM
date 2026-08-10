// scripts/test-reading-eot.mjs — verifies the full read pipeline (event_log
// + lens + reading substrate, from eoreader6 PR #50) at its real shipped
// location: text -> tagger -> toEvents -> real event_log -> real
// readDocument -> EOT `reader` surface text.
//
// Run: node --test scripts/test-reading-eot.mjs
// (picked up automatically by `yarn test`'s `node --test scripts/test-*.mjs`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReading, toEOTReader } from "../app/client/reading-pipeline.js";

test("buildReading over real English text produces a Link-terrain reading with the expected chain", () => {
  const { reading, refused } = buildReading("I saw the fat black cat sleeping on the old wooden table.");
  assert.equal(refused.length, 0);
  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  assert.equal(linkLens.view.length, 4); // 2 edges per stack x 2 stacks (cat, table)
});

test("toEOTReader emits a well-formed room + links + reader surface", () => {
  const result = buildReading("the fat black cat slept");
  const eot = toEOTReader(result, { roomName: "cat_doc" });
  assert.match(eot, /cat_doc : room/);
  assert.match(eot, /cat_doc\.contract\.terrains = Field, Link, Lens/);
  assert.match(eot, /!EVA cat_doc\b/);
  assert.match(eot, /cat\.black -> cat\b/);
  assert.match(eot, /cat\.black\.class = "color"/);
  assert.match(eot, /cat\.black\.fat -> cat\.black\b/);
  assert.match(eot, /cat\.black\.fat\.class = "quality"/);
  assert.match(eot, /cat_doc_reader : reader/);
  assert.match(eot, /cat_doc_reader\.room = cat_doc/);
  assert.match(eot, /cat_doc_reader\.cursor = \d+/);
  assert.match(eot, /!EVA cat_doc_reader/);
});

test("a real inverted stack in the source text is refused, never silently ticked as if it were fine", () => {
  // "black fat cat" is the wrong order for English (color before quality) --
  // the tagger reports it in reading order, and toEvents refuses it.
  const { reading, refused } = buildReading("I saw the black fat cat.");
  assert.equal(refused.length, 1);
  assert.equal(refused[0].head, "cat");
  assert.equal(refused[0].gap, "unstable");
  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  assert.equal(linkLens.view.length, 0, "the refused stack contributes no edges");
});

test("toEOTReader on a reading with no chain still emits a valid, checkpointed room", () => {
  const result = buildReading("nothing to see here");
  const eot = toEOTReader(result, { roomName: "empty_doc" });
  assert.match(eot, /empty_doc : room/);
  assert.match(eot, /no Link-terrain structure/);
  assert.match(eot, /empty_doc_reader : reader/);
});

test("cursor in the emitted EOT matches the reading's own cursor exactly", () => {
  const result = buildReading("the fat black cat slept");
  assert.match(toEOTReader(result), new RegExp(`reading_reader\\.cursor = ${result.reading.cursor}\\b`));
});

// ── the induced, live_priors-measured prior (bin/priors/modifier-order/
// en-induced.json, vendored as modifier-order-induced-prior.js) adds real
// coverage the ~50-word hand-authored English lexicon never had ─────────

test("buildReading recovers 'Mock Turtle' from the induced prior alone -- the hand lexicon has no entry for either word", () => {
  const { reading, refused } = buildReading("So they went up to the Mock Turtle, who looked at them with large eyes.");
  assert.equal(refused.length, 0);
  const eot = toEOTReader({ reading, refused }, { roomName: "alice_doc" });
  assert.match(eot, /turtle\.Mock -> turtle\b/);
  assert.match(eot, /turtle\.Mock\.class = "mock"/);
});

test("buildReading runs both taggers over one document and merges their stacks into a single reading", () => {
  const { reading, refused } = buildReading(
    "I saw the fat black cat. So they went up to the Mock Turtle, and then the White Rabbit ran past."
  );
  assert.equal(refused.length, 0);
  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  // 2 edges (fat black cat) + 1 edge (mock turtle) + 1 edge (white rabbit)
  assert.equal(linkLens.view.length, 4);
});

test("the induced prior's one disclosed non-adjective pair ('did'/'not') is tagged exactly like a real modifier pair -- the mechanism cannot tell the difference, honestly", () => {
  // "did not" is the induced prior's own disclosed exception (real
  // monotonic order, but verb-phrase negation, not modifier-noun
  // structure -- see modifier-order-induced-prior.js's header). This
  // documents the actual, honest consequence rather than hiding it: the
  // scanner treats it identically to "Mock Turtle", producing a real
  // Link-terrain edge that is NOT a genuine narrowing relationship.
  const { reading, refused } = buildReading("she did not know");
  assert.equal(refused.length, 0);
  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  assert.ok(
    linkLens.view.some((e) => e.subject === "not::did" && e.class === "did"),
    "expected the induced tagger to have found the did/not pair, as disclosed"
  );
});
