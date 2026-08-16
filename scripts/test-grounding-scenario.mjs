// test-grounding-scenario.mjs — the assay for a long conversation, not a single turn.
//
// test-grounding.mjs checks the arithmetic in isolation: hand buildFoldLedger a
// set of counts, check what groundingDemand and routeTurn do with them. This
// file checks the thing that arithmetic is FOR — that as an actual multi-turn
// conversation runs, a fact surfaced early stays checkable while it is
// verbatim, becomes an ungroundable gist once it falls out of the recency
// window, and forces grounding on its own once it falls out of the fold list
// entirely. That is the "surf vs. fold" claim in eo-grounding.ts's file header,
// played out turn by turn instead of asserted about a single snapshot.
//
// The turn math mirrors what app/store/chat.ts actually sends: a verbatim
// recency window of EO_HISTORY_TURNS user turns (chat.ts:285) and a fold list
// bounded by MAX_FOLDS_IN_PROMPT (eo-discourse.ts). Those two constants are the
// entire reason a fact's provenance decays on a schedule instead of at random,
// so this file hardcodes EO_HISTORY_TURNS (chat.ts does not export it — it is
// a private module constant) and imports MAX_FOLDS_IN_PROMPT rather than
// hardcode both.
//
// Run: node --test scripts/       (or  yarn test)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFoldLedger,
  groundingDemand,
  routeTurn,
  reviewDraft,
  channelOf,
} from "../app/client/eo-grounding.ts";

import {
  MAX_FOLDS_IN_PROMPT,
  RECORDS_IN_PROMPT,
  buildGroundingRecord,
  addGroundingRecord,
  buildRecordSystemMessage,
  emptySummary,
} from "../app/client/eo-discourse.ts";

// chat.ts:285 — "const EO_HISTORY_TURNS = 8". Not exported (that module pulls
// in the web-llm engine and browser storage, so it is not something a
// node --test file can import), so it is pinned here instead. If chat.ts's
// constant ever moves, this is the number to update alongside it.
const EO_HISTORY_TURNS = 8;

// The turn horizon past which chat.ts's own verbatim window + fold list can no
// longer cover a turn: 8 verbatim + 12 folded = 20 turns of coverage, so turn
// 21 is the first one a conversation can lose outright.
const LOSS_HORIZON = EO_HISTORY_TURNS + MAX_FOLDS_IN_PROMPT;

/**
 * The discourse ledger input chat.ts's getMessagesWithMemory computes for a
 * conversation N user turns deep, with no clearContext in between: every
 * completed turn is folded into the running summary (bounded to the last
 * MAX_FOLDS_IN_PROMPT), and the last EO_HISTORY_TURNS turns are still resent
 * verbatim. See app/store/chat.ts:2031-2077.
 */
function discourseAtTurn(n) {
  return {
    turnCount: n,
    folds: Math.min(n, MAX_FOLDS_IN_PROMPT),
    verbatimTurns: Math.min(n, EO_HISTORY_TURNS),
    summaryInPrompt: n > EO_HISTORY_TURNS,
  };
}

const NOTHING_ELSE = {
  gate: { active: 6, folded: 24, crowdedOut: 0, gap: false },
  corpus: { enabledSources: 0, sourcesSurfaced: 0, passages: 0 },
  web: { attempted: false, results: 0 },
  file: { attached: false },
  desk: { facts: 0 },
  budget: { droppedMessages: 0, truncated: false },
};

function ledgerAtTurn(n) {
  return buildFoldLedger({ ...NOTHING_ELSE, discourse: discourseAtTurn(n) });
}

test(`turn coverage holds through turn ${LOSS_HORIZON} and breaks at turn ${LOSS_HORIZON + 1}`, () => {
  const held = channelOf(ledgerAtTurn(LOSS_HORIZON), "discourse");
  const broken = channelOf(ledgerAtTurn(LOSS_HORIZON + 1), "discourse");
  assert.equal(held.foldedLost, 0, "every turn up to the horizon is accounted for");
  assert.equal(
    broken.foldedLost,
    1,
    "one turn past the horizon, exactly one turn's worth of material is unrecoverable",
  );
});

// ── A fact that lives only as a paraphrase decays on schedule ─────────────

test("a fact surfaced early stays checkable while verbatim, becomes an ungroundable gist once folded, and forces grounding once lost", () => {
  // Turn 3: the reader asks something the model has to look up. Web material
  // is surfaced this turn and can ground a claim about it.
  const surfacingTurn = buildFoldLedger({
    ...NOTHING_ELSE,
    web: { attempted: true, results: 1 },
    discourse: discourseAtTurn(3),
  });
  const surfacingDemand = groundingDemand(surfacingTurn);
  assert.ok(surfacingDemand.check.includes("web"));
  assert.equal(routeTurn(surfacingTurn, surfacingDemand).system, "system2");

  // Turns 4 through 8: the fact from turn 3 is still inside the verbatim
  // recency window (EO_HISTORY_TURNS = 8) — it is still literally in the
  // prompt, not yet folded to anything.
  for (const n of [4, 6, 8]) {
    const ledger = ledgerAtTurn(n);
    assert.equal(
      channelOf(ledger, "discourse").surfaced,
      EO_HISTORY_TURNS < n ? EO_HISTORY_TURNS : n,
      `turn ${n}: still inside the verbatim window`,
    );
  }

  // Turn 15: the reader circles back and asks a question whose answer needs
  // that turn-3 fact. Nothing else external is in play this turn, so the
  // pre-answer route does not fire on the fold alone — that would make every
  // long conversation System 2 regardless of what the current turn actually
  // asks (see test-grounding.mjs: "folded past discourse ... does not alone
  // escalate"). What fires is the DRAFT: once the model's answer actually
  // states the figure, that is a checkable claim resting on a paraphrase.
  const foldedLedger = ledgerAtTurn(15);
  const foldedDemand = groundingDemand(foldedLedger);
  assert.ok(
    foldedDemand.forbidden.includes("discourse"),
    "turn 3's fact is now gist-only and cannot itself ground a claim",
  );
  const quietPreAnswer = routeTurn(foldedLedger, foldedDemand);
  assert.equal(
    quietPreAnswer.system,
    "system1",
    "the fold alone, before any draft, does not force deliberation",
  );
  const draftRestatingIt = reviewDraft({
    ledger: foldedLedger,
    demand: foldedDemand,
    claimAtoms: 1,
    unsupported: 0,
  });
  assert.equal(
    draftRestatingIt.system,
    "system2",
    "a draft that states the figure from turn 3 must be checked before it ships, because the only thing carrying it forward is a paraphrase",
  );

  // Turn 21: turn 3 has fallen out of both the verbatim window and the fold
  // list. It is not merely ungrounded now — it left no name to follow back at
  // all. That is unknown provenance, and unknown provenance escalates before
  // a single token of the draft exists, with no need to wait and see what the
  // draft claims.
  const lostLedger = ledgerAtTurn(LOSS_HORIZON + 1);
  const lostDemand = groundingDemand(lostLedger);
  assert.ok(channelOf(lostLedger, "discourse").foldedLost > 0);
  assert.equal(lostDemand.byDefault, true);
  const lostPreAnswer = routeTurn(lostLedger, lostDemand);
  assert.equal(
    lostPreAnswer.system,
    "system2",
    "material with no address left is escalated pre-answer, before any draft exists to review",
  );
});

// ── An addressed record does not decay the same way a gist does ───────────

test("a System 2 fold (addressed) survives past the horizon where the matching System 1 fold (gist) would already be lost", () => {
  // Turn 3 gets BOTH kinds of fold: the plain one-line gist that feeds
  // eoSummary.folds (and eventually the discourse channel above), and a
  // System 2 record naming the byte range it was actually checked against.
  const turn3Record = buildGroundingRecord({
    turn: 3,
    gist: "reader asked about the API rate limit",
    channels: ["web"],
    refs: ["https://example.com/api-docs#rate-limits"],
    unsupported: [],
    open: [],
  });

  // Most turns in a conversation never need a check, so they never produce a
  // System 2 record at all — only a handful of later turns do here (unlike
  // the plain fold list, which grows by one on every single turn regardless
  // of whether that turn needed grounding). By turn 25, well past
  // LOSS_HORIZON, only 5 record-producing turns have happened, so the record
  // window (bounded to RECORDS_IN_PROMPT = 8) has not had to evict turn 3 yet.
  let summary = addGroundingRecord(emptySummary(), turn3Record);
  for (const n of [10, 15, 22, 25]) {
    summary = addGroundingRecord(summary, {
      ...turn3Record,
      turn: n,
      gist: `turn ${n} was also checked`,
      refs: [`source-${n}.txt#0-100`],
    });
  }

  const rendered = buildRecordSystemMessage(summary);
  assert.match(
    rendered,
    /example\.com\/api-docs#rate-limits/,
    "turn 3's address is still in the prompt at turn 25, well past the horizon where its plain fold is already unrecoverable — the record window evicts by count of CHECKED turns, not by age",
  );
  assert.match(rendered, /can be re-opened/);

  // The record window still has a bound, though: enough checked turns and it
  // evicts whole records outright — but the failure mode is "this old turn is
  // no longer mentioned", never "this old turn is mentioned but its evidence
  // quietly became a paraphrase", which is what happens to a plain fold.
  let evictingSummary = emptySummary();
  for (let n = 1; n <= RECORDS_IN_PROMPT + 3; n += 1) {
    evictingSummary = addGroundingRecord(evictingSummary, {
      ...turn3Record,
      turn: n,
      refs: [`source-${n}.txt#0-100`],
    });
  }
  assert.equal(evictingSummary.records.length, RECORDS_IN_PROMPT);
  assert.equal(evictingSummary.records[0].turn, 4);
  const evictedRendered = buildRecordSystemMessage(evictingSummary);
  assert.ok(
    !evictedRendered.includes("Turn 1:"),
    "an evicted record is dropped whole, not degraded to a gist",
  );
});

test("without a System 2 record, the same fact has no addressed fallback once it is lost", () => {
  const lostLedger = ledgerAtTurn(LOSS_HORIZON + 1);
  const demand = groundingDemand(lostLedger);
  assert.ok(
    !demand.check.includes("web"),
    "turn 3's web result is not this turn's surfaced material — nothing keeps its address once the plain fold list has moved past it",
  );
  assert.ok(demand.mustUnfold.includes("discourse"));
});
