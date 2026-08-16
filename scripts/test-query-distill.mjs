// test-query-distill.mjs — what actually reaches the search engine.
//
// distillQuery is the last thing between the reader's sentence and a search
// API, and until this file existed it had no test at all. The cost of that was
// measured live: "write me an essay about dolphins" matched no rule, went to
// Wikipedia verbatim, and returned Hysterical realism / Margaret St. Clair /
// Larry Csonka / Gale Garnett — four articles ranked on the scaffolding words,
// none about dolphins. Because that set was non-empty, webSearch returned
// early (eo-websearch.ts:168), DuckDuckGo was never reached, and the model was
// handed a literary genre and an NFL fullback to ground the essay in.
//
// The deliverable rules that fix it are migrated from eochat's
// server/holonic-chat.js::distillSubject, whose own comment records the same
// failure from the other side ("'essay' → Voltaire"). eochat is legacy and
// frozen — this is a migration, and these tests are what make it a migration
// rather than a copy nobody can check.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-query-distill.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { distillQuery } from "../app/client/eo-websearch.ts";

// ── The measured regression ───────────────────────────────────────────────

test("a deliverable framing yields the subject, not the sentence", () => {
  assert.equal(distillQuery("write me an essay about dolphins"), "dolphins");
});

test("the length of the deliverable is not part of the subject", () => {
  // eochat's own example, verbatim from its comment. "dolphins 5 pages" finds
  // nothing; the page count belongs to the request, not to what it is about.
  assert.equal(
    distillQuery(
      "Write me a 5 page essay about dolphins, after researching online first.",
    ),
    "dolphins",
  );
});

test("every deliverable noun in the migrated set reaches its subject", () => {
  for (const noun of ["essay", "report", "paper", "summary", "article", "piece"])
    assert.equal(
      distillQuery(`write me a ${noun} about coral reefs`),
      "coral reefs",
      `deliverable "${noun}" did not distil`,
    );
});

test("a direct ask yields its subject", () => {
  assert.equal(distillQuery("tell me about dolphins"), "dolphins");
  assert.equal(distillQuery("what is a hydrofoil"), "hydrofoil");
});

test("search-intent verbs come off, since hasExplicitSearchIntent routes on them", () => {
  // eo-tool-router.ts routes to a search on exactly these words, so they arrive
  // here attached to the subject and would otherwise be searched for.
  assert.equal(distillQuery("research dolphins"), "dolphins");
  assert.equal(distillQuery("look up dolphins"), "dolphins");
  assert.equal(distillQuery("google dolphins"), "dolphins");
});

// ── Behaviour that already worked and must keep working ───────────────────

test("a genuine topical query passes through unchanged", () => {
  assert.equal(
    distillQuery("Taylor C709 milkshake machine error codes"),
    "Taylor C709 milkshake machine error codes",
  );
});

test("the pre-existing leading-scaffold strip still applies", () => {
  assert.equal(
    distillQuery("what's wrong with my Taylor C709 milkshake machine"),
    "wrong with my Taylor C709 milkshake machine",
  );
});

test("empty and whitespace input yield empty, never a crash", () => {
  assert.equal(distillQuery(""), "");
  assert.equal(distillQuery("   "), "");
  assert.equal(distillQuery(null), "");
});

// ── The declared limit, pinned ────────────────────────────────────────────

test(
  "the same request distils in any language, not only English",
  {
    todo:
      "Every rule in distillQuery is English. Measured: the Japanese, German " +
      "and Arabic forms of 'write me an essay about dolphins' all pass through " +
      "completely unchanged. For Japanese the consequence is worse than a " +
      "passthrough — fetchWikipedia is hardcoded to en.wikipedia.org, which " +
      "returns ZERO hits for the Japanese sentence, so the turn gets no " +
      "grounding material and the fold ledger reports 'consulted and came " +
      "back empty' to the reader as a finding about their own evidence. " +
      "Routing to ja.wikipedia.org does not fix it: the undistilled sentence " +
      "matches エッセイ/書いて/ください and returns a musician, a novel, a " +
      "lyricist and a music genre. The repair is NOT a German rule list and an " +
      "Arabic one — that is the same mistake in more languages (eo-constitution " +
      "II.20, proposed) — but content-word extraction that enumerates no " +
      "scaffolding at all.",
  },
  () => {
    const SAME_REQUEST = [
      ["ja", "イルカについてのエッセイを書いてください"],
      ["de", "schreibe mir einen Aufsatz über Delfine"],
      ["ar", "اكتب لي مقالاً عن الدلافين"],
    ];
    for (const [lang, sentence] of SAME_REQUEST)
      assert.notEqual(
        distillQuery(sentence),
        sentence,
        `${lang}: the whole sentence reaches the search engine untouched`,
      );
  },
);
