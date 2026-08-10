// eoWebLLM · modifier-order-revision — app-original (not vendored from
// eoreader6), composing eo-binary/nul.js's typed-gap vocabulary the same
// way every other file in this directory does.
//
// The master log is append-only and records every act the system takes
// while reading, not only the eventful ones: a fresh SEG.narrow candidate
// for a (subject, object) pair the ledger already holds an entry for
// either agrees (a SEG.confirm event ticks, pointing back at what it
// confirmed) or disagrees (a SEG.revise event ticks, carrying
// `supersedes: <prior event_id>`). Neither ever overwrites or removes the
// prior entry — this follows the precedent set by eoreader6's
// emergence/voice.js::reviseVoice: "not an edit — a later event that
// supersedes an earlier one, so the original claim and the correction
// both stay in the log and the change is auditable." Turning that
// append-only trail into something readable (the current state, hiding
// confirmed history) is the projection/fold layer's job — see
// modifier-order-lens.js's MODIFIER_SCOPE_CURRENT_LENS — never the
// ledger's own.
//
// Deliberately NOT the eoreader6 emergence/revision.js/REC-tier-stack
// machinery (Bayesian surprise over hypergraph structure) — a different,
// much heavier mechanism for a different act. This is the narrow, local
// question: does a fresh tag for a node this ledger has already ticked
// agree or disagree with what's there.

import { gap } from "./nul.js";

// U+241F (SYMBOL FOR UNIT SEPARATOR), not "::" — subject ids already
// contain "::" (modifier-order.js's toTriples: `${parent}::${label}`), so
// "::" as a key separator could collide with a real id. Exported so any
// other fold over (subject, object) -- e.g. modifier-order-lens.js's
// MODIFIER_SCOPE_CURRENT_LENS -- keys the same way, once, in one place.
export const key = (subject, object) => `${subject}␟${object}`;

/**
 * Folds a tick-ordered slice of events into "current state per
 * (subject, object)" — last tick wins. Relies on the slice already being
 * in tick order (event_log.js only ever appends, so any slice of
 * log.events already is); does not re-sort. SEG.confirm folds in exactly
 * like SEG.narrow/SEG.revise: it carries the same class/polarity as what
 * it confirmed, so folding through it changes nothing about the current
 * state, only who most recently vouched for it.
 */
export const foldNarrowState = (events) => {
  const latest = new Map();
  for (const e of events) {
    if (
      e.type !== "SEG.narrow" &&
      e.type !== "SEG.revise" &&
      e.type !== "SEG.confirm"
    )
      continue;
    latest.set(key(e.subject, e.object), e);
  }
  return latest;
};

/**
 * Classifies one freshly-tagged SEG.narrow candidate against a folded
 * prior state (from foldNarrowState). Always returns a real event to
 * tick — there is no silent no-op path: an unchanged re-read is still a
 * witnessed act (SEG.confirm), because the ledger's job is to hold
 * everything that happened, not just what changed. Never mutates
 * `priorState` — the caller updates it with the returned event (via
 * recordTicked) so a run that mints several revisions/confirmations in
 * sequence chains correctly (a second candidate for the same node is
 * resolved against the first candidate's own tick, not against the
 * stale ledger entry it already superseded/confirmed).
 */
export const resolveAgainstLedger = (priorState, candidate) => {
  if (!candidate || candidate.type !== "SEG.narrow")
    return gap("undeclared", {
      what: "candidate",
      why: "only a SEG.narrow event is resolved against the ledger",
    });

  const prior = priorState.get(key(candidate.subject, candidate.object));
  if (!prior) return { action: "new", event: candidate };

  if (
    prior.class === candidate.class &&
    prior.polarity === candidate.polarity
  ) {
    return {
      action: "confirm",
      event: Object.freeze({
        type: "SEG.confirm",
        subject: candidate.subject,
        object: candidate.object,
        class: candidate.class,
        polarity: candidate.polarity,
        confirms: prior.event_id,
      }),
    };
  }

  return {
    action: "revise",
    event: Object.freeze({
      type: "SEG.revise",
      subject: candidate.subject,
      object: candidate.object,
      class: candidate.class,
      polarity: candidate.polarity,
      supersedes: prior.event_id,
      priorClass: prior.class,
      priorPolarity: prior.polarity,
    }),
  };
};

/**
 * Records a just-ticked event (the output of tick(log, resolved.event))
 * into `priorState` in place, keyed the same way foldNarrowState/
 * resolveAgainstLedger key it — so a caller ticking several resolutions
 * in one pass never needs to know the key format itself.
 */
export const recordTicked = (priorState, ticked) => {
  priorState.set(key(ticked.subject, ticked.object), ticked);
};
