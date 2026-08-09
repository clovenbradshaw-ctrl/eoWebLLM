// scripts/test-modifier-graph.mjs — verifies the vendored eoreader6
// modifier-order + graph organs, and the disclosed-scope English demo
// tagger, at their real shipped location under app/client/eo-binary/.
//
// Run: node --test scripts/test-modifier-graph.mjs
// (picked up automatically by `yarn test`'s `node --test scripts/test-*.mjs`)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractEnglishModifierStacks,
  ENGLISH_DEMO_TYPOLOGY,
} from "../app/client/eo-binary/english-modifier-demo.js";
import { toTriples, order } from "../app/client/eo-binary/modifier-order.js";
import { createGraph, readTriples, edgeKey } from "../app/client/eo-binary/graph.js";
import { isGap } from "../app/client/eo-binary/nul.js";

test("extractEnglishModifierStacks finds 'fat black cat' and 'old wooden table' in reading order", () => {
  const stacks = extractEnglishModifierStacks(
    "I saw the fat black cat sleeping on the old wooden table.",
  );
  assert.equal(stacks.length, 2, JSON.stringify(stacks));
  assert.equal(stacks[0].head, "cat");
  assert.deepEqual(stacks[0].tags, [
    { class: "quality", surface: "fat" },
    { class: "color", surface: "black" },
  ]);
  assert.equal(stacks[1].head, "table");
  assert.deepEqual(stacks[1].tags, [
    { class: "age", surface: "old" },
    { class: "material", surface: "wooden" },
  ]);
});

test("extractEnglishModifierStacks does not fire on a single adjective", () => {
  assert.deepEqual(extractEnglishModifierStacks("the black cat slept"), []);
});

test("extractEnglishModifierStacks is silent on non-English text — disclosed scope, not a wrong guess", () => {
  assert.deepEqual(
    extractEnglishModifierStacks("le chat noir et gros dormait sur la table"),
    [],
  );
});

test("order() judges 'fat black' nested and 'black fat' inverted, using the same typology the demo tagger receives", () => {
  const nested = order(
    [{ class: "quality" }, { class: "color" }],
    ENGLISH_DEMO_TYPOLOGY,
  );
  assert.equal(nested.relation, "nested");
  const inverted = order(
    [{ class: "color" }, { class: "quality" }],
    ENGLISH_DEMO_TYPOLOGY,
  );
  assert.equal(inverted.relation, "inverted");
});

test("end to end: tagger output flows through toTriples into the real emergence/graph.js", () => {
  const [stack] = extractEnglishModifierStacks("the fat black cat slept");
  const t = toTriples(stack.tags, ENGLISH_DEMO_TYPOLOGY, { head: stack.head });
  assert.ok(!isGap(t), JSON.stringify(t));
  assert.equal(t.entityNode, "cat::black::fat");

  const g = createGraph({ gamma: 0.85, pruneBelow: 0.02 });
  const result = readTriples(g, t.triples);
  assert.equal(result.newNodes, 3);
  assert.equal(result.newEdges, 2);
  for (const triple of t.triples) {
    assert.ok(g.edges.has(edgeKey(triple)), `graph must hold the edge for ${JSON.stringify(triple)}`);
  }
});

test("an inverted stack is refused at toTriples and never reaches the graph", () => {
  const invertedTags = [
    { class: "color", surface: "black" },
    { class: "quality", surface: "fat" },
  ]; // black, fat — inverted
  const t = toTriples(invertedTags, ENGLISH_DEMO_TYPOLOGY, { head: "cat" });
  assert.ok(isGap(t));
  assert.equal(t.gap, "unstable");
});

test("a typology missing its giver is refused, not silently accepted", () => {
  const { giver, ...noGiver } = ENGLISH_DEMO_TYPOLOGY;
  const r = order([{ class: "quality" }, { class: "color" }], noGiver);
  assert.ok(isGap(r));
  assert.equal(r.gap, "unreceived_origin");
});
