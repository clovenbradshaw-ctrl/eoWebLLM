// scripts/test-self-facts.mjs — verifies eo-self-facts.js's extraction and
// block-building directly, and replays the exact transcript that motivated
// it: "my name is frank." followed by "what is my name?" a few turns
// later, confirming the fix actually closes that gap.
//
// Run: node --test scripts/test-self-facts.mjs
// (picked up automatically by `yarn test`'s `node --test scripts/test-*.mjs`)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSelfFacts,
  selfFactsToTriples,
  buildSelfFactsBlock,
} from "../app/client/eo-self-facts.js";

test("extracts a name from the exact transcript sentence that started this", () => {
  const facts = extractSelfFacts("my name is frank.");
  assert.deepEqual(facts, [{ verb: "is-named", object: "frank" }]);
});

test("recognises the same fact stated three different ways", () => {
  assert.deepEqual(extractSelfFacts("My name's Frank"), [{ verb: "is-named", object: "Frank" }]);
  assert.deepEqual(extractSelfFacts("call me Frank"), [{ verb: "is-named", object: "Frank" }]);
  assert.deepEqual(extractSelfFacts("I'm Frank, nice to meet you"), [{ verb: "is-named", object: "Frank" }]);
});

test("does not fire on unrelated text", () => {
  assert.deepEqual(extractSelfFacts("please write me a letter to my boss asking for a sick day"), []);
  assert.deepEqual(extractSelfFacts("where do i work?"), []);
});

test("extracts multiple distinct fact kinds from one message, at most once each", () => {
  const facts = extractSelfFacts("my name is frank. i live in Chicago and i'm 40 years old.");
  const byVerb = Object.fromEntries(facts.map((f) => [f.verb, f.object]));
  assert.equal(byVerb["is-named"], "frank");
  assert.equal(byVerb["lives-in"], "Chicago");
  assert.equal(byVerb["age-is"], "40");
});

test("a trailing function word is trimmed off the object", () => {
  assert.deepEqual(extractSelfFacts("my name is frank and"), [{ verb: "is-named", object: "frank" }]);
});

test("selfFactsToTriples produces canonical (user, verb, object) triples", () => {
  const triples = selfFactsToTriples([{ verb: "is-named", object: "frank" }]);
  assert.deepEqual(triples, [{ subject: "user", verb: "is-named", object: "frank" }]);
});

test("buildSelfFactsBlock is null on no facts, never an empty block", () => {
  assert.equal(buildSelfFactsBlock([]), null);
});

test("buildSelfFactsBlock instructs the model never to deny a listed fact", () => {
  const block = buildSelfFactsBlock([{ verb: "is-named", object: "Frank" }]);
  assert.match(block, /never deny/i);
  assert.match(block, /name: Frank/);
});

// ── The actual bug transcript, replayed ──────────────────────────────────

test("THE POINT: the exact transcript that failed now produces a fact block by the time the denial-prone turn arrives", () => {
  // Turn 5 of the real transcript.
  const stated = "my name is frank.";
  const facts = extractSelfFacts(stated);
  assert.equal(facts.length, 1, "the turn that broke this must be captured");

  // Simulating what chat.ts now does every subsequent turn: query the
  // facts accumulated so far (here, just this one) and build the block
  // that gets spliced into extraSystemBlocks before generation.
  const block = buildSelfFactsBlock(facts);
  assert.ok(block, "a fact was captured, so a block must be built");
  assert.match(
    block,
    /frank/i,
    "the block that reaches the model on the 'what is my name?' turn must contain the name",
  );

  // The two later turns that actually failed in the real transcript never
  // themselves contain "frank" or "my name" — this channel does not
  // depend on lexical overlap with them at all, unlike the hypergraph's
  // own token-match gate (eo-hypergraph.ts::navigateHypergraph).
  for (const laterQuestion of ["what is my name?", "i gave it to you before", "but what is my name?"]) {
    assert.deepEqual(
      extractSelfFacts(laterQuestion),
      [],
      "a later question restates no fact of its own -- the block above is what must carry it, not a fresh extraction",
    );
  }
});
