// test-warrant.mjs — the assay for the grounding trigger.
//
// The claim this file exists to check is narrow and testable: grounding fires
// whenever material outside the model bears on a turn, and it fires without
// asking the model anything. A policy nobody measures drifts into a slogan
// within one refactor (eochat LAWS.md), and the failure this one forbids is
// specific — a turn where the reader supplied a document, or where the thread
// had already been folded past recovery, that was nonetheless answered from
// the model's own memory as though it had been checked.
//
// Run: node --test scripts/       (or  yarn test)
//
// Node 22 strips the types off app/client/eo-warrant.ts directly, which is why
// that module carries no value imports: the policy is checkable on its own,
// with no browser, no engine, and no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFoldLedger,
  groundingDemand,
  routeTurn,
  reviewDraft,
  classifyResponseSet,
  escalate,
  foldPressure,
  lostPressure,
  buildWarrantBlock,
  channelOf,
  CHANNEL_WARRANT,
} from "../app/client/eo-warrant.ts";

/** The turn loop's own numbers for an ordinary chat turn with nothing attached. */
const PLAIN_TURN = {
  gate: { active: 6, folded: 24, crowdedOut: 0, gap: false },
  corpus: { enabledSources: 0, sourcesSurfaced: 0, passages: 0 },
  web: { attempted: false, results: 0 },
  file: { attached: false },
  desk: { facts: 0 },
  discourse: {
    turnCount: 2,
    folds: 0,
    verbatimTurns: 2,
    summaryInPrompt: false,
  },
  budget: { droppedMessages: 0, truncated: false },
};

const decide = (inputs) => {
  const ledger = buildFoldLedger(inputs);
  const demand = groundingDemand(ledger);
  return { ledger, demand, route: routeTurn(ledger, demand) };
};

// ── The System 1 case: the model may answer on its own ────────────────────

test("a plain turn with nothing attached stays System 1 and demands no grounding", () => {
  const { demand, route } = decide(PLAIN_TURN);
  assert.equal(route.system, "system1");
  assert.equal(route.mechanical, true);
  assert.equal(demand.required, false);
  assert.deepEqual(demand.check, []);
});

test("the always-on instruction folds alone never escalate a turn", () => {
  // Every turn folds most of the instruction set to fingerprints. If that
  // counted as fold pressure, every turn would be System 2 and the split would
  // mean nothing.
  const { route } = decide({
    ...PLAIN_TURN,
    gate: { active: 6, folded: 60, crowdedOut: 0, gap: false },
  });
  assert.equal(route.system, "system1");
});

test("the desk alone does not escalate — its check is already mechanical", () => {
  const { demand, route } = decide({ ...PLAIN_TURN, desk: { facts: 9 } });
  assert.equal(route.system, "system1");
  assert.ok(demand.check.includes("desk"), "the desk is still checked against");
});

// ── The grounding trigger: external material bears on the turn ────────────

test("a surfaced reader source demands grounding against the corpus", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    corpus: { enabledSources: 3, sourcesSurfaced: 2, passages: 5 },
  });
  assert.equal(route.system, "system2");
  assert.equal(demand.required, true);
  assert.ok(demand.check.includes("corpus"));
});

test("fully surfaced direct corpus retrieval remains System 1", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    corpus: { enabledSources: 1, sourcesSurfaced: 1, passages: 3 },
  });
  assert.equal(route.system, "system1");
  assert.equal(demand.required, true);
  assert.ok(demand.check.includes("corpus"));
});

test("a reader source that surfaced NOTHING still demands grounding, and demands an unfold", () => {
  // This is the failure the whole module exists for: the reader attached a
  // document, the lexical surf missed, and the turn is now one step away from
  // answering about their document out of general knowledge.
  const { demand, route } = decide({
    ...PLAIN_TURN,
    corpus: { enabledSources: 2, sourcesSurfaced: 0, passages: 0 },
  });
  assert.equal(route.system, "system2");
  assert.ok(demand.check.includes("corpus"));
  assert.ok(demand.mustUnfold.includes("corpus"));
});

test("a web search that ran and found nothing is not the same as never searching", () => {
  const searched = decide({
    ...PLAIN_TURN,
    web: { attempted: true, results: 0 },
  });
  const never = decide({
    ...PLAIN_TURN,
    web: { attempted: false, results: 0 },
  });
  assert.equal(searched.route.system, "system2");
  assert.equal(searched.demand.required, true);
  assert.equal(never.route.system, "system1");
  assert.equal(never.demand.required, false);
});

test("surfaced web results demand grounding against the web", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    web: { attempted: true, results: 4 },
  });
  assert.ok(demand.check.includes("web"));
  assert.equal(route.system, "system1");
});

test("an uploaded file demands grounding", () => {
  const { demand, route } = decide({ ...PLAIN_TURN, file: { attached: true } });
  assert.equal(route.system, "system1");
  assert.ok(demand.check.includes("file"));
});

// ── Fold provenance: a paraphrase is never warrant ────────────────────────

test("folded past discourse is forbidden as warrant but does not alone escalate", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    discourse: {
      turnCount: 14,
      folds: 6,
      verbatimTurns: 8,
      summaryInPrompt: true,
    },
  });
  assert.ok(demand.forbidden.includes("discourse"));
  // Every long conversation carries a summary. If that alone forced System 2,
  // "thanks, that's clearer" on turn 20 would deliberate. The escalation comes
  // from the draft-review stage instead, once the answer actually makes claims.
  assert.equal(route.system, "system1");
});

test("turns folded past the fold list are lost, and lost material always escalates", () => {
  const { ledger, demand, route } = decide({
    ...PLAIN_TURN,
    discourse: {
      turnCount: 40,
      folds: 12,
      verbatimTurns: 8,
      summaryInPrompt: true,
    },
  });
  assert.equal(channelOf(ledger, "discourse").foldedLost, 20);
  assert.equal(route.system, "system2");
  assert.equal(
    demand.byDefault,
    true,
    "unrecoverable material is an unknown warrant",
  );
  assert.ok(demand.mustUnfold.includes("discourse"));
});

test("fold pressure and lost pressure are shares of bearing material", () => {
  const ledger = buildFoldLedger({
    ...PLAIN_TURN,
    gate: { active: 0, folded: 0, crowdedOut: 0, gap: false },
    discourse: {
      turnCount: 10,
      folds: 2,
      verbatimTurns: 4,
      summaryInPrompt: true,
    },
  });
  assert.equal(foldPressure(ledger), 0.6); // 2 folded + 4 lost of 10
  assert.equal(lostPressure(ledger), 0.4);
});

// ── Unknown provenance fails toward grounding ─────────────────────────────

test("a rule that matched and did not fit the budget escalates by default", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    gate: { active: 6, folded: 24, crowdedOut: 2, gap: false },
  });
  assert.equal(route.system, "system2");
  assert.equal(demand.byDefault, true);
  assert.ok(demand.mustUnfold.includes("rules"));
});

test("context the clamp dropped is unknown warrant, so the turn escalates", () => {
  const { demand, route } = decide({
    ...PLAIN_TURN,
    budget: { droppedMessages: 3, truncated: false },
  });
  assert.equal(route.system, "system2");
  assert.equal(demand.byDefault, true);
});

test("a truncated anchor escalates even with nothing dropped", () => {
  const { route } = decide({
    ...PLAIN_TURN,
    budget: { droppedMessages: 0, truncated: true },
  });
  assert.equal(route.system, "system2");
});

// ── System 2 as a monitor on the finished draft ───────────────────────────

const plain = decide(PLAIN_TURN);

test("a draft that asserts nothing checkable stays System 1", () => {
  const r = reviewDraft({
    ledger: plain.ledger,
    demand: plain.demand,
    claimAtoms: 0,
    unsupported: 0,
  });
  assert.equal(r.system, "system1");
});

test("an unsupported claim escalates at draft review", () => {
  const r = reviewDraft({
    ledger: plain.ledger,
    demand: plain.demand,
    claimAtoms: 7,
    unsupported: 2,
  });
  assert.equal(r.system, "system2");
  assert.equal(r.mechanical, true);
});

test("checkable claims escalate when a paraphrase is the only carrier of the thread", () => {
  const folded = decide({
    ...PLAIN_TURN,
    discourse: {
      turnCount: 14,
      folds: 6,
      verbatimTurns: 8,
      summaryInPrompt: true,
    },
  });
  const quiet = reviewDraft({
    ledger: folded.ledger,
    demand: folded.demand,
    claimAtoms: 0,
    unsupported: 0,
  });
  const claiming = reviewDraft({
    ledger: folded.ledger,
    demand: folded.demand,
    claimAtoms: 5,
    unsupported: 0,
  });
  assert.equal(quiet.system, "system1");
  assert.equal(
    claiming.system,
    "system2",
    "figures and names asserted over a paraphrase must be deliberated",
  );
});

// ── Multiple responses are System 2 by construction ───────────────────────

test("one response may be System 1; two or more never is", () => {
  assert.equal(classifyResponseSet(1).system, "system1");
  assert.equal(classifyResponseSet(2).system, "system2");
  assert.equal(classifyResponseSet(4).system, "system2");
});

// ── Escalation is monotone ────────────────────────────────────────────────

test("System 2 wins from any stage, in any order", () => {
  const s1 = classifyResponseSet(1);
  const s2 = classifyResponseSet(3);
  assert.equal(escalate(s1, s2).system, "system2");
  assert.equal(escalate(s2, s1).system, "system2");
  assert.equal(escalate(s1, s1).system, "system1");
});

test("a model probe can raise the route and can never lower it", () => {
  const mechanical2 = decide({
    ...PLAIN_TURN,
    corpus: { enabledSources: 1, sourcesSurfaced: 0, passages: 0 },
  }).route;
  const probeSaysEasy = {
    system: "system1",
    stage: "probe",
    reasons: ["probe read it as simple"],
    mechanical: false,
  };
  assert.equal(escalate(mechanical2, probeSaysEasy).system, "system2");

  const probeSaysHard = {
    system: "system2",
    stage: "probe",
    reasons: ["two live readings"],
    mechanical: false,
  };
  const raised = escalate(plain.route, probeSaysHard);
  assert.equal(raised.system, "system2");
  assert.equal(
    raised.mechanical,
    false,
    "a route only a model raised is logged as model-raised",
  );
});

test("escalate keeps every reason that raised the route", () => {
  const a = {
    system: "system2",
    stage: "pre-answer",
    reasons: ["corpus present"],
    mechanical: true,
  };
  const b = {
    system: "system2",
    stage: "draft-review",
    reasons: ["unsupported claim"],
    mechanical: true,
  };
  assert.deepEqual(escalate(a, b).reasons, [
    "corpus present",
    "unsupported claim",
  ]);
});

test("escalate survives missing routes rather than throwing mid-turn", () => {
  assert.equal(escalate(null, undefined).system, "system1");
  assert.equal(escalate(null, classifyResponseSet(2)).system, "system2");
});

// ── The block the model receives ──────────────────────────────────────────

test("the warrant block names each channel in play and what it can carry", () => {
  const { ledger, demand } = decide({
    ...PLAIN_TURN,
    corpus: { enabledSources: 2, sourcesSurfaced: 1, passages: 3 },
    discourse: {
      turnCount: 30,
      folds: 12,
      verbatimTurns: 8,
      summaryInPrompt: true,
    },
  });
  const block = buildWarrantBlock(ledger, demand);
  assert.match(block, /\[corpus\]/);
  assert.match(block, /\[discourse\]/);
  assert.match(block, /Not warrant this turn: discourse/);
  assert.match(block, /Folded and not read this turn/);
});

test("a turn needing no grounding says so, rather than saying nothing", () => {
  const { ledger, demand } = decide(PLAIN_TURN);
  const block = buildWarrantBlock(ledger, demand);
  assert.match(block, /Nothing outside your own knowledge bears on this turn/);
});

test("every channel declares a warrant rule, so a new channel cannot be silent", () => {
  for (const [name, w] of Object.entries(CHANNEL_WARRANT)) {
    assert.ok(w.rule && w.rule.length > 20, `${name} has no usable rule text`);
    assert.equal(typeof w.canWarrant, "boolean");
  }
  assert.equal(
    CHANNEL_WARRANT.discourse.canWarrant,
    false,
    "a paraphrase must never warrant",
  );
  assert.equal(CHANNEL_WARRANT.corpus.canWarrant, true);
});
