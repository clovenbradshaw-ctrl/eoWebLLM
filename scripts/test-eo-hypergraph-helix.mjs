// scripts/test-eo-hypergraph-helix.mjs — verifies the "helix re-climb" gate
// added to eoRunSystem2 (app/store/chat.ts, section "3d"): a second
// navigateHypergraph call keyed on a draft's own claim sentences should
// reach nodes/edges the pre-draft navigation (keyed on the raw question)
// never touched, when the draft states something the question's own words
// never mentioned. This is the exact mechanical condition that "earns" the
// climb response — checked here directly against eo-hypergraph.ts, without
// spinning up the whole chat pipeline or a real model.
//
// Runs against a real prose fixture (eoreader6's own adversarial test
// corpus, a Frankenstein excerpt), not synthetic toy sentences — the
// relation extractor is deliberately calibrated against real recurrence
// statistics across a real document (see eoreader6/scripts/
// LOSS-LESS-LADDER.md), and a two-sentence synthetic string never clears
// its discovery floors (verified while writing this test: admitting a
// handful of hand-written sentences produced zero relations every time,
// zero nodes, zero edges — not a bug, the engine's own admission gates
// (discoverReferents' sentences-recurrence floor, primarily) are simply
// not meant to fire below real-corpus scale). The fixture is read once and
// its own already-extracted edges are used to build the pre/post queries,
// so this test asserts the DIFFING mechanism's own correctness against
// real, honestly-noisy extraction — not a hand-curated happy path.
//
// Run: node --test scripts/test-eo-hypergraph-helix.mjs
// (picked up automatically by `yarn test`'s `node --test scripts/test-*.mjs`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  admitHypergraphSource,
  hypergraphSnapshot,
  navigateHypergraph,
} from "../app/client/eo-hypergraph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real fixture lives under eoreader6/scripts/adversarial/fixtures/,
// two directories over from this file.
const FRANKENSTEIN_EXCERPT = path.join(
  __dirname,
  "..",
  "eoreader6",
  "scripts",
  "adversarial",
  "fixtures",
  "frankenstein-excerpt.txt",
);

function admitFixture(scopeId) {
  const text = readFileSync(FRANKENSTEIN_EXCERPT, "utf8");
  const movement = admitHypergraphSource(scopeId, { id: "frank", text });
  assert.ok(
    movement && movement.stated > 0,
    "fixture admission should state at least one relation — if this fails, the fixture path or the extraction pipeline changed",
  );
  return movement;
}

test("a claim-keyed re-navigation reaches a real edge the question-keyed one missed", () => {
  const scopeId = "test-helix-real-1";
  admitFixture(scopeId);

  const snap = hypergraphSnapshot(scopeId);
  assert.ok(snap.edges.length > 0, "expected the real fixture to yield edges");

  // Pick a real extracted edge and use its own subject/object phrase as the
  // "draft claim" — exactly the shape eoRunSystem2's 3d section builds
  // (claims.join(" ") fed straight into navigateHypergraph).
  const target = snap.edges[0];
  const [subject, , object] = target.edge.split("|");
  const claimText = `${subject} ${object}.`.trim();

  // The "pre-draft" pass: keyed on words with no relation to the target
  // edge at all — same role chat.ts's pre-draft navigateHypergraph call
  // plays (keyed on the reader's raw question, before the target edge's
  // own words have been said by anyone).
  const preNav = navigateHypergraph(scopeId, "unrelated query about nothing");
  const preEdgeKeys = new Set((preNav?.relevantEdges ?? []).map((e) => e.edge));
  assert.ok(
    !preEdgeKeys.has(target.edge),
    "the unrelated pre-draft query should not already contain the target edge",
  );

  const postNav = navigateHypergraph(scopeId, claimText);
  assert.ok(postNav, "post-draft navigation should return a result");
  const postEdgeKeys = new Set(
    (postNav.relevantEdges ?? []).map((e) => e.edge),
  );
  assert.ok(
    postEdgeKeys.has(target.edge),
    `expected the claim-keyed pass to reach the target edge ${JSON.stringify(target.edge)} via its own words ${JSON.stringify(claimText)}, got: ${JSON.stringify([...postEdgeKeys])}`,
  );

  // This is the exact diff eoRunSystem2's 3d section computes to decide
  // whether the climb response is earned.
  const newEdges = postNav.relevantEdges.filter(
    (e) => !preEdgeKeys.has(e.edge),
  );
  assert.ok(
    newEdges.some((e) => e.edge === target.edge),
    "the target edge should show up in the new-edges diff, the mechanical earn condition",
  );
});

test("no new edges when the draft only restates what the question already said", () => {
  const scopeId = "test-helix-real-2";
  admitFixture(scopeId);

  const snap = hypergraphSnapshot(scopeId);
  const target = snap.edges[0];
  const [subject, , object] = target.edge.split("|");
  const claimText = `${subject} ${object}.`.trim();

  // This time the "question" already contains the same words the "draft"
  // will restate — the gate should not earn a climb response for a claim
  // that adds no new ground over the question.
  const preNav = navigateHypergraph(scopeId, claimText);
  const preEdgeKeys = new Set((preNav?.relevantEdges ?? []).map((e) => e.edge));
  assert.ok(
    preEdgeKeys.has(target.edge),
    "sanity check: the question itself should already reach the target edge",
  );

  const postNav = navigateHypergraph(scopeId, claimText);
  const newEdges = (postNav?.relevantEdges ?? []).filter(
    (e) => !preEdgeKeys.has(e.edge),
  );
  assert.equal(
    newEdges.length,
    0,
    `expected no new edges when the draft adds no new ground, got: ${JSON.stringify(newEdges)}`,
  );
});
