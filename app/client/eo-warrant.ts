// eo-warrant.ts — what a claim is allowed to rest on this turn, decided
// mechanically, before any model is asked anything.
//
// The question this module answers is not "is this a hard question?" It is
// "where would the warrant for an answer have to come from?" Those are
// different questions and only the second one is decidable without a model.
//
// A turn assembles material from several channels — the reader's own source
// bytes, a web fetch, an uploaded file, the verbatim desk of stated facts,
// the folded PAST DISCOURSE paraphrase, the instruction folds in force — and
// each channel carries a different kind of warrant. Reader bytes can back a
// factual claim and can be checked byte for byte. A 100-character paraphrase
// of a turn from twenty exchanges ago cannot back anything: its source is
// gone, so a claim resting on it is indistinguishable from a claim resting on
// nothing. The model's own weights can answer plenty on their own, but only
// when nothing external was in play — the moment a reader hands over a
// document, "from general knowledge" stops being an acceptable warrant for a
// claim about that document.
//
// So the grounding trigger is not the shape of the question. It is the
// composition of the fold ledger: HOW MUCH material bearing on this turn was
// folded away rather than surfaced, and WHICH CHANNEL it came from. That is
// the whole differentiator between a turn the model may answer on its own and
// a turn that requires grounding, and it is arithmetic over counts this app
// already computes — no classifier, no keyword scan, no model call.
//
// LAWS.md L11c — mechanical, auditable signals are exhausted before a model is
// asked to judge anything. Everything in this file is checkable by a human
// reading the same numbers the code read. A model probe (eo-task-plan.ts's
// probeReading) may still run afterward, but only to RAISE the route, never to
// lower it: see escalate() below.
//
// This module deliberately has no value imports. It is pure policy over plain
// numbers, which is what makes it runnable under `node --test` (see
// scripts/test-warrant.mjs) and auditable without booting a browser.

import type { ThinkingSystem } from "./eo-task-plan";

export type { ThinkingSystem };

// ── Channels and what each one can warrant ────────────────────────────────

export type WarrantChannel =
  | "corpus" // the reader's own source bytes, held in OPFS, byte-addressed
  | "web" // snippets fetched this turn
  | "file" // a one-shot uploaded file's structure block
  | "desk" // the verbatim conversation memory of stated facts
  | "discourse" // the folded PAST DISCOURSE summary — a paraphrase
  | "rules" // instruction folds in force
  | "hypergraph" // a background model's prose synthesis over the accumulated entity/relation graph — a paraphrase of structure, not a source
  | "internal"; // the model's own weights

export type WarrantKind =
  | "external" // bytes that exist outside the model and can be re-read
  | "conversational" // what was actually said, held verbatim
  | "paraphrase" // a lossy fold whose source is not in the prompt
  | "normative" // rules: they govern form, they never supply facts
  | "internal"; // the model's own knowledge

export interface ChannelWarrant {
  kind: WarrantKind;
  /** May a factual claim rest on this channel alone? */
  canWarrant: boolean;
  /** Must a claim drawn from this channel be checked against surfaced bytes? */
  demandsCheck: boolean;
  /** The sentence handed to the model when this channel is in play. */
  rule: string;
}

// The one place the warrant rules are written down. A channel added later
// declares its warrant here rather than growing a special case at a call site.
export const CHANNEL_WARRANT: Record<WarrantChannel, ChannelWarrant> = {
  corpus: {
    kind: "external",
    canWarrant: true,
    demandsCheck: true,
    rule: "Reader source passages are surfaced with their file name and byte range. A claim about what a source says must be traceable to a passage surfaced here; name the source when you make one.",
  },
  web: {
    kind: "external",
    canWarrant: true,
    demandsCheck: true,
    rule: "Web material surfaced this turn can back a claim about the world outside this conversation. A specific figure or proper name you state must appear in what was actually fetched.",
  },
  file: {
    kind: "external",
    canWarrant: true,
    demandsCheck: true,
    rule: "An uploaded file's structure was read mechanically. Claims about the file must stay inside what that reading actually reports.",
  },
  desk: {
    kind: "conversational",
    canWarrant: true,
    demandsCheck: true,
    rule: "The desk holds, word for word, facts the reader already stated. It settles what was said. Never deny or contradict something recorded there.",
  },
  discourse: {
    kind: "paraphrase",
    canWarrant: false,
    demandsCheck: true,
    rule: "PAST DISCOURSE is a short paraphrase of earlier turns, not a record of them. It can remind you what the thread is about. It can never be the evidence for a factual claim: if a claim needs an earlier turn, say that you would need to check it rather than reconstructing it from the summary.",
  },
  rules: {
    kind: "normative",
    canWarrant: false,
    demandsCheck: false,
    rule: "The rules in force govern how you answer. They are not evidence about the world and never supply a fact.",
  },
  hypergraph: {
    kind: "paraphrase",
    canWarrant: false,
    demandsCheck: true,
    rule: "A HYPERGRAPH THOUGHT is a background model's own synthesis over entities and relations gathered from this conversation and its sources — not a quotation of anything. It can orient you toward what is connected to what. It can never be the evidence for a factual claim: if a claim needs a source, point to the actual passage, not to the thought.",
  },
  internal: {
    kind: "internal",
    canWarrant: true,
    demandsCheck: false,
    rule: "General knowledge of your own is a legitimate answer when nothing external bears on the question — say plainly that it is general knowledge rather than implying it came from something surfaced here.",
  },
};

export const EXTERNAL_CHANNELS: WarrantChannel[] = ["corpus", "web", "file"];

// ── The fold ledger ───────────────────────────────────────────────────────

export interface ChannelLedger {
  channel: WarrantChannel;
  /** Units of material this channel holds that bear on this turn. */
  present: number;
  /** Units handed to the model verbatim this turn. */
  surfaced: number;
  /** Units withheld but still NAMED, so they remain re-openable (R2/R4). */
  foldedNamed: number;
  /**
   * Units withheld with no name at all. This is the dangerous number: it is
   * material that bore on the turn and left no trace the reader or the model
   * can follow back. LAWS.md L3 — no silent truncation.
   */
  foldedLost: number;
  /** Folds that MATCHED this turn and did not fit the budget (R8). */
  crowdedOut: number;
  /**
   * The channel was consulted and came back with nothing. LAWS.md L2e —
   * "checked, nothing there" and "never checked" are different facts and must
   * not render alike. This is the one that matters most for grounding: a
   * lookup that came back empty is positive evidence that the model's own
   * memory of the answer was NOT confirmed, so filling the gap from memory is
   * worse here than on a turn where no lookup happened at all.
   */
  checkedEmpty: boolean;
  note: string;
}

export interface FoldLedger {
  channels: ChannelLedger[];
  present: number;
  surfaced: number;
  foldedNamed: number;
  foldedLost: number;
  crowdedOut: number;
  /** Messages the context-window clamp had to drop or truncate this turn. */
  dropped: { messages: number; truncated: boolean };
}

export interface LedgerInputs {
  gate?: {
    active: number;
    folded: number;
    crowdedOut: number;
    gap: boolean;
  } | null;
  corpus?: {
    enabledSources: number;
    /** Distinct sources any surfaced passage came from. */
    sourcesSurfaced: number;
    passages: number;
  } | null;
  web?: { attempted: boolean; results: number } | null;
  file?: { attached: boolean } | null;
  desk?: { facts: number } | null;
  discourse?: {
    /** Completed user turns so far. */
    turnCount: number;
    /** One-line folds still carried in the summary. */
    folds: number;
    /** Turns still present verbatim in the recency window. */
    verbatimTurns: number;
    /** Whether the PAST DISCOURSE block is actually in this prompt. */
    summaryInPrompt: boolean;
  } | null;
  hypergraph?: {
    /** Strongest graph edges the navigation considered this turn. */
    edgesConsidered: number;
    /** Whether a bounded background "thought" was actually drafted and put in the prompt. */
    thoughtDrafted: boolean;
  } | null;
  budget?: { droppedMessages: number; truncated: boolean } | null;
}

function channel(
  ch: WarrantChannel,
  counts: {
    present: number;
    surfaced: number;
    foldedNamed?: number;
    foldedLost?: number;
    crowdedOut?: number;
    checkedEmpty?: boolean;
  },
  note: string,
): ChannelLedger {
  return {
    channel: ch,
    present: Math.max(0, counts.present),
    surfaced: Math.max(0, counts.surfaced),
    foldedNamed: Math.max(0, counts.foldedNamed ?? 0),
    foldedLost: Math.max(0, counts.foldedLost ?? 0),
    crowdedOut: Math.max(0, counts.crowdedOut ?? 0),
    checkedEmpty: !!counts.checkedEmpty,
    note,
  };
}

/**
 * Assemble this turn's ledger from counts the turn loop already has. Every
 * number here is something the app computed for another reason — the gate's
 * own stats, how many passages the corpus surf returned, how many turns the
 * summary has folded — so the ledger costs nothing beyond the arithmetic.
 */
export function buildFoldLedger(inputs: LedgerInputs): FoldLedger {
  const channels: ChannelLedger[] = [];

  const corpus = inputs.corpus;
  if (corpus && corpus.enabledSources > 0) {
    // A source that did not surface is folded but never lost: the original
    // bytes stay in OPFS and a later question can surface a different part of
    // the same file (see eo-corpus.ts). Folding here is a view, not a
    // deletion, which is exactly why corpus folds are `foldedNamed`.
    const unsurfaced = corpus.enabledSources - corpus.sourcesSurfaced;
    channels.push(
      channel(
        "corpus",
        {
          present: corpus.enabledSources,
          surfaced: corpus.sourcesSurfaced,
          foldedNamed: unsurfaced,
          checkedEmpty: corpus.passages === 0,
        },
        corpus.passages > 0
          ? `${corpus.passages} passage(s) from ${corpus.sourcesSurfaced}/${corpus.enabledSources} enabled source(s)`
          : `${corpus.enabledSources} enabled source(s), no passage matched`,
      ),
    );
  }

  const web = inputs.web;
  if (web?.attempted) {
    channels.push(
      channel(
        "web",
        {
          present: web.results,
          surfaced: web.results,
          checkedEmpty: web.results === 0,
        },
        web.results > 0
          ? `${web.results} result(s) surfaced`
          : "searched, nothing found",
      ),
    );
  }

  if (inputs.file?.attached) {
    channels.push(
      channel("file", { present: 1, surfaced: 1 }, "file structure attached"),
    );
  }

  const desk = inputs.desk;
  if (desk && desk.facts > 0) {
    channels.push(
      channel(
        "desk",
        { present: desk.facts, surfaced: desk.facts },
        `${desk.facts} recorded fact(s), verbatim`,
      ),
    );
  }

  const discourse = inputs.discourse;
  if (discourse && discourse.turnCount > 0) {
    // The three-way split that matters: turns still verbatim, turns reduced to
    // a named one-line fold, and turns that fell off the end of even the fold
    // list. MAX_FOLDS_IN_PROMPT bounds the middle bucket, so a long enough
    // conversation necessarily produces the third — and the third is
    // unauditable by construction.
    const verbatim = Math.min(discourse.verbatimTurns, discourse.turnCount);
    const folded = Math.min(discourse.folds, discourse.turnCount - verbatim);
    const lost = Math.max(0, discourse.turnCount - verbatim - folded);
    channels.push(
      channel(
        "discourse",
        {
          present: discourse.turnCount,
          surfaced: verbatim,
          foldedNamed: folded,
          foldedLost: lost,
        },
        `${verbatim} verbatim, ${folded} folded to one line, ${lost} past the fold list` +
          (discourse.summaryInPrompt ? ", summary in prompt" : ""),
      ),
    );
  }

  const hypergraph = inputs.hypergraph;
  if (hypergraph && hypergraph.edgesConsidered > 0) {
    // Considered but not drafted (below the movement gate, or the background
    // call failed) is `foldedNamed`, the same standing an unsurfaced corpus
    // source gets: the graph still knows it, a reader can still ask for it,
    // it just did not enter this turn's prompt.
    channels.push(
      channel(
        "hypergraph",
        {
          present: hypergraph.edgesConsidered,
          surfaced: hypergraph.thoughtDrafted ? hypergraph.edgesConsidered : 0,
          foldedNamed: hypergraph.thoughtDrafted
            ? 0
            : hypergraph.edgesConsidered,
        },
        hypergraph.thoughtDrafted
          ? `${hypergraph.edgesConsidered} relation(s) synthesized into a background thought`
          : `${hypergraph.edgesConsidered} relation(s) considered, no thought drafted`,
      ),
    );
  }

  const gate = inputs.gate;
  if (gate && gate.active + gate.folded > 0) {
    channels.push(
      channel(
        "rules",
        {
          present: gate.active + gate.folded,
          surfaced: gate.active,
          foldedNamed: gate.folded,
          crowdedOut: gate.crowdedOut,
        },
        `${gate.active} in force, ${gate.folded} folded to fingerprints` +
          (gate.crowdedOut > 0
            ? `, ${gate.crowdedOut} matched but did not fit`
            : "") +
          (gate.gap ? ", declared gap" : ""),
      ),
    );
  }

  const dropped = {
    messages: Math.max(0, inputs.budget?.droppedMessages ?? 0),
    truncated: !!inputs.budget?.truncated,
  };

  const total = (pick: (c: ChannelLedger) => number) =>
    channels.reduce((sum, c) => sum + pick(c), 0);

  return {
    channels,
    present: total((c) => c.present),
    surfaced: total((c) => c.surfaced),
    foldedNamed: total((c) => c.foldedNamed),
    foldedLost: total((c) => c.foldedLost),
    crowdedOut: total((c) => c.crowdedOut),
    dropped,
  };
}

export function channelOf(
  ledger: FoldLedger,
  ch: WarrantChannel,
): ChannelLedger | null {
  return ledger.channels.find((c) => c.channel === ch) ?? null;
}

/** Share of this turn's bearing material that was not handed over verbatim. */
export function foldPressure(ledger: FoldLedger): number {
  if (ledger.present <= 0) return 0;
  return (ledger.foldedNamed + ledger.foldedLost) / ledger.present;
}

/** Share that was withheld leaving no name to follow back. */
export function lostPressure(ledger: FoldLedger): number {
  if (ledger.present <= 0) return 0;
  return ledger.foldedLost / ledger.present;
}

// ── The grounding demand ──────────────────────────────────────────────────

export interface GroundingDemand {
  /** Does any claim this turn need a warrant beyond the model's own word? */
  required: boolean;
  /** Channels a claim must be checkable against. */
  check: WarrantChannel[];
  /** Channels whose folded material must be re-opened before a claim rests on it. */
  mustUnfold: WarrantChannel[];
  /** Channels that may never carry a factual claim on their own. */
  forbidden: WarrantChannel[];
  reasons: string[];
  /**
   * True when the demand was raised because provenance could NOT be
   * established, rather than because a specific channel was in play. An
   * unknown warrant is treated as a missing one — the same fail-toward-work
   * discipline the tool router uses for an unparseable verdict.
   */
  byDefault: boolean;
}

/**
 * The whole grounding decision, as arithmetic over the ledger.
 *
 * Note what is NOT consulted: the wording of the question, its length, its
 * punctuation, whether it starts with "what". Those are the signals a
 * classifier would use and they are exactly the ones that over- and under-fire
 * in ways a reader cannot predict or correct. What IS consulted is whether
 * material that bears on this turn exists outside the model, and whether this
 * turn actually got to see it.
 */
export function groundingDemand(ledger: FoldLedger): GroundingDemand {
  const check = new Set<WarrantChannel>();
  const mustUnfold = new Set<WarrantChannel>();
  const forbidden = new Set<WarrantChannel>();
  const reasons: string[] = [];
  let byDefault = false;

  for (const ch of EXTERNAL_CHANNELS) {
    const c = channelOf(ledger, ch);
    if (!c) continue;
    if (c.surfaced > 0) {
      // Something external is in front of the model. Anything it says about
      // that material is now checkable, so it must be checked.
      check.add(ch);
      reasons.push(`${ch}: ${c.surfaced} surfaced — claims must trace to it`);
    }
    if (c.present > 0 && c.surfaced === 0) {
      // The reader supplied material and none of it reached the prompt. This
      // is the R2 failure verbatim: the manual had a real number, the silence
      // erased it, and the model supplied a plausible one. Answering from
      // general knowledge here reads to the reader as an answer about their
      // document.
      check.add(ch);
      mustUnfold.add(ch);
      reasons.push(
        `${ch}: ${c.present} present but nothing surfaced — do not answer as if it had been read`,
      );
    }
    if (c.foldedNamed > 0) {
      mustUnfold.add(ch);
      reasons.push(
        `${ch}: ${c.foldedNamed} named but unsurfaced — re-openable, not read`,
      );
    }
    if (c.checkedEmpty) {
      // The lookup ran and came back empty. That is a fact ABOUT this turn,
      // and it cuts against answering from memory rather than for it: the one
      // check that could have confirmed the figure was made, and it did not.
      check.add(ch);
      byDefault = true;
      reasons.push(
        `${ch}: consulted and came back empty — an unconfirmed answer must be given as unconfirmed`,
      );
    }
  }

  const desk = channelOf(ledger, "desk");
  if (desk && desk.present > 0) {
    check.add("desk");
    reasons.push(`desk: ${desk.present} recorded fact(s) must not be denied`);
  }

  const discourse = channelOf(ledger, "discourse");
  if (discourse && discourse.foldedNamed + discourse.foldedLost > 0) {
    // A paraphrase can never warrant. This is the sharpest rule here and the
    // one the rest of the system leans on: it is what stops a claim from being
    // reconstructed out of a summary of a summary.
    forbidden.add("discourse");
    if (discourse.foldedLost > 0) {
      mustUnfold.add("discourse");
      byDefault = true;
      reasons.push(
        `discourse: ${discourse.foldedLost} turn(s) past the fold list — their content is unrecoverable from this prompt`,
      );
    } else {
      reasons.push(
        `discourse: ${discourse.foldedNamed} turn(s) folded to one line — orientation only, never evidence`,
      );
    }
  }

  const hypergraph = channelOf(ledger, "hypergraph");
  if (hypergraph && hypergraph.surfaced > 0) {
    // A drafted thought is a paraphrase of structure, same standing as
    // discourse's own paraphrase of turns: it can orient, it cannot warrant,
    // and it is IN the prompt this turn, so it must be named forbidden, not
    // merely left uncounted.
    forbidden.add("hypergraph");
    reasons.push(
      `hypergraph: ${hypergraph.surfaced} relation(s) synthesized into a thought — orientation only, never evidence`,
    );
  }

  const rules = channelOf(ledger, "rules");
  if (rules && rules.crowdedOut > 0) {
    // R8 — "matched but did not fit" is a different fact from "nothing
    // matched", and a rule that was relevant and got dropped means the turn
    // was answered under an incomplete manual.
    mustUnfold.add("rules");
    byDefault = true;
    reasons.push(
      `rules: ${rules.crowdedOut} matched this turn and did not fit the budget`,
    );
  }

  if (ledger.dropped.messages > 0 || ledger.dropped.truncated) {
    byDefault = true;
    reasons.push(
      `context clamp dropped ${ledger.dropped.messages} message(s)` +
        (ledger.dropped.truncated ? " and truncated the anchor" : "") +
        " — what they held is unknown",
    );
  }

  return {
    required: check.size > 0 || mustUnfold.size > 0 || byDefault,
    check: [...check],
    mustUnfold: [...mustUnfold],
    forbidden: [...forbidden],
    reasons,
    byDefault,
  };
}

// ── Routing ───────────────────────────────────────────────────────────────

export interface TurnRoute {
  system: ThinkingSystem;
  reasons: string[];
  /** True when this route was reached with no model call. */
  mechanical: boolean;
  /** Where in the turn the route was decided. */
  stage: "pre-answer" | "draft-review" | "response-set" | "probe";
}

function route(
  system: ThinkingSystem,
  stage: TurnRoute["stage"],
  reasons: string[],
  mechanical = true,
): TurnRoute {
  return { system, stage, reasons, mechanical };
}

/**
 * The pre-answer route, decided before a single token is generated and
 * without asking the model anything.
 *
 * System 2 is not "the hard questions". It is the turns where something other
 * than the model's own knowledge has to carry the answer, or where material
 * that bore on the turn did not make it into the prompt. Everything else is
 * System 1: the ordinary streamed answer, which is never blocked or delayed by
 * anything in this file.
 */
export function routeTurn(
  ledger: FoldLedger,
  demand: GroundingDemand,
): TurnRoute {
  const reasons: string[] = [];

  for (const ch of EXTERNAL_CHANNELS) {
    const c = channelOf(ledger, ch);
    if (!c) continue;
    if (c.present > 0)
      reasons.push(`${ch} material bears on this turn (${c.note})`);
    else if (c.checkedEmpty)
      reasons.push(`${ch} was consulted this turn and came back empty`);
  }
  if (ledger.foldedLost > 0)
    reasons.push(
      `${ledger.foldedLost} unit(s) of bearing material left no name to follow back`,
    );
  if (ledger.crowdedOut > 0)
    reasons.push(`${ledger.crowdedOut} matched rule(s) did not fit the budget`);
  if (ledger.dropped.messages > 0 || ledger.dropped.truncated)
    reasons.push("the context clamp dropped or truncated material this turn");
  if (demand.byDefault)
    reasons.push("provenance could not be established for part of this turn");

  if (reasons.length) return route("system2", "pre-answer", reasons);

  // The desk alone does not escalate. Its check (checkRecallDenial) is
  // mechanical and already runs on every finished answer, so a turn whose only
  // external tie is the desk still costs nothing beyond that check.
  return route("system1", "pre-answer", [
    "nothing outside the model bears on this turn; the answer rests on general knowledge and is labelled as such",
  ]);
}

/**
 * System 2 as a monitor on System 1's output, not only as a gate on its input.
 *
 * This is the half a pre-answer route cannot do. A turn can look unremarkable
 * going in — no sources, no search, an ordinary question — and come back with
 * an answer full of specific figures and proper names. Those are checkable
 * claims, and if nothing in this turn could have supported them, the fast
 * answer just asserted things on no warrant at all. Kahneman's System 2 is
 * exactly this: the check that reads what System 1 produced and decides
 * whether to take it.
 *
 * `claimAtoms` is the mechanical count of checkable atoms in the draft (see
 * countClaimAtoms in eo-citation-check.ts) — figures and proper names, the
 * same extraction the grounding check itself uses. `unsupported` is how many
 * of them failed against the channels actually surfaced.
 */
export function reviewDraft(input: {
  ledger: FoldLedger;
  demand: GroundingDemand;
  claimAtoms: number;
  unsupported: number;
}): TurnRoute {
  const { ledger, demand, claimAtoms, unsupported } = input;
  const reasons: string[] = [];

  if (unsupported > 0)
    reasons.push(
      `${unsupported} of ${claimAtoms} checkable claim(s) are not supported by anything surfaced this turn`,
    );

  if (claimAtoms > 0 && demand.forbidden.length)
    reasons.push(
      `the draft makes ${claimAtoms} checkable claim(s) while ${demand.forbidden.join(", ")} is the only carrier of the earlier thread — a paraphrase cannot warrant them`,
    );

  if (claimAtoms > 0 && ledger.foldedLost > 0)
    reasons.push(
      `the draft makes checkable claims and ${ledger.foldedLost} unit(s) of bearing material are unrecoverable from this prompt`,
    );

  if (reasons.length) return route("system2", "draft-review", reasons);
  return route("system1", "draft-review", [
    "the finished draft asserts nothing this turn cannot account for",
  ]);
}

/**
 * More than one response is System 2, by construction.
 *
 * This is not a convention bolted on. A turn emits a second message only
 * because it found something the first one could not hold — a live alternative
 * reading, a claim needing its own separate warrant, a correction of its own
 * first pass. Those are the same conditions routeTurn and reviewDraft test
 * for, read off the output side instead of the input side. So the count is not
 * evidence ABOUT the route; at two or more it IS the route.
 */
export function classifyResponseSet(responses: number): TurnRoute {
  if (responses > 1)
    return route("system2", "response-set", [
      `${responses} responses in one turn — a turn that needed more than one utterance was deliberating, not reacting`,
    ]);
  return route("system1", "response-set", ["one response"]);
}

/**
 * Escalation is monotone: System 2 wins, always, whichever stage raised it.
 *
 * A later stage may discover a reason to deliberate. It may never discover a
 * reason to stop — "the model's probe came back saying this was easy" is not
 * evidence that the reader's document stopped existing. This is also what
 * makes a slow or failed model probe safe: it can only ever fail to add a
 * reason, never remove one.
 */
export function escalate(
  ...routes: (TurnRoute | null | undefined)[]
): TurnRoute {
  const present = routes.filter((r): r is TurnRoute => !!r);
  if (!present.length)
    return route("system1", "pre-answer", ["no route was computed"]);
  const raised = present.filter((r) => r.system === "system2");
  if (!raised.length) {
    return {
      system: "system1",
      stage: present[0].stage,
      reasons: present.flatMap((r) => r.reasons),
      mechanical: present.every((r) => r.mechanical),
    };
  }
  return {
    system: "system2",
    stage: raised[0].stage,
    reasons: raised.flatMap((r) => r.reasons),
    // The route is only "mechanical" if a no-model-call stage raised it. A
    // route that only a model probe raised is real but weaker evidence, and
    // the log says so.
    mechanical: raised.some((r) => r.mechanical),
  };
}

// ── The block the model actually receives ─────────────────────────────────

const WARRANT_HEADER = "===== WHAT CAN CARRY A CLAIM THIS TURN =====";
const WARRANT_FOOTER = "===== END WARRANT =====";

/**
 * Render the ledger as the turn's warrant block. This goes in with the System
 * 1 prompt — it is cheap, it costs no model call, and it is the difference
 * between a model that knows a paraphrase is not evidence and one that does
 * not.
 */
export function buildWarrantBlock(
  ledger: FoldLedger,
  demand: GroundingDemand,
): string | null {
  if (!ledger.channels.length) return null;
  const lines: string[] = [WARRANT_HEADER];

  for (const c of ledger.channels) {
    const w = CHANNEL_WARRANT[c.channel];
    lines.push(`\n[${c.channel}] ${c.note}\n${w.rule}`);
  }

  if (demand.forbidden.length) {
    lines.push(
      `\nNot warrant this turn: ${demand.forbidden.join(", ")}. Material from these channels can orient you and can never be the grounds for a factual claim.`,
    );
  }

  if (demand.mustUnfold.length) {
    // LAWS.md L6 — no implied completeness. The model is told what it did NOT
    // get to see, by name, so it cannot answer as though it had.
    lines.push(
      `\nFolded and not read this turn: ${demand.mustUnfold.join(", ")}. Material exists in these channels that was not surfaced. If the answer depends on it, say so plainly and say it would have to be checked — do not reconstruct it.`,
    );
  }

  if (!demand.required) {
    lines.push(
      `\nNothing outside your own knowledge bears on this turn. Answer from general knowledge and say that is what it is.`,
    );
  }

  lines.push(WARRANT_FOOTER);
  return lines.join("\n");
}

/** One line for the EOT log — the whole decision, auditable at a glance. */
export function warrantLogLine(
  ledger: FoldLedger,
  demand: GroundingDemand,
  turnRoute: TurnRoute,
): string {
  const pressure = Math.round(foldPressure(ledger) * 100);
  const lost = Math.round(lostPressure(ledger) * 100);
  return (
    `warrant: ${turnRoute.system} (${turnRoute.mechanical ? "mechanical" : "model-raised"}, ${turnRoute.stage}) — ` +
    `${ledger.surfaced}/${ledger.present} surfaced, fold pressure ${pressure}%, lost ${lost}%; ` +
    `grounding ${demand.required ? "required" : "not required"}` +
    (demand.check.length ? ` against ${demand.check.join(", ")}` : "") +
    (demand.mustUnfold.length ? `; unfold ${demand.mustUnfold.join(", ")}` : "")
  );
}

// ── The mouth: the horizon law, made a named budget ───────────────────────

export interface Mouth<T> {
  working: T[];
  /** How many items were withheld — never silent truncation. */
  withheld: number;
  withheld_ids: T[];
}

/**
 * The mouth — how much of the material reaches a single generation. The same
 * budget the engine draws (`eoreader6/packages/engine/holon/task-log.js`'s
 * `foldToWorkingSet`): `k` defaults to 7, the top of the 4–7 Ericsson–Kintsch
 * Long-Term Working Memory range, and it is a declared argument, never a
 * default a caller discovered. The horizon law says no operation reads the
 * whole — this function is the shape of that: bounded output, and whatever was
 * withheld is reported by name, never silently dropped.
 */
export function foldToMouth<T>(
  ranked: readonly T[],
  {
    k = 7,
    id = (x: T) => String(x),
  }: { k?: number; id?: (x: T) => string } = {},
): Mouth<T> {
  if (!Number.isInteger(k) || k < 1)
    throw new TypeError("foldToMouth: k must be a positive integer");
  const working = ranked.slice(0, k);
  return {
    working,
    withheld: Math.max(0, ranked.length - k),
    withheld_ids: ranked.slice(k),
  };
}
