// test-eo-citation-resolve.mjs — the assay for surprise-driven resolution.
//
// The claim this file exists to check: a grounding finding is a RETRIEVAL
// signal, not necessarily a failed claim. When the answer says "CEO" and the
// material says "Chief Executive", the check reports an unsupported claim —
// but the closed-form abbreviation table resolves that against a fresh search
// of the same material, in both directions, without asking a model. A finding
// that resolves was never unsupported; it was un-surfaced.
//
// Run: node --test scripts/       (or  yarn test)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkGrounding,
  buildUnionIndex,
  tokenSupported,
  resolveFindingsAgainst,
  abbreviationExpansion,
  detectMaterialEvasion,
} from "../app/client/eo-citation-check.ts";

const cite = (text) => ({ index: 1, source_id: "doc.md#0-100", text });

// ── The closed-form abbreviation table ─────────────────────────────────────

test("the abbreviation table maps an acronym to its expansion words", () => {
  assert.deepEqual(abbreviationExpansion("CEO"), ["chief", "executive"]);
  assert.deepEqual(abbreviationExpansion("ceo."), ["chief", "executive"]);
  assert.equal(abbreviationExpansion("us"), null, "no prose-collision words");
});

test("the union index carries an abbreviation when the source spells it out", () => {
  const index = buildUnionIndex([cite("Nadia Voss served as founding Chief Executive")]);
  assert.equal(tokenSupported(index, false, "CEO"), true);
});

test("the union index carries the spelled-out form when the source abbreviates", () => {
  const index = buildUnionIndex([cite("The CEO approved the budget")]);
  assert.equal(tokenSupported(index, false, "chief"), true);
  assert.equal(tokenSupported(index, false, "executive"), true);
});

// ── checkGrounding stops crying about the paraphrase ──────────────────────

test("checkGrounding accepts CEO against a source that says Chief Executive", () => {
  const report = checkGrounding(
    "The founding CEO of AOR was Nadia Voss.",
    [cite("AOR was founded on 14 March 2089 by Nadia Voss, who served as founding Chief Executive until her departure on 2 November 2097.")],
    { channels: ["corpus"] },
  );
  assert.equal(report.clean, true);
});

test("checkGrounding accepts the spelled-out form against a source that says CEO", () => {
  const report = checkGrounding(
    "Nadia Voss was the founding Chief Executive of AOR.",
    [cite("AOR's founding CEO was Nadia Voss")],
    { channels: ["corpus"] },
  );
  assert.equal(report.clean, true);
});

test("checkGrounding still flags a genuinely absent name", () => {
  const report = checkGrounding(
    "The founding CEO of AOR was Nadia Voss.",
    [cite("The board met quarterly")],
    { channels: ["corpus"] },
  );
  assert.equal(report.clean, false);
  assert.ok(report.findings.some((f) => f.absent.includes("CEO")));
});

// ── resolveFindingsAgainst: the re-surf's resolution test ─────────────────

test("a finding resolves against fresh material that spells the surprise out", () => {
  const first = checkGrounding(
    "The founding CEO of AOR was Nadia Voss.",
    [cite("AOR was founded on 14 March 2089 by Nadia Voss.")],
    { channels: ["corpus"] },
  );
  assert.equal(first.clean, false);

  const resolved = resolveFindingsAgainst(
    first.findings,
    [cite("Nadia Voss served as founding Chief Executive until her departure.")],
  );
  assert.equal(resolved.length, 1);
  assert.ok(resolved[0].absent.includes("CEO"));
});

test("a finding stays unresolved against fresh material that still lacks it", () => {
  const first = checkGrounding(
    "The founding CEO of AOR was Nadia Voss.",
    [cite("The company was founded by Nadia Voss on 14 March 2089.")],
    { channels: ["corpus"] },
  );
  const resolved = resolveFindingsAgainst(
    first.findings,
    [cite("The board met quarterly")],
  );
  assert.equal(resolved.length, 0);
});

test("resolveFindingsAgainst with no fresh citations resolves nothing", () => {
  const first = checkGrounding(
    "The founding CEO of AOR was Nadia Voss.",
    [cite("The company was founded by Nadia Voss on 14 March 2089.")],
    { channels: ["corpus"] },
  );
  assert.equal(resolveFindingsAgainst(first.findings, []).length, 0);
});

// ── detectMaterialEvasion: denial without bytes is not an evasion ─────────

test("a denial with no retrieval is not an evasion", () => {
  assert.equal(
    detectMaterialEvasion("The text doesn't mention a specific deposit.", 0),
    null,
  );
});

test("the Q4 dodge 'doesn't provide specific information' is caught", () => {
  const phrase = detectMaterialEvasion(
    "Unfortunately, the text doesn't provide specific information about which site is the better source of water for a propellant depot.",
    2,
  );
  assert.ok(phrase && phrase.includes("doesn't provide"));
});

test("the Q5 dodge 'does not provide information on when' is caught", () => {
  const phrase = detectMaterialEvasion(
    "the text does not provide information on when each person returned to duty.",
    1,
  );
  assert.ok(phrase && phrase.includes("does not provide"));
});

test("the baseline Q2 dodge 'passage doesn't mention' is caught", () => {
  const phrase = detectMaterialEvasion(
    "The passage doesn't mention a specific deposit.",
    1,
  );
  assert.ok(phrase && phrase.includes("doesn't mention"));
});

test("bare denials 'not specified', 'no information', 'cannot determine' are caught", () => {
  assert.ok(detectMaterialEvasion("It is not specified which deposit.", 1));
  assert.ok(detectMaterialEvasion("There is no information about the yield.", 1));
  assert.ok(detectMaterialEvasion("The multiple cannot be determined.", 1));
});

test("an honest answer that quotes the material is not flagged", () => {
  assert.equal(
    detectMaterialEvasion("The K-2 well produces 41 liters per day.", 1),
    null,
  );
});

test("a truthful negative still fires — the retrieval guard decides truth", () => {
  // By design: the function fires on the denial; whether the denial was
  // truthful is decided by whether the mechanical surf retrieved bytes. A
  // denial that no bytes contradict stays unpunished by the caller.
  assert.ok(detectMaterialEvasion("The text does not mention the CEO's salary.", 1));
});
