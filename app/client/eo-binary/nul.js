// eoreader6 · nul — the only module.
//
// One operation: difference against a nothing constructed by perturbing what is
// present. Three uses, distinguished only by what the difference is measured
// against:
//
//   figure   — difference from its own ground
//   pattern  — the difference that figure made to the next ground
//   level    — the difference one figure makes to another's ground   (not here yet)
//
// Pattern is Bateson's: a difference that makes a difference. Not "the same
// difference again" — that would need identity, which needs matching, which is
// string-thinking in a numeric coat. A figure earns pattern by changing what
// happens next, and the only next available is the ground.
//
// Two numbers are declared, never defaulted, because together they are the whole
// physiology: `draws` is the resolution of testimony (the finest rank sayable is
// 1/draws), and `reseeds` is the resolution of pattern. The third — how much
// material a ground is built over — is NOT the seed's to choose. Whoever hands
// material in has already declared the extent.
//
// Pure: no clock, no randomness, no I/O, no ambient state.
//
// Read SEED.md first. Especially before adding anything.

// The cells this organ occupies on the operator grid (engine/operators.js):
// the core act at each of its three uses. Declared, checked by conformance.
export const CELLS = Object.freeze([
  Object.freeze({ op: "NUL", grain: "Ground" }),
  Object.freeze({ op: "EVA", grain: "Figure" }),
  Object.freeze({ op: "REC", grain: "Ground" }),
]);

const GAP = Symbol.for("eoreader6.gap");

// Every entry below is the same act at a different grain: refusing a claim.
// See CUBE.md, "why this instrument earns its keep" — checked against real
// exemplars, not asserted.
export const GAP_TYPES = Object.freeze([
  "no_ground", // a figure without the perturbation that made its ground
  "kept_ground", // asked to perceive through a ground held for testimony
  "unreceived_origin", // cites neither the material it perturbed nor a giver
  "degenerate_ground", // zero width: a null that would clear anything
  "undeclared", // a resolution was left to a default
  "unknown_spec", // no such perturbation or statistic
  "empty_material",
  "exceeds_witness", // the rank is censored — the ground cannot place it
  "made_no_difference", // perceived, and therefore not testimony
  "unstable", // level()'s cross-measurement failed — the two grounds share no comparable footing
  "incommensurate_extent", // a null built over a different amount of material than the thing it is the null FOR
  "missing_kind_prior", // emergence/people: the reader has no received understanding of this population as a kind — a typed gap, never a silently wrong number
  "slack_ground", // sustained regularity: a run of censored-below placements longer than reseeding noise explains. A finding, not a failure — the remedy is investigation at finer grain, never reZero.
  "anchor_ground", // asked to perceive through a ground held only to be tended, never judged through (SEED.md §7's ambient ground)
  "no_candidate", // host/sing: the reader's own search found nothing it has not already met — the run is over, and the ending is a result (SEED #8)
  "self_referential", // frame: an act that reads the trail's own trail is the watcher's regress — refused at the gate, never a number
  "paradigm_unraveled", // emergence/paradigm: coherent material arrived that no received core could place — a frame refusal, a paradigm can no longer speak
  "empty_paradigm", // emergence/paradigm: refusal asked to be read through a paradigm with no cores
  "no_rezero_trigger", // emergence/paradigm: REC asked to re-zero without having measured an unravel — REC is never a default
  "not_earned", // emergence/paradigm: the re-zero conceded nothing — the new paradigm still cannot hold the old loss
  "empty_field", // emergence/field: SYN·Ground received no parts to compose
  "byte_mismatch", // emergence/field: a part declares a byte extent its own text does not fill — a lying address
  "overlapping_parts", // emergence/field: two parts of one source claim the same bytes
  "gap_between_parts", // emergence/field: a part begins before/after its predecessor ended — a missing part
  "undeclared_organ", // emergence/declaration: an act by a name that is not on the roster — an organ this engine has not earned has no acts in the record
  "undeclared_cell", // emergence/declaration: an organ acted outside the cell it declared, which is acting as something it is not
  "payoff_not_confirmed", // model-as-contracted-part: a model's output was cited as resolving a planted commitment, but the mechanical check could not find the required terms in it — refused admission to the tape, never silently kept as if resolved
  "model_unreachable", // scripts/write-novella.mjs: the one live/reactive network call anywhere in this repo failed — surfaced as a typed gap, never a raw, unclassified exception (challenge #14)
  "trending_material", // loops/atmosphere::stationarityGap: the material carries a trend, so a ground built over a trailing window of it is a lagging estimate of a slope, not a rebuilt nothing. Every placement against such a ground is exceeded structurally, whatever the content says. Measured on emergence/activation's `recalled` over the committed Frankenstein fixture: re-zeros exactly 122 frames apart, and 30 shuffled-order controls returned mean 6.00 ± 0.00, identical to the real reading — a metronome set by the minimum ground size. The trend was never cleared out of the ground; it became the ground.
]);

export const gap = (type, detail = {}) => {
  if (!GAP_TYPES.includes(type))
    throw new TypeError(`unknown gap type: ${type}`);
  return Object.freeze({ [GAP]: true, gap: type, ...detail });
};

export const isGap = (x) => Boolean(x && x[GAP] === true);

/** Deterministic. A ground that cannot be replayed cannot be testimony. */
const rng = (seed) => {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** In-place radix-2 Cooley-Tukey. Length must be a power of two; see `dft`. */
const fft2 = (re, im, inverse) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const xr = re[i + k + (len >> 1)];
        const xi = im[i + k + (len >> 1)];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + (len >> 1)] = ur - vr;
        im[i + k + (len >> 1)] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
};

/**
 * Bluestein, so the transform is exact at ANY length.
 *
 * The obvious shortcuts are both refusals in disguise. Truncating to the
 * largest power of two changes the EXTENT, and SEED.md #5 is about exactly
 * that: a ground built over 4096 of a 5000-point material is not the null for
 * that material, and `pattern` already refuses the mismatch by type
 * (`incommensurate_extent`). Zero-padding is worse — it invents a stretch of
 * material that is not there, and the perturbation would then be preserving
 * the spectrum of something nobody handed in. The extent is the giver's
 * declaration; an internal convenience does not get to revise it.
 */
const dft = (inRe, inIm, inverse = false) => {
  const n = inRe.length;
  const re = Float64Array.from(inRe);
  const im = inIm ? Float64Array.from(inIm) : new Float64Array(n);
  if ((n & (n - 1)) === 0) {
    fft2(re, im, inverse);
    return { re, im };
  }
  let m = 1;
  while (m < 2 * n + 1) m <<= 1;
  const sign = inverse ? 1 : -1;
  const [cosT, sinT] = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    // (i*i) % (2n) before the divide: i*i overflows exact double precision at
    // large n, and the chirp is periodic in 2n, so reducing first is not an
    // optimisation but the only way the angle stays correct.
    const a = (sign * Math.PI * ((i * i) % (2 * n))) / n;
    cosT[i] = Math.cos(a);
    sinT[i] = Math.sin(a);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    ar[i] = re[i] * cosT[i] - im[i] * sinT[i];
    ai[i] = re[i] * sinT[i] + im[i] * cosT[i];
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = cosT[0];
  bi[0] = -sinT[0];
  for (let i = 1; i < n; i++) {
    br[i] = br[m - i] = cosT[i];
    bi[i] = bi[m - i] = -sinT[i];
  }
  fft2(ar, ai, false);
  fft2(br, bi, false);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft2(ar, ai, true);
  for (let i = 0; i < n; i++) {
    re[i] = ar[i] * cosT[i] - ai[i] * sinT[i];
    im[i] = ar[i] * sinT[i] + ai[i] * cosT[i];
    if (inverse) {
      re[i] /= n;
      im[i] /= n;
    }
  }
  return { re, im };
};

/**
 * Perturbations of what is present. No parametric family, no global mean and sd:
 * an unconditional null is a units change and preserves everything it was meant
 * to test.
 */
export const PERTURBATIONS = Object.freeze({
  shuffle: (material, seed) => {
    const next = rng(seed);
    const out = material.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  },
  resample: (material, seed) => {
    const next = rng(seed);
    return material.map(() => material[Math.floor(next() * material.length)]);
  },
  /**
   * Randomise the Fourier phases; keep every magnitude exactly.
   *
   * The two above destroy the power spectrum along with everything else, which
   * makes them the right null when the question is "does this index carry
   * anything at all" and the WRONG one the moment the spectrum is itself
   * received. Material can arrive with its second-order structure already
   * declared by whoever handed it in — a turbulent cascade is handed over with
   * Kolmogorov's exponent attached, and it was not this engine that earned it.
   * Against a shuffle such material is censored below on every order statistic
   * before anything interesting has been asked, because the shuffle is
   * answering a question already settled at intake.
   *
   * This one holds the declared part fixed and destroys the rest. What survives
   * it is, exactly, the structure the spectrum does not explain. That makes it a
   * CONDITIONAL null in the sense `pattern` already had to relearn below: it
   * varies along the axis the artefact exploits, where an unconditional null is
   * only a change of units.
   *
   * Preserved to floating-point: every |X[k]|, hence the autocorrelation, hence
   * mean and variance. Destroyed: phase coherence, and with it time asymmetry
   * and intermittency. Two series can therefore be bit-identical in spectrum
   * and land on opposite sides of this ground — which is the entire reason it
   * is worth having, and is not reachable from `shuffle` at any draws.
   *
   * Hermitian symmetry is imposed rather than hoped for, so the output is real
   * by construction and not by rounding. DC keeps its value (it is the mean,
   * which is part of what is preserved) and, at even length, so does Nyquist —
   * that bin has no free phase, only a sign, and spending randomness on it
   * would be perturbing a magnitude while claiming not to.
   *
   * LICENSED FOR `irreversibility` ONLY. Amendment I: a perturbation admitted
   * on the strength of one statistic carries no warrant for any other, and this
   * one was measured, not assumed. Against 96 real DNS lines
   * (scripts/turbulence-growth-rule.mjs) the growth rule's `level` test returns:
   *
   *   irreversibility     above 84/96, mean displacement +0.361   ← joins
   *   burstiness          unstable 91/96
   *   permutationEntropy  exceeds_witness 93/96
   *
   * The two failures are not noise and are worth keeping. `burstiness` is a max
   * over windows and phase randomisation preserves the variance, so the two
   * grounds sit almost on top of each other and the cross-measurement has no
   * footing — `unstable` is the correct answer, not a near miss.
   * `permutationEntropy` is censored because real turbulence is more ordered
   * than a spectrum-matched surrogate at every line, which is a finding about
   * the material rather than a placement of it. Only the arrow statistic
   * actually needs this ground, and only it may use it.
   */
  phase: (material, seed) => {
    const n = material.length;
    if (n < 4) return material.slice();
    const next = rng(seed);
    const { re, im } = dft(material, null, false);
    const half = n >> 1;
    for (let k = 1; k < (n + 1) >> 1; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const ph = next() * 2 * Math.PI;
      re[k] = mag * Math.cos(ph);
      im[k] = mag * Math.sin(ph);
      re[n - k] = re[k];
      im[n - k] = -im[k];
    }
    if ((n & 1) === 0) im[half] = 0;
    const back = dft(re, im, true);
    // The inverse of a Hermitian spectrum is real; the imaginary part is
    // rounding, and dropping it silently is how a perturbation starts
    // returning something that is not material. Kept as a real array.
    return Array.from(back.re);
  },
});

/**
 * The statistic must be sensitive to what the perturbation destroys or the
 * ground is vacuous. A mean is shuffle-invariant: every draw returns the same
 * number, a ground of width zero that clears anything put in front of it — an
 * unconditional null wearing a different hat. Largest windowed mean is the
 * simplest honest choice for a series, and shuffling genuinely destroys it.
 */
export const burstiness = (series, { window }) => {
  if (!Number.isInteger(window) || window < 2 || window > series.length)
    return NaN;
  let best = -Infinity;
  for (let i = 0; i + window <= series.length; i++) {
    let s = 0;
    for (let j = i; j < i + window; j++) s += series[j];
    best = Math.max(best, s / window);
  }
  return best;
};

/**
 * LEVEL. The mean of ONE window of the material — not a max over all of them.
 *
 * This exists because `burstiness` is the wrong null for a question that is
 * asked constantly: "is THIS window's mean unusual?" The observation there is a
 * single window's mean, and `burstiness`'s samples are the max over ~n windows
 * of a shuffle. A single draw placed against an extreme of many sits below the
 * support almost always — measured on the competency battery, an ordinary real
 * window is censored BELOW on 248–272 of ~314 steps (79–87%). That is not
 * regularity, which is what the reading had to be; it is the arithmetic of
 * comparing one draw against a maximum of many.
 *
 * It is `extremeGround`'s defect with the sides swapped. There the observation
 * was an extreme of n and the null was one arrival, so everything looked
 * significant. Here the observation is one arrival and the null is an extreme of
 * n, so nothing does. Both are the same failure: the null did not undergo what
 * the observation underwent.
 *
 * SHUFFLE-SENSITIVE, and not by the argument that fails for a global mean. The
 * mean of the WHOLE material is shuffle-invariant — every draw returns the same
 * number, the zero-width ground #3 refuses. The mean of one WINDOW is not:
 * shuffling changes which values land in it, so the draws spread as the mean of
 * `window` values drawn without replacement, and the ground has real width.
 * `ground` still refuses the degenerate case by type, so material that happens
 * to be constant is caught rather than assumed away.
 *
 * TWO-SIDED, which is the point. `burstiness` over a growing prefix is monotone
 * non-decreasing — a max can only rise — so once a series has visited a high
 * level it can never signal a return to a low one. On the competency battery's
 * level-shift control (40-step legs alternating 0 and 4) burstiness jumps once,
 * from 0.491 to 4.737, and is then frozen for the remaining 280 steps
 * regardless of which leg is current. This statistic is not a running extreme
 * and reads a drop as readily as a rise, so censored above and censored below
 * are both live — Amendment II in the one place it changes a result.
 */
export const windowMean = (series, { window }) => {
  if (!Number.isInteger(window) || window < 2 || window > series.length)
    return NaN;
  let s = 0;
  for (let j = 0; j < window; j++) s += series[j];
  return s / window;
};

/**
 * Ordinal patterns (Bandt-Pompe). A window of `window` values is reduced to the
 * permutation that sorts it — magnitudes discarded, order kept. Ties break by
 * index, which is the standard choice and matters only on quantised material.
 */
const ordinalKey = (series, t, d) => {
  const idx = Array.from({ length: d }, (_, i) => i);
  idx.sort((a, b) => series[t + a] - series[t + b] || a - b);
  return idx.join(",");
};

/**
 * Reversing the series reverses each window, so the sorting permutation is read
 * backwards: position p becomes d-1-p. An involution on the pattern space, which
 * is what makes the reversed distribution a relabelling of the forward one
 * rather than a separate measurement.
 */
const reversedKey = (key, d) =>
  key
    .split(",")
    .map((p) => d - 1 - Number(p))
    .join(",");

const patternCounts = (series, d) => {
  const counts = new Map();
  const slots = series.length - d + 1;
  for (let t = 0; t < slots; t++) {
    const k = ordinalKey(series, t, d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return { counts, slots };
};

const factorial = (n) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

/**
 * The pattern space must be populable or the estimate is noise: fewer windows
 * than possible patterns means most bins are empty by arithmetic, not by
 * structure. Refused (NaN) rather than reported, so `ground` gaps instead of
 * building a null out of a counting artefact.
 */
const patternSpaceAdmissible = (series, d) =>
  Number.isInteger(d) &&
  d >= 2 &&
  d <= 8 &&
  series.length - d + 1 >= factorial(d);

/**
 * ORDER. Normalised permutation entropy, in [0,1].
 *
 * Shuffle-sensitive by construction, and one-sided by theorem: shuffling a
 * series destroys dependence, and for a stationary source subadditivity gives
 * block entropy of the shuffled series >= that of the real one, with equality
 * iff independent. So a real series can only sit at or BELOW its own shuffle
 * null. Sitting below is `exceeds_witness` with direction "below" — regularity,
 * which SEED.md #8 warns must not be mistaken for surfeit. Here regularity is
 * the finding: the index is load-bearing.
 *
 * Note what this does NOT see: the pattern space is closed under reversal, so
 * reversing a series permutes the bins without changing the distribution's
 * entropy. This statistic is exactly blind to time's arrow. See `irreversibility`.
 */
export const permutationEntropy = (series, { window }) => {
  if (!patternSpaceAdmissible(series, window)) return NaN;
  const { counts, slots } = patternCounts(series, window);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / slots;
    h -= p * Math.log(p);
  }
  return h / Math.log(factorial(window));
};

/**
 * ARROW. Divergence between the ordinal-pattern distribution and its own
 * reversal image, in [0,1].
 *
 * Zero exactly when the distribution is reversal-symmetric — which is what a
 * time-reversible process has, however much memory it carries. A stationary
 * Gaussian AR process and a sine wave are both strongly ordered and both read
 * zero here; a ratchet does not.
 *
 * The quantity that literally is entropy production is the KL divergence
 * between forward and reverse path distributions (Crooks). This uses the
 * Jensen-Shannon form instead: same zero set, bounded, and finite when a
 * pattern occurs forward but never in reverse — which on finite material is
 * common and would send KL to infinity. A bounded surrogate for a real
 * thermodynamic quantity, named as such rather than passed off as the thing.
 *
 * On shuffled material the pattern distribution is uniform, uniform is its own
 * reversal image, so the null sits near zero and a real arrow is censored ABOVE
 * it: surfeit, in the sense the seed already uses.
 */
export const irreversibility = (series, { window }) => {
  if (!patternSpaceAdmissible(series, window)) return NaN;
  const { counts, slots } = patternCounts(series, window);
  const keys = new Set(counts.keys());
  for (const k of [...keys]) keys.add(reversedKey(k, window));

  let js = 0;
  for (const k of keys) {
    const p = (counts.get(k) ?? 0) / slots;
    const q = (counts.get(reversedKey(k, window)) ?? 0) / slots;
    const m = (p + q) / 2;
    if (p > 0) js += 0.5 * p * Math.log(p / m);
    if (q > 0) js += 0.5 * q * Math.log(q / m);
  }
  return js / Math.log(2);
};

/**
 * OUTLIER. Max absolute deviation from the material's own median.
 *
 * None of the four statistics above see a single point sitting far from its
 * neighbours, and that gap was measured, not assumed (eoreader6.1's
 * check-real-ground-full.mjs, run against this engine's real `ground`/
 * `difference` live): a planted magnitude anomaly, otherwise-ordinary
 * material around it, ranks 0.42-0.91 against every one of
 * burstiness/shuffle, windowMean/shuffle, permutationEntropy/shuffle,
 * irreversibility/shuffle, irreversibility/phase. None flag it, because none
 * of the four ask a POINTWISE question — they ask about windowed bursts,
 * distributional order, or reversal asymmetry, never about one value's
 * distance from the rest.
 *
 * `window` is accepted and unused, deliberately: this statistic is a
 * property of the whole material handed to it, not of a sub-span within it.
 * The correct use is therefore NOT `ground({material: series, ...})` on a
 * series that contains the candidate — that would let the ground's own
 * perturbations draw the candidate back in (`resample` can and will), which
 * is the exact contamination `pattern`'s own `cites` check exists to catch
 * elsewhere. The candidate must be held out of `material` and tested
 * against the ground `difference` builds from the rest, the same shape
 * `cascade` already uses for holding a target out of its own null.
 *
 * NOT licensed for `shuffle`: shuffle only permutes the material's own
 * multiset, and this statistic is invariant under any permutation of a fixed
 * multiset, so every draw returns the identical value — `ground` reports
 * `degenerate_ground` for it, correctly, every time (checked directly,
 * scripts/check-shuffle-maxdev.mjs). Licensed for `resample` and `phase`
 * below, which don't hold the multiset fixed.
 */
export const maxDeviation = (series) => {
  const sorted = [...series].sort((a, b) => a - b);
  const n = sorted.length;
  const i = (n - 1) / 2;
  const lo = Math.floor(i);
  const median = sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
  let best = 0;
  for (const x of series) best = Math.max(best, Math.abs(x - median));
  return best;
};

export const STATISTICS = Object.freeze({
  burstiness,
  windowMean,
  permutationEntropy,
  irreversibility,
  maxDeviation,
});

/**
 * Which (statistic, perturbation) pairs have actually been established.
 *
 * Amendment I says sensitivity is a property of the pair, and that "a
 * statistic admitted to STATISTICS on the strength of one perturbation
 * carries no warrant for any other." That was recorded as prose, and prose is
 * what SEED.md elsewhere calls a lint wearing an invariant's clothes. This is
 * the same claim in a form an organ can be refused by.
 *
 * NOT enforced inside `ground`. The pairs below predate the map, and quietly
 * gapping anything absent from it would be a change of behaviour smuggled in
 * as bookkeeping. An organ that wants the guarantee asks for it — see
 * `cascade`, which refuses to build on an unlicensed pair.
 *
 * `where` names the material each licence was earned on, because a licence
 * established on one kind of material is evidence, not a general warrant.
 */
export const LICENSED = Object.freeze({
  "burstiness/shuffle": Object.freeze({
    where:
      "conformance/temporality.test.js — vacuity controls; goldens/surprise",
  }),
  "windowMean/shuffle": Object.freeze({
    where:
      "scripts/predictive-competency.mjs — candidate:regime-mean-windowMean recovers all 7 planted level-shift boundaries where burstiness recovers 2, and cuts the loss to baseline:moving-mean-6 from -118.7 to -23.3. NOT EARNED by the growth rule: it still loses the positive control, so it waits",
  }),
  "permutationEntropy/shuffle": Object.freeze({
    where: "conformance/temporality.test.js — the three rows",
  }),
  "irreversibility/shuffle": Object.freeze({
    where: "conformance/temporality.test.js — the three rows",
  }),
  "irreversibility/phase": Object.freeze({
    where:
      "scripts/turbulence-growth-rule.mjs — level() returns `above` on 84/96 real DNS lines, mean displacement +0.361",
  }),
  "maxDeviation/resample": Object.freeze({
    where:
      "scripts/verify-maxdeviation-candidate.mjs — a planted single-point magnitude outlier (97 against an otherwise-ordinary series) is none of burstiness/windowMean/permutationEntropy/irreversibility's business (ranks 0.415-0.910 against shuffle and phase, none flagged; see the correction in eoreader6.1's PARITY.md, checked against this file directly). Held out of its own material and tested leave-one-out against the rest: exceeds_witness above, reZero true. A matched control (deviation 0.55, held out the same way) reads exceeds_witness below — regularity per Amendment II, not a hazard",
  }),
  "maxDeviation/phase": Object.freeze({
    where:
      "scripts/check-shuffle-maxdev.mjs — same outlier, same leave-one-out construction, phase in place of resample: exceeds_witness above, reZero true, on a wider support ([0.93, 1.90] vs resample's [0.79, 1.44])",
  }),
});

export const licensed = (statistic, perturbation) =>
  Object.hasOwn(LICENSED, `${statistic}/${perturbation}`);

/**
 * What each perturbation HOLDS FIXED — which is a different question from what
 * it is licensed for, and conflating the two is a mistake worth naming.
 *
 * A licence is about sensitivity: does this statistic move when this
 * perturbation is applied. This is about containment: an organ that transforms
 * its material before measuring needs a null that underwent the same
 * transformation, and can only get one if the transformation's whole effect
 * lies inside what the perturbation preserves. `cascade` box-filters, a box
 * filter is a multiplication in frequency and nothing else, so only a
 * spectrum-preserving null contains it.
 *
 * The two checks catch different failures and neither implies the other:
 * `irreversibility/shuffle` is fully licensed and still unusable for cascade.
 */
export const PRESERVES = Object.freeze({
  shuffle: Object.freeze(["multiset"]),
  resample: Object.freeze(["support"]),
  phase: Object.freeze(["spectrum", "autocorrelation", "mean", "variance"]),
});

export const preserves = (perturbation, what) =>
  (PRESERVES[perturbation] ?? []).includes(what);

/**
 * `window` is the reach of the present — how much of the material is contemporary
 * with itself. It is declared, never derived from the material's length: a
 * statistic whose window follows `n` means a different thing before and after
 * material arrives, so the two grounds are silently incomparable and every
 * comparison between them is an artefact of growth. It is the third and last
 * declared number.
 */
// #5: two grounds are comparable only if built to the same spec. `n` and
// `direction` are part of that spec — a best-of-fifty nothing and a one-arrival
// nothing answer different questions over the same material, and comparing them
// is exactly the artefact #5 refuses. Ordinary grounds carry neither field, so
// `undefined === undefined` leaves them comparable as before.
const sameSpec = (a, b) =>
  a.perturbation === b.perturbation &&
  a.statistic === b.statistic &&
  a.draws === b.draws &&
  a.window === b.window &&
  a.n === b.n &&
  a.direction === b.direction;

/**
 * Exported so a candidate statistic can be checked against the real `ground`/
 * `difference` pipeline (Amendment I's own demand: "checked, not assumed")
 * without duplicating this hash to build a compatible `cites`-passing object
 * by hand. Kept identical to the private construction every ground already
 * uses — there is no second fingerprint, only this one made reachable.
 */
export const fingerprint = (m) =>
  `n${m.length}:${m.reduce((h, v) => Math.imul(h ^ Math.round(v * 1e6), 16777619) | 0, 2166136261) >>> 0}`;

/**
 * Does this constructed ground cite exactly this material? A ground stores a
 * content fingerprint (`from`), not its material, so this is the only question
 * about material identity it can answer — and the one every reseeding null
 * needs answered, because a null built over material the ground never
 * perturbed is measuring something else entirely, at any extent.
 */
export const cites = (g, material) =>
  Boolean(
    g &&
    g.from != null &&
    Array.isArray(material) &&
    g.from === fingerprint(material),
  );

const quantile = (sorted, q) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

/**
 * `statistic` is a registry key by default, the closed vocabulary `licensed`
 * and `cascade` reason about. A function is also accepted, unregistered and
 * unlicensable by construction (`licensed(fn, perturbation)` is false for
 * any function, since `LICENSED` is keyed by name) — this is what lets a
 * candidate be run through the real pipeline (Amendment I, "checked, not
 * assumed") before it earns a name in `STATISTICS` at all, rather than
 * requiring the registry to be edited just to try something out.
 */
const resolveStatistic = (statistic) =>
  typeof statistic === "function" ? statistic : STATISTICS[statistic];

/** Construct a nothing by perturbing present material. */
export const ground = ({
  material,
  draws,
  window,
  perturbation = "shuffle",
  statistic = "burstiness",
  seed = 0,
  via,
}) => {
  if (!Array.isArray(material) || material.length === 0)
    return gap("empty_material", {});
  if (!Number.isInteger(draws) || draws < 2)
    return gap("undeclared", {
      what: "draws",
      why: "the resolution of testimony is 1/draws and is never a default",
    });
  if (!Number.isInteger(window) || window < 2)
    return gap("undeclared", {
      what: "window",
      why: "the reach of the present is never derived from material length",
    });
  const perturb = PERTURBATIONS[perturbation];
  const stat = resolveStatistic(statistic);
  if (!perturb) return gap("unknown_spec", { perturbation });
  if (!stat) return gap("unknown_spec", { statistic });

  const samples = [];
  for (let d = 0; d < draws; d++)
    samples.push(stat(perturb(material, seed + d), { window }));
  if (samples.some((v) => !Number.isFinite(v)))
    return gap("unknown_spec", {
      reason: "the statistic could not be formed at this window",
      statistic,
      window,
    });
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted[0] === sorted[sorted.length - 1])
    return gap("degenerate_ground", {
      reason: "zero width: this null would clear anything",
      statistic,
      perturbation,
    });

  return Object.freeze({
    spec: Object.freeze({
      perturbation,
      statistic,
      seed,
      draws,
      window,
      ...(via ? { via } : {}),
    }),
    from: fingerprint(material),
    // How much material this nothing was built by perturbing. Recorded because
    // SEED.md #5 turns out to bite harder than it reads: `window` is declared
    // so the statistic means one thing throughout, but the EXTENT still grows,
    // and a max-over-windows statistic grows with it. Two grounds over
    // different extents are not comparable unless the null grows the same way.
    extent: material.length,
    samples: Object.freeze(sorted),
    kept: false,
  });
};

/**
 * A nothing for the BEST OF N, when n observations are placed against one ground.
 *
 * The defect this closes is arithmetic and silent. `ground` builds the null for
 * ONE arrival. Place fifty candidates against it and keep the most extreme, and
 * the most extreme of fifty null draws clears a one-draw support most of the
 * time — so "generate more candidates" becomes a mechanism for manufacturing
 * findings, and it reads as productivity. Nothing in the record would show it:
 * every surviving candidate cites a real ground, a real rank, a real spec.
 *
 * This is #3 at a grain the seed states only for a single arrival. A support
 * that the maximum of n draws clears by construction is a null of zero width
 * for the question actually being asked, even though it has perfectly good
 * width for the question it was built for.
 *
 * MEASURED, 2026-07-31, burstiness/shuffle over 400 iid values, draws=200,
 * window=8, 40 trials per row. Every "observation" is a statistic of perturbed
 * material — signal-free by construction, so a correct null places it uniformly
 * and the median rank should sit near 1/2:
 *
 *   n     median rank vs one-arrival   vs best-of-n   censored above (naive)
 *   1     0.633                        0.633          0%
 *   5     0.185                        0.615          0%
 *   20    0.040                        0.438          0%
 *   50    0.038                        0.537          3%
 *   200   0.010                        0.573          25%
 *
 * At n=200 a one-arrival ground ranks pure noise at 0.010 and calls a quarter
 * of the trials surfeit outright. The corrected column stays near uniform
 * throughout. n=1 is identical in both columns, which is the identity the
 * suite asserts directly. Evidence: `conformance/extreme.test.js`.
 *
 * `n` IS NOT A FOURTH DECLARED NUMBER. It is counted, not chosen — the same
 * standing `extent` has: "the extent of the material is not among them. Whoever
 * hands material in has already declared it." Whoever hands in n observations
 * has likewise already declared n, and a caller that has to *pick* n has
 * misunderstood the call. Three declared numbers still.
 *
 * `direction` IS REQUIRED and is never defaulted. Amendment II: above and below
 * are both measurements and neither is the informative one. Pooling them would
 * be a two-sided test smuggled in under a one-sided name, and #6 refuses the
 * averaging of grounds. The extreme of n maxima and the extreme of n minima are
 * different nothings and this returns whichever was asked for.
 *
 * The result is the same shape `ground` returns, so `difference`, `volume`,
 * `admissible` and `keep` consume it unchanged — there is no second mechanism
 * here, only the same construction asked a question about n arrivals.
 *
 * Cost is n×draws statistic evaluations, paid here and not hidden.
 */
export const extremeGround = ({
  material,
  draws,
  window,
  perturbation = "shuffle",
  statistic = "burstiness",
  seed = 0,
  n,
  direction,
}) => {
  if (!Number.isInteger(n) || n < 1)
    return gap("undeclared", {
      what: "n",
      why: "how many observations are placed against this ground is counted, never defaulted",
    });
  if (direction !== "above" && direction !== "below")
    return gap("undeclared", {
      what: "direction",
      why: "above and below are different findings and are never pooled (Amendment II)",
    });

  // One arrival is the ordinary case and must be bit-identical to it, or two
  // callers asking the same question get two different nothings.
  if (n === 1)
    return ground({ material, draws, window, perturbation, statistic, seed });

  if (!Array.isArray(material) || material.length === 0)
    return gap("empty_material", {});
  if (!Number.isInteger(draws) || draws < 2)
    return gap("undeclared", {
      what: "draws",
      why: "the resolution of testimony is 1/draws and is never a default",
    });
  if (!Number.isInteger(window) || window < 2)
    return gap("undeclared", {
      what: "window",
      why: "the reach of the present is never derived from material length",
    });
  const perturb = PERTURBATIONS[perturbation];
  const stat = resolveStatistic(statistic);
  if (!perturb) return gap("unknown_spec", { perturbation });
  if (!stat) return gap("unknown_spec", { statistic });

  const samples = [];
  for (let d = 0; d < draws; d++) {
    let best = null;
    for (let k = 0; k < n; k++) {
      const v = stat(perturb(material, seed + d * n + k), { window });
      if (!Number.isFinite(v))
        return gap("unknown_spec", {
          reason: "the statistic could not be formed at this window",
          statistic,
          window,
        });
      if (best === null) best = v;
      else best = direction === "above" ? Math.max(best, v) : Math.min(best, v);
    }
    samples.push(best);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted[0] === sorted[sorted.length - 1])
    return gap("degenerate_ground", {
      reason: "zero width: this null would clear anything",
      statistic,
      perturbation,
      n,
    });

  return Object.freeze({
    spec: Object.freeze({
      perturbation,
      statistic,
      seed,
      draws,
      window,
      n,
      direction,
    }),
    from: fingerprint(material),
    extent: material.length,
    samples: Object.freeze(sorted),
    kept: false,
  });
};

/**
 * The origin cannot be derived. Three independent mechanisms tried and every one
 * collapsed toward the material's own vocabulary at r ≈ 0.974. A first ground is
 * a gift and must name its giver.
 */
export const received = ({ samples, provenance }) => {
  if (!Array.isArray(samples) || samples.length < 2)
    return gap("no_ground", { reason: "received nothing" });
  if (!provenance)
    return gap("unreceived_origin", { reason: "names no giver" });
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted[0] === sorted[sorted.length - 1])
    return gap("degenerate_ground", { provenance });
  return Object.freeze({
    provenance,
    samples: Object.freeze(sorted),
    kept: false,
  });
};

export const admissible = (g) => {
  if (
    !g ||
    typeof g !== "object" ||
    !Array.isArray(g.samples) ||
    g.samples.length < 2
  )
    return gap("no_ground", {});
  if (!g.spec && !g.provenance)
    return gap("unreceived_origin", {
      reason: "cites neither material nor giver",
    });
  if (g.spec && g.from == null)
    return gap("unreceived_origin", {
      reason: "constructed but cites no material",
    });
  return null;
};

/**
 * Keeping is what makes a ground testimony — and what makes it unfit to perceive
 * through. Replay reconstructs a ground from its retained spec; it never reuses
 * the kept samples. That is why this one boolean is the whole phase rule: an
 * unkept ground is still in the silence, a kept one has returned and may speak.
 */
export const keep = (g) => Object.freeze({ ...g, kept: true });

/**
 * A ground held only to be tended, never perceived through — the anchor
 * awareness needs (SEED.md §7 of the balance-routing spec). `tendVoid`/
 * `admissible` still read it fine: it is a perfectly good ground, sampled
 * for its own volume like any other. What it may never do is stand in for
 * `g` in a `difference()` call, because the moment it judges an arrival it
 * has stopped being an anchor and become a second attention. Same shape as
 * `keep` — one boolean, not a second mechanism — and the same discipline:
 * this marks a ground unfit for one particular use without touching what it
 * contains.
 */
export const anchor = (g) => Object.freeze({ ...g, anchor: true });

/**
 * A fresh nothing over the same material — never the stored one reused.
 * The named trigger for this ("censored above is surfeit") is the Ramakrishna
 * cell in CUBE.md: unravel the frame, return and cultivate.
 *
 * The fresh nothing is TAGGED via:"reZero" in its spec. The tag is why a
 * re-zero is never mistaken for a fresh beginning: two nulls with identical
 * parameters give an identical verdict, and only the tag says one of them
 * came out of a re-zero. Replaying a tagged spec reproduces the tag, so the
 * replay is faithful; a double re-zero is visible in the tag and the seed,
 * never silent.
 */
export const reZero = (g, { material, seed }) =>
  ground({
    ...g.spec,
    material,
    seed: seed ?? g.spec.seed + g.spec.draws,
    via: "reZero",
  });

/**
 * Aperture is the room left to be surprised in. Interquartile, not range: range
 * grows without bound in `draws`, which would make the vital sign partly a
 * measure of how many times we sampled.
 */
export const volume = (g) =>
  g?.samples?.length
    ? quantile(g.samples, 0.75) - quantile(g.samples, 0.25)
    : 0;

/**
 * The tails' own room. Interquartile is the middle's width; this is the
 * outer 90% — 0.95 minus 0.05, so the two move independently: the middle can
 * narrow while the tails hold, and the tails can spread while the middle
 * holds. Volume and tail span are companions, not copies; aperture that stayed
 * still is no proof the tails did. Companion to `volume`, never a fourth
 * declared number — it is derived from the same samples.
 */
export const tailSpan = (g) =>
  g?.samples?.length
    ? quantile(g.samples, 0.95) - quantile(g.samples, 0.05)
    : 0;

/**
 * Where the observation sits in its own nothing.
 *
 * Outside the support the rank is CENSORED, not unmeasurable — the magnitude is
 * right there and reporting it is honest; what the ground cannot supply is a
 * place. Censored above is surfeit and is the trigger to re-zero: the honest
 * silence of a witness who was present and cannot say how much. Censored below
 * is its opposite, regularity, and must not be mistaken for it.
 */
export const difference = (observed, g) => {
  const bad = admissible(g);
  if (bad) return bad;
  if (g.kept)
    return gap("kept_ground", {
      reason: "cannot perceive through a ground held for testimony",
    });
  if (g.anchor)
    return gap("anchor_ground", {
      reason: "held to be tended, not to perceive through",
    });
  if (!Number.isFinite(observed)) return gap("empty_material", { observed });

  const s = g.samples;
  const [lo, hi] = [s[0], s[s.length - 1]];
  const censoredAt = 1 / s.length;
  if (observed > hi)
    return gap("exceeds_witness", {
      observed,
      support: [lo, hi],
      direction: "above",
      censoredAt,
      reZero: true,
    });
  if (observed < lo)
    return gap("exceeds_witness", {
      observed,
      support: [lo, hi],
      direction: "below",
      censoredAt,
    });
  return Object.freeze({
    observed,
    support: Object.freeze([lo, hi]),
    rank: s.filter((v) => v >= observed).length / s.length,
    volume: volume(g),
  });
};

/**
 * Continue a material by drawing from what is already in it. Not a third
 * perturbation: it is `resample` asked for a length instead of the length it
 * happened to have. What it produces is the same regime, carried on — which is
 * exactly the counterfactual a growing ground needs its null to be.
 */
const continueBy = (material, k, seed) => {
  const next = rng(seed);
  const out = material.slice();
  for (let i = 0; i < k; i++)
    out.push(material[Math.floor(next() * material.length)]);
  return out;
};

/**
 * A difference that makes a difference.
 *
 * Did the figure move the next ground further than it would have moved anyway?
 * `opened` carries the sign: a difference that narrows the ground is still a
 * pattern, and it is extraction. Only widening is encounter.
 *
 * TWO CORRECTIONS LIVE HERE, found independently and both load-bearing. The
 * first is about the MAGNITUDE's null and extent; the second about the SIGN's.
 *
 * THE NULL MUST GROW THE WAY `after` GREW. This is the correction that cost the
 * most to find, so it is written down at length.
 *
 * SEED.md's statement of the null is "same spec, same material, fresh seed,"
 * and that is right for the case it was written for: two grounds over the SAME
 * material, where the only thing that moved them apart is the figure. But the
 * commonest real use is a reader accumulating material, where `after` is built
 * over MORE material than `before` — and burstiness is a max over windows, so
 * its expectation rises with extent for no reason but extent. Held at before's
 * n, the null then measures seed noise while `moved_by` measures seed noise
 * PLUS growth, and growth wins.
 *
 * What that looks like when you go and check: wired into atmosphere clearing,
 * this fired on homogeneous noise at almost exactly even spacing — boundaries
 * 28 apart, a clock, not a perception — and recovered 23 of Frankenstein's 24
 * chapter boundaries while ALSO recovering 21–23 of them from the same series
 * SHUFFLED. A statistic that scores the same on material whose order has been
 * destroyed is reading its own arithmetic. (scripts/two-clearings.mjs)
 *
 * So the null is grown to `after`'s extent by drawing from `before`'s own
 * material: the same regime, continued. Any displacement it shows is what
 * growth alone contributes, and `moved` is what survives subtracting it. This
 * is a CONDITIONAL null in the sense the lineage keeps having to relearn — it
 * varies along the exact axis the artefact exploits, where an unconditional one
 * is only a change of units. When the extents are equal it reduces to the
 * reseeding null with nothing added.
 *
 * `material` is BEFORE's own material, and that is checked rather than trusted:
 * handing in AFTER's material instead makes every null draw a sibling of
 * `after` — same material, different seed — so `moved` becomes a coin that
 * lands true about 1/(reseeds+1) of the time no matter what the material does.
 * That is a real bug this check was written to catch, and it caught one.
 *
 * AND THE SIGN IS OWED A NULL TOO. `opened` was a bare inequality,
 * volume(after) > volume(before) — measured, on real arrivals, to fall inside
 * this null 77.8% of the time, to flip on a mere reseed 41.1% of the time, and
 * to call an exact tie "extraction" 15.0% of the time. That is SEED.md #3 ("a
 * null of zero width is refused, everywhere, at every level") and #4 in the one
 * place the seed calls the whole physiology. So the sign is three-valued: a
 * gap is a result (#8), and "no sign sayable" is a real finding about this
 * arrival rather than a quiet vote for extraction.
 */
export const pattern = ({ before, after, material, reseeds }) => {
  for (const g of [before, after]) {
    const bad = admissible(g);
    if (bad) return bad;
  }
  if (!Number.isInteger(reseeds) || reseeds < 2)
    return gap("undeclared", {
      what: "reseeds",
      why: "the resolution of pattern is never a default",
    });
  if (!before.spec || !after.spec)
    return gap("unreceived_origin", {
      reason: "a received ground has no reseeding null",
    });
  if (!sameSpec(before.spec, after.spec))
    return gap("unknown_spec", {
      reason: "two grounds built to different specs were never comparable",
    });
  if (!Array.isArray(material) || material.length === 0)
    return gap("empty_material", {});

  // Type error before null, both ways round (SEED.md #7).
  if (material.length !== before.extent)
    return gap("incommensurate_extent", {
      reason:
        "the null must be built over BEFORE's own material — anything else measures the wrong thing",
      given: material.length,
      before: before.extent,
      after: after.extent,
    });
  // Extent alone is not identity: a different material of the right length
  // passed the check above for as long as it was the only check, and the
  // docstring's "checked rather than trusted" was a length test wearing an
  // identity test's clothes. The ground already cites its material by
  // fingerprint, so ask it.
  if (!cites(before, material))
    return gap("unreceived_origin", {
      reason:
        "this material has BEFORE's extent but is not the material BEFORE cites — the null would be built over something the ground never perturbed",
    });
  if (after.extent < before.extent)
    return gap("incommensurate_extent", {
      reason:
        "the later ground was built over LESS material: there is no growth for the null to match",
      before: before.extent,
      after: after.extent,
    });

  // A median is too robust to see reseeding at all: on a quantised statistic it
  // returns the same value for every seed, so the null comes out zero-width and
  // any displacement whatsoever reads as a pattern. Compare the whole shape.
  const displacement = (a, b) => {
    const grid = [0.1, 0.25, 0.5, 0.75, 0.9];
    return (
      grid.reduce(
        (s, q) => s + Math.abs(quantile(a.samples, q) - quantile(b.samples, q)),
        0,
      ) / grid.length
    );
  };

  const grewBy = after.extent - before.extent;
  const moved_by = displacement(after, before);
  const volumeBefore = volume(before);
  const nullSamples = [];
  let volumeNull = 0;
  for (let r = 1; r <= reseeds; r++) {
    const seed = before.spec.seed + r * before.spec.draws;
    const nullMaterial =
      grewBy === 0 ? material : continueBy(material, grewBy, seed);
    const g = reZero(before, { material: nullMaterial, seed });
    if (isGap(g)) return g;
    nullSamples.push(displacement(g, before));
    volumeNull = Math.max(volumeNull, Math.abs(volume(g) - volumeBefore));
  }

  // nullMax used to be Math.max(...nullSamples): the raw sample maximum over
  // exactly `reseeds` reseed draws. That is itself an order statistic whose
  // OWN expected value rises with `reseeds` — a max of few draws under-
  // estimates the true achievable reseed-noise ceiling — so `moved_by` (which
  // does not scale with `reseeds` at all) cleared it more and more easily as
  // a caller declared FEWER, still validly-declared (>=2), reseeds. This is
  // the identical defect family `extremeGround` (above, "the max of n draws
  // clears a one-draw support most of the time") and `level` (below, the
  // 12/120/300/600-draws table) already carry corrections for, applied here
  // to `pattern`'s own reseeding null instead of to a candidate count or a
  // rank threshold. Fixed the same way SEED.md's "Earned since" already
  // fixed `slackRunNull`: calibrated rather than raw — mean + 3·std of the
  // reseed-displacement samples, not their bare maximum.
  //
  // MEASURED, 2026-08-05 (adversarial challenge #5, "birth-as-consequence,
  // not appearance"). Two measurements:
  //
  // (1) False-positive rate on 150 trials of pure reseed noise per row
  // (signal-free by construction — `after` is `before` extended by bootstrap
  // draws from its own material, exactly the counterfactual this null
  // already builds), burstiness/shuffle, draws=48, window=8:
  //
  //   reseeds   raw max FP    mean+3·std FP
  //        2       34.7%           18.7%
  //        4       24.7%           10.7%
  //        8       17.3%            6.7%
  //       12       10.7%            2.0%
  //       24        4.7%            2.0%
  //       48        1.3%            1.3%
  //       96        1.3%            1.3%
  //
  // (2) On the challenge's own fixture (real production call, not synthetic
  // noise): KESTREL is a verbatim, zero-consequence repeated line whose
  // `moved_by` sits at 0.266–0.267 no matter how it is read. The raw maximum
  // it needed to clear ranged from 0.19 (reseeds=12, draws=96) to 0.23
  // (draws=48, any reseeds tried) — below 0.266, hence wrongly admitted — up
  // to 0.47 (reseeds=24, draws=96, the one hand-tuned SPEC the original
  // report used), where the same raw maximum correctly refused it. mean +
  // 3·std of the SAME reseed samples clears 0.266 at every one of those
  // (reseeds, draws) pairs — the ceiling stops being a function of how many
  // reseeds happened to be declared. It costs precision at the margin: VOSS,
  // the fixture's genuinely-consequential surface, had a `moved_by` of 0.309
  // against a raw maximum of only 0.291 at the hand-tuned SPEC — a margin of
  // 0.018, thinner than KESTREL's own false positives were riding on, and
  // one the corrected ceiling (mean 0.121 + 3·std 0.079 = 0.359) no longer
  // clears at that SPEC, though it still clears at others. SEED.md #3 makes
  // that the right side to be wrong on: a null of zero width — which is what
  // a systematically-low raw maximum amounts to — is refused, everywhere,
  // never assumed away because the material on the other side of it happens
  // to be the one a fixture was built to admit.
  //
  // Evidence: `scripts/adversarial/challenge-5-birth-as-consequence-not-
  // appearance.mjs`.
  const nullMean = nullSamples.reduce((s, v) => s + v, 0) / nullSamples.length;
  const nullVariance =
    nullSamples.reduce((s, v) => s + (v - nullMean) ** 2, 0) /
    Math.max(1, nullSamples.length - 1);
  const nullMax = nullMean + 3 * Math.sqrt(nullVariance);
  if (nullMax === 0)
    return gap("degenerate_ground", {
      reason:
        "reseeding moves this ground not at all: a null of zero width would clear any displacement",
      reseeds,
    });

  // The SIGN gets the same null the magnitude gets. `opened` used to be the bare
  // inequality volume(after) > volume(before) — measured, on real arrivals, to
  // fall inside this null 77.8% of the time, to flip on a mere reseed 41.1% of
  // the time, and to call an exact tie "extraction" 15.0% of the time. That is
  // SEED.md #3 ("a null of zero width is refused, everywhere, at every level")
  // and #4 in the one place the seed calls the whole physiology. Three-valued,
  // because SEED.md #8: a gap is a result, and "no sign sayable" is a real
  // finding about this arrival — not a quiet vote for extraction.
  const volumeDelta = volume(after) - volumeBefore;
  const opened =
    volumeNull === 0 || Math.abs(volumeDelta) <= volumeNull
      ? null
      : volumeDelta > 0;

  return Object.freeze({
    moved: moved_by > nullMax,
    displacement: moved_by,
    reseedNull: nullMax,
    grewBy,
    censoredAt: 1 / reseeds,
    opened,
    volumeDelta,
    volumeNull,
  });
};

/**
 * The third use of the one operation: another figure's ground.
 *
 * Two figures are measured by the SAME observation against two different grounds.
 * The relationship between the grounds is determined by how differently the
 * observation ranks. If the observation is more extreme against the target ground
 * than the figure's own, the figure's ground is "above" (it constrains what can
 * be perceived). If less extreme, it's "below" (the target enables more). If the
 * displacement is negligible, the grounds are "peer" — no level exists between
 * them. This is the first sheath: identity by consequence, never by appearance.
 *
 * For the growth rule: a candidate organ is "above" the core if its observation
 * ranks higher (more extreme) against the core's ground than against its own —
 * the core's ground cannot anticipate what the organ perceives.
 *
 * THE THRESHOLD IS A RESOLUTION FLOOR, NOT A NULL, AND FOR A LONG TIME IT WAS
 * ASKED TO BE BOTH.
 *
 * `2/draws` is the finest rank difference two grounds can even express, so
 * nothing below it is sayable. That makes it necessary and it never made it
 * sufficient — and because it SHRINKS as draws grows, a caller who paid for
 * more resolution got a threshold approaching zero, which SEED.md #3 names as
 * the lineage's most expensive dead end: a null of zero width clears anything
 * put in front of it.
 *
 * Measured, on white noise coarsened to six scales (12 realisations, six
 * adjacent pairs each) — material with no scale structure whatsoever, where
 * every relation should be `peer`:
 *
 *   draws  threshold   laddered/5   above / below
 *      60     0.0333         3.08      21 / 16
 *     120     0.0167         3.42      19 / 22
 *     300     0.0067         4.33      27 / 25
 *     600     0.0033         4.42      26 / 27
 *
 * The direction is a coin flip at every setting, and the rate of finding a
 * level where none exists RISES with draws. This is the same defect, in the
 * same shape, that `pattern`'s `opened` sign carried until it was given a
 * reseeding null — recorded a few dozen lines above, at 77.8%.
 *
 * So the displacement gets the null the sign already got: how far does the
 * rank move on a MERE RESEED of own's own ground, same spec, same material,
 * fresh seed. Anything smaller is reseeding noise wearing a level's clothes.
 * No fourth declared number — `reseeds` is already the resolution of pattern.
 *
 * The null is OPTIONAL because a ground stores a fingerprint and an extent,
 * not its material, so `level` cannot reseed on its own. When it is not
 * supplied the result says so (`nulled: false`) instead of quietly presenting
 * a resolution floor as a null. Callers that can supply material should.
 *
 * Returns { relationship, displacement, threshold, floor, reseedNull, nulled,
 * rank, cross } or a gap.
 */
export const level = (
  observed,
  ownGround,
  targetGround,
  { material, reseeds } = {},
) => {
  const own = admissible(ownGround);
  if (own && isGap(own)) return own;
  const tgt = admissible(targetGround);
  if (tgt && isGap(tgt)) return tgt;
  if (ownGround.kept)
    return gap("kept_ground", {
      reason: "cannot level through a ground held for testimony",
    });
  if (targetGround.kept)
    return gap("kept_ground", {
      reason: "cannot level against a ground held for testimony",
    });

  const fig = difference(observed, ownGround);
  if (isGap(fig)) return fig;

  const cross = difference(observed, targetGround);
  if (isGap(cross))
    return gap("unstable", {
      reason: "cross-measurement failed",
      detail: cross,
    });

  const displacement = cross.rank - fig.rank;
  const floor = 2 / ownGround.samples.length;

  let reseedNull = null;
  if (material !== undefined || reseeds !== undefined) {
    if (!Number.isInteger(reseeds) || reseeds < 2)
      return gap("undeclared", {
        what: "reseeds",
        why: "the resolution of pattern is never a default",
      });
    if (!Array.isArray(material) || material.length === 0)
      return gap("empty_material", {});
    if (!ownGround.spec)
      return gap("unreceived_origin", {
        reason: "a received ground has no reseeding null",
      });
    // Type error before null, SEED.md #7: a null over different material than
    // the ground it is the null FOR is measuring something else entirely.
    if (material.length !== ownGround.extent)
      return gap("incommensurate_extent", {
        reason: "the null must be built over OWN's own material",
        given: material.length,
        own: ownGround.extent,
      });
    if (!cites(ownGround, material))
      return gap("unreceived_origin", {
        reason:
          "this material has OWN's extent but is not the material OWN cites",
      });

    reseedNull = 0;
    for (let r = 1; r <= reseeds; r++) {
      const g = reZero(ownGround, {
        material,
        seed: ownGround.spec.seed + r * ownGround.spec.draws,
      });
      if (isGap(g)) return g;
      const d = difference(observed, g);
      // A reseed that cannot place the observation is not a failure of the
      // level question — it is the honest width of the noise showing up as
      // censoring, and counting it as zero displacement would shrink the null
      // exactly when it should widen it.
      if (isGap(d))
        return gap("unstable", {
          reason: "a reseed of own's ground could not place the observation",
          detail: d,
        });
      reseedNull = Math.max(reseedNull, Math.abs(d.rank - fig.rank));
    }
  }

  const threshold = Math.max(floor, reseedNull ?? 0);

  let relationship;
  if (Math.abs(displacement) <= threshold) relationship = "peer";
  else if (displacement > 0) relationship = "above";
  else relationship = "below";

  return Object.freeze({
    relationship,
    displacement,
    threshold,
    floor,
    reseedNull,
    nulled: reseedNull !== null,
    rank: fig.rank,
    cross: cross.rank,
  });
};

/**
 * Plural grounds for one figure are legal and their disagreement is the only
 * self-check here — all judgement now lives in the choice of perturbation, and a
 * bad perturbation fails invisibly and globally. Censored differences are kept,
 * not dropped: one perturbation calling something surfeit while another does not
 * is the most informative signal this system can produce.
 */
export const disagreement = (differences) => {
  const censored = differences.filter(
    (d) => isGap(d) && d.gap === "exceeds_witness",
  ).length;
  const ranks = differences.filter((d) => !isGap(d)).map((d) => d.rank);
  if (differences.length < 2)
    return gap("no_ground", { reason: "one ground cannot disagree" });
  return Object.freeze({
    n: differences.length,
    censored,
    split: censored > 0 && ranks.length > 0,
    spread: ranks.length > 1 ? Math.max(...ranks) - Math.min(...ranks) : null,
  });
};

/**
 * Objective immortality: what a satisfaction adds to what comes after it.
 *
 * `keep()` is half of Whitehead's clause — "it closes up the entity." This is
 * the other half — "and yet is the superject adding its character to the
 * creativity whereby there is a becoming of entities superseding the one in
 * question." Without it the engine has subjects and no superjects: every
 * witnessed record is frozen, returned, and prehended by nothing.
 *
 * The character it adds is displacement in units of the reseeding null: how far
 * this figure moved the ground beyond what the material moves it by itself.
 * That ratio is the engine's name for "an origination not wholly traceable to
 * the mere data" — the null IS the mere data.
 *
 * Returns a value, never a ground. A superject prehended as a prior would close
 * the successor's ground and this would be sclerosis with extra steps; prehended
 * as datum it can still be differed from. The depositor cannot read its own
 * deposit, and needs no machinery to be stopped: its ground is kept, and a kept
 * ground cannot be perceived through. Keeping makes a satisfaction unusable
 * here; objectifying makes it usable there.
 */
export const objectify = (record) => {
  if (isGap(record)) return record;
  if (!record || !record.ground || !record.figure || !record.pattern)
    return gap("no_ground", { reason: "not a witnessed record" });
  if (record.ground.kept !== true)
    return gap("no_ground", {
      reason: "a satisfaction that never closed its entity is not a superject",
    });
  if (record.pattern.moved !== true)
    return gap("made_no_difference", { reason: "nothing to pass on" });
  if (!(record.pattern.reseedNull > 0))
    return gap("degenerate_ground", {
      reason: "no null to express the excess in",
    });

  const giver = record.ground.provenance ?? record.ground.from;
  if (giver == null)
    return gap("unreceived_origin", {
      reason: "a satisfaction passed on must still name its giver",
    });

  return Object.freeze({
    value: record.pattern.displacement / record.pattern.reseedNull,
    rank: record.figure.rank ?? null,
    opened: record.pattern.opened,
    provenance: giver,
  });
};

/**
 * A nexus: antecedent members objectified in the formal constitution of what
 * follows. The material a successor's nothing is built by perturbing.
 *
 * Whitehead (ii) puts the objectification in the *formal constitution* — the
 * process, not the outcome — so a nexus is material and nothing else. Its order
 * is the order of the succession, which is real, and which perturbing destroys:
 * that is what makes a statistic over it non-vacuous (SEED.md #4).
 *
 * One grain up from the material a figure was measured in, and unit-consistent
 * with itself: every member is an excess-over-its-own-null, so satisfactions
 * built over different domains are comparable here and nowhere else.
 */
export const nexus = (records) => {
  if (!Array.isArray(records) || records.length === 0)
    return gap("empty_material", { reason: "a nexus of nothing" });
  const members = records.map(objectify);
  const bad = members.find(isGap);
  if (bad) return bad;
  return Object.freeze({
    material: Object.freeze(members.map((m) => m.value)),
    givers: Object.freeze(members.map((m) => m.provenance)),
    n: members.length,
  });
};

/**
 * Testify from a ground you kept.
 *
 * A difference that made no difference is not information, so it is not
 * testimony either. That refusal is the witness gate, rederived: the system may
 * perceive anything and may speak only of what changed the ground.
 *
 * Succeeding here requires binding to independent evidence (pattern.moved),
 * never generating an unsupported claim — see CUBE.md, "why this instrument
 * earns its keep."
 */
export const witness = ({ ground: g, figure, pattern: p }) => {
  const bad = admissible(g);
  if (bad) return bad;
  if (!g.kept)
    return gap("no_ground", {
      reason: "testimony from a ground that was never kept",
    });
  if (isGap(figure)) return figure;
  if (!figure || !Number.isFinite(figure.observed))
    return gap("no_ground", { reason: "no figure" });
  if (!p || typeof p.moved !== "boolean")
    return gap("made_no_difference", { reason: "pattern not established" });
  if (!p.moved)
    return gap("made_no_difference", {
      displacement: p.displacement,
      reseedNull: p.reseedNull,
    });
  return Object.freeze({ ground: g, figure, pattern: p });
};
