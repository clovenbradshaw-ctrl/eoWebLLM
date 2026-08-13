// test-multilingual-search.mjs — does a query survive the search path intact,
// in any language a reader might actually type?
//
// The guarantee this file pins is narrow and total: between a caller and the
// search engine, NOTHING inspects, rewrites, reduces, or normalizes the
// reader's words. That is the whole of "omnilingual" at this layer, and it is
// checkable offline — no relay, no network, no fixture.
//
// It needs pinning because the path used to violate it. distillQuery is an
// English regex, it ran on every query, and it was measured to make results
// WORSE where it did fire on a non-English string: 「イルカ」 alone returns
// four-of-five results about Iruka the folk singer, because the surrounding
// words were the only thing distinguishing the animal from the musician. The
// distillation now lives inside fetchWikipedia, the one backend that cannot
// read a sentence and is already declared English-biased. Nothing else touches
// the query.
//
// The 25 prompts below are deliberately awkward rather than clean specimens —
// code-switching, transliteration, mixed direction, mixed numeral systems,
// IME full-width text, emoji, and a few outright pathological inputs. A reader
// types these. A test suite that only ever sees well-formed single-script
// sentences will pass while the real path breaks.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-multilingual-search.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ddgSearchUrl,
  distillQuery,
  webSearch,
  configureSearchProxy,
} from "../app/client/eo-websearch.ts";

// Each entry: [label, the thing a reader actually typed]
export const PROMPTS = [
  // — single-script, the ordinary case in nine languages —
  ["ja  polite request", "イルカについてのエッセイを書いてください"],
  ["ar  imperative", "اكتب لي مقالاً عن الدلافين"],
  ["hi  devanagari", "डॉल्फ़िन के बारे में एक निबंध लिखें"],
  ["ru  cyrillic", "напиши мне эссе о дельфинах"],
  ["ko  hangul", "돌고래에 대한 에세이를 써주세요"],
  ["th  no word spaces", "เขียนเรียงความเกี่ยวกับโลมาให้ฉันหน่อย"],
  ["zh  simplified", "请给我写一篇关于海豚的文章"],
  ["he  rtl", "כתוב לי חיבור על דולפינים"],
  ["el  greek", "γράψε μου μια έκθεση για τα δελφίνια"],

  // — code-switching: two languages inside one sentence —
  ["en+ja mid-sentence switch", "write an essay about イルカ please"],
  ["ja+en inverted", "イルカ about essay 書いて"],
  ["es+en spanglish", "escribe un essay sobre dolphins porfa"],
  ["de+en compound switch", "schreib mir was über dolphin echolocation"],
  ["fr+en", "explique moi le dolphin echolocation stp"],

  // — transliteration: one language written in another's script —
  ["hinglish (hindi in latin)", "dolphin ke baare mein essay likho"],
  ["arabizi (arabic in latin+digits)", "iktebli maqal 3an el dolphins"],
  ["russian in latin", "napishi mne esse o delfinah"],

  // — mixed direction, mixed numerals, mixed width —
  ["rtl+ltr in one clause", "ما هو dolphin echolocation؟"],
  ["devanagari numerals", "डॉल्फ़िन की २५ प्रजातियाँ"],
  ["arabic-indic numerals + latin", "٥ pages essay about dolphins"],
  ["full-width latin (japanese IME)", "ｄｏｌｐｈｉｎ　ｅｓｓａｙ"],

  // — emoji and non-linguistic content —
  ["emoji + english", "🐬 essay pls 🙏"],
  ["emoji + japanese", "🐬について書いて"],
  ["ZWJ emoji sequence", "dolphins 🏳️‍🌈 and 👨‍👩‍👧‍👦 essay"],

  // — pathological —
  ["newlines and tabs", "write me\n\tan essay\nabout\tdolphins"],
];

test("the fixture covers 25 prompts across scripts, directions and numeral systems", () => {
  assert.equal(PROMPTS.length, 25);
  const joined = PROMPTS.map(([, q]) => q).join("");
  // A guard on the fixture rather than on the code: if someone "tidies" these
  // into ASCII the file keeps passing while testing nothing.
  for (const [name, re] of [
    ["CJK", /[぀-ヿ一-鿿]/],
    ["Arabic", /[؀-ۿ]/],
    ["Devanagari", /[ऀ-ॿ]/],
    ["Cyrillic", /[Ѐ-ӿ]/],
    ["Hangul", /[가-힯]/],
    ["Thai", /[฀-๿]/],
    ["Hebrew", /[֐-׿]/],
    ["Greek", /[Ͱ-Ͽ]/],
    ["emoji", /\p{Extended_Pictographic}/u],
    ["full-width", /[＀-￯]/],
  ])
    assert.match(joined, re, `fixture lost its ${name} coverage`);
});

// ── The guarantee ─────────────────────────────────────────────────────────

test("every prompt reaches the search engine byte-identical to what was typed", () => {
  for (const [label, q] of PROMPTS) {
    const url = ddgSearchUrl(q);
    const sent = decodeURIComponent(url.slice(url.indexOf("?q=") + 3));
    assert.equal(
      sent,
      q,
      `${label}: the query was altered on the way to the engine\n` +
        `  typed: ${JSON.stringify(q)}\n  sent : ${JSON.stringify(sent)}`,
    );
  }
});

test("no prompt produces a malformed URL", () => {
  for (const [label, q] of PROMPTS) {
    const url = ddgSearchUrl(q);
    assert.doesNotThrow(() => new URL(url), `${label}: unparseable URL`);
    assert.ok(
      !/[\s"<>]/.test(url),
      `${label}: raw whitespace or delimiter leaked into the URL`,
    );
  }
});

test("percent-encoding round-trips every script without loss", () => {
  // Encoding is where multibyte text usually dies — a lone surrogate or a
  // half-encoded sequence produces a URL that resolves to a different query.
  for (const [label, q] of PROMPTS) {
    const url = ddgSearchUrl(q);
    const back = decodeURIComponent(url.slice(url.indexOf("?q=") + 3));
    assert.equal([...back].length, [...q].length, `${label}: codepoint count changed`);
    assert.equal(
      Buffer.from(back, "utf8").length,
      Buffer.from(q, "utf8").length,
      `${label}: byte length changed`,
    );
  }
});

// ── The one place an English rule is still allowed to run ─────────────────

test("distillQuery never mangles a non-Latin query, whatever else it does", () => {
  // It is English-only and declared so. What it must never do is corrupt a
  // string it does not understand — silently returning a mangled subject is
  // worse than returning the sentence unchanged.
  for (const [label, q] of PROMPTS) {
    const out = distillQuery(q);
    assert.equal(typeof out, "string", `${label}: non-string result`);
    if (out && out !== q.trim().replace(/\s+/g, " "))
      assert.ok(
        q.includes(out) || q.replace(/\s+/g, " ").includes(out),
        `${label}: produced a substring that is not in the original\n` +
          `  in : ${JSON.stringify(q)}\n  out: ${JSON.stringify(out)}`,
      );
  }
});

// ── The whole path, with no relay ─────────────────────────────────────────

test("every prompt resolves rather than throwing when no relay is configured", async () => {
  configureSearchProxy(null);
  for (const [label, q] of PROMPTS) {
    const out = await webSearch(q, { numResults: 1 });
    assert.ok(Array.isArray(out), `${label}: webSearch did not return an array`);
  }
});

// ── The intent gate: silence vs. inability ────────────────────────────────

test("the Latin-only intent gate reports when it could not read the question at all", async () => {
  const { hasExplicitSearchIntent, searchIntentUndecidable } = await import(
    "../app/client/eo-tool-router.ts"
  );

  // English: the gate genuinely examined these and has a real verdict.
  for (const q of ["research dolphins", "write me an essay about dolphins"]) {
    assert.equal(searchIntentUndecidable(q), false, `decidable: ${q}`);
  }
  assert.equal(hasExplicitSearchIntent("research dolphins"), true);
  assert.equal(hasExplicitSearchIntent("write me an essay about dolphins"), false);

  // No Latin letters anywhere: the patterns could not have matched, so their
  // silence is not a verdict. 「イルカについて調べてください」 asks for a lookup
  // as plainly as "look up dolphins" does.
  for (const q of [
    "イルカについて調べてください",
    "ابحث عن الدلافين",
    "докажи это",
    "돌고래에 대해 알아봐",
  ]) {
    assert.equal(hasExplicitSearchIntent(q), false, `gate cannot fire: ${q}`);
    assert.equal(searchIntentUndecidable(q), true, `should be undecidable: ${q}`);
  }
});

test("a code-switched question was genuinely examined, even if the gate stayed silent", () => {
  // One Latin letter is enough for the patterns to have had a chance, so
  // "essay について書いて" is a real negative rather than an unreadable one.
  // Only a question with no Latin at all was never looked at.
  return import("../app/client/eo-tool-router.ts").then(
    ({ searchIntentUndecidable }) => {
      assert.equal(searchIntentUndecidable("write an essay about イルカ please"), false);
      assert.equal(searchIntentUndecidable("イルカ about essay 書いて"), false);
      assert.equal(searchIntentUndecidable("🐬について書いて"), true, "emoji are not Latin letters");
    },
  );
});
