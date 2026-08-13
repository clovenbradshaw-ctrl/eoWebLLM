import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGroundingSpans } from "../app/client/eo-grounding-spans.ts";
import { resolveSpans } from "../app/client/eo-revision.ts";

test("buildGroundingSpans: no citations at all -> numbers 'checking', names 'general'", () => {
  const content = "The Eiffel Tower was completed in 1889.";
  const spans = buildGroundingSpans(content, { citations: [] });
  const number = spans.find((s) => s.atomKind === "number");
  const name = spans.find((s) => s.atomKind === "name");
  assert.equal(number.state, "checking");
  // "general", not "unconfirmed": nothing external bore on this turn, so
  // general knowledge is the legitimate basis rather than a gap. The two were
  // the same state until the owned split.
  assert.equal(name.state, "general");
});

test("buildGroundingSpans: citations support every atom -> sourced", () => {
  const content = "The Eiffel Tower was completed in 1889.";
  const citations = [
    {
      index: 1,
      source_id: "wiki",
      text: "The Eiffel Tower was completed in 1889 in Paris.",
    },
  ];
  const spans = buildGroundingSpans(content, { citations });
  assert.ok(spans.length >= 1);
  assert.ok(spans.every((s) => s.state === "sourced"));
});

test("buildGroundingSpans: citations exist but don't cover the number -> checking; name still owned", () => {
  const content = "The Eiffel Tower was completed in 1901.";
  const citations = [
    { index: 1, source_id: "wiki", text: "The Eiffel Tower is a landmark in Paris." },
  ];
  const spans = buildGroundingSpans(content, { citations });
  const number = spans.find((s) => s.atomKind === "number");
  assert.equal(number.state, "checking");
});

test("buildGroundingSpans: an atom echoing the reader's own question is not a claim", () => {
  const content = "Yes, it was built in 1887.";
  const spans = buildGroundingSpans(content, {
    citations: [],
    question: "was it built in 1887?",
  });
  assert.equal(spans.length, 0, "an echoed figure should not produce a span");
});

test("buildGroundingSpans: sentences with no checkable atoms produce no span", () => {
  const content = "That sounds like a reasonable plan overall.";
  const spans = buildGroundingSpans(content, { citations: [] });
  assert.equal(spans.length, 0);
});

test("resolveSpans: never mutates content — only returns per-span checks", async () => {
  const content = "The Eiffel Tower was completed in 1889.";
  const spans = buildGroundingSpans(content, { citations: [] }).map((s) => ({
    text: s.text,
    start: s.start,
    end: s.end,
    atomKind: s.atomKind,
  }));
  const contentBefore = content;
  const fakeSearch = async () => [
    { rank: 1, title: "Eiffel Tower", url: "https://x/eiffel", snippet: "completed in 1889" },
  ];
  const fakeJudge = async () => ({ verdict: "confirmed" });
  const { checks } = await resolveSpans(content, spans, fakeJudge, fakeSearch);
  assert.equal(content, contentBefore, "resolveSpans must never touch the content string");
  assert.ok(checks.length > 0);
});

test("resolveSpans: numbers get judged, names never get an asserted verdict", async () => {
  const content = "The Eiffel Tower was completed in 1889.";
  const spans = buildGroundingSpans(content, { citations: [] }).map((s) => ({
    text: s.text,
    start: s.start,
    end: s.end,
    atomKind: s.atomKind,
  }));
  const fakeSearch = async () => [
    { rank: 1, title: "Scientific method", url: "https://x/sci", snippet: "unrelated snippet" },
  ];
  // A judge that would ALWAYS say "contradicted" if it were ever called on
  // the name — proves resolveSpans never calls it for a name atom.
  const fakeJudge = async (atom) => {
    if (atom !== "1889") {
      throw new Error(`judge should never be called for a non-number atom: ${atom}`);
    }
    return { verdict: "confirmed" };
  };
  const { checks } = await resolveSpans(content, spans, fakeJudge, fakeSearch);
  const nameCheck = checks.find((c) => c.span.atomKind === "name");
  const numberCheck = checks.find((c) => c.span.atomKind === "number");
  assert.equal(nameCheck.judged, false);
  assert.equal(nameCheck.verdict, undefined);
  assert.ok(nameCheck.clause, "a name should still get a verbatim clause attached");
  assert.equal(numberCheck.judged, true);
  assert.equal(numberCheck.verdict, "confirmed");
});

test("resolveSpans: a contradicted number carries a correction; unrelated/failed search does not", async () => {
  const content = "The Eiffel Tower was completed in 1889.";
  const spans = buildGroundingSpans(content, { citations: [] })
    .filter((s) => s.atomKind === "number")
    .map((s) => ({ text: s.text, start: s.start, end: s.end, atomKind: s.atomKind }));
  const fakeSearch = async () => [
    { rank: 1, title: "Eiffel Tower", url: "https://x/eiffel", snippet: "completed in 1901" },
  ];
  const fakeJudge = async () => ({
    verdict: "contradicted",
    correction: "It was completed in 1889, not 1901.",
  });
  const { checks } = await resolveSpans(content, spans, fakeJudge, fakeSearch);
  assert.equal(checks[0].verdict, "contradicted");
  assert.ok(checks[0].correction);

  const failSearch = async () => {
    throw new Error("network down");
  };
  const { checks: failedChecks } = await resolveSpans(content, spans, fakeJudge, failSearch);
  assert.equal(failedChecks[0].judged, false);
  assert.equal(failedChecks[0].correction, undefined);
});

test("25-fixture sweep: buildGroundingSpans + resolveSpans never mutate content, never contradict a name", async () => {
  const DRAFTS = [
    "The Eiffel Tower was completed in 1889.",
    "Jean-Paul Sartre published Being and Nothingness in 1943.",
    "Alpha was founded in 1901. Beta was founded in 1902. Gamma was founded in 1903. Delta was founded in 1904. Epsilon was founded in 1905. Zeta was founded in 1906. Eta was founded in 1907.",
    "That sounds like a reasonable plan overall.",
    "In the long and often retold history of European civil engineering during the nineteenth century, spanning many decades of iron and steel construction across the continent, the Eiffel Tower was finally completed in 1887.",
    "Erwin Schrödinger proposed the thought experiment in 1935.",
    "The bridge cost $1,250,000 to build.",
    "Roughly 42% of respondents agreed.",
  ];
  while (DRAFTS.length < 25) {
    const i = DRAFTS.length;
    DRAFTS.push(`Landmark ${i} was completed in ${1900 + i}.`);
  }

  for (let turn = 0; turn < DRAFTS.length; turn++) {
    const content = DRAFTS[turn];
    const mode = turn % 4;
    const search =
      mode === 0
        ? async () => {
            throw new Error("search backend down");
          }
        : mode === 1
          ? async () => []
          : async (q) => [
              { rank: 1, title: `Source ${turn}`, url: `https://x/${turn}`, snippet: `re: ${q.slice(0, 30)}` },
            ];
    const judge =
      mode === 2
        ? async (atom) => ({ verdict: "contradicted", correction: `corrected ${atom}` })
        : async () => ({ verdict: "confirmed" });

    const spans = buildGroundingSpans(content, { citations: [] });
    const claimSpans = spans.map((s) => ({
      text: s.text,
      start: s.start,
      end: s.end,
      atomKind: s.atomKind,
    }));
    const before = content;
    const { checks } = await resolveSpans(content, claimSpans, judge, search);

    assert.equal(content, before, `turn ${turn}: content must never be mutated`);
    for (const c of checks) {
      if (c.span.atomKind === "name") {
        assert.notEqual(
          c.verdict,
          "contradicted",
          `turn ${turn}: a name atom must never be asserted contradicted`,
        );
      }
    }
  }
});
