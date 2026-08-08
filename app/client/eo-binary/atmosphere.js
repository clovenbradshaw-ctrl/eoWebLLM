// eoreader6 · loops/atmosphere — TURN 1's interpretation cell:
// Interpretation × Ground = ATMOSPHERE. The first place all three tiers can
// actually run, because its existence tier (nul's VOID) is the only one
// already solid.
//
// THE NINE FIRE IN MODE ORDER, and stance is entailed by (mode, grain) —
// never chosen. At Ground grain every Differentiate op is Clearing, every
// Relate op is Tending, every Generate op is Cultivating. So this cell's
// three operators are fully determined:
//
//   DEF · Atmosphere · Clearing     where does the accumulated ground FAIL?
//                                   -> difference() returning exceeds_witness
//   EVA · Atmosphere · Tending      does the stretch still cohere? the ground
//                                   is MAINTAINED as new material arrives
//   REC · Atmosphere · Cultivating  re-zero: a new ambient ground begins here
//                                   -> reZero(). CUBE.md's Ramakrishna cell.
//
// An atmosphere boundary is therefore not a topic label or a punctuation
// rule — it is the position at which a reader's accumulated ground stops
// working and must be rebuilt. Causal (only material already read),
// reader-relative, and medium-agnostic: this would segment a symphony into
// movements by the same operation it uses to segment prose into scenes.
//
// `tolerance` is declared, never defaulted, for the same reason draws and
// window are: it is the resolution of REFUSAL — how many consecutive
// clearings before the ground is conceded to be the wrong one. A tolerance
// of 1 re-zeros on every outlier and finds boundaries everywhere; a
// tolerance the length of the material finds none.

import {
  ground,
  difference,
  isGap,
  gap,
  volume,
  PERTURBATIONS,
} from "./nul.js";
import { cellOf } from "./operators.js";

// The cells this organ occupies on the operator grid (engine/operators.js):
// DEF · Atmosphere · Clearing, EVA · Atmosphere · Tending, REC · Atmosphere ·
// Cultivating — the three refuse/witness/concede acts of the one regime.
// Declared, checked by conformance. The event cells below are derived from
// the algebra, never hand-listed.
export const CELLS = Object.freeze([
  Object.freeze({ op: "DEF", grain: "Ground" }),
  Object.freeze({ op: "EVA", grain: "Ground" }),
  Object.freeze({ op: "REC", grain: "Ground" }),
]);

const DEF_GROUND = cellOf("DEF", "Ground"); // Atmosphere · Clearing
const REC_GROUND = cellOf("REC", "Ground"); // Atmosphere · Cultivating

/**
 * A ground's relation to one arrival — one per Interpretation×Ground operator,
 * so the vocabulary is the algebra's and not a second, parallel one. Three,
 * never two: PLACED and OTHER are the easy poles, and STRAINED between them is
 * the state `tolerance` exists to hold open. See createRegimeTracker's header.
 * A fourth case — no ground to judge against — is a typed gap, not a member
 * here, because it is a refusal rather than a relation.
 */
export const PLACEMENT = Object.freeze({
  PLACED: "placed", // EVA · Tending
  STRAINED: "strained", // DEF · Clearing
  OTHER: "other", // REC · Cultivating
});

/**
 * A run of consecutive below-censorings is expected at some length by
 * chance, and a routing rule that fires on raw run length is the one
 * uncalibrated act in the system (SEED.md #3, again). This is the null for
 * it: shuffle the run's own below/not-below sequence — nul's own
 * `shuffle`, the same perturbation licensed for order questions — and take
 * the 95th percentile of the longest run each shuffle produces. Modelled on
 * `holon_level`'s `percentile95` device (conformance/calibration.test.js)
 * rather than inventing a new shape.
 *
 * `flags` must already be sampled coarsely enough that consecutive entries
 * are independent trials. Adjacent PUSHES are not: a censoring at t and one
 * at t+1 share `window - 1` of the material their windows are built from,
 * so shuffling raw per-push flags is not a null of anything — it is
 * shuffling an artefact of the overlap. Sampled every `window` pushes, the
 * windows compared no longer share material, and a shuffle of that sequence
 * is a real null. (Measured: at stride 1 the false-alarm rate on iid noise
 * runs 55-90%; at stride `window` it holds at 0-3%. See the calibration
 * test for the numbers this cost to find.)
 */
export const slackRunNull = (flags, reseeds, seed) => {
  const asNumbers = flags.map((f) => (f ? 1 : 0));
  const longestRun = (bits) => {
    let run = 0;
    let longest = 0;
    for (const b of bits) {
      if (b) {
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    return longest;
  };
  const runs = [];
  for (let r = 0; r < reseeds; r++)
    runs.push(longestRun(PERTURBATIONS.shuffle(asNumbers, seed + r * 7919)));
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length * 0.95)];
};

/**
 * Is this series stationary enough for a windowed ground to BE a ground?
 *
 * WHAT THIS EXISTS TO CATCH, measured, not hypothetical. `emergence/
 * activation.js`'s `recalled` channel climbs monotonically across a reading —
 * 0 through the first ~15 frames of Frankenstein, ~127 by frame 140 — because
 * posting lists grow as the read proceeds: more prior frames exist to answer,
 * so more answer. Feed that to `createRegimeTracker` and every ground built
 * over a trailing window is exceeded by what follows STRUCTURALLY, whatever
 * the content says. Clearings accumulate, `tolerance` trips, the ground
 * rebuilds one level higher, and the cycle repeats at a period fixed by
 * `groundFrom`'s own `10*window` minimum. Measured on the committed
 * Frankenstein fixture: re-zeros at frames 133, 255, 377, 499, 621, 743 —
 * spaced exactly 122 apart — and 30 shuffled-order controls returned a mean
 * of 6.00 re-zeros with standard deviation 0.00, identical to the real
 * reading. A metronome, not an Atmosphere. The trend was never cleared out of
 * the ground; it BECAME the ground.
 *
 * THE TEST. Compare the mean of the last quarter against the mean of the
 * first quarter, ranked against a null built by shuffling the series' own
 * values — nul's licensed perturbation for order questions, the same device
 * `slackRunNull` above already uses on its own run of flags.
 *
 * This is a DIRECT test of the property that matters, not a proxy for it. The
 * question a ground-builder needs answered is "is the ground built at the
 * start still a valid ground at the end," and comparing the ends asks exactly
 * that. A trend ends far from where it started; a burst rises and returns.
 *
 * FOUR ALTERNATIVES WERE TESTED AND REFUSED. Kept on the record with their
 * measured numbers so the next person does not re-walk them:
 *
 *   HALF-SPLIT mean comparison — tests the wrong property. Any burst sitting
 *     past the midpoint lifts the second half's mean, and most bursts do.
 *   SPEARMAN rank correlation with position — degenerate on this material.
 *     `recalled` is mostly ties at zero (68 of 83 values in the fixture that
 *     exposed it), which drags rho to 0.95 for a burst that plainly returns.
 *   REVERSAL asymmetry (does the reading depend on which way time runs) —
 *     measured fwd/rev re-zero counts: Frankenstein 6/0, mid-burst 1/1,
 *     end-burst 1/0. Separates the trend, but flags the end-burst too,
 *     because an end-burst reversed becomes a START-burst that fires before
 *     `groundFrom`'s 10*window minimum has been met.
 *   VALUE-SHUFFLE invariance (is the output blind to order) — measured real
 *     vs shuffled-null: Frankenstein 6 vs 0.00, mid-burst 1 vs 0.13,
 *     end-burst 1 vs 0.00. Every signal case exceeds its null, so this
 *     separates signal from noise but not trend from burst.
 *
 * THE END-QUARTER CASE IS NOT A FALSE POSITIVE. It is an identity, and this
 * is provable rather than arguable: a burst occupying the final quarter and
 * the PREFIX OF A TREND are the same series. Construct both — sixty flat
 * values followed by a rise — and they are byte-identical. No statistic can
 * separate them because there is no difference to separate; the evidence that
 * would distinguish "this returns" from "this is the new level" is the
 * material after the end, which a causal reader does not have and will not
 * invent. Refusing is therefore correct, not conservative-but-wrong: the
 * honest answer to "is this a trend" at that moment is that the reading
 * cannot yet tell, and a gap is what this engine says when it cannot tell.
 * Once the return arrives the same series is admitted (conformance holds
 * both halves of this).
 *
 * A GAP, NEVER A CORRECTION. This returns a typed gap or null. It does not
 * detrend, difference, or rescale the series — repairing a caller's material
 * silently is how a measurement stops being the caller's. What to do about a
 * trending channel is the caller's declaration to make.
 *
 * `reseeds` and `seed` are declared by the caller for the same reason every
 * other null's resolution is.
 */
export const stationarityGap = (values, { reseeds, seed = 0 } = {}) => {
  if (!Number.isInteger(reseeds) || reseeds < 2)
    throw new TypeError(
      "atmosphere: reseeds is the resolution of the stationarity null and is never a default",
    );
  const xs = [...values].filter(
    (x) => typeof x === "number" && Number.isFinite(x),
  );
  // Two quarters of at least two points each, or there is nothing to compare.
  if (xs.length < 8) return null;

  const quarter = Math.max(2, Math.floor(xs.length / 4));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const split = (a) =>
    Math.abs(mean(a.slice(a.length - quarter)) - mean(a.slice(0, quarter)));

  const observed = split(xs);
  const nulls = [];
  for (let r = 0; r < reseeds; r++)
    nulls.push(split(PERTURBATIONS.shuffle(xs, seed + r * 7919)));
  nulls.sort((a, b) => a - b);
  const threshold = nulls[Math.floor(nulls.length * 0.95)];

  if (!(observed > threshold)) return null;
  return gap("trending_material", {
    why: "the halves of this window differ by more than reordering the same values produces — a ground built over it is a lagging estimate of a slope, not a rebuilt nothing",
    observed,
    threshold,
    reseeds,
    n: xs.length,
  });
};

/**
 * NOTE FOR ANYONE WIRING A NEW CHANNEL INTO THIS ORGAN. The clearing below is
 * SURFEIT — `exceeds_witness` above the ground, accumulated to `tolerance`.
 * scripts/RESULTS.md's own headline table measures surfeit alone at 4/24
 * chapter boundaries, p≈0.84 against rotated chapters, and says so plainly:
 * "surfeit alone is at chance." The clearing that beat that null is `moved`
 * — did the ground itself shift under maintenance — at 19/24, p≈0.000, and it
 * lives in `loops/turn.js::runTurn` (`clearOn: ["moved"]`), not here. Wiring a
 * channel to THIS function and expecting boundary detection reproduces a
 * result this project already measured at chance. Check `stationarityGap`
 * above on your series first, then check which clearing you actually want.
 */
export const readAtmosphere = ({
  material,
  window,
  draws,
  tolerance,
  hop = 1,
  seed = 0,
  statistic = "burstiness",
}) => {
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

  const regions = [];
  const events = [];
  let regionStart = 0;
  let g = null;
  let clearings = 0;
  let tended = 0;
  let apertureAtOpen = null; // equanimity toward what arises and passes (SEED.md §5): a closed region is reported with the same prominence as an open one

  // MINIMUM VIABLE GROUND, measured rather than assumed — the same
  // discipline `slackRunNull`'s header documents for the other channel. At
  // `window + 2` elements (the smallest span `burstiness` can be computed
  // over at all) a max-over-`window`-sub-windows statistic has exactly 3
  // candidate positions to draw from regardless of `window`, so shuffling
  // barely moves the sample and the bootstrap null comes back near
  // zero-width — not the exact-zero `ground()` already refuses as
  // `degenerate_ground`, but narrow enough that an ordinary next window
  // clears it almost by construction. That is a false REC, not a found one,
  // and because a fresh ground is rebuilt from this same minimum immediately
  // after every re-zero (not only at the start of a material), a too-small
  // minimum manufactures re-zeros on a content-independent clock. MEASURED,
  // 2026-08-05 (scripts/adversarial/challenge-7-rec-re-zero-atmosphere-boundary-correctn.mjs
  // and its calibration sweep): on iid noise, causal re-zero fires spuriously
  // at `window + 2` on 12.5-27.5% of trials across two independently-used
  // parameter sets (window=5/draws=256/tolerance=3 and window=6/draws=96/
  // tolerance=2); at `3 * window` it falls to 0-10%.
  //
  // `3 * window` turned out to be necessary but not sufficient. It fixed the
  // content-independent clock above and left a second, content-DEPENDENT
  // artifact standing: a real, single-topic passage (Homer's Odyssey, Book
  // IX alone — no seam, no shift) still re-zeroed at the very first chunk a
  // ground became legally buildable, on every one of 20 seeds tried, at
  // `3 * window` AND at every multiple up to `8 * window` — a minimal-width
  // ground is still fragile against ordinary local variance in real prose
  // even once the iid-noise clock is gone. RAISED TO `10 * window`.
  // MEASURED, 2026-08-05 (scripts/causal-surprisal-gamma-calibration.mjs,
  // section 2): at `10 * window` (paired with causalSurprisalSeries's own
  // `gamma` fix, perceiver/text/material.js — ground size alone does not
  // buy this back; the same script's section 1 shows drift still clears a
  // healthy ground at minimums up to `20 * window` when the series itself is
  // undecayed) the false-alarm rate on BOTH of challenge-7's real-text
  // negative controls (Book IX alone, cookery alone) falls to 0/20 seeds,
  // the real seam between them is still found on 20/20, and the region is a
  // plateau from `9 * window` to at least `16 * window` — not a single
  // lucky cell. Section 3 of the same script confirms the raise costs
  // nothing on iid noise: 0-1/40 fired at `3 * window`, 0/40 at `10 * window`
  // and `12 * window`, on both parameter sets above. Still no default: it is
  // `window` itself, declared, not a derived multiple of the material's
  // length — and still a real cost worth naming, not hidden: a caller now
  // waits `10 * window` arrivals (60, at speak-from-here.mjs's window=6)
  // before atmosphere can report anything at all.
  const MIN_GROUND = (window) => 10 * window;

  const groundFrom = (start, end) => {
    if (end - start < MIN_GROUND(window)) return null;
    const built = ground({
      material: material.slice(start, end),
      draws,
      window,
      statistic,
      seed: seed + start,
    });
    return isGap(built) ? null : built;
  };

  for (let i = window; i + window <= material.length; i += hop) {
    if (!g) {
      g = groundFrom(regionStart, i);
      if (!g) continue;
      apertureAtOpen = volume(g);
    }

    // The observation must be commensurate with the ground's own statistic:
    // burstiness is a MAX-over-windows, so a real windowed mean is the
    // comparable quantity — a raw single value is not. (Learned the hard way
    // several times over; see span-golden-run.mjs and chapter-scene-level.mjs.)
    let sum = 0;
    for (let j = i; j < i + window; j++) sum += material[j];
    const observed = sum / window;

    const d = difference(observed, g);

    // Only SURFEIT clears. Burstiness is a max-over-windows statistic, so an
    // ordinary real window sits BELOW the ground's support almost always —
    // that is regularity, and SEED.md warns in as many words that it must not
    // be mistaken for surfeit. Counting "below" as a clearing re-zeroed on
    // essentially every step (measured: 28 regions over 3 planted regimes).
    if (isGap(d) && d.gap === "exceeds_witness" && d.direction === "above") {
      // DEF · Clearing — this material does not belong to the ground so far
      clearings++;
      events.push({
        at: i,
        op: "DEF",
        domain: DEF_GROUND.domain,
        terrain: DEF_GROUND.terrain,
        stance: DEF_GROUND.stance,
        direction: d.direction,
      });

      if (clearings >= tolerance) {
        // REC · Cultivating — concede the ground and grow a new one here.
        // Widening is encounter, narrowing is extraction, and NULL (the sign
        // not earned, because an open value was never sampled) is a third
        // outcome — never folded into either (SEED.md §5). Reported with the
        // same prominence a still-open region gets below.
        const closingAperture = volume(g);
        regions.push({
          start: regionStart,
          end: i,
          tended,
          apertureOpen: apertureAtOpen,
          apertureClose: closingAperture,
          opened:
            apertureAtOpen != null ? closingAperture > apertureAtOpen : null,
        });
        events.push({
          at: i,
          op: "REC",
          domain: REC_GROUND.domain,
          terrain: REC_GROUND.terrain,
          stance: REC_GROUND.stance,
          reason: "ground conceded after repeated clearing",
        });
        regionStart = i;
        g = null;
        clearings = 0;
        tended = 0;
        apertureAtOpen = null;
      }
    } else {
      // EVA · Tending — the ground holds; maintain it against the new material
      clearings = 0;
      tended++;
      const maintained = groundFrom(regionStart, i);
      if (maintained) g = maintained;
    }
  }

  const last = g ?? groundFrom(regionStart, material.length);
  const lastAperture = last ? volume(last) : null;
  // The final region is closed by the material running out, not by a
  // failure — as reportable a result as one that closed on a clearing, and
  // not a worse read than one that is still open (SEED.md §5).
  regions.push({
    start: regionStart,
    end: material.length,
    tended,
    apertureOpen: apertureAtOpen,
    apertureClose: lastAperture,
    opened:
      apertureAtOpen != null && lastAperture != null
        ? lastAperture > apertureAtOpen
        : null,
  });

  return {
    regions,
    events,
    clearingCount: events.filter((e) => e.op === "DEF").length,
    rezeroCount: events.filter((e) => e.op === "REC").length,
  };
};

/**
 * The same three operators, driven one arrival at a time.
 *
 * `readAtmosphere` above segments material that has already fully arrived: at
 * position i it compares a ground built on [regionStart, i) against a window
 * [i, i+window) that lies AHEAD of the ground. That is fine for segmentation
 * and fatal for prediction — a predictor that peeks at [i, i+window) to decide
 * where its regime starts has already seen the value it is about to be scored
 * on. So this is not a wrapper around the function above and must not become
 * one: the ground precedes the observation in both, but here BOTH lie strictly
 * in the past, ground on [regionStart, t−window) and observation on
 * [t−window, t). The decision rule is identical; only the horizon moves.
 *
 * Feed it revealed values with `push`, in order. `regimeStart` is then the
 * index at which the current ground was last conceded — the only thing a
 * caller needs to know to answer "how much of my history is contemporary with
 * itself right now."
 *
 * `tolerance` is declared for the same reason it is declared above: it is the
 * resolution of refusal, and a default would decide in advance how eager this
 * is to concede.
 *
 * `push` also returns `placement`: this ground's relation to THIS arrival, as
 * one of three, because the three Interpretation×Ground operators already are
 * that distinction and collapsing them loses the middle one.
 *
 *   PLACED    EVA · Tending      the ground places the arrival. No news.
 *   STRAINED  DEF · Clearing     the arrival exceeds this ground, but the
 *                                ground still stands — a correction, not a
 *                                different world. `tolerance` exists to hold
 *                                exactly this state open.
 *   OTHER     REC · Cultivating  enough strain has accumulated to concede;
 *                                the ground is given up and regrown here.
 *
 * This is eoreader4.2's monitor triad (enactor/monitor.js: SELF /
 * SELF_MISMATCH / WORLD) without the authorship it assumed. There, SELF meant
 * "I emitted this and sensed it return." This engine emits nothing, so the
 * claim available here is weaker and is named for what it actually is: the
 * GROUND places the arrival, not "the arrival is mine." Self/world is the
 * special case this collapses into once there is an author to close the loop
 * — see SEED.md's relativity debt, which is why that author does not exist
 * yet. A boolean here would fuse STRAINED and OTHER, which is the difference
 * between a ground being corrected and a ground being abandoned.
 *
 * When there is no ground to judge against at all — too little material has
 * arrived to span a window, or one could not be built over the region —
 * `placement` is a TYPED GAP, never PLACED. Reporting "no ground yet" as "the
 * ground held" is a silently wrong number of exactly the kind a typed gap
 * exists to refuse.
 */
/**
 * `findOn` is an ABLATION HANDLE like `clearOn` in `loops/turn.js` — an
 * opt-in, never a default. Its one legal member today is `"regularity"`:
 * sustained censored-below, reported as a typed finding and never as an
 * action. Reusing `tolerance` (the resolution of refusal) rather than
 * inventing a second constant — slackness is refusal in the other
 * direction — and reusing `reseeds` (the resolution of pattern) for the
 * finding's own null, per `slackRunNull` above.
 */
export const createRegimeTracker = ({
  window,
  draws,
  tolerance,
  seed = 0,
  statistic = "burstiness",
  findOn = [],
  reseeds,
}) => {
  if (!Number.isInteger(tolerance) || tolerance < 1)
    throw new TypeError(
      "atmosphere: tolerance is the resolution of refusal and is never a default",
    );
  if (!Number.isInteger(window) || window < 2)
    throw new TypeError(
      "atmosphere: window is the reach of the present and is never derived from material length",
    );
  if (!Number.isInteger(draws) || draws < 2)
    throw new TypeError(
      "atmosphere: draws is the resolution of testimony and is never a default",
    );
  const findsRegularity = findOn.includes("regularity");
  if (findsRegularity && (!Number.isInteger(reseeds) || reseeds < 2))
    throw new TypeError(
      "atmosphere: reseeds is the resolution of the slack-run null and is never a default",
    );

  const seen = [];
  let regimeStart = 0;
  let g = null;
  let clearings = 0;
  let rezeroCount = 0;

  // Regularity's own counter, held APART from `clearings`: the two poles are
  // opposite findings (SEED.md #8, Amendment II) and must not share one
  // tally. Sampled every `window` pushes rather than every push — adjacent
  // pushes share window-1 of their material, so a run over raw pushes is
  // autocorrelated by construction and no shuffle of it is a null of
  // anything (see `slackRunNull`). Reset whenever the ground is conceded: a
  // fresh ground inherits no predecessor's history of slack.
  const belowFlags = [];
  let sinceSlackSample = 0;

  // Same measured minimum as readAtmosphere's `groundFrom` — see its header
  // comment for the calibration. Duplicated here rather than shared because
  // the two closures already are (material.slice vs seen.slice); this keeps
  // that existing duplication rather than adding a new cross-closure import
  // for one constant.
  const groundFrom = (start, end) => {
    if (end - start < 10 * window) return null;
    const built = ground({
      material: seen.slice(start, end),
      draws,
      window,
      statistic,
      seed: seed + start,
    });
    return isGap(built) ? null : built;
  };

  const push = (x) => {
    if (typeof x !== "number" || !Number.isFinite(x))
      throw new TypeError(
        "atmosphere: a regime tracker consumes finite numbers only",
      );
    seen.push(x);
    const t = seen.length;
    // Both the ground and the observed window must end at or before t. No
    // ground yet is a typed gap, NOT "the ground held" — see the header.
    if (t < window)
      return {
        regimeStart,
        rezeroed: false,
        placement: gap("no_ground", {
          why: "less material has arrived than one window of reach",
          arrived: t,
          window,
        }),
        aperture: g ? volume(g) : null,
        finding: null,
      };

    const built = groundFrom(regimeStart, t - window);
    if (built) g = built;
    if (!g)
      return {
        regimeStart,
        rezeroed: false,
        placement: gap("no_ground", {
          why: "no ground could be built over the region so far",
          regimeStart,
          upTo: t - window,
        }),
        aperture: null,
        finding: null,
      };

    // Commensurate with the ground's own statistic: burstiness is a
    // max-over-windows, so only a real windowed mean is comparable to it.
    let sum = 0;
    for (let j = t - window; j < t; j++) sum += seen[j];
    const d = difference(sum / window, g);

    // Which censorings clear is a property of the (statistic, observation) PAIR,
    // not a constant. Against `burstiness` the observation is one window's mean
    // and the samples are a max over many, so "below" is where an ordinary
    // window lives (measured: 79-87% of steps) and only surfeit can clear.
    // Against `windowMean` the null is the SAME functional as the observation,
    // so both censorings look like findings and a level DROP is as real as a
    // rise (Amendment II) — UNLESS regularity has somewhere else to go. Once
    // `findOn` asks for it, below is routed to the slack channel below
    // instead of the clearing channel: SEED.md #8 is exact on this point —
    // "censored above is surfeit and is the trigger to re-zero. Censored
    // below is regularity and must not be mistaken for it" — and treating a
    // level drop as a clearing was always that mistake wearing "two-sided"
    // as a name. See nul's `windowMean`.
    const twoSided = statistic === "windowMean" && !findsRegularity;
    const strained =
      isGap(d) &&
      d.gap === "exceeds_witness" &&
      (twoSided || d.direction === "above");

    // The missing remedy (SEED.md's Amendment II, made mechanical): a run of
    // censored-below placements this ground never earns a clearing for is a
    // finding in its own right — reported, never acted on. Burstiness's
    // below-censoring is near-universal (79-87% of ordinary steps) and
    // therefore uninformative here; this is calibrated for statistics whose
    // below-censoring is a genuine, non-chronic event, `windowMean` among
    // them. See conformance for the measured false-alarm rate.
    let finding = null;
    if (findsRegularity) {
      const below =
        isGap(d) && d.gap === "exceeds_witness" && d.direction === "below";
      sinceSlackSample++;
      if (sinceSlackSample >= window) {
        sinceSlackSample = 0;
        belowFlags.push(below);
        let run = 0;
        for (let k = belowFlags.length - 1; k >= 0 && belowFlags[k]; k--) run++;
        if (run >= tolerance) {
          const threshold = slackRunNull(
            belowFlags,
            reseeds,
            seed + regimeStart,
          );
          if (run > threshold) {
            finding = gap("slack_ground", {
              runLength: run,
              tolerance,
              threshold,
              reseeds,
            });
            belowFlags.length = 0;
          }
        }
      }
    }

    let rezeroed = false;
    if (strained) {
      // DEF · Clearing. Only surfeit clears — censored BELOW is regularity,
      // and counting it here re-zeros on nearly every step (SEED.md #8).
      clearings++;
      if (clearings >= tolerance) {
        // REC · Cultivating — concede the ground, grow the next one here.
        regimeStart = t - window;
        g = null;
        clearings = 0;
        rezeroCount++;
        rezeroed = true;
        belowFlags.length = 0;
        sinceSlackSample = 0;
      }
    } else {
      clearings = 0; // EVA · Tending
    }
    return {
      regimeStart,
      rezeroed,
      placement: rezeroed
        ? PLACEMENT.OTHER
        : strained
          ? PLACEMENT.STRAINED
          : PLACEMENT.PLACED,
      aperture: g ? volume(g) : null,
      finding,
    };
  };

  return {
    push,
    get regimeStart() {
      return regimeStart;
    },
    get rezeroCount() {
      return rezeroCount;
    },
    get aperture() {
      return g ? volume(g) : null;
    },
  };
};
