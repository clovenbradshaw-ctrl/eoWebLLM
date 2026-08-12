// eoreader6 · engine/holon/task-log — the append-only log, re-earned as
// engine code.
//
// Re-earned, not ported (constitution Article I.2: "nothing is ported from
// [legacy]; every organ is re-earned... a legacy organ that has not been
// re-earned does not exist for placement purposes"). This module first
// existed as eochat/server/task-log.js, an application file. It passed the
// omnimodal test (II.1 — "would a leitmotif in a symphony have this
// problem?") empirically: the identical code, unmodified, drove music
// composition, essay generation, fiction, numeric prediction, multi-file
// code, and SVG diagrams. No clock, no I/O, no randomness, no prior (III.2) —
// `seq` is a logical counter the log supplies itself, never a received `ts`.
// That is what earns the move; nothing about the mechanism changed to
// deserve it.
//
// What re-earning corrected, not just relocated:
//
//   Operator identity and production order used to be a hand-rolled partial
//   copy (application-side eo-cube.js / an invented HELIX ordering). Both are
//   now read from THIS package's own operators.js — GRAINS, cellOf,
//   OPERATOR_ORDER, validateChain — the single source the rest of the engine
//   already answers to. `isProductionOrder` below is a thin wrapper over
//   `validateChain`, not a second ordinal table that could silently drift
//   from the real one.
//
//   `deriveLevels`' existence-dependency is DECLARED, not MEASURED, and says
//   so in its own doc comment below. `holon_level/index.js` already has a
//   real, Born-null-gated version of the same two tests (existence-
//   dependency, possibility-constraint) for CONTINUOUS material (a numeric
//   series and a regime). This module's material is a DISCRETE graph
//   (`depends_on` edges between task_ids), and `ground()`/`STATISTICS` in
//   nul/index.js has no statistic shaped for that yet — building one
//   properly means a new perturbation+statistic pair, licensed and
//   calibration-tested the way `holon_level`'s own header records its first
//   null being wrong (17/60 false positives at nominal 5%) before it was
//   fixed. That is real, separate work. Until it exists, `deriveLevels` here
//   is an honestly-named sibling (the same "siblings, not one
//   generalization" pattern as generation/tasks.js vs prediction/tasks.js) —
//   a stated CLAIM about dependency, never dressed as a measurement it has
//   not earned.
//
// The core discipline carried over unchanged, because it is what keeps this
// module from rotting:
//
//   No clock. Ordering is `seq`, a logical counter supplied by the log
//   itself. Callers may attach their own timestamps as opaque payload;
//   nothing here reads them.
//
//   No silent coercion. An entry that cannot be typed produces an explicit
//   null-with-reason, never a guess. A missing operator is `null` with a
//   stated basis, not a default.
//
// A flat, browser-bundlable mirror of the canonical
// eoreader6/packages/engine/holon/task-log.js — same content, only the
// operators.js import path changed (this directory's own trimmed copy,
// matching atmosphere.js/nul.js's existing flattening here), for the same
// reason those files were flattened rather than pulled in as the npm
// workspace package. Kept identical to the canonical file by hand; a
// behavioral change belongs upstream first.

import {
  GRAINS,
  cellOf,
  OPERATOR_ORDER,
  isCurrentOperator,
  validateChain,
} from "./operators.js";

// The Structure row — SEG/CON/SYN, this engine's Differentiate/Relate/
// Generate over Structure. Kept as a named subset (not a special mechanism):
// `admits` on a log is just which of the nine operators it will accept, and
// callers who only ever meant "structural composition" can still say so
// explicitly.
export const STRUCTURE_OPERATORS = Object.freeze({
  SEG: "SEG",
  CON: "CON",
  SYN: "SYN",
});
export const STRUCTURE_ROW = Object.freeze(Object.keys(STRUCTURE_OPERATORS));

// Differentiate · Interpretation — the engine refusing a claim (OP_VERBS.DEF
// = "refuse"). A task carrying this operator is a typed gap given a place in
// the log, not a string field bolted on beside it.
export const REFUSAL_OPERATOR = "DEF";

// How an entry's operator came to be what it is. The system is autopoietic —
// the log produces the entries that constitute the log — so the primary
// basis is neither "a classifier decided" nor "a planner declared": it is
// PRODUCED, meaning the operator names the production rule that actually
// fired. The other bases stay representable because the system is
// structurally coupled, not solipsistic: an outside assertion may disagree
// with what production yielded, and both are retained as CONTESTED rather
// than one silently overwriting the other.
export const OPERATOR_BASIS = Object.freeze({
  PRODUCED: "produced",
  DERIVED: "derived",
  DECLARED: "declared",
  CONTESTED: "contested",
  ABSENT: "absent",
});

export const ENTRY_KINDS = Object.freeze({
  PROPOSE: "propose",
  SUPERSEDE: "supersede",
  EVIDENCE: "evidence",
  RESULT: "result",
  RETRACT: "retract",
});

const isGrain = (g) => typeof g === "string" && GRAINS.includes(g);

/**
 * A new, empty log. `seq` is logical and starts at 0.
 *
 * `admits` is a declared choice of which operators this log will accept,
 * defaulting to all nine — this is domain-general engine infrastructure with
 * no application-specific restriction to protect, so there is nothing to
 * default narrowly FOR. A caller building a purely compositional log may
 * still say `{ admits: STRUCTURE_ROW }` explicitly.
 */
export function createTaskLog({ admits = OPERATOR_ORDER } = {}) {
  if (!Array.isArray(admits) || admits.length === 0) {
    throw new TypeError(
      "createTaskLog: admits must be a non-empty array of operator codes",
    );
  }
  for (const op of admits) {
    if (!isCurrentOperator(op)) {
      throw new TypeError(
        `createTaskLog: ${JSON.stringify(op)} is not one of the nine operators`,
      );
    }
  }
  return Object.freeze({
    entries: Object.freeze([]),
    nextSeq: 0,
    admits: Object.freeze([...admits]),
  });
}

/**
 * Append one entry. Returns a NEW log — the old one remains valid, which is
 * what makes "what did this look like before the revision" answerable.
 */
export function append(log, entry) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("append requires an entry object");
  }
  if (!Object.values(ENTRY_KINDS).includes(entry.kind)) {
    throw new TypeError(
      `append: unknown entry kind ${JSON.stringify(entry.kind)}`,
    );
  }
  if (typeof entry.task_id !== "string" || !entry.task_id) {
    throw new TypeError("append: every entry needs a task_id");
  }
  const admits = log.admits ?? OPERATOR_ORDER;
  if (entry.operator != null && !admits.includes(entry.operator)) {
    throw new TypeError(
      `append: ${JSON.stringify(entry.operator)} is not admitted by this log (admits ${admits.join(", ")})`,
    );
  }
  // An operator without a stated basis is the silent default this module
  // exists to prevent.
  if (
    entry.operator != null &&
    !Object.values(OPERATOR_BASIS).includes(entry.operator_basis)
  ) {
    throw new TypeError(
      "append: an entry carrying an operator must state its operator_basis",
    );
  }
  if (entry.grain != null && !isGrain(entry.grain)) {
    throw new TypeError(
      `append: ${JSON.stringify(entry.grain)} is not one of the three grains (${GRAINS.join(", ")})`,
    );
  }
  // A grain names which of the three legal cells its operator's row lands
  // on. Without the operator on the SAME entry there is no cell for it to
  // complete — the two are earned together, not stitched from separate acts.
  if (entry.grain != null && entry.operator == null) {
    throw new TypeError(
      "append: a grain was supplied without the operator that shares its cell",
    );
  }

  const sealed = Object.freeze({
    ...entry,
    seq: log.nextSeq,
    // `depends_on` is the existence-dependency CLAIM this task rests on — the
    // raw material for `deriveLevels`, and, per this module's own header,
    // not yet a measured relation. Never itself a level.
    depends_on: Object.freeze([...(entry.depends_on ?? [])]),
    evidence: Object.freeze([...(entry.evidence ?? [])]),
  });

  return Object.freeze({
    entries: Object.freeze([...log.entries, sealed]),
    nextSeq: log.nextSeq + 1,
    admits,
  });
}

/**
 * Fold the log into the current set of live tasks.
 *
 * Later entries for a task_id win, superseded and retracted tasks drop out of
 * the live set — but nothing is deleted from `log.entries`.
 */
export function projectTasks(log) {
  const byId = new Map();
  const superseded = new Set();
  const retracted = new Set();

  for (const e of log.entries) {
    if (e.kind === ENTRY_KINDS.RETRACT) {
      retracted.add(e.task_id);
      continue;
    }
    if (e.supersedes) superseded.add(e.supersedes);

    const prior = byId.get(e.task_id) ?? {
      task_id: e.task_id,
      operator: null,
      operator_basis: OPERATOR_BASIS.ABSENT,
      operator_gap: "no structural act has been earned for this task yet",
      grain: null,
      grain_gap: "no grain has been earned for this task's operator yet",
      cell: null,
      description: null,
      depends_on: [],
      evidence: [],
      result: null,
      first_seq: e.seq,
    };

    // Domain payload. The log is medium-agnostic — it knows about structure,
    // not about what the structure is made of — but a task has to be able to
    // carry its material or the fold hands downstream an empty shape.
    const RESERVED = new Set([
      "kind",
      "task_id",
      "seq",
      "supersedes",
      "operator",
      "operator_basis",
      "grain",
      "description",
      "depends_on",
      "evidence",
      "result",
    ]);
    const payload = {};
    for (const [key, value] of Object.entries(e)) {
      if (!RESERVED.has(key)) payload[key] = value;
    }

    // grain and cell come from the SAME entry's operator+grain pair, never
    // stitched across two different acts. An entry that moves the operator
    // without repeating the grain lapses the old grain rather than pairing
    // it with an operator it was never affirmed alongside.
    const nextOperator = e.operator ?? prior.operator;
    const nextGrain = e.grain ?? (e.operator != null ? null : prior.grain);
    const nextGrainGap =
      e.grain != null
        ? null
        : e.operator != null
          ? "no grain has been earned for this task's operator yet"
          : prior.grain_gap;
    const nextCell =
      nextOperator != null && nextGrain != null
        ? cellOf(nextOperator, nextGrain)
        : null;

    byId.set(e.task_id, {
      ...prior,
      ...payload,
      // Evidence accumulates from ANY entry that carries it, not only from
      // EVIDENCE-kind entries — a task proposed WITH its evidence is the
      // normal case, not a special one.
      evidence: e.evidence?.length
        ? [...new Set([...prior.evidence, ...e.evidence])]
        : prior.evidence,
      result: e.kind === ENTRY_KINDS.RESULT ? e.result : prior.result,
      description: e.description ?? prior.description,
      depends_on: e.depends_on.length ? [...e.depends_on] : prior.depends_on,
      operator: nextOperator,
      operator_basis:
        e.operator != null ? e.operator_basis : prior.operator_basis,
      operator_gap: e.operator != null ? null : prior.operator_gap,
      grain: nextGrain,
      grain_gap: nextGrainGap,
      cell: nextCell,
      last_seq: e.seq,
    });
  }

  return [...byId.values()]
    .filter((t) => !retracted.has(t.task_id) && !superseded.has(t.task_id))
    .sort((a, b) => a.first_seq - b.first_seq);
}

/**
 * Derive level relations from `depends_on`.
 *
 * DECLARED, NOT MEASURED — see this module's header. `depends_on` is a stated
 * claim ("B cannot exist without A"), taken as-is; nothing here tests it
 * against a null the way `holon_level/index.js`'s `existenceDependencyTest`
 * does for continuous material. Naming that plainly here is the point: a
 * caller comparing this module's `relations` to `holon_level`'s
 * `holonLevelRelation` output must not treat them as the same standing of
 * claim.
 *
 * Two tests are named in the docstring this module inherited from its
 * pre-engine form (existence-dependency, possibility-constraint); only the
 * first is implemented, for the same reason — possibility-constraint needs
 * its own measured test over the fold, not a graph re-reading of
 * `depends_on`, and does not yet exist for discrete material either.
 *
 * A pair that passes neither is a PEER. That is a real answer, not a missing
 * one: not every nesting is a ladder, and forcing a rank where none was
 * earned is the exact failure this replaces.
 *
 * `depth` is a derived convenience for display, recomputed from the
 * dependency edges on every call, never authoritative. `cycles` reports every
 * dependency cycle found — `depthOf` still returns a peer-ish 0 on a cycle,
 * but a caller can now tell a root's 0 from circular dependency.
 */
export function deriveLevels(tasks) {
  const ids = new Set(tasks.map((t) => t.task_id));
  const above = new Map(tasks.map((t) => [t.task_id, new Set()]));

  for (const t of tasks) {
    for (const dep of t.depends_on) {
      // A dependency on something not in the live set is a typed gap, not an
      // edge to invent.
      if (ids.has(dep)) above.get(t.task_id).add(dep);
    }
  }

  const depthOf = (id, seen = new Set()) => {
    if (seen.has(id)) return 0; // cycle: report a peer-ish 0 rather than recurse
    const parents = above.get(id);
    if (!parents || parents.size === 0) return 0;
    const next = new Set(seen).add(id);
    return 1 + Math.max(...[...parents].map((p) => depthOf(p, next)));
  };

  const cycles = [];
  const seenCycle = new Set();
  const colour = new Map();
  const stack = [];
  const walk = (id) => {
    const c = colour.get(id);
    if (c === "black") return;
    if (c === "grey") {
      const cycle = stack.slice(stack.indexOf(id));
      const key = [...cycle].sort().join("|");
      if (!seenCycle.has(key)) {
        seenCycle.add(key);
        cycles.push(Object.freeze([...cycle]));
      }
      return;
    }
    colour.set(id, "grey");
    stack.push(id);
    for (const parent of above.get(id) ?? []) walk(parent);
    stack.pop();
    colour.set(id, "black");
  };
  for (const t of tasks) walk(t.task_id);

  const relations = [];
  for (const a of tasks) {
    for (const b of tasks) {
      if (a.task_id >= b.task_id) continue;
      const aAboveB = above.get(b.task_id).has(a.task_id);
      const bAboveA = above.get(a.task_id).has(b.task_id);
      relations.push({
        a: a.task_id,
        b: b.task_id,
        relation: aAboveB ? "a-above-b" : bAboveA ? "b-above-a" : "peer",
        earned_by: aAboveB || bAboveA ? "existence-dependency" : null,
      });
    }
  }

  return {
    levels: tasks.map((t) => ({
      task_id: t.task_id,
      depth: depthOf(t.task_id),
    })),
    relations,
    cycles,
  };
}

/** true iff `nextOp` does not fire strictly before `priorOp` in the engine's real dependency order. */
export function isProductionOrder(priorOp, nextOp) {
  if (!isCurrentOperator(priorOp) || !isCurrentOperator(nextOp)) return null;
  try {
    validateChain([priorOp, nextOp]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Are these tasks' results actually in hand?
 *
 * SYN is the combine step of a recursion (the only rule that produces a task
 * nothing else depends on the parts of), and combining before the parts have
 * produced anything is Tempus's mistake — the watchmaker who restarts because
 * he built on a sub-assembly that was not finished. Advisory, like
 * `deriveLevels`'s cycle report: nothing here blocks an append.
 */
export function readyToSynthesize(tasks, ids) {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  const missing = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) missing.push({ task_id: id, reason: "not in the live fold" });
    else if (t.result == null)
      missing.push({ task_id: id, reason: "no result yet" });
  }
  return { ready: missing.length === 0, missing };
}

/**
 * One production step: the log producing the components that constitute it.
 *
 * This is what makes the structure autopoietic rather than merely
 * append-only. Nothing outside decides the shape of the work; the current
 * fold is perturbed by evidence and PRODUCES its own next entries. A rule is
 * supplied per operator; `produce()` fires them in the engine's real
 * dependency order (`OPERATOR_ORDER`) within one step, so an entry produced
 * by an earlier-ordered operator can be built on by a later one on the SAME
 * pass, and by any operator on the next.
 *
 * Termination is operational closure — production yielding nothing new — NOT
 * a depth ceiling. Closure is measured on the FOLD (a digest of
 * `projectTasks`), not on `entries.length`: a rule that re-proposes an
 * identical task changes nothing in the fold even though it grows `entries`,
 * and comparing the fold is what lets that still read as closed rather than
 * running to the guard. `maxSteps` is only a runaway guard, and when it is
 * what stopped the loop that is reported rather than passed off as closure.
 *
 * A live task carrying `REFUSAL_OPERATOR` that nothing has answered holds the
 * run open even after the fold stops changing — `halted_by` distinguishes
 * "nothing left to produce" (`operational-closure`), "an unanswered refusal
 * remains" (`open-gaps-remain`), and "the guard tripped" (`max-steps-guard`).
 */
const stableStringify = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
};
const foldDigest = (tasks) =>
  stableStringify(tasks.map(({ last_seq, ...rest }) => rest));

export function produce(log, rules, { maxSteps = 64 } = {}) {
  if (!rules || typeof rules !== "object") {
    throw new TypeError("produce requires a rule set keyed by operator code");
  }

  let current = log;
  let steps = 0;
  let closed = false;
  // Per-step trace — see its own doc below for why this exists: the closure
  // test is a TERMINAL bit (changed / didn't), and collapses "converging
  // slowly," "drifting," and "genuinely done" into one undifferentiated
  // signal until `max-steps-guard` trips. This is the raw material a caller
  // needs to tell those apart, without this module guessing a threshold it
  // has not measured.
  const trace = [];

  while (steps < maxSteps) {
    const tasks = projectTasks(current);
    const before = foldDigest(tasks);
    const entriesBefore = current.entries.length;

    for (const op of OPERATOR_ORDER) {
      const rule = rules[op];
      if (typeof rule !== "function") continue;
      for (const produced of rule(tasks, current) ?? []) {
        const kind = produced.kind ?? ENTRY_KINDS.PROPOSE;
        // The rule that fired IS the type, but only for entries that BRING A
        // TASK INTO BEING (PROPOSE/SUPERSEDE). A RESULT attaches an answer to
        // a task that already exists; stamping the firing operator on it
        // would re-type the task in the fold.
        const constitutes =
          kind === ENTRY_KINDS.PROPOSE || kind === ENTRY_KINDS.SUPERSEDE;
        current = append(current, {
          ...produced,
          kind,
          ...(constitutes
            ? { operator: op, operator_basis: OPERATOR_BASIS.PRODUCED }
            : {}),
        });
      }
    }

    steps += 1;
    const foldChanged = foldDigest(projectTasks(current)) !== before;
    // `entriesAdded` and `foldChanged` are DIFFERENT facts, and their
    // disagreement is itself a finding: entries added with the fold
    // unchanged is production CHURNING — rules kept firing (e.g.
    // re-proposing an already-live task) without moving the actual state.
    // Silent in the old entries.length-only comparison this replaced; visible
    // here rather than guessed away.
    trace.push({
      step: steps,
      entriesAdded: current.entries.length - entriesBefore,
      foldChanged,
    });
    if (!foldChanged) {
      closed = true;
      break;
    }
  }

  const openGaps = projectTasks(current)
    .filter((t) => t.operator === REFUSAL_OPERATOR)
    .map((t) => t.task_id);

  const halted_by = !closed
    ? "max-steps-guard"
    : openGaps.length
      ? "open-gaps-remain"
      : "operational-closure";

  return {
    log: current,
    steps,
    closed: closed && openGaps.length === 0,
    halted_by,
    open_gaps: openGaps,
    // "Production is exhausted" (the fold stopped moving) is a different fact
    // from "the work is done" (`closed`) — an unanswered refusal holds `closed`
    // false forever by design, which is also exactly the boundary at which a
    // rule-set change (REC re-entry — see loops/atmosphere.js's own
    // DEF/EVA/REC regime, the sibling mechanism this module's refusal
    // machinery is named after) may legally happen: between fixpoint
    // computations, never inside one.
    fixpoint: closed,
    // The wayfinding reading, stated plainly because it is the actual reason
    // this exists: `closed`/`halted_by` are a sighting of the destination —
    // you only get one, at the exact step it happens, or at the guard.
    // `trace` is the bearing log — how much moved, each step, on the way
    // there.
    //
    // MEASURED, not assumed: `entriesAdded` shrinking toward zero is NOT a
    // universal signature of converging — a branching production (SEG
    // fanning a frontier of several eligible tasks out in parallel) grows
    // `entriesAdded` for as many steps as the frontier is still widening
    // (measured here: [2, 4, 0] for a 4-item evidence set split to leaves —
    // width outpacing per-branch shrinkage before the tree bottoms out), and
    // that is healthy, bounded convergence, not drift. The one signal this
    // trace actually supports without inventing a threshold: whether
    // `foldChanged` ever reaches `false` at all. It doing so is convergence,
    // however the per-step shape got there; every step holding `true` all
    // the way to `max-steps-guard` is the honest "this may not be
    // converging" a bare `steps >= maxSteps` cannot distinguish from "was one
    // step short." `entriesAdded > 0` with `foldChanged: false` on the SAME
    // step is a third, different fact — churn: a rule fired and appended
    // something, but nothing it appended changed the live fold (e.g.
    // re-proposing an already-live task verbatim). This module states the
    // bearing; it does not decide when to stop believing it — no threshold
    // is picked here that has not been measured, the same discipline
    // `deriveLevels` already holds for existence-dependency.
    trace,
  };
}

/**
 * The mouth.
 *
 * The world folds before anything is said, so what reaches a single
 * generation is a working-memory-sized handful — not everything a search
 * found and not everything the log holds. `k` defaults to 7, the top of the
 * 4-7 Ericsson-Kintsch Long-Term Working Memory range. It is a declared
 * budget, so it lives here as an argument rather than as a constant some
 * organ discovers.
 */
export function foldToWorkingSet(tasks, { k = 7, score = null } = {}) {
  if (!Number.isInteger(k) || k < 1)
    throw new TypeError("foldToWorkingSet: k must be a positive integer");
  const rank = score ?? ((t) => t.evidence.length);
  const ordered = [...tasks].sort(
    (x, y) => rank(y) - rank(x) || x.first_seq - y.first_seq,
  );
  return {
    working: ordered.slice(0, k),
    // What did NOT reach the mouth, and how much. Silent truncation reads as
    // "this was everything" when it was not.
    withheld: ordered.length > k ? ordered.length - k : 0,
    withheld_ids: ordered.slice(k).map((t) => t.task_id),
  };
}

/**
 * Register something noticed mid-generation that nobody planned for — a
 * character the model introduces unasked, a file a written file references.
 * Tagged SEG (Differentiate) at Figure grain: a single thing pulled out of
 * undifferentiated material and individually named.
 */
export function proposeDiscovered(log, discoveries) {
  let next = log;
  for (const d of discoveries) {
    if (typeof d.task_id !== "string" || !d.task_id) {
      throw new TypeError("proposeDiscovered: every discovery needs a task_id");
    }
    const { task_id, description, depends_on, ...payload } = d;
    next = append(next, {
      kind: ENTRY_KINDS.PROPOSE,
      task_id,
      description,
      depends_on,
      operator: STRUCTURE_OPERATORS.SEG,
      operator_basis: OPERATOR_BASIS.PRODUCED,
      grain: GRAINS[1], // Figure
      ...payload,
    });
  }
  return next;
}

/**
 * Register a refusal — a claim this task could not settle. `grain` is
 * required and load-bearing: Ground clears a general assumption, Figure
 * rejects one specific claim, Pattern dismantles a whole frame (this
 * package's operators.js, Differentiate row).
 */
export function proposeGaps(log, gaps) {
  let next = log;
  for (const g of gaps) {
    if (typeof g.task_id !== "string" || !g.task_id) {
      throw new TypeError("proposeGaps: every gap needs a task_id");
    }
    if (typeof g.reason !== "string" || !g.reason) {
      throw new TypeError(
        `proposeGaps: gap ${JSON.stringify(g.task_id)} must state a reason — a gap without one is the guessed default this module refuses`,
      );
    }
    if (!isGrain(g.grain)) {
      throw new TypeError(
        `proposeGaps: gap ${JSON.stringify(g.task_id)} must declare the grain it refuses at (${GRAINS.join(", ")})`,
      );
    }
    const { task_id, description, depends_on, grain, ...payload } = g;
    next = append(next, {
      kind: ENTRY_KINDS.PROPOSE,
      task_id,
      description,
      depends_on,
      operator: REFUSAL_OPERATOR,
      operator_basis: OPERATOR_BASIS.PRODUCED,
      grain,
      ...payload,
    });
  }
  return next;
}

// ── Grain progression: advisory, never a blocking gate ─────────────────────

export const GRAIN_RANK = Object.freeze(
  Object.fromEntries(GRAINS.map((g, i) => [g, i])),
);

/** true iff `nextGrain` is the same or a deeper resolution than `priorGrain` — never a coarsening. */
export function isGrainProgression(priorGrain, nextGrain) {
  if (!isGrain(priorGrain) || !isGrain(nextGrain)) return null;
  return GRAIN_RANK[nextGrain] >= GRAIN_RANK[priorGrain];
}

function threadRootOf(task_id, supersedes) {
  let current = task_id;
  const seen = new Set();
  while (supersedes.has(current) && !seen.has(current)) {
    seen.add(current);
    current = supersedes.get(current);
  }
  return current;
}

/**
 * Walks one thread's own entries (in seq order) and flags any step where
 * grain coarsened or production order ran backward against the engine's real
 * `OPERATOR_ORDER`. A thread follows `supersedes` across task_ids — the
 * spiral link, distinct from `depends_on`'s lattice link.
 */
export function checkCubeProgression(log) {
  const supersedes = new Map();
  for (const e of log.entries) {
    if (e.kind === ENTRY_KINDS.SUPERSEDE && e.supersedes)
      supersedes.set(e.task_id, e.supersedes);
  }

  const byThread = new Map();
  for (const e of log.entries) {
    if (e.operator == null || e.grain == null) continue;
    const root = threadRootOf(e.task_id, supersedes);
    if (!byThread.has(root)) byThread.set(root, []);
    byThread.get(root).push(e);
  }

  const flags = [];
  for (const entries of byThread.values()) {
    for (let i = 1; i < entries.length; i++) {
      const prior = entries[i - 1];
      const next = entries[i];
      if (isGrainProgression(prior.grain, next.grain) === false) {
        flags.push({
          task_id: next.task_id,
          kind: "grain-coarsened",
          from: prior.grain,
          to: next.grain,
          atSeq: next.seq,
        });
      }
      if (
        prior.operator !== next.operator &&
        isProductionOrder(prior.operator, next.operator) === false
      ) {
        flags.push({
          task_id: next.task_id,
          kind: "production-order-reversed",
          from: prior.operator,
          to: next.operator,
          atSeq: next.seq,
        });
      }
    }
  }
  return flags;
}
