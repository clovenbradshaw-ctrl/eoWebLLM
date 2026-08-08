// eoreader6 · loops/turn — ONE COMPLETE TURN: all nine operators at one
// grain, fired in order. Domain is the dependency (Existence enables
// Structure enables Interpretation); mode is the sequence within it
// (Differentiate, Relate, Generate). Stance is entailed by (mode, grain) and
// never chosen — at Ground grain every Differentiate op is Clearing, every
// Relate op is Tending, every Generate op is Cultivating.
//
//   ① NUL · Void · Clearing          construct the nothing
//   ② SIG · Void · Tending           relate presence to it; keep it viable
//   ③ INS · Void · Cultivating       material comes into being
//   ④ SEG · Field · Clearing         partition the arena into reach-units
//   ⑤ CON · Field · Tending          which units are contemporary
//   ⑥ SYN · Field · Cultivating      the arena as one extent; coverage
//   ⑦ DEF · Atmosphere · Clearing    where the ground fails (BOTH ways)
//   ⑧ EVA · Atmosphere · Tending     where it holds; maintain it
//   ⑨ REC · Atmosphere · Cultivating re-zero; a new ambient ground begins
//
// ⑦⑧⑨'s settled output is what turn 2 RECEIVES as its existence tier. Only
// Ground grain is implemented; the other grains are honestly refused rather
// than faked.
//
// APERTURE FLOWS: a region closes with its warmth and the next region opens with
// that SAME warmth — by identity, not by resemblance. The reading's own settled
// past is received by its present (SEED.md #1; belief.js WORLDS.this: "the
// giver is this reader at an earlier here"). No gate decides it, no number
// modulates it; the only ground that opens cold is the first one.
//
// THE REGISTER: the past also crosses TURN boundaries. The caller hands the
// previous turn's `register` in — the closing warmth plus the measurement's own
// declared choice (the perturbation) — and this turn's first region opens with
// that warmth instead of cold, and the turn hands its own register back.
// Firstness is never derived: a region that
// opens with nothing carried says `openedFrom: "own"` and is only first if the
// caller actually read nothing before. A register built on a different
// perturbation is refused, not mixed (SEED.md #6, Amendment I: sensitivity is
// a property of the pair). The register is one scalar plus a declared choice,
// never a rollup of the trail — the watcher's regress is refused exactly where
// it was before.
//
// THE FRAME organ (frame/) holds the reading's trail of its own acts — the
// refusal that ended a region and the re-zero that followed, provenance
// "received", the watcher's regress refused by type. It lives apart from the
// turn (conformance/frame.test.js enforces firstness and one trajectory); a
// turn does not bolt it on, because a constructed ground can never be the
// first act of a sequence (SEED.md #1).

import {
  ground,
  difference,
  pattern,
  admissible,
  volume,
  isGap,
  gap,
  anchor,
} from "./nul.js";
import { cellOf } from "./operators.js";
import { slackRunNull } from "./atmosphere.js";

// The cells this organ occupies on the operator grid (engine/operators.js):
// one complete turn fires all nine at Ground grain. Declared, checked by
// conformance.
export const CELLS = Object.freeze(
  ["NUL", "SIG", "INS", "SEG", "CON", "SYN", "DEF", "EVA", "REC"].map((op) =>
    Object.freeze({ op, grain: "Ground" }),
  ),
);

// The interpretation tier's cells, derived from the algebra (operators.js) —
// terrain and stance are entailed by (mode, grain), never hand-listed. The
// comments record what the derivation yields, so a drift in the algebra shows
// as a test failure, not a silent relabel.
const DEF_GROUND = cellOf("DEF", "Ground"); // Atmosphere · Clearing
const EVA_GROUND = cellOf("EVA", "Ground"); // Atmosphere · Tending
const REC_GROUND = cellOf("REC", "Ground"); // Atmosphere · Cultivating

// ── EXISTENCE · Void ─────────────────────────────────────────────────────────

/** ① NUL · Void · Clearing — a nothing built by perturbing what is present. */
export const clearVoid = ({
  material,
  draws,
  window,
  seed,
  perturbation = "shuffle",
  statistic = "burstiness",
}) => ground({ material, draws, window, seed, perturbation, statistic });

/**
 * ② SIG · Void · Tending — keep the nothing fit to perceive through, and
 * report how much room is left to be surprised in. A ground that has gone
 * degenerate or been kept for testimony is no longer a void you can see
 * against; aperture (interquartile volume) is the sign of health, never a gate.
 */
export const tendVoid = (g) => {
  const bad = admissible(g);
  if (bad) return { viable: false, reason: bad };
  if (g.kept)
    return {
      viable: false,
      reason: gap("kept_ground", { reason: "held for testimony" }),
    };
  const room = volume(g);
  return { viable: room > 0, aperture: room };
};

/**
 * ③ INS · Void · Cultivating — what has come into being so far. Causal by
 * construction: a turn may only ever see material already arrived, never the
 * whole extent. This is the operator that makes the read a READING rather
 * than an analysis of a finished object.
 */
export const cultivateVoid = (material, upTo) =>
  material.slice(0, Math.max(0, Math.min(upTo, material.length)));

// ── STRUCTURE · Field ────────────────────────────────────────────────────────

/**
 * ④ SEG · Field · Clearing — partition the arena into reach-units. `window`
 * is the reach of the present (SEED.md's third declared number): how much
 * material is contemporary with itself. Declared, never derived from length.
 */
export const clearField = (extent, { window, hop }) => {
  const units = [];
  for (let i = 0; i + window <= extent; i += hop)
    units.push({ start: i, end: i + window });
  return units;
};

/** ⑤ CON · Field · Tending — two units are contemporary when they overlap. */
export const tendField = (units) => {
  const adjacency = new Map();
  for (let i = 0; i < units.length; i++) {
    const touching = [];
    for (let j = 0; j < units.length; j++) {
      if (i === j) continue;
      if (units[j].start < units[i].end && units[i].start < units[j].end)
        touching.push(j);
    }
    adjacency.set(i, touching);
  }
  return adjacency;
};

/**
 * ⑥ SYN · Field · Cultivating — the arena as one extent. Reports coverage:
 * material no reach-unit touches is outside the field and cannot bear a
 * relation, which is a gap in the arena, not a silent omission.
 */
export const cultivateField = (units, extent) => {
  if (units.length === 0)
    return { covered: 0, extent, uncovered: extent, complete: false };
  const covered = new Set();
  for (const u of units) for (let i = u.start; i < u.end; i++) covered.add(i);
  return {
    covered: covered.size,
    extent,
    uncovered: extent - covered.size,
    complete: covered.size === extent,
  };
};

// ── INTERPRETATION · Atmosphere ──────────────────────────────────────────────

/**
 * ⑦⑧⑨ DEF/EVA/REC · Atmosphere · Clearing/Tending/Cultivating.
 *
 * An atmosphere boundary is where the accumulated ground stops working and
 * must be rebuilt — not a topic label, not a punctuation rule.
 *
 * A GROUND CAN FAIL TWO WAYS, and both are DEF · Atmosphere · Clearing:
 *
 *   surfeit — the new material EXCEEDS the ground's support. What arrived is
 *     outside what the nothing can place. Detectable from the figure alone:
 *     difference() returns exceeds_witness above. (Censored BELOW is not a
 *     failure — burstiness is a max-over-windows statistic, so an ordinary
 *     real window sits under its support almost always, and SEED.md warns in
 *     as many words that censored-below is regularity and must not be
 *     mistaken for it. Counting it re-zeroed on essentially every step.)
 *
 *   moved — the GROUND ITSELF has shifted under maintenance: rebuilt over the
 *     region as it now stands, it sits further from where it was than merely
 *     reseeding it would put it. That is pattern() — Bateson's difference
 *     that makes a difference, applied to the ambient ground rather than to
 *     a figure.
 *
 * Why the second one had to exist: burstiness is a max over windows, so
 * surfeit responds to whatever lifts the max. That makes it good at LEVEL
 * shifts and unreliable on SPREAD shifts — not blind to them, which was the
 * first draft of this paragraph and was wrong. A big enough variance increase
 * does lift a max. What it misses is a spread change against a ground already
 * wide enough to absorb it, which is the ordinary case once a reader has
 * accumulated anything. Measured on a planted calm → elevated → turbulent
 * series over three seeds: the moved clearing found the spread transition 3/3,
 * surfeit 1/3, and aperture tracked it every time (0.5 → 1.2 → 2.5) while
 * clearing did not. pattern() compares the whole quantile shape of the two
 * grounds, so a spread change displaces it. The two modes read different
 * failures of the same ground.
 *
 * Crucially this invents no new threshold. pattern() carries its own null and
 * `moved` is a comparison against it, not against a number chosen here.
 * `tolerance` stays the one hand-set knob, and both modes count into it,
 * because "the ground failed again" is the same fact either way.
 *
 * What it cost to get right: wired against pattern()'s ORIGINAL null — held
 * at before's extent while `after` grew — this fired on homogeneous noise at
 * near-even spacing and recovered 23/24 Frankenstein chapter boundaries while
 * recovering 21–23/24 from the same series SHUFFLED. See nul/index.js::pattern
 * for the correction and scripts/RESULTS.md for the numbers on both sides
 * of it.
 *
 * Declared, never defaulted: `tolerance` (the resolution of refusal),
 * `window`, `draws`, and now `reseeds` (the resolution of pattern).
 *
 * `clearOn` selects which failure modes count. It is an ABLATION HANDLE, for
 * measuring one mode against the other, not a tuning knob — the shipped
 * reading admits both, because a reader whose ground has moved out from
 * under them has lost it just as surely as one swamped by surfeit.
 *
 * A THIRD MEMBER, `"regularity"`, is not a failure mode and clears nothing.
 * Sustained censored-below is the opposite pole (SEED.md #8, Amendment II)
 * and its remedy is investigation, never re-zero — so opting into it does
 * not add a way to fail; it adds a `findings` channel alongside `events`
 * that the clearing machinery never reads and never triggers from. See
 * `loops/atmosphere`'s `slackRunNull` for the null and conformance for the
 * measured false-alarm rate. Calibrated for statistics whose below-censoring
 * is a genuine, non-chronic event — burstiness's is not (measured: 79-87% of
 * ordinary steps), so this is most informative when `statistic` is
 * `"windowMean"`.
 *
 * A FOURTH MEMBER, `"release"`, is not a failure either. #8 makes re-zero a
 * response to failure; a ground held until it breaks spends its final phase
 * closing, so releasing only on failure means the steady state is always
 * holding something that has already begun to stop working. Opting in
 * concedes the standing ground on a CADENCE instead: once it has been
 * maintained over as much new material again as it was first built over
 * (no new declared number — the extent a ground was built over is already
 * carried as `gEnd - regionStart`). Tagged `clearedBy: "release"`, apart from
 * `"surfeit"`/`"moved"`, because a scheduled concession and a failed one are
 * different facts even though both re-zero. Off by default: existing readers
 * of `regions`/`events` see no new boundaries unless they ask for this.
 */
export const runTurn = ({
  material,
  grain = "Ground",
  window,
  draws,
  reseeds,
  tolerance,
  hop = 1,
  seed = 0,
  clearOn = ["surfeit", "moved"],
  perturbation = "shuffle",
  statistic = "burstiness",
  awareness = false,
  giver = "reader",
  register = null,
}) => {
  if (grain !== "Ground")
    return gap("unknown_spec", {
      reason: `grain "${grain}" is not yet earned — only Ground is built`,
      grain,
    });
  if (!Array.isArray(material) || material.length === 0)
    return gap("empty_material", {});
  if (!Number.isInteger(tolerance) || tolerance < 1)
    return gap("undeclared", {
      what: "tolerance",
      why: "the resolution of refusal is never a default",
    });
  if (!Number.isInteger(window) || window < 2)
    return gap("undeclared", {
      what: "window",
      why: "the reach of the present is never derived from material length",
    });
  if (!Number.isInteger(draws) || draws < 2)
    return gap("undeclared", {
      what: "draws",
      why: "the resolution of testimony is 1/draws and is never a default",
    });
  const wantsMoved = clearOn.includes("moved");
  const wantsRegularity = clearOn.includes("regularity");
  const wantsRelease = clearOn.includes("release");
  if (
    (wantsMoved || wantsRegularity) &&
    (!Number.isInteger(reseeds) || reseeds < 2)
  )
    return gap("undeclared", {
      what: "reseeds",
      why: "the resolution of pattern is never a default",
    });
  for (const mode of clearOn)
    if (
      mode !== "surfeit" &&
      mode !== "moved" &&
      mode !== "regularity" &&
      mode !== "release"
    )
      return gap("unknown_spec", { reason: `no such failure mode: ${mode}` });
  // "regularity" finds and "release" schedules; neither fails. A reading of
  // nothing but those still has no way to ever concede its ground on its own
  // account, which is the same defect `clearOn: []` already refuses.
  if (
    !clearOn.includes("surfeit") &&
    !clearOn.includes("moved") &&
    !wantsRelease
  )
    return gap("undeclared", {
      what: "clearOn",
      why: "a ground that cannot fail is not a ground",
    });

  // The past a register carries must be receivable: typed, giver-named,
  // one closing warmth, and built on the same perturbation this present is
  // built on. Mixing a past measured against another perturbation would be an
  // averaging of grounds (SEED.md #6, constitution II.8), refused here by type.
  if (register != null) {
    if (typeof register !== "object" || Array.isArray(register))
      return gap("unreceived_origin", {
        reason: "a register must be a typed object, not a bare value",
      });
    if (typeof register.giver !== "string" || register.giver.length === 0)
      return gap("unreceived_origin", {
        reason:
          "a carried past must name whose past it is — a prior names its giver (SEED.md #1)",
      });
    if (register.close != null && !Number.isFinite(register.close))
      return gap("unknown_spec", {
        reason:
          "the carried warmth is one closing volume — never a rollup of the trail",
      });
    if (register.perturbation != null && register.perturbation !== perturbation)
      return gap("unknown_spec", {
        reason:
          "a past built on a different perturbation cannot open this present — two grounds built to different specs were never comparable (SEED.md #5), and sensitivity is a property of the (statistic, perturbation) pair (Amendment I)",
        carried: register.perturbation,
        here: perturbation,
      });
  }
  const carried = register?.close != null ? register.close : null;

  // ④⑤⑥ FIELD — the arena, established before anything is interpreted in it
  const units = clearField(material.length, { window, hop });
  const adjacency = tendField(units);
  const coverage = cultivateField(units, material.length);

  const regions = [];
  const events = [];
  const findings = []; // "regularity"'s own channel — reported, never acted on (SEED.md #8)
  const driftGaps = new Map(); // a gap is a result: pattern refusing to rule is recorded, not swallowed
  let regionStart = 0;
  let g = null;
  let gEnd = null; // how much material the standing ground was built over — pattern's null needs it
  let bornAt = null; // where THIS standing ground was first built — "release"'s own cadence needs it, separate from gEnd, which moves on every maintenance
  let clearings = 0;
  let tended = 0;
  let apertureAtOpen = null;
  let apertureSeries = []; // sampled every act, per region — the sign as a series, not two samples (SEED.md §8)
  let actsThisRegion = 0; // exposed so a series' length is checkable against the region's own act count, not inferred

  // Awareness's own anchor (SEED.md §7): a ground held only to be tended,
  // never judged through. No wider opening — same `window`, over the WHOLE
  // accumulated extent from the very start of the material, never reset by
  // a region conceding. Parasitic-free: attention narrowing or its region
  // conceding leaves this reach untouched.
  let ambient = null;
  const ambientAperture = [];

  // Regularity's own counter, held APART from `clearings` — opposite poles,
  // never one tally (SEED.md #8, Amendment II). Sampled once every roughly
  // `window` worth of material rather than every unit: adjacent units at
  // `hop` share `window - hop` of their material, so a run over raw units is
  // autocorrelated by construction and no shuffle of it is a null of
  // anything (see `slackRunNull`). Reset whenever the ground concedes.
  const belowFlags = [];
  let sinceSlackSample = 0;
  const slackStride = Math.max(1, Math.round(window / hop));

  let apertureReceived = null; // the flow: last region's close, carried into the next region's open
  let regionOpenCarried = false; // the open warmth's provenance: carried past or own ground

  // MINIMUM VIABLE GROUND — the same defect loops/atmosphere's `groundFrom`
  // carries a fix for, measured independently here rather than assumed: this
  // closure is atmosphere's `groundFrom` at a different grain (`buildAt` feeds
  // both the standing ground judged by `difference()` for surfeit AND the
  // maintained ground `pattern()` reads for moved), so it inherits the same
  // vulnerability at its old minimum, `window + 2`. At that size `burstiness`
  // (max over `window`-sized sub-windows) has exactly 3 candidate positions
  // regardless of `window`, so the bootstrap null comes back too narrow and an
  // ordinary next window clears it almost by construction — a false DEF·surfeit,
  // not a found one.
  //
  // MEASURED, 2026-08-05: isolating `clearOn: ["surfeit"]` (the exact
  // difference()-driven mechanism atmosphere.js's fix addresses) on iid noise,
  // hop=1, `window + 2` fires a spurious re-zero on 10-20% of trials across the
  // same two parameter sets atmosphere.js's own calibration used (window=5/
  // draws=256/tolerance=3 and window=6/draws=96/tolerance=2); at `3 * window`
  // it falls to 0/40 in both — and 0/40 at hop=4 too, so the fix is not an
  // artefact of one hop. (The shipped default, `clearOn: ["surfeit", "moved"]`,
  // still re-zeros at a real but much lower baseline rate at `3 * window` —
  // that residual is "moved"'s OWN reseeding-null resolution floor, already
  // budgeted for by turn.test.js's "A GROWING GROUND IS NOT A MOVING ONE",
  // not a remnant of this defect.)
  //
  // RAISED TO `10 * window`, 2026-08-05, alongside atmosphere.js's own second
  // fix (see its MIN_GROUND header) — `3 * window` fixed the iid near-
  // degenerate-null artifact above but left this organ exposed to the same
  // content-DEPENDENT one atmosphere.js's fix addresses: `buildAt` is fed real
  // production material through this exact `difference()`-driven surfeit path
  // (scripts/two-clearings.mjs, scripts/activation-clearings.mjs both drive
  // `runTurn` on `causalSurprisalSeries` output over real prose). MEASURED
  // (scripts/turn-fold-formation-min-ground-real-text-calibration.mjs §1,
  // `clearOn: ["surfeit"]`, Book IX and cookery-recipe excerpts alone — the
  // same real, single-topic, no-seam fixtures challenge-7 uses, gamma=0.999):
  // at `3 * window` through `9 * window`, at least one of the two real-text
  // negative controls falsely re-zeros on up to 20/20 seeds, purely from
  // causal-surprisal's content-independent upward drift, not a topic shift.
  // Only at `10 * window` do BOTH negative controls clear to 0/20 while the
  // real seam (Book IX -> cookery) is still found on 20/20 — for both
  // parameter sets atmosphere.js's own calibration used — and the region is a
  // plateau through `16 * window`, not a single lucky cell.
  const MIN_GROUND = 10 * window;
  const buildAt = (start, end, s) => {
    if (end - start < MIN_GROUND) return null;
    // ① NUL · Void · Clearing
    const built = clearVoid({
      material: cultivateVoid(material, end).slice(start),
      draws,
      window,
      seed: s + start,
      perturbation,
      statistic,
    });
    if (isGap(built)) return null;
    // ② SIG · Void · Tending
    return tendVoid(built).viable ? built : null;
  };

  // Concede the standing region — shared by a failure that clears tolerance
  // and by a scheduled release, so the reset discipline lives in one place.
  const concede = (i, clearedBy) => {
    const closing = tendVoid(g);
    regions.push({
      start: regionStart,
      end: i,
      tended,
      apertureOpen: apertureAtOpen,
      apertureClose: closing.aperture,
      opened: closing.aperture > apertureAtOpen, // widened = encounter; narrowed = extraction
      aperture: Object.freeze(apertureSeries), // the sign as a series, not two samples (SEED.md §8)
      acts: actsThisRegion,
      clearedBy,
      // The open warmth's provenance: whether this region's present had a
      // past to open with. "own" is never firstness claimed — it is the
      // engine saying it received nothing, so firstness is the caller's to
      // declare, never derived here.
      openedFrom: regionOpenCarried ? "carried" : "own",
    });
    events.push({
      at: i,
      op: "REC",
      domain: REC_GROUND.domain,
      terrain: REC_GROUND.terrain,
      stance: REC_GROUND.stance,
      clearedBy,
    });
    regionStart = i;
    g = null;
    gEnd = null;
    bornAt = null;
    clearings = 0;
    tended = 0;
    apertureSeries = [];
    actsThisRegion = 0;
    belowFlags.length = 0;
    sinceSlackSample = 0;
    apertureReceived = closing.aperture; // the warmth flows across the boundary
  };

  for (const unit of units) {
    const i = unit.start;
    if (i < window) continue;

    if (!g) {
      g = buildAt(regionStart, i, seed);
      if (!g) continue;
      gEnd = i;
      bornAt = i;
      // APERTURE FLOWS: a region opens with the warmth the last region closed
      // with — the reading's own settled past received by its present
      // (belief.js WORLDS.this). The past crosses TURN boundaries through the
      // register, so the first region of a later turn opens with the previous
      // turn's closing warmth, and only a region that received nothing opens
      // cold, against its own fresh ground: firstness is received, never
      // derived. Not a gate: tendVoid's viability still decides everything.
      regionOpenCarried = carried != null || apertureReceived != null;
      apertureAtOpen = carried ?? apertureReceived ?? tendVoid(g).aperture;
    }

    // Awareness's own anchor (SEED.md §7): rebuilt every act over the WHOLE
    // accumulated extent, never reset by attention's region conceding, and
    // never handed to `difference()` — `anchor()` marks it unfit for that,
    // and the guard lives in nul, not here. Attention narrowing (or its
    // region conceding) leaves this reach untouched, because nothing above
    // ever writes to `regionStart` before reaching here.
    if (awareness) {
      const ambientBuilt = buildAt(0, i, seed);
      ambient = ambientBuilt ? anchor(ambientBuilt) : ambient;
      ambientAperture.push(ambient ? tendVoid(ambient).aperture : null);
    }

    let sum = 0;
    for (let j = i; j < i + window; j++) sum += material[j];
    const observed = sum / window;

    // ⑦ DEF · Clearing, first failure: the figure exceeds what the ground can place.
    const d = difference(observed, g);
    let failure = null;
    if (
      clearOn.includes("surfeit") &&
      isGap(d) &&
      d.gap === "exceeds_witness" &&
      d.direction === "above"
    )
      failure = { mode: "surfeit", observed, support: d.support };

    // The missing remedy: a run of censored-below placements is a finding
    // (`slack_ground`), never a clearing. Reported into `findings`, which the
    // clearing machinery below never reads.
    if (wantsRegularity) {
      const below =
        isGap(d) && d.gap === "exceeds_witness" && d.direction === "below";
      sinceSlackSample++;
      if (sinceSlackSample >= slackStride) {
        sinceSlackSample = 0;
        belowFlags.push(below);
        let run = 0;
        for (let k = belowFlags.length - 1; k >= 0 && belowFlags[k]; k--) run++;
        if (run >= tolerance) {
          const threshold = slackRunNull(
            belowFlags,
            reseeds,
            seed + regionStart,
          );
          if (run > threshold) {
            findings.push({
              at: i,
              ...gap("slack_ground", {
                runLength: run,
                tolerance,
                threshold,
                reseeds,
              }),
            });
            belowFlags.length = 0;
          }
        }
      }
    }

    // ⑧ EVA · Tending is also the only place the SECOND failure becomes
    // visible: you have to actually rebuild the ground over the region as it
    // now stands before you can ask whether it moved. So the maintenance act
    // happens here unconditionally, and what it returns is read twice —
    // once as the maintained ground, once as evidence about the old one.
    const maintained = buildAt(regionStart, i, seed);
    apertureSeries.push(
      maintained ? tendVoid(maintained).aperture : tendVoid(g).aperture,
    );
    actsThisRegion++;
    let drift = null;
    if (wantsMoved && maintained && gEnd != null && gEnd < i) {
      // The null is BEFORE's own reseeding variation over BEFORE's own
      // material — never the grown material, which would make `after` a
      // member of its own null and force moved=false structurally.
      drift = pattern({
        before: g,
        after: maintained,
        material: material.slice(regionStart, gEnd),
        reseeds,
      });
      if (isGap(drift))
        driftGaps.set(drift.gap, (driftGaps.get(drift.gap) || 0) + 1);
      else if (drift.moved && !failure)
        failure = {
          mode: "moved",
          displacement: drift.displacement,
          reseedNull: drift.reseedNull,
          opened: drift.opened,
        };
    }

    // "Release" (SEED.md §9): a ground may concede on a cadence, still
    // working, and not only on failure. No competing signal — a failure this
    // act takes priority, and release only ever fires on an otherwise-quiet
    // act, so it is never a way to dodge `tolerance`.
    const released =
      !failure &&
      wantsRelease &&
      bornAt != null &&
      bornAt > regionStart &&
      i - bornAt >= bornAt - regionStart;

    if (failure) {
      clearings++;
      events.push({
        at: i,
        op: "DEF",
        domain: DEF_GROUND.domain,
        terrain: DEF_GROUND.terrain,
        stance: DEF_GROUND.stance,
        ...failure,
      });

      // A failing ground is not maintained. The standing ground is held
      // fixed while consecutive failures accumulate, for both modes alike —
      // otherwise `tolerance` would be counting against a moving target.
      if (clearings >= tolerance) concede(i, failure.mode);
    } else if (released) {
      // Scheduled, uncriterioned — it does not wait for `tolerance` because
      // there is no uncertainty to accumulate evidence against; the cadence
      // itself is the whole criterion.
      concede(i, "release");
    } else {
      clearings = 0;
      tended++;
      events.push({
        at: i,
        op: "EVA",
        domain: EVA_GROUND.domain,
        terrain: EVA_GROUND.terrain,
        stance: EVA_GROUND.stance,
      });
      if (maintained) {
        g = maintained;
        gEnd = i;
      }
    }
  }

  const last = g ?? buildAt(regionStart, material.length, seed);
  const lastAperture = last ? tendVoid(last).aperture : null;
  // The last region opens with the warmth carried across the boundary — or its
  // own fresh ground, but only if it is genuinely the first (nothing carried
  // AND nothing built in the loop). `apertureAtOpen` may be stale here: if the
  // previous region's close consumed the last buildable unit, this region
  // never opened in the loop, so the carried close — from the last region or
  // from the prior turn's register — is what it opens with.
  const lastOpen = apertureReceived ?? apertureAtOpen ?? carried;
  const lastOpenCarried =
    apertureReceived != null ||
    (apertureAtOpen != null && regionOpenCarried) ||
    (apertureAtOpen == null && carried != null);
  regions.push({
    start: regionStart,
    end: material.length,
    tended,
    apertureOpen: lastOpen,
    apertureClose: lastAperture,
    aperture: Object.freeze(apertureSeries),
    acts: actsThisRegion,
    opened:
      lastAperture != null && lastOpen != null ? lastAperture > lastOpen : null,
    clearedBy: null, // the last region is ended by the material running out, not by a failure
    openedFrom: lastOpenCarried ? "carried" : "own",
  });

  const defs = events.filter((e) => e.op === "DEF");
  return {
    grain,
    clearOn,
    field: {
      units: units.length,
      coverage,
      adjacencyOf: (i) => adjacency.get(i) ?? [],
    },
    regions,
    events,
    // "regularity"'s findings, apart from `events`: a finding is not an act
    // the clearing machinery took, and folding it into the same channel would
    // be exactly the conflation SEED.md #8 refuses.
    findings,
    clearings: defs.length,
    clearingsBy: {
      surfeit: defs.filter((e) => e.mode === "surfeit").length,
      moved: defs.filter((e) => e.mode === "moved").length,
    },
    driftGaps: Object.fromEntries(driftGaps),
    rezeros: events.filter((e) => e.op === "REC").length,
    // "release"'s own tally, apart from a failure's — a scheduled concession
    // and a failed one are different facts even though both re-zero.
    releases: events.filter((e) => e.op === "REC" && e.clearedBy === "release")
      .length,
    tendings: events.filter((e) => e.op === "EVA").length,
    // Awareness's own trace (SEED.md §7) — null throughout unless `awareness`
    // was asked for. `ambientGround` is exposed so a caller (or a test) can
    // confirm the anchor refuses to be perceived through: `difference(x,
    // ambientGround)` gaps `anchor_ground`.
    ambientAperture: awareness ? Object.freeze(ambientAperture) : null,
    ambientGround: awareness ? ambient : null,
    // The register the next turn receives: the reader's own settled past
    // (one closing warmth — never a rollup of the trail) plus the
    // measurement's own declared choice (the perturbation). The host holds
    // the sequence of turns; this is what it hands forward. A register built
    // on a different perturbation is refused, never mixed (SEED.md #6).
    close: lastAperture,
    register: Object.freeze({
      giver,
      close: lastAperture,
      perturbation,
    }),
  };
};
