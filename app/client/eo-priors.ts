// eo-priors.ts — the priors channel: a measured, narrow-scope background
// register that may steer how the corpus channel searches, and may never
// carry a claim itself.
//
// eo-grounding.ts already draws the line eoreader6's own Assembly-C spec names
// (11-terrain-occupancy-and-the-two-ascents.md §5, "Lens from channel
// disagreement"): "the high tier sets the low tier's own hyperparameters and
// only the residual ... climbs back up ... it may not contribute a score to
// [the] placement decision." Applied here: this module may adjust how many
// passages eo-corpus.ts's retrieveCorpus is willing to keep before the
// reader ever sees anything. It may never inject text, never touch a
// candidate's own score, and never appear in a prompt as something to cite —
// see CHANNEL_GROUNDING.priors in eo-grounding.ts, which declares canGround
// false for exactly that reason.
//
// Assembly C itself is not built (its own file says so — reading-regime.js's
// header names it "NOT YET BUILT HERE", pending real measurement against a
// second regime-tracker channel). What IS built and measured end to end is
// narrower: INDUCED_MODIFIER_PRIOR (modifier-order-induced-prior.js), a
// register baked by eoreader6's induction/stacks.js against one live_priors
// text and vendored into this app as a tagger for reading-pipeline.js. Its
// own header discloses the scope honestly: eight ranked tokens, one pair
// that is verb-phrase negation rather than modifier order, not a general
// model of English. That narrowness is not hidden here either — on most
// real text this measures zero and adjusts nothing. Silence is the correct
// behavior of a narrow-scope prior on text it was never measured against,
// not a bug to paper over with a broader claim this repo cannot back.

import {
  INDUCED_MODIFIER_PRIOR,
  extractInducedModifierStacks,
} from "./eo-binary/modifier-order-induced-prior.js";

export interface PriorTouch {
  /** How many modifier stacks the induced prior's own ranked tokens formed in this text. */
  stacksFound: number;
  /** Size of the prior's ranked-token register, for the audit log — not a threshold. */
  tokensRanked: number;
  /** The prior's own disclosed provenance string (see modifier-order-induced-prior.js). */
  giver: string;
}

export interface PriorHyperparams {
  /** The only thing a prior may ever hand to retrieval: a bounded passage-count step. */
  maxPassagesDelta: number;
  reason: string;
}

// The one discrete step this channel is ever allowed to take. Assembly C's
// own acceptance bar (C4: "a discrete typed re-parameterization event, not a
// continuous adjustment") applied here as a fixed constant rather than a
// function of stacksFound — "the prior touched this turn" can only ever mean
// one thing: search one passage wider, never a graduated score that scales
// with how many tokens matched.
const MAX_PASSAGES_DELTA = 1;

/**
 * Measure whether the induced prior's own ranked tokens form a stack in
 * `text` at all — the question, not the corpus, so the adjustment is decided
 * before retrieval runs rather than by looking at what it returned (which
 * would make this a voting term on the very search it is meant to steer).
 */
export function measurePriorTouch(text: string): PriorTouch {
  const stacks = extractInducedModifierStacks(text || "");
  return {
    stacksFound: stacks.length,
    tokensRanked: Object.keys(INDUCED_MODIFIER_PRIOR.ranks).length,
    giver: INDUCED_MODIFIER_PRIOR.giver,
  };
}

/**
 * Translate a touch into a hyperparameter step. Zero touches, zero
 * adjustment — the default on almost all real text, since the register is
 * eight tokens measured from a single Alice in Wonderland pocket.
 */
export function priorHyperparameters(touch: PriorTouch): PriorHyperparams {
  if (touch.stacksFound <= 0) {
    return {
      maxPassagesDelta: 0,
      reason: "no stack touched the induced prior — no adjustment",
    };
  }
  return {
    maxPassagesDelta: MAX_PASSAGES_DELTA,
    reason: `${touch.stacksFound} stack(s) touched the induced prior — retrieval widened by ${MAX_PASSAGES_DELTA}`,
  };
}
