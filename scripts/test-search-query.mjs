// test-search-query.mjs — mid-conversation queries that carry no subject.
//
// "prove it" has nothing to search for. Neither does 「証明して」, «докажи
// это», or "أثبت ذلك". The subject is in the conversation, and the module
// under test resolves it WITHOUT knowing what any of those phrases mean —
// there is no phrase list in eo-search-query.ts, in any language, by design.
// It asks an injected resolver and validates the answer against the
// conversation's own text.
//
// So these tests use a scripted resolver: no model, no network, deterministic.
// What they check is the contract that makes trusting a resolver safe at all —
// closed set, additive, fail-open — plus that the contract holds identically
// across scripts, since a mechanism that only works in English is the defect
// this module exists to avoid.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-search-query.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveSearchQuery,
  groundReferent,
  MAX_CARRIED,
} from "../app/client/eo-search-query.ts";

// A conversation that has established a subject, in five languages.
const CONVOS = {
  en: "Dolphins use echolocation to navigate murky water. They are marine mammals.",
  ja: "イルカは反響定位を使って濁った水の中を移動します。イルカは海洋哺乳類です。",
  ru: "Дельфины используют эхолокацию для навигации. Дельфины — морские млекопитающие.",
  ar: "تستخدم الدلافين تحديد الموقع بالصدى للتنقل. الدلافين ثدييات بحرية.",
  th: "โลมาใช้การสะท้อนเสียงเพื่อนำทาง โลมาเป็นสัตว์เลี้ยงลูกด้วยนมในทะเล",
};

// What a reader types mid-stream, carrying no subject of its own.
const REFERENTIAL = {
  en: "prove it",
  ja: "証明して",
  ru: "докажи это",
  ar: "أثبت ذلك",
  th: "พิสูจน์สิ",
};

// What a resolver would answer — the subject, in the conversation's own words.
const ANSWERS = {
  en: "echolocation",
  ja: "反響定位",
  ru: "эхолокацию",
  ar: "الدلافين",
  th: "การสะท้อนเสียง",
};

const scripted = (reply) => async () => reply;

// ── The contract, across scripts ──────────────────────────────────────────

test("a subjectless message carries the conversation's subject, in every script", async () => {
  for (const lang of Object.keys(CONVOS)) {
    const out = await resolveSearchQuery({
      message: REFERENTIAL[lang],
      conversation: CONVOS[lang],
      resolveReferent: scripted(ANSWERS[lang]),
    });
    assert.equal(out.standalone, false, `${lang}: nothing was carried`);
    assert.deepEqual(out.carried, [ANSWERS[lang]], `${lang}: wrong term carried`);
    assert.equal(out.query, `${REFERENTIAL[lang]} ${ANSWERS[lang]}`, `${lang}: query`);
  }
});

test("the query always begins with the reader's own message, byte for byte", async () => {
  for (const lang of Object.keys(CONVOS)) {
    const out = await resolveSearchQuery({
      message: REFERENTIAL[lang],
      conversation: CONVOS[lang],
      resolveReferent: scripted(ANSWERS[lang]),
    });
    assert.ok(
      out.query.startsWith(REFERENTIAL[lang]),
      `${lang}: message was altered — ${JSON.stringify(out.query)}`,
    );
  }
});

// ── Closed set: a resolver cannot invent a subject ───────────────────────

test("a referent the conversation does not contain is refused", async () => {
  const out = await resolveSearchQuery({
    message: "prove it",
    conversation: CONVOS.en,
    resolveReferent: scripted("quantum chromodynamics"),
  });
  assert.equal(out.standalone, true);
  assert.deepEqual(out.carried, []);
  assert.match(out.reason, /nothing the conversation contains/);
});

test("a plausible-sounding invention next to a real term keeps only the real one", async () => {
  const out = await resolveSearchQuery({
    message: "prove it",
    conversation: CONVOS.en,
    resolveReferent: scripted("echolocation and bioluminescence"),
  });
  assert.deepEqual(out.carried, ["echolocation"]);
});

test("groundReferent works on unspaced scripts, where token splitting would fail", () => {
  // Thai and Japanese have no word delimiters. Substring containment is the
  // reason this module never tokenizes.
  assert.deepEqual(groundReferent("反響定位", CONVOS.ja), ["反響定位"]);
  assert.deepEqual(groundReferent("การสะท้อนเสียง", CONVOS.th), ["การสะท้อนเสียง"]);
  assert.deepEqual(groundReferent("量子力学", CONVOS.ja), []);
});

test("groundReferent rejects a single character as evidence of a referent", () => {
  // One character is noise in a cased script and a fragment in an unspaced
  // one; neither identifies a subject.
  assert.deepEqual(groundReferent("は", CONVOS.ja), []);
  assert.deepEqual(groundReferent("a", CONVOS.en), []);
});

test("a resolver that echoes the whole conversation degrades to bounded noise, not to a giant term", () => {
  // The whole-reply candidate is refused on length, but its constituent words
  // are genuinely present, so they survive — which is the right outcome: the
  // result is bounded, additive and made of real words, never one enormous
  // span that swamps the reader's own message.
  const out = groundReferent(CONVOS.en, CONVOS.en);
  assert.ok(out.length <= MAX_CARRIED, `unbounded: ${out.length}`);
  for (const term of out) {
    assert.ok(term.length <= 60, `over-long span survived: ${term}`);
    assert.ok(CONVOS.en.includes(term), `not actually in the conversation: ${term}`);
  }
});

test("carrying is bounded", async () => {
  const convo = "alpha beta gamma delta epsilon zeta eta theta";
  const out = await resolveSearchQuery({
    message: "prove it",
    conversation: convo,
    resolveReferent: scripted("alpha beta gamma delta epsilon zeta"),
  });
  assert.ok(out.carried.length <= MAX_CARRIED, `carried ${out.carried.length}`);
});

// ── Fail open, every way it can fail ─────────────────────────────────────

test("no resolver, no conversation, empty message — all give the message alone", async () => {
  const a = await resolveSearchQuery({ message: "prove it", conversation: CONVOS.en });
  assert.equal(a.query, "prove it");
  assert.match(a.reason, /no resolver/);

  const b = await resolveSearchQuery({
    message: "prove it",
    conversation: "",
    resolveReferent: scripted("echolocation"),
  });
  assert.equal(b.query, "prove it");
  assert.match(b.reason, /no conversation/);

  const c = await resolveSearchQuery({ message: "", conversation: CONVOS.en });
  assert.equal(c.query, "");
});

test("a resolver that throws, hangs into a rejection, or answers junk costs nothing", async () => {
  const throwing = async () => {
    throw new Error("engine busy");
  };
  const t = await resolveSearchQuery({
    message: "prove it",
    conversation: CONVOS.en,
    resolveReferent: throwing,
  });
  assert.equal(t.query, "prove it");
  assert.match(t.reason, /resolver failed/);

  for (const junk of ['{"referent": "echo"}', "I'm not sure I can help", "```", ""]) {
    const j = await resolveSearchQuery({
      message: "prove it",
      conversation: CONVOS.en,
      resolveReferent: scripted(junk),
    });
    assert.ok(
      j.query.startsWith("prove it"),
      `junk reply ${JSON.stringify(junk)} altered the message`,
    );
  }
});

// ── A message that stands on its own is not "resolved" into something else ──

test("a self-contained message keeps its own subject even when a resolver answers", async () => {
  // The resolver is asked on every turn; what protects a standalone message is
  // that carrying is ADDITIVE. "what about whales" never becomes a search for
  // echolocation instead — at worst it becomes a search for both.
  const out = await resolveSearchQuery({
    message: "what about whales",
    conversation: CONVOS.en,
    resolveReferent: scripted("echolocation"),
  });
  assert.ok(out.query.startsWith("what about whales"));
  assert.ok(out.query.includes("whales"), "the reader's own subject survived");
});
