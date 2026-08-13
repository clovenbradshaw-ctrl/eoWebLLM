// eo-stigmergy.ts — steering marks left by one turn for the next turn's gate
// to read. EXPERIMENT: nothing wires this into the turn loop yet.
//
// The problem is one eo-gate.ts names about itself and does not close:
//
//   "System 1 ... is biased the way availability is biased: it finds the rules
//    WORDED like the question. That is the right first pass, and it
//    systematically misses the rule that governs this turn without sharing its
//    vocabulary."
//
// A signal-matched gate cannot surface the citation-discipline fold for a turn
// that never says "citation". A model that reads the turn can. But a model in
// the pre-answer path is exactly the wound chat.ts:2637-2643 already closed —
// "three sequential background model calls on a local engine, in front of an
// answer the reader is watching an empty box for ... (LAWS.md L1 — no dead
// air)" — and prompt selection happens pre-answer by necessity.
//
// So the model does not run in the fast path at all. It runs AFTER the answer,
// in the System 2 phase that already pays a deliberation cost, and deposits
// marks. The NEXT turn's gate reads those marks mechanically, with zero model
// calls, exactly as fast as it is today. Turn N leaves a trace; turn N+1 reads
// the trace. Nothing ever waits.
//
// That is stigmergy, and it is this project's own stated architecture rather
// than an import: docs/SEED-SPEC.md grounds the design in Grassé 1959 — "the
// termites never meet, they read the mound" — and says "this app is the mound."
//
// ── Why marks are safe in a way a generated query is not ─────────────────
//
// A mark names a fold that already exists. The deposit is validated against
// the known fold-id set, so a name matching nothing is discarded and a model
// cannot invent a rule. Selection from a closed set is mechanically checkable
// in a way generation is not — no JSON is asked for or parsed (the local model
// is never trusted with structured output); the model's prose is matched
// against a known vocabulary by exact id or title.
//
// ── Additive, never subtractive ──────────────────────────────────────────
//
// A mark can only ever UNFOLD — pull a fold in beyond what the mechanical pass
// chose, against a raised ceiling — never displace one that won the budget
// race on its own merits. This is deliberate and it is the same shape
// eo-gate.ts's System 2 already uses for R8 ("matched but did not fit" folds
// are pulled back in against a raised ceiling), and the same monotone
// discipline eo-warrant.ts's escalate() enforces: a later stage may find a
// reason to include, never a reason to exclude.
//
// Scoring marks INTO the ordinary budget race would break that: raising a
// marked fold's score can push an unmarked one out, so the guarantee would
// hold on the score and not on the surfaced set. Returning folds to add, and
// letting the caller raise the ceiling, keeps "additive" literally true.
//
// This module has no value imports, so it runs under `node --test` without a
// browser (see scripts/test-stigmergy.mjs) — same discipline as eo-warrant.ts.

/** How much of a mark survives one turn without reinforcement. */
export const EVAPORATION = 0.6;

/** A mark below this is gone — pruned, not carried as noise. */
export const TRACE_EPSILON = 0.05;

/**
 * Strength ceiling. Without it a fold marked on twenty consecutive turns
 * would outweigh everything forever, and the trail would stop being evidence
 * about the current conversation and start being a record of its own history.
 */
export const MARK_CEILING = 3;

/** Most folds one turn's marks may unfold. The horizon law applied here. */
export const MAX_UNFOLD = 3;

export interface SteeringMark {
  foldId: string;
  /** Accumulates on reinforcement, decays by EVAPORATION per turn. */
  strength: number;
  /** Turn the mark was last reinforced — decay is computed from this. */
  lastTurn: number;
  /**
   * Why this was marked, kept verbatim. A trail that steers without saying
   * why is an undeclared prior (LAWS.md L6 — no implied completeness), and a
   * reader auditing a surfaced fold must be able to see what pulled it in.
   */
  reasons: string[];
}

export interface SteeringTrace {
  marks: SteeringMark[];
}

export function emptyTrace(): SteeringTrace {
  return { marks: [] };
}

/**
 * Evaporate every mark to `turn`, dropping any that fell below epsilon.
 * Pure — returns a new trace, never mutates.
 *
 * Decay is not a cache eviction policy dressed up. A fold that mattered eight
 * turns ago and has not mattered since should stop steering, and it should
 * stop gradually rather than at a cliff, because the conversation it belonged
 * to may still be partly in view. eoreader6's own activation behaves this way
 * for the same reason (LAWS.md L4: "activation decays and re-zeros by design")
 * — and the same caution applies here: never widen the window to fix a recall
 * failure.
 */
export function evaporate(trace: SteeringTrace, turn: number): SteeringTrace {
  const marks: SteeringMark[] = [];
  for (const m of trace.marks) {
    const elapsed = Math.max(0, turn - m.lastTurn);
    const strength = m.strength * Math.pow(EVAPORATION, elapsed);
    if (strength >= TRACE_EPSILON)
      marks.push({ ...m, strength, lastTurn: turn });
  }
  return { marks };
}

/**
 * Lay down (or reinforce) a mark for one fold.
 *
 * `knownFoldIds` is the closed set this deposit is validated against — the
 * whole reason a mark is safer than a generated string. A name that matches
 * nothing is not a weak signal to be kept at low confidence; it is a fold that
 * does not exist, and it is dropped.
 */
export function deposit(
  trace: SteeringTrace,
  {
    foldId,
    turn,
    reason,
    knownFoldIds,
  }: {
    foldId: string;
    turn: number;
    reason: string;
    knownFoldIds: ReadonlySet<string>;
  },
): SteeringTrace {
  if (!knownFoldIds.has(foldId)) return trace;

  const decayed = evaporate(trace, turn);
  const existing = decayed.marks.find((m) => m.foldId === foldId);
  if (existing) {
    return {
      marks: decayed.marks.map((m) =>
        m.foldId === foldId
          ? {
              ...m,
              strength: Math.min(MARK_CEILING, m.strength + 1),
              lastTurn: turn,
              reasons: [...m.reasons, reason].slice(-MARK_CEILING),
            }
          : m,
      ),
    };
  }
  return {
    marks: [
      ...decayed.marks,
      { foldId, strength: 1, lastTurn: turn, reasons: [reason] },
    ],
  };
}

/**
 * Read a model's free-text reply and turn it into deposits.
 *
 * The local model is never asked for JSON (it is not reliable at structured
 * output, and eo-holonic-plan.ts already records that lesson: a small model's
 * JSON reply "can come back malformed on exactly the requests complex enough
 * to need this judgment"). It replies in prose, and this matches that prose
 * against the closed set — by fold id, or by title, case-insensitively, on a
 * word boundary. Anything else in the reply is ignored rather than parsed.
 *
 * Returns the ids actually found. A reply naming nothing real yields nothing,
 * which is the correct outcome and not an error.
 */
export function readSteer(
  reply: string,
  folds: ReadonlyArray<{ id: string; title: string }>,
): string[] {
  const text = String(reply || "").toLowerCase();
  if (!text.trim()) return [];
  const found: string[] = [];
  for (const fold of folds) {
    const needles = [fold.id, fold.title].map((s) => String(s).toLowerCase());
    const hit = needles.some((n) => {
      if (!n) return false;
      const i = text.indexOf(n);
      if (i === -1) return false;
      const before = i === 0 ? " " : text[i - 1];
      const after = i + n.length >= text.length ? " " : text[i + n.length];
      return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
    });
    if (hit && !found.includes(fold.id)) found.push(fold.id);
  }
  return found;
}

export interface Unfold {
  /** Fold ids to pull in beyond what the mechanical pass selected. */
  unfold: string[];
  /** One line per unfolded fold, naming the mark that pulled it. */
  reasons: string[];
  /** Marks that pointed at an already-surfaced fold — nothing to do. */
  alreadySurfaced: number;
  /** Marks dropped because MAX_UNFOLD was reached. LAWS.md L3 — say so. */
  withheld: number;
}

/**
 * What this turn's trace asks the gate to add, given what the mechanical pass
 * already surfaced.
 *
 * Never returns a fold that is already surfaced, never returns more than
 * MAX_UNFOLD, and reports what it withheld rather than truncating silently.
 * The caller raises its ceiling to fit these — it does not score them against
 * the folds that already won, which is what keeps this additive.
 */
export function steerUnfold(
  trace: SteeringTrace,
  {
    surfacedIds,
    turn,
    max = MAX_UNFOLD,
  }: { surfacedIds: ReadonlySet<string>; turn: number; max?: number },
): Unfold {
  const decayed = evaporate(trace, turn);
  const candidates = decayed.marks
    .filter((m) => !surfacedIds.has(m.foldId))
    .sort((a, b) => b.strength - a.strength || a.foldId.localeCompare(b.foldId));

  const taken = candidates.slice(0, Math.max(0, max));
  return {
    unfold: taken.map((m) => m.foldId),
    reasons: taken.map(
      (m) =>
        `${m.foldId}: steered in by a mark from turn ${m.lastTurn} (strength ${m.strength.toFixed(2)}) — ${m.reasons[m.reasons.length - 1]}`,
    ),
    alreadySurfaced: decayed.marks.length - candidates.length,
    withheld: Math.max(0, candidates.length - taken.length),
  };
}

/** Current strength for one fold, for display or for a test. */
export function strengthOf(
  trace: SteeringTrace,
  foldId: string,
  turn: number,
): number {
  const m = evaporate(trace, turn).marks.find((x) => x.foldId === foldId);
  return m ? m.strength : 0;
}
