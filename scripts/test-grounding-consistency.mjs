// test-grounding-consistency.mjs — the assay for the SEAMS between Citey's
// grounding layers, not for any one of them.
//
// Every other grounding test in this directory checks one module in isolation:
// test-eo-grounding-spans.mjs checks buildGroundingSpans, test-grounding.mjs
// checks the ledger arithmetic. All of them pass. The defects pinned below live
// BETWEEN those modules — a state decided by one function, a citation list
// decided by a second, a verdict written by a third, and a chip rendered from a
// fourth, with nothing forcing the four to agree. A per-module suite cannot see
// any of it by construction.
//
// Grounding is decided in four places today, on different inputs:
//
//   1. buildGroundingSpans, per stream chunk   -> liveCitations  (pre-search)
//   2. buildGroundingSpans, chat.ts:3446       -> allCitations   (post-search)
//   3. checkGrounding, chat.ts:3232            -> allCitations
//   4. resolveSpans -> in-place mutation, chat.ts:3506
//
// The structural reason they cannot be reconciled is that GroundingSpan carries
// no channel: eo-grounding.ts's grounding model ("only corpus/web/file/desk may
// carry a claim") is computed per TURN and never reaches the ATOM. So the rule
// in docs/citey-structured-grounding.md §0 is written in one file and enforced
// in none.
//
// ── On `todo` ─────────────────────────────────────────────────────────────
//
// The four defect tests are marked `{ todo: ... }`. node:test runs them,
// reports them separately, and does NOT count their failure — `yarn test` stays
// green while the defect stays visible and named. That is LAWS.md L6 applied
// ("a recognized pattern needs a name here even when no fix is ready yet"): a
// defect nobody wrote down is one the next pass reintroduces. When a fix lands,
// drop the `todo` and the test becomes a regression guard with no other edit.
//
// ── On mirrored logic ─────────────────────────────────────────────────────
//
// Two pieces of the pipeline cannot be imported here and are mirrored instead:
//
//   - chat.ts's resolve-mutation block: app/store/chat.ts pulls in the web-llm
//     engine and OPFS, so a node --test file cannot load it. Same standing as
//     test-grounding-scenario.mjs pinning EO_HISTORY_TURNS by hand.
//   - grounding-chip.tsx's citability predicate: that module imports
//     unist-util-visit at the top level, so it cannot load without node_modules
//     (this suite otherwise runs against a bare checkout).
//
// Mirrored logic rots silently, so each mirror has a DRIFT GUARD below that
// reads the real source and fails if the expression it copies has changed.
// Those guards are NOT todo — they must pass, and they are what makes the
// mirrors trustworthy.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-grounding-consistency.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGroundingSpans } from "../app/client/eo-grounding-spans.ts";
import { checkGrounding } from "../app/client/eo-citation-check.ts";
import { resolveSpans } from "../app/client/eo-revision.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const squash = (s) => s.replace(/\s+/g, " ").trim();
const readSrc = (rel) => squash(readFileSync(join(ROOT, rel), "utf8"));
// Line-preserving read, for guards that need to tell code from the comments
// explaining it. squash() collapses newlines, which makes `//` run to EOF.
const readCode = (rel) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ── Mirrors ───────────────────────────────────────────────────────────────

/** grounding-chip.tsx's `hasCitationLink` (and buildCitationNumbering's own
 *  filter, which uses the same two conditions): what makes a chip clickable
 *  and eligible for a footnote number. */
const isCitable = (span) =>
  (span.state === "sourced" || span.state === "echoed") &&
  span.supportingCitationIndexes.length > 0;

/** chat.ts:3459 — which spans are handed to the async resolve pass. */
const isResolveEligible = (state, atomKind) =>
  state === "checking" || atomKind === "name";

/** chat.ts:3506-3526 — how a resolved check is written back onto its span.
 *  Note the ordering: clause/sourceTitle/sourceUrl are assigned BEFORE the
 *  `if (c.judged)` guard, so they land on every matched span regardless of
 *  whether a verdict was reached. */
function applyResolveChecks(spans, checks) {
  for (const c of checks) {
    const span = spans.find(
      (s) => s.start === c.span.start && s.end === c.span.end,
    );
    if (!span) continue;
    span.clause = c.clause;
    span.sourceTitle = c.source?.title;
    span.sourceUrl = c.source?.url;
    if (c.judged) {
      span.state =
        c.verdict === "contradicted"
          ? "contradicted"
          : c.verdict === "confirmed"
            ? "sourced"
            : "unconfirmed";
      span.correction = c.correction;
    } else if (span.state === "checking") {
      span.state = "unconfirmed";
    }
  }
  return spans;
}

const toClaimSpans = (spans) =>
  spans.map((s) => ({
    text: s.text,
    start: s.start,
    end: s.end,
    atomKind: s.atomKind,
  }));

// ── Drift guards — these must pass, or the mirrors above are lying ────────

test("drift guard: chat.ts's resolve-eligibility filter still matches its mirror", () => {
  assert.ok(
    readSrc("app/store/chat.ts").includes(
      's.state === "checking" || s.atomKind === "name"',
    ),
    "chat.ts's toResolve filter changed — update isResolveEligible above to match",
  );
});

test("drift guard: grounding-chip.tsx's citability predicate still matches its mirror", () => {
  assert.ok(
    readSrc("app/components/terrain/grounding-chip.tsx").includes(
      '(span.state === "sourced" || span.state === "echoed") && span.supportingCitationIndexes.length > 0',
    ),
    "hasCitationLink changed — update isCitable above to match",
  );
});

test("drift guard: chat.ts's resolve write-back still lands on the states this mirrors", () => {
  // The owned split renamed what a failed/unrelated resolve produces. That is
  // exactly the kind of change a mirror misses silently, so it is guarded by
  // name rather than left to whoever notices.
  const src = readSrc("app/store/chat.ts");
  assert.ok(
    src.includes('c.verdict === "confirmed" ? "sourced" : "unconfirmed"'),
    "chat.ts's verdict mapping changed — update applyResolveChecks above",
  );
  assert.ok(
    src.includes('span.state = "unconfirmed";'),
    "chat.ts's unresolved-checking fallback changed — update applyResolveChecks above",
  );
});

test("drift guard: chat.ts still assigns provenance before the judged guard", () => {
  const src = readSrc("app/store/chat.ts");
  const provenance = src.indexOf("span.clause = c.clause;");
  const guard = src.indexOf("if (c.judged) {", provenance);
  assert.ok(provenance > -1 && guard > provenance, [
    "chat.ts's resolve write-back changed shape — applyResolveChecks above",
    "mirrors 'assign provenance, THEN branch on judged'. If provenance is now",
    "inside the guard, D3 may be fixed: re-check the mirror and this test.",
  ].join(" "));
});

// ── Invariants that hold today — regression guards ────────────────────────

test("more evidence never lowers a span's grade", () => {
  // The atom-level analogue of escalate()'s monotone rule: evidence may raise
  // what a claim rests on, never quietly lower it. buildUnionIndex only ever
  // grows, so support can only ever be gained.
  // The four states that replaced "owned" all sit on the same rung: they say
  // different things about WHY an atom is unsourced, not different things
  // about how well-backed it is. "stated" is the exception — the desk
  // grounds it — so it ranks with echoed.
  const RANK = {
    contradicted: 0,
    bleed: 1,
    unconfirmed: 1,
    general: 1,
    checking: 1,
    stated: 2,
    echoed: 2,
    sourced: 3,
  };
  const draft = "The Eiffel Tower was completed in 1889 in Paris.";
  const none = buildGroundingSpans(draft, { citations: [] });
  const some = buildGroundingSpans(draft, {
    citations: [
      { index: 1, source_id: "a", text: "The Eiffel Tower stands in Paris." },
    ],
  });
  const all = buildGroundingSpans(draft, {
    citations: [
      { index: 1, source_id: "a", text: "The Eiffel Tower stands in Paris." },
      { index: 2, source_id: "b", text: "It was completed in 1889." },
    ],
  });
  for (const [i, span] of none.entries()) {
    assert.ok(
      RANK[some[i].state] >= RANK[span.state],
      `${span.text}: adding a citation lowered ${span.state} -> ${some[i].state}`,
    );
    assert.ok(
      RANK[all[i].state] >= RANK[some[i].state],
      `${span.text}: adding a second citation lowered ${some[i].state} -> ${all[i].state}`,
    );
  }
});

test("the full mirrored pipeline never mutates the message content", async () => {
  const draft = "The Eiffel Tower was completed in 1889.";
  const before = draft;
  const spans = buildGroundingSpans(draft, { citations: [] });
  const { checks } = await resolveSpans(
    draft,
    toClaimSpans(spans.filter((s) => isResolveEligible(s.state, s.atomKind))),
    async () => ({ verdict: "contradicted", correction: "no" }),
    async () => [
      { rank: 1, title: "T", url: "https://x/1", snippet: "completed in 1901" },
    ],
  );
  applyResolveChecks(spans, checks);
  assert.equal(draft, before);
});

test("a name atom never reaches a 'contradicted' state through the pipeline", async () => {
  // eo-revision.ts's own rule: a wrong date is a comparison of two numbers, a
  // wrong name is a judgment about identity, and this pipeline is not reliable
  // at the second. Enforced end to end, not just at resolveSpans' boundary.
  const draft = "Albert Einstein published the paper in 1905.";
  const spans = buildGroundingSpans(draft, { citations: [] });
  const { checks } = await resolveSpans(
    draft,
    toClaimSpans(spans.filter((s) => isResolveEligible(s.state, s.atomKind))),
    // A judge that condemns everything it is asked about.
    async () => ({ verdict: "contradicted", correction: "wrong" }),
    async () => [
      { rank: 1, title: "Scientific method", url: "https://x/s", snippet: "unrelated" },
    ],
  );
  applyResolveChecks(spans, checks);
  for (const s of spans) {
    if (s.atomKind === "name")
      assert.notEqual(
        s.state,
        "contradicted",
        `name atom ${JSON.stringify(s.text)} was asserted contradicted`,
      );
  }
});

// ── Pinned defects ────────────────────────────────────────────────────────

test(
  "I1 — a chip in a positive state can always be followed to a citation",
  {
    todo:
      "D1: state is decided against the abbreviation-expanded union index, but " +
      "supportingCitationIndexes is recomputed per citation with raw wordSet/hasWord " +
      "(eo-grounding-spans.ts:104-114), and 'ceo' is under MIN_STEM=4. Source " +
      "'Chief Executive' + draft 'CEO' yields state=sourced, supporting=[] — a " +
      "confident chip that is not clickable, against 310-citation-audit.md's " +
      "contract that every citation can be followed to its source.",
  },
  () => {
    const citations = [
      {
        index: 1,
        source_id: "memo.txt#0-40",
        text: "The Chief Executive resigned on Tuesday.",
      },
    ];
    const spans = buildGroundingSpans("The CEO resigned.", { citations });
    for (const span of spans) {
      if (span.state === "sourced" || span.state === "echoed")
        assert.ok(
          isCitable(span),
          `${JSON.stringify(span.text)} is ${span.state} but has no resolvable citation`,
        );
    }
  },
);

test(
  "I2 — an atom checkGrounding calls unsupported is never rendered as cited",
  {
    todo:
      "D2: 2-of-3 tokens clears ECHOED_MIN_TOKEN_FRACTION, so draft 'Nashville " +
      "Police Commissioner' over a source saying 'Department' renders echoed — " +
      "clickable and footnote-numbered by buildCitationNumbering — while " +
      "checkGrounding reports the same atom unsupported and files it as a refusal. " +
      "A fabricated job title is handed a citation footnote. Decision on record: " +
      "echoed is to be treated as unsupported (a partial match is the unearned " +
      "bracket 020-core-citation-law.md forbids).",
  },
  () => {
    const citations = [
      {
        index: 1,
        source_id: "report.txt#0-60",
        text: "The Nashville Police Department released the file.",
      },
    ];
    const draft = "The Nashville Police Commissioner released the file.";
    const spans = buildGroundingSpans(draft, { citations });
    const report = checkGrounding(draft, citations, {
      channels: ["your sources"],
    });
    for (const finding of report.findings) {
      const span = spans.find(
        (s) => s.start === finding.start && s.end === finding.end,
      );
      if (!span) continue;
      assert.ok(
        !isCitable(span),
        `${JSON.stringify(span.text)} is reported unsupported (absent: ${finding.absent}) ` +
          `yet renders as ${span.state} with citation ${span.supportingCitationIndexes[0]}`,
      );
    }
  },
);

test(
  "I3 — a corpus-grounded span never has its provenance replaced by a web result",
  {
    todo:
      "D3: chat.ts:3459 selects on `state === 'checking' || atomKind === 'name'`, " +
      "so a name already sourced against corpus bytes is re-searched on the web; " +
      "chat.ts:3512-3514 then writes clause/sourceTitle/sourceUrl BEFORE the " +
      "`if (c.judged)` guard, so the span keeps its corpus citation index while " +
      "acquiring an unrelated web URL. That is orientation laundered into grounding " +
      "— docs/citey-structured-grounding.md §0.",
  },
  async () => {
    const citations = [
      {
        index: 1,
        source_id: "casefile.txt#100-160",
        text: "Detective Alvarez signed the report.",
      },
    ];
    const draft = "Detective Alvarez signed the report.";
    const spans = buildGroundingSpans(draft, { citations });
    const name = spans.find((s) => s.atomKind === "name");
    assert.equal(name.state, "sourced", "precondition: backed by corpus bytes");

    const { checks } = await resolveSpans(
      draft,
      toClaimSpans(spans.filter((s) => isResolveEligible(s.state, s.atomKind))),
      async () => {
        throw new Error("a name must never be judged");
      },
      async () => [
        {
          rank: 1,
          title: "Detective",
          url: "https://en.wikipedia.org/wiki/Detective",
          snippet: "A detective is an investigator.",
        },
      ],
    );
    applyResolveChecks(spans, checks);

    assert.equal(
      name.sourceUrl,
      undefined,
      `corpus-grounded span acquired web provenance: ${name.sourceUrl}`,
    );
  },
);

test(
  "I4 — resolve eligibility is a function of state alone, never of atom kind",
  {
    todo:
      "D4: chat.ts:3459's filter is a disjunction of a STATE and a KIND, so a " +
      "contradicted name is re-resolved while an echoed number never is. " +
      "Eligibility should be decidable from the grade a span already carries.",
  },
  () => {
    for (const state of [
      "sourced",
      "echoed",
      "owned",
      "checking",
      "contradicted",
    ]) {
      assert.equal(
        isResolveEligible(state, "number"),
        isResolveEligible(state, "name"),
        `state=${state}: eligibility differs by atom kind ` +
          `(number=${isResolveEligible(state, "number")}, name=${isResolveEligible(state, "name")})`,
      );
    }
  },
);

// ── A void is a finding, not a silence (V3) ───────────────────────────────

test("'never checked' and 'checked, nothing wrong' do not render alike", () => {
  // LAWS.md L2e, at the report's own surface. `clean` alone answers a
  // three-state question with a boolean: it is true both when a check found
  // nothing wrong AND when no check ran at all. A caller reading `.clean` got
  // the same answer for a verified sentence and an unexamined one.
  const source = [{ index: 1, source_id: "s", text: "The budget was 1022900000." }];
  const claim = "The budget was 1136000000.";

  const unexamined = checkGrounding(claim, [], { channels: [] });
  const examinedAbsent = checkGrounding(claim, source, { channels: ["src"] });
  const examinedClean = checkGrounding("The budget was 1022900000.", source, {
    channels: ["src"],
  });

  assert.equal(unexamined.examined, false, "no citations means nothing was examined");
  assert.equal(examinedAbsent.examined, true);
  assert.equal(examinedClean.examined, true);

  // The predicate a caller actually wants — and the one that separates all
  // three states, which `clean` alone cannot.
  const verifiedClean = (r) => r.examined && r.clean;
  assert.equal(verifiedClean(unexamined), false, "an unexamined claim is not verified clean");
  assert.equal(verifiedClean(examinedAbsent), false);
  assert.equal(verifiedClean(examinedClean), true);
});

test("an unexamined report still says so in its own counts", () => {
  const r = checkGrounding("The budget was 1136000000.", [], { channels: [] });
  assert.equal(r.atomsChecked, 0);
  assert.deepEqual(r.channels, []);
  assert.equal(r.findings.length, 0);
});

// ── II.8: plural grounds stay parallel ────────────────────────────────────

test("a claim about the reader's document is not validated by an unrelated web hit", async () => {
  // The measured violation. checkGrounding builds ONE union index across every
  // citation handed to it, so a figure absent from the reader's own PDF comes
  // back CLEAN when a web snippet happens to carry the same digits. That is
  // eo-constitution II.8's first named consequence — "No averaging of grounds"
  // — and the shape it calls the second death: a merged index cannot disagree
  // with itself, so the one thing worth reporting is what the merge destroys.
  const { checkGroundsInParallel } = await import(
    "../app/client/eo-citation-check.ts"
  );
  const yourSources = {
    name: "your sources",
    citations: [
      { index: 1, source_id: "budget.pdf#0-90", text: "The department received 1022900000 for fiscal year 2031." },
    ],
  };
  const theWeb = {
    name: "the web",
    citations: [
      { index: 1, source_id: "https://x/wiki", text: "Unrelated article mentioning 1136000000 in another context." },
    ],
  };
  const claim = "Your document states the budget is 1136000000 for fiscal year 2031.";

  // Merged — what the union index does today.
  const merged = checkGrounding(
    claim,
    [...yourSources.citations, ...theWeb.citations.map((c) => ({ ...c, index: 2 }))],
    { channels: ["your sources", "the web"] },
  );
  assert.equal(merged.clean, true, "precondition: the merge reports this fabrication as clean");

  // Parallel — the grounds keep their own verdicts.
  const parallel = checkGroundsInParallel(claim, [yourSources, theWeb]);
  const fabricated = parallel.disagreements.find((d) => d.text === "1136000000");
  assert.ok(fabricated, "the invented figure must surface as a disagreement");
  assert.deepEqual(fabricated.supportedBy, ["the web"]);
  assert.deepEqual(fabricated.absentFrom, ["your sources"]);
});

test("nothing in the parallel report ranks, scores or resolves a disagreement", async () => {
  // II.8/II.3: a disagreement between grounds belongs to the reader. The
  // report may carry it; it may not settle it.
  const { checkGroundsInParallel } = await import(
    "../app/client/eo-citation-check.ts"
  );
  const r = checkGroundsInParallel("The budget is 1136000000.", [
    { name: "a", citations: [{ index: 1, source_id: "a", text: "budget 1136000000" }] },
    { name: "b", citations: [{ index: 1, source_id: "b", text: "budget 1022900000" }] },
  ]);
  const json = JSON.stringify(r);
  for (const forbidden of ["score", "confidence", "weight", "rank", "verdict", "winner"])
    assert.ok(!json.includes(forbidden), `the report must not carry a "${forbidden}"`);
  assert.equal(r.grounds.length, 2, "both grounds keep their own verdict");
});

test("a ground with no material is examined:false, never silently clean", async () => {
  const { checkGroundsInParallel } = await import(
    "../app/client/eo-citation-check.ts"
  );
  const r = checkGroundsInParallel("The budget is 1136000000.", [
    { name: "your sources", citations: [] },
    { name: "the web", citations: [{ index: 1, source_id: "w", text: "budget 1136000000" }] },
  ]);
  const empty = r.grounds.find((g) => g.name === "your sources");
  assert.equal(empty.examined, false);
  // An unexamined ground contributes to neither column — absence of a check
  // is not evidence of absence.
  const atom = [...r.disagreements, ...r.unsupportedEverywhere].find((a) => a.text === "1136000000");
  if (atom) assert.ok(!atom.absentFrom.includes("your sources"));
});

// ── The void's bound ───────────────────────────────────────────────────────
//
// "Not found in anything that was searched" is only a finding if the reader
// can see WHAT was searched. Without that it is unfalsifiable, and II.9's
// revision test — a claim has to be the kind of thing someone else can come
// back and disagree with — fails at the first step.

test("a void records the scope it was found against, by identifier", async () => {
  const { checkGroundsInParallel } = await import(
    "../app/client/eo-citation-check.ts"
  );
  const r = checkGroundsInParallel("The commissioner is Dolores Vandermeer.", [
    {
      name: "your sources",
      citations: [
        { index: 1, source_id: "budget.pdf#0-90", text: "The department received funds." },
        { index: 2, source_id: "budget.pdf#90-180", text: "Further appropriations followed." },
        { index: 3, source_id: "charter.pdf#0-40", text: "The charter establishes the office." },
      ],
    },
    {
      name: "the web",
      citations: [{ index: 1, source_id: "https://x/wiki", text: "An unrelated article." }],
      query: "Nashville police commissioner",
    },
  ]);

  const voided = r.unsupportedEverywhere.find((v) => v.text.includes("Vandermeer"));
  assert.ok(voided, "an invented name absent everywhere must surface as a void");

  const yours = r.grounds.find((g) => g.name === "your sources");
  // Three citations, TWO documents — the scope is what was looked in, not how
  // many slices it was cut into.
  assert.deepEqual(
    yours.sourceIds,
    ["budget.pdf#0-90", "budget.pdf#90-180", "charter.pdf#0-40"],
    "every identifier searched is recorded, deduplicated, in order",
  );
  const web = r.grounds.find((g) => g.name === "the web");
  assert.equal(
    web.query,
    "Nashville police commissioner",
    "a fetched ground carries the query, so the void is re-runnable",
  );
  assert.equal(yours.query, undefined, "a held ground has no query to carry");
});

test("void scope text names every examined ground and never an unexamined one", async () => {
  const { voidScopeText } = await import("../app/client/eo-citation-check.ts");

  const text = voidScopeText([
    { name: "your sources", examined: true, atomsChecked: 1, findings: [], sourceIds: ["a.pdf", "b.pdf"] },
    { name: "the web", examined: true, atomsChecked: 1, findings: [], sourceIds: ["https://x"], query: "dolphins" },
    { name: "your notes", examined: false, atomsChecked: 0, findings: [], sourceIds: [] },
  ]);

  assert.ok(text.includes("your sources (2 sources)"), `got: ${text}`);
  assert.ok(text.includes("the web (1 source)"), `singular is not pluralised: ${text}`);
  assert.ok(text.includes("dolphins"), "the query is shown so the search can be re-run");
  // The one that matters: a ground nobody looked in must not be listed as a
  // place the thing was not found (L2e — "checked, nothing there" and "never
  // checked" are different facts).
  assert.ok(!text.includes("your notes"), `an unexamined ground is not part of the bound: ${text}`);
});

test("with nothing examined, a void claims no scope at all", async () => {
  const { voidScopeText } = await import("../app/client/eo-citation-check.ts");
  assert.equal(
    voidScopeText([
      { name: "your sources", examined: false, atomsChecked: 0, findings: [], sourceIds: [] },
    ]),
    "nothing was searched",
  );
});

// ── The steering channel is visible and correctable ───────────────────────
//
// session.eoFocus is the one input to retrieval a reader could previously
// neither see nor argue with. These guard the two properties that make it
// answerable rather than merely displayed.

test("a reader-pinned focus is never overwritten by a derived one", () => {
  // II.2, the giver test: placement knowledge is RECEIVED, not derived. The
  // System-2 pass may propose a focus; it may not overrule one the reader
  // placed. Guarded against chat.ts's source because the check sits inside an
  // updateCurrentSession callback that no headless harness can reach.
  const src = readSrc("app/store/chat.ts");
  assert.ok(
    src.includes("if (session.eoFocusPinned) return;"),
    "the derived-focus write-back lost its pinned guard — a reader's steering can now be silently overwritten",
  );
});

test("the focus bar can both clear and re-pin, and clearing unpins", () => {
  // "stop steering" and "steer here instead" are different acts, and a
  // control offering only one of them leaves the reader stuck with a focus
  // they can see and cannot leave.
  const src = readSrc("app/components/chat.tsx");
  assert.ok(
    src.includes("props.onChange(next, next.length > 0);"),
    "FocusBar's commit no longer unpins on an empty edit",
  );
  assert.ok(
    src.includes('onClick={() => props.onChange("", false)}'),
    "FocusBar lost its clear action — a focus must be leavable, not only editable",
  );
});

test("the grounds panel renders disagreements above the reply, not below it", () => {
  // The attention inversion, guarded structurally. A disagreement between
  // grounds is the one reading the reader cannot get anywhere else (II.8);
  // rendering it after the answer makes it a footnote to the thing it
  // contradicts.
  const src = readSrc("app/components/chat.tsx");
  const panel = src.indexOf("<GroundsPanel");
  const body = src.indexOf("<Markdown", panel);
  assert.ok(panel > -1, "GroundsPanel is not mounted in the chat surface");
  assert.ok(
    body > panel,
    "GroundsPanel moved below the reply body — the disagreement is no longer the first thing read",
  );
});

test("the grounds panel never collapses a disagreement into one statement", () => {
  // The last-mile version of "no averaging of grounds": the engine keeps the
  // grounds parallel, and a UI that summarises them re-merges what it
  // carefully refused to merge.
  const raw = readSrc("app/components/terrain/grounds-panel.tsx");
  assert.ok(
    raw.includes("carried by") && raw.includes("absent from"),
    "both columns must be rendered — a single column is a verdict",
  );
  // Comments stripped: the file's own header explains why it must not score
  // or rank anything, and scanning that prose finds the very words it is
  // forbidding. This guard is about what the code DOES.
  const src = readCode("app/components/terrain/grounds-panel.tsx");
  for (const forbidden of ["sort(", "slice(0,", "reduce(", "confidence", "score"])
    assert.ok(
      !src.includes(forbidden),
      `grounds-panel.tsx must not ${forbidden} — that ranks, truncates or scores a disagreement`,
    );
});

// ── The panel and the chips must not contradict each other ────────────────
//
// The last place the merge survived. buildGroundingSpans grades against ONE
// union index across every ground, so an atom carried by a single ground
// reads as `sourced` — and the panel above it, built from the parallel
// report, simultaneously says the grounds disagree about that same atom.
// Two surfaces, one message, opposite claims.

test("an atom the grounds disagree about is not left rendering as sourced", async () => {
  const { checkGroundsInParallel } = await import(
    "../app/client/eo-citation-check.ts"
  );
  const { buildGroundingSpans, demoteDisagreedSpans } = await import(
    "../app/client/eo-grounding-spans.ts"
  );

  const yours = {
    name: "your sources",
    citations: [
      { index: 1, source_id: "budget.pdf#0-90", text: "The department received 1022900000 for fiscal year 2031." },
    ],
  };
  const web = {
    name: "the web",
    citations: [
      { index: 2, source_id: "https://x/wiki", text: "An article mentioning 1136000000 in another context." },
    ],
  };
  const claim = "Your document states the budget is 1136000000 for fiscal year 2031.";
  const all = [...yours.citations, ...web.citations];

  // Precondition — the merged grading over-credits, which is the whole bug.
  const merged = buildGroundingSpans(claim, { citations: all });
  const before = merged.find((s) => s.text === "1136000000");
  assert.equal(
    before.state,
    "sourced",
    "precondition: the union index credits an atom only one ground carries",
  );

  const report = checkGroundsInParallel(claim, [yours, web]);
  const after = demoteDisagreedSpans(merged, report.disagreements).find(
    (s) => s.text === "1136000000",
  );
  assert.equal(after.state, "unconfirmed", "a disagreed atom must stop claiming backing");
  assert.deepEqual(
    after.supportingCitationIndexes,
    [],
    "and must not offer the one ground that happens to agree as its citation",
  );

  // The coherence property, stated directly: nothing the panel reports as a
  // disagreement may still be rendered by a chip as backed.
  const spans = demoteDisagreedSpans(merged, report.disagreements);
  for (const d of report.disagreements) {
    const span = spans.find((s) => s.start === d.start && s.end === d.end);
    if (!span) continue;
    assert.ok(
      span.state !== "sourced" && span.state !== "echoed",
      `"${d.text}" is shown as a disagreement and graded ${span.state}`,
    );
  }
});

test("demotion touches only the disagreed spans, and only claiming states", async () => {
  const { demoteDisagreedSpans } = await import(
    "../app/client/eo-grounding-spans.ts"
  );
  const spans = [
    { start: 0, end: 5, text: "a", atomKind: "name", state: "sourced", supportingCitationIndexes: [1] },
    { start: 10, end: 15, text: "b", atomKind: "name", state: "sourced", supportingCitationIndexes: [2] },
    { start: 20, end: 25, text: "c", atomKind: "number", state: "checking", supportingCitationIndexes: [] },
  ];
  const out = demoteDisagreedSpans(spans, [
    { start: 10, end: 15 },
    { start: 20, end: 25 },
  ]);

  assert.equal(out[0].state, "sourced", "an undisputed span is untouched");
  assert.deepEqual(out[0].supportingCitationIndexes, [1], "and keeps its citation");
  assert.equal(out[1].state, "unconfirmed", "the disputed span is demoted");
  // An already-unsourced state is not made worse by the grounds differing:
  // "checking" says a resolve pass is still owed, and overwriting it would
  // silently cancel that pass.
  assert.equal(out[2].state, "checking", "an unsourced state is left alone");
});

test("with no disagreements, demotion is identity", async () => {
  const { demoteDisagreedSpans } = await import(
    "../app/client/eo-grounding-spans.ts"
  );
  const spans = [
    { start: 0, end: 5, text: "a", atomKind: "name", state: "sourced", supportingCitationIndexes: [1] },
  ];
  assert.equal(demoteDisagreedSpans(spans, []), spans, "the same array, not a copy");
});

test("drift guard: chat.ts still un-merges the chips after building them", () => {
  const src = readSrc("app/store/chat.ts");
  const build = src.indexOf("botMessage.groundingSpans = buildGroundingSpans(message,");
  const demote = src.indexOf("demoteDisagreedSpans(", build);
  const commit = src.indexOf("botMessage.groundingCitations = allCitations;", build);
  assert.ok(build > -1 && demote > build, "the finalize pass no longer demotes disagreed spans");
  assert.ok(demote < commit, "demotion must happen before the spans are committed to the message");
});
