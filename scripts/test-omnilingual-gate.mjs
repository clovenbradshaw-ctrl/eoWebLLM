// test-omnilingual-gate.mjs — is the claim-detection gate language-neutral?
//
// `extractClaimAtoms` (eo-citation-check.ts) decides what counts as a checkable
// claim, and therefore what Citey ever goes and grounds. Everything downstream
// — the grounding chips, checkGrounding, the resolve pass, any future
// always-on lookup — only ever sees atoms this function emitted. A claim it
// does not flag is never checked by anything, in any language.
//
// LAWS.md L2 already rules that capitalization must never be the primary
// "is this an entity" signal, and L4 records the encoded assumptions that
// survive ("German capitalises every noun, so this predicate is worthless
// there"). Both are on record as arguments. This file makes them a measurement.
//
// ── Why the UDHR ─────────────────────────────────────────────────────────
//
// scripts/fixtures/udhr/ holds nine translations of ONE document. Same text,
// same facts, nine languages. So atom density is a controlled comparison: a
// language-neutral detector should flag roughly the same number of atoms per
// 1000 words in all nine, because all nine say the same thing. Divergence
// measures the detector, not the text.
//
// Only space-delimited scripts are in the fixture. Chinese, Japanese and Thai
// were deliberately removed: atoms-per-WORD is undefined without word
// boundaries, and including them produced a fake result — Japanese measured
// 233 atoms/1k off a denominator of 90 "words" for a 4070-character document,
// which is a denominator artifact, not an over-fire. Measuring those scripts
// honestly needs a different metric, so they are out of this comparison rather
// than silently distorting it.
//
// ── Two independent root causes, both measured ───────────────────────────
//
// (1) PROPER_RE keys on \p{Lu}. Uncased scripts match nothing.
// (2) NUMBER_RE is /\b\d[\d,]*(?:\.\d+)?%?\b/ — `\d` with no `u` flag is
//     ASCII [0-9], so native numeral systems are invisible.
//
// Hindi and Urdu hit BOTH, which is why they measure exactly zero:
//
//   language   words   atoms   per 1k   ascii digits   native numerals
//   German      1635     547    334.6            51                  0
//   Russian     1588     138     86.9            51                  0
//   Spanish     1932     147     76.1            51                  0
//   English     1742     125     71.8            51                  0
//   Korean      1185      30     25.3            51                  0
//   Arabic      1332      30     22.5            51                  0
//   Hindi       2009       0      0.0             0                 51
//   Urdu        2113       0      0.0             0                 51
//   Farsi       1822       0      0.0             0                  0
//
// Arabic and Korean are uncased, so cause (1) zeroes their NAME atoms — the 30
// atoms each is exactly the article numbers 1-30, in ASCII digits. Hindi and
// Urdu write those same 51 numerals natively, so cause (2) removes even those.
// Farsi spells the numbers out and has neither.
//
// The over-firing case (German, 4.7x English) is loud and merely wasteful. The
// zero case is silent and dangerous: a claim written in Urdu is never checked
// by anything, because nothing upstream believes a claim was made. An
// always-on grounding pass inherits that hole exactly.
//
// ── Status ───────────────────────────────────────────────────────────────
//
// The three assertions below are `todo`: they fail today, pinned so the defect
// stays named without turning `yarn test` red (LAWS.md L6).
//
// Cause (2) has a narrow fix — \p{Nd} with the `u` flag instead of \d. Cause
// (1) does not, and the fix is NOT "add more stopword lists and more alphabet
// ranges": that is the same mistake in more languages. It is to derive
// checkworthiness from the material's own statistics, the way L4 describes the
// engine's stage-1 perception already doing it — surprisal against the text's
// own frequency table, and a Zipf-derived relevance threshold in place of a
// stopword list. Surprisal counts tokens; it has no opinion about case.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-omnilingual-gate.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractClaimAtoms } from "../app/client/eo-citation-check.ts";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "udhr",
);

// The four-line English metadata header is identical in every translation.
// Left in, it hands every language the same English proper nouns ("Universal
// Declaration of Human Rights", "United Nations", "Paris") and the same ASCII
// digits, flooring the zero-atom languages at a false non-zero.
const HEADER = /^(Universal Declaration|Language:|Adopted:|Publisher:)/;

const ASCII_DIGIT = /[0-9]/g;
// Devanagari, Arabic-Indic and Extended Arabic-Indic digit blocks — the three
// present in this fixture. Not a general solution, just enough to prove the
// numerals exist in the text and the gate does not see them.
const NATIVE_NUMERAL = /[٠-٩۰-۹०-९]/g;

const count = (re, s) => (s.match(re) || []).length;

function measure() {
  const rows = [];
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".txt"))) {
    const raw = readFileSync(join(FIXTURES, file), "utf8");
    const language = (raw.match(/^Language:\s*(.+)$/m) || [, file])[1].trim();
    const body = raw
      .split("\n")
      .filter((line) => !HEADER.test(line.trim()))
      .join("\n");
    const words = body.split(/\s+/).filter(Boolean).length;
    const atoms = extractClaimAtoms(body);
    rows.push({
      file,
      language,
      words,
      atoms: atoms.length,
      numbers: atoms.filter((a) => a.atomKind === "number").length,
      per1k: words ? (atoms.length / words) * 1000 : 0,
      asciiDigits: count(ASCII_DIGIT, body),
      nativeNumerals: count(NATIVE_NUMERAL, body),
    });
  }
  return rows.sort((a, b) => b.per1k - a.per1k);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const table = (rows) =>
  rows
    .map(
      (r) =>
        `    ${r.language.slice(0, 26).padEnd(28)} ${r.per1k.toFixed(1).padStart(6)} atoms/1k  (${r.atoms} in ${r.words} words)`,
    )
    .join("\n");

// ── The fixture must be sound, or the measurement means nothing ───────────

test("fixture: nine space-delimited translations load with enough text to measure", () => {
  const rows = measure();
  assert.equal(rows.length, 9, "expected nine translations");
  for (const r of rows)
    assert.ok(
      r.words >= 400,
      `${r.language}: only ${r.words} words after header strip. Atoms-per-word needs a real ` +
        `word count — an unspaced script does not have one and must not be in this fixture.`,
    );
});

test("fixture: the English metadata header is stripped, not counted", () => {
  // If the header leaked through, every language would inherit the same
  // English proper nouns and ASCII digits, and no language could measure zero
  // — silently masking the exact defect this file exists to catch.
  const raw = readFileSync(join(FIXTURES, "udhr-urd.txt"), "utf8");
  assert.match(raw, /^Language:/m, "precondition: header present in the file");
  const body = raw
    .split("\n")
    .filter((line) => !HEADER.test(line.trim()))
    .join("\n");
  assert.equal(
    extractClaimAtoms(body).length,
    0,
    "Urdu should measure zero once the English header is removed; a non-zero count means the strip is leaking",
  );
});

// ── Pinned defects ────────────────────────────────────────────────────────

test(
  "every translation of a document that states facts yields at least one checkable atom",
  {
    todo:
      "Root cause (1): PROPER_RE keys on \\p{Lu}, which matches nothing in " +
      "Arabic, Urdu, Farsi or Devanagari — so no NAME atom is ever produced for " +
      "them. Combined with root cause (2) for Hindi and Urdu, the total is zero: " +
      "a claim in those languages is never flagged, and therefore never grounded " +
      "by anything downstream. Silent under-grounding is the dangerous failure " +
      "direction. Across the full 516-translation corpus, 19 languages measure zero.",
  },
  () => {
    const rows = measure();
    const zero = rows.filter((r) => r.atoms === 0);
    assert.deepEqual(
      zero.map((r) => r.language),
      [],
      `these translations state the same facts as the others and flagged nothing:\n${table(zero)}`,
    );
  },
);

test(
  "a numeral written in a native script is detected as a number atom",
  {
    todo:
      "Root cause (2): NUMBER_RE is /\\b\\d[\\d,]*(?:\\.\\d+)?%?\\b/ and `\\d` " +
      "without the `u` flag is ASCII [0-9]. Hindi and Urdu write the UDHR's 51 " +
      "article numerals in Devanagari and Extended Arabic-Indic digits, and the " +
      "gate sees none of them, while Arabic and Korean — which use ASCII digits " +
      "for the same numbers — get all 30. This one has a narrow fix: \\p{Nd} with " +
      "the `u` flag. It is independent of the capitalization cause and should be " +
      "fixed on its own, not folded into it.",
  },
  () => {
    const rows = measure().filter((r) => r.nativeNumerals > 0);
    assert.ok(
      rows.length > 0,
      "precondition: the fixture contains a translation using native numerals",
    );
    for (const r of rows)
      assert.ok(
        r.numbers > 0,
        `${r.language}: ${r.nativeNumerals} native numeral(s) in the text, ` +
          `${r.asciiDigits} ASCII digit(s), and ${r.numbers} number atom(s) detected`,
      );
  },
);

test(
  "atom density does not diverge more than 2x from the median across languages",
  {
    todo:
      "German capitalizes every noun, so PROPER_RE reads each one as a proper " +
      "name: 334.6 atoms/1k against a 71.8 English baseline, ~4.7x, and 547 " +
      "'names' in a document with a few dozen. LAWS.md L4 predicted exactly this; " +
      "it is now measured. Wasteful rather than unsafe, but it shares root cause " +
      "(1) with the zero case, so a real fix should move both.",
  },
  () => {
    const rows = measure();
    const med = median(rows.map((r) => r.per1k));
    assert.ok(med > 0, "precondition: a non-zero median to compare against");
    const outliers = rows.filter((r) => r.per1k > med * 2);
    assert.deepEqual(
      outliers.map((r) => r.language),
      [],
      `median is ${med.toFixed(1)} atoms/1k; these exceed 2x it:\n${table(outliers)}\n\n  full measurement:\n${table(rows)}`,
    );
  },
);
