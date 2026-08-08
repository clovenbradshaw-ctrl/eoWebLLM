// eoreader6 · engine/operators — the 9 operators as the app's verb grid.
//
// Every verb of the app is one of these, aimed at some target, at some
// holonic height. The verb is the act; the target is a document or a passage
// inside it; the height is the grain the act lands on. "Everywhere" means the
// act is aimed at every target in the corpus — a prompt that does not name a
// single source is not a guess about which one, it is an address to all of
// them.
//
// THIS IS THE CUBE, AS ONE ALLOWED RUNTIME USE. CUBE.md says the cube is an
// instrument, not a runtime, and as a *classifier* (deriving a cell from
// content) it was measured and refuted — 95.7% of cell assignments survived
// shuffling words inside 2,527 paragraphs. This registry is not that act.
// Nothing here derives a cell from content. Each organ DECLARES the cell it
// already occupies, from its own header, and the surfer dispatches a prompt's
// verb to the organs of that cell. The instrument becomes a dispatch key, and
// the refusal to classify content stands. The tension with CUBE.md's sentence
// is recorded here rather than hidden: the instrument earned one runtime use,
// the one that turns a reader's verb into an addressed act.
//
// THE ALGEBRA IS THE SINGLE SOURCE OF TRUTH, and it is the coherent one —
// terrain and stance are derived from (mode, domain, grain), never hand-listed.
// eoreader5 carried a hand-listed diagonal whose algebra refused five of its
// own nine cells; that contradiction is not re-inherited (CUBE.md). The cells
// declared here are the ones the engine's organs already claimed in their
// headers, checked against the derivation.
//
//   operator = (mode, domain)      NUL SIG INS / SEG CON SYN / DEF EVA REC
//   terrain  = (domain, grain)     Existence:      Void       Entity  Kind
//                                  Structure:      Field      Link    Network
//                                  Interpretation: Atmosphere Lens    Paradigm
//   stance   = (mode, grain)       Differentiate:  Clearing    Dissecting Unraveling
//                                  Relate:         Tending     Binding    Tracing
//                                  Generate:       Cultivating Making     Composing
//
// The verb vocabulary is host-facing and mechanical (English, no model):
//   NUL receive  · SIG scout  · INS admit  · SEG snip  · CON bind
//   SYN compile  · DEF refuse · EVA evaluate · REC rezero
// SEG IS SNIP: the SEG operation is the act of cutting a reach-unit out of
// the arena — boundaries found by form, the addressed unit brought to the
// reader byte-accurate, a window labelled a window never a chapter. The
// engine organs of the cell (segments, spans) do the finer acts under it.
// A prompt that names no verb defaults to the surfer's own act, SEG · snip.

export const MODES = Object.freeze(["Differentiate", "Relate", "Generate"]);
export const DOMAINS = Object.freeze([
  "Existence",
  "Structure",
  "Interpretation",
]);
export const GRAINS = Object.freeze(["Ground", "Figure", "Pattern"]);

// op letter -> (mode, domain), the operator face of the cube.
const OP_MODE = Object.freeze({
  NUL: "Differentiate",
  SIG: "Relate",
  INS: "Generate",
  SEG: "Differentiate",
  CON: "Relate",
  SYN: "Generate",
  DEF: "Differentiate",
  EVA: "Relate",
  REC: "Generate",
});
const OP_DOMAIN = Object.freeze({
  NUL: "Existence",
  SIG: "Existence",
  INS: "Existence",
  SEG: "Structure",
  CON: "Structure",
  SYN: "Structure",
  DEF: "Interpretation",
  EVA: "Interpretation",
  REC: "Interpretation",
});

const TERRAIN_BY_DOMAIN = Object.freeze({
  Existence: Object.freeze({
    Ground: "Void",
    Figure: "Entity",
    Pattern: "Kind",
  }),
  Structure: Object.freeze({
    Ground: "Field",
    Figure: "Link",
    Pattern: "Network",
  }),
  Interpretation: Object.freeze({
    Ground: "Atmosphere",
    Figure: "Lens",
    Pattern: "Paradigm",
  }),
});

const STANCE_BY_MODE = Object.freeze({
  Differentiate: Object.freeze({
    Ground: "Clearing",
    Figure: "Dissecting",
    Pattern: "Unraveling",
  }),
  Relate: Object.freeze({
    Ground: "Tending",
    Figure: "Binding",
    Pattern: "Tracing",
  }),
  Generate: Object.freeze({
    Ground: "Cultivating",
    Figure: "Making",
    Pattern: "Composing",
  }),
});

export const OP_VERBS = Object.freeze({
  NUL: "receive",
  SIG: "scout",
  INS: "admit",
  SEG: "snip",
  CON: "bind",
  SYN: "compile",
  DEF: "refuse",
  EVA: "evaluate",
  REC: "rezero",
});

/** Derive the cell (terrain · stance) of an operator at a grain — the algebra, never a hand-list. */
export const cellOf = (op, grain) => {
  if (!OP_MODE[op])
    return gap("unknown_spec", {
      reason: `no such operator: ${op}`,
      known: Object.keys(OP_MODE),
    });
  if (!GRAINS.includes(grain))
    return gap("unknown_spec", {
      reason: `no such grain: ${grain}`,
      known: GRAINS,
    });
  const mode = OP_MODE[op];
  const domain = OP_DOMAIN[op];
  return Object.freeze({
    op,
    grain,
    mode,
    domain,
    terrain: TERRAIN_BY_DOMAIN[domain][grain],
    stance: STANCE_BY_MODE[mode][grain],
  });
};

const gap = (type, detail = {}) => Object.freeze({ gap: type, ...detail });

/**
 * The 9 operators. Each is a verb aimed at a target at a holonic height; the
 * default cell is the Ground-grain one the engine's own turn implements
 * (loops/turn.js fires all nine at Ground). Organs that occupy a Figure or
 * Pattern cell are in the roster below, not folded into these defaults.
 */
export const OPERATORS = Object.freeze(
  Object.fromEntries(
    Object.keys(OP_MODE).map((op) => [
      op,
      Object.freeze({
        ...cellOf(op, "Ground"),
        verb: OP_VERBS[op],
        what: {
          NUL: "construct the nothing; the first ground is received, never derived",
          SIG: "direct attention; keep the nothing fit to perceive through",
          INS: "material comes into being",
          SEG: "partition the arena into reach-units; boundaries found by form, never named",
          CON: "which units are contemporary; bind a passage to its segment",
          SYN: "the arena as one extent; a whole composed from parts",
          DEF: "where the ground fails; a typed gap, never a guess",
          EVA: "witness: speak only of what changed the ground",
          REC: "a new ambient ground begins; censored above is the trigger to re-zero",
        }[op],
      }),
    ]),
  ),
);

/**
 * The organ roster: every engine organ that declares an operator cell, with
 * the exported function that implements it. Unwired is failing — an organ
 * listed here without a matching CELL export (or a cell with no organ) is
 * refuted by conformance/operators.test.js.
 */
export const ORGANS = Object.freeze([
  {
    id: "nul/core",
    module: "nul/index.js",
    fn: "ground",
    op: "NUL",
    grain: "Ground",
    verb: "receive",
    what: "construct the nothing (ground); the first ground is received",
  },
  {
    id: "nul/witness",
    module: "nul/index.js",
    fn: "witness",
    op: "EVA",
    grain: "Figure",
    verb: "evaluate",
    what: "witness: all three terms or it is not a record",
  },
  {
    id: "nul/rezero",
    module: "nul/index.js",
    fn: "reZero",
    op: "REC",
    grain: "Ground",
    verb: "rezero",
    what: "censored above is surfeit and is the trigger to re-zero",
  },
  {
    id: "loops/turn",
    module: "packages/engine/loops/turn.js",
    fn: "runTurn",
    op: "NUL",
    grain: "Ground",
    verb: "receive",
    what: "one complete turn: all nine operators at one grain, fired in order",
  },
  {
    id: "host/corpus/admit",
    module: "packages/host/corpus.js",
    fn: "admitChunked",
    op: "INS",
    grain: "Ground",
    verb: "admit",
    what: "material comes into being: text admitted to the corpus, chunked by byte budget",
  },
  {
    id: "host/surfer",
    module: "packages/host/surfer.js",
    fn: "executePrompt",
    op: "SEG",
    grain: "Ground",
    verb: "snip",
    what: "the app's reader-facing act: the prompt's address becomes a snipped reach-unit, aimed at every target the prompt names — the default verb",
  },
  {
    id: "host/corpus/snip",
    module: "packages/host/corpus.js",
    fn: "snipSegment",
    op: "SEG",
    grain: "Ground",
    verb: "snip",
    what: "cut the addressed reach-unit out of the arena, byte-accurate; a missing boundary is a labelled context window, never an invented chapter",
  },
  {
    id: "loops/atmosphere/def",
    module: "packages/engine/loops/atmosphere.js",
    fn: "readAtmosphere",
    op: "DEF",
    grain: "Ground",
    verb: "refuse",
    what: "where the accumulated ground fails (surfeit; censored below is regularity)",
  },
  {
    id: "loops/atmosphere/eva",
    module: "packages/engine/loops/atmosphere.js",
    fn: "readAtmosphere",
    op: "EVA",
    grain: "Ground",
    verb: "evaluate",
    what: "does the stretch still cohere; the ground is maintained",
  },
  {
    id: "loops/atmosphere/rec",
    module: "packages/engine/loops/atmosphere.js",
    fn: "createRegimeTracker",
    op: "REC",
    grain: "Ground",
    verb: "rezero",
    what: "concede the ground, grow the next one; CUBE.md's Ramakrishna cell",
  },
  {
    id: "loops/surf",
    module: "packages/engine/loops/surf.js",
    fn: "surf",
    op: "EVA",
    grain: "Figure",
    verb: "evaluate",
    what: "one anticipation, one arrival, bound; EVA · Lens · Binding",
  },
  {
    id: "loops/level",
    module: "packages/engine/loops/level.js",
    fn: "promote",
    op: "DEF",
    grain: "Figure",
    verb: "refuse",
    what: "settled significance becomes received existence; DEF.admit, never a bare boolean",
  },
  {
    id: "loops/grain",
    module: "packages/engine/loops/grain.js",
    fn: "grainWalk",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "the figure → pattern → witness grain walk, one call",
  },
  {
    id: "loops/family",
    module: "packages/engine/loops/family.js",
    fn: "crossFamilyLevel",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "cross-family level stability; a bad perturbation fails globally",
  },
  {
    id: "loops/time",
    module: "packages/engine/loops/time.js",
    fn: "timeLoop",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "the reader-assimilation loop: a growing fraction of the same material",
  },
  {
    id: "emergence/fold",
    module: "packages/engine/emergence/fold.js",
    fn: "fold",
    op: "SYN",
    grain: "Pattern",
    verb: "compile",
    what: "a fold projects the universe from a given here; SYN · Network · Composing",
  },
  {
    id: "emergence/graph",
    module: "packages/engine/emergence/graph.js",
    fn: "readTriples",
    op: "SYN",
    grain: "Pattern",
    verb: "compile",
    what: "the prior is a graph; nodes are Entity, edges Link, whole Network",
  },
  {
    id: "emergence/tiers",
    module: "packages/engine/emergence/tiers.js",
    fn: "foldThrough",
    op: "EVA",
    grain: "Figure",
    verb: "evaluate",
    what: "meaning folds on itself; atmosphere, lens, paradigm ARE priors",
  },
  {
    id: "emergence/activation",
    module: "packages/engine/emergence/activation.js",
    fn: "readForward",
    op: "CON",
    grain: "Figure",
    verb: "bind",
    what: "associative memory that reads left to right; one recurrent hop, not a flood",
  },
  {
    id: "loops/reading-regime",
    module: "packages/engine/loops/reading-regime.js",
    fn: "readingRegime",
    op: "EVA",
    grain: "Figure",
    verb: "evaluate",
    what: "does the reader's ground still hold — the same regime tracker atmosphere.js runs, fed a channel of activation.js's own measured recall instead of the material's raw token statistic",
  },
  {
    id: "emergence/voice",
    module: "packages/engine/emergence/voice.js",
    fn: "enterVoice",
    op: "DEF",
    grain: "Figure",
    verb: "refuse",
    what: "who is speaking, or being cited; outside every asserted voice, a typed gap",
  },
  {
    id: "emergence/surprise",
    module: "packages/engine/emergence/surprise.js",
    fn: "bayesianSurprise",
    op: "EVA",
    grain: "Figure",
    verb: "evaluate",
    what: "the two lanes: novelty and bayesian surprise, kept apart",
  },
  {
    id: "emergence/revision",
    module: "packages/engine/emergence/revision.js",
    fn: "revise",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "surprise is a witnessed revision of prior structure — the candidate applied to a copy, the delta attributed to operators, each ranked against its own null; REC is deferred to the tier stack, not guessed",
  },
  {
    id: "search/relevance",
    module: "packages/engine/search/index.js",
    fn: "judge",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "the relevance gate: preserve a candidate only if it moves the hypergraph beyond the ground's own reseeding variation (tuple-rotate reseeding null) — new existence is never redundant, restatement within the ground's capacity is refused, unplaceable magnitude is censored, never ranked",
  },
  {
    id: "frame/index",
    module: "frame/index.js",
    fn: "note",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "the reading's own trail: each witness-gated act, in order, with the ground it moved against; a trail is walked, never summed — the session rollup is refused by type",
  },
  {
    id: "referents/blind",
    module: "packages/engine/referents/blind.js",
    fn: "findRecurringMotifs",
    op: "SIG",
    grain: "Ground",
    verb: "scout",
    what: "existence detection with no human-named prior; noticing needs no name",
  },
  {
    id: "perceiver/text/segments",
    module: "packages/engine/perceiver/text/segments.js",
    fn: "outlineOfIndex",
    op: "SEG",
    grain: "Ground",
    verb: "segment",
    what: "structural boundaries found by form and nothing else",
  },
  {
    id: "perceiver/text/surfaces",
    module: "packages/engine/perceiver/text/surfaces.js",
    fn: "extractSurfaces",
    op: "SIG",
    grain: "Ground",
    verb: "scout",
    what: "candidate referent surfaces, from the text's own statistics",
  },
  {
    id: "perceiver/text/spans",
    module: "packages/engine/perceiver/text/spans.js",
    fn: "splitSentences",
    op: "SEG",
    grain: "Ground",
    verb: "segment",
    what: "sentence segmentation; abbreviations are injected priors, never a list",
  },
  {
    id: "perceiver/text/relations",
    module: "packages/engine/perceiver/text/relations.js",
    fn: "extractRelations",
    op: "CON",
    grain: "Figure",
    verb: "bind",
    what: "subject · verb · object triples; the graph's medium-specific mouth — against a vocabulary measured from the text (discoverRelationVocab), never a hand-listed English verb set",
  },
  {
    id: "perceiver/text/pronouns",
    module: "packages/engine/perceiver/text/pronouns.js",
    fn: "resolvePronouns",
    op: "CON",
    grain: "Figure",
    verb: "bind",
    what: "third-person singular pronouns bound to the already-admitted cast by one-hop activation recall over sentence frames — the same recurrent-hop mechanism emergence/activation.js already trusts for motif memory, asked a narrower question; gender is a derived hard filter, descriptor synonymy is untouched, declared activation/margin bars gate every binding",
  },
  {
    id: "emergence/binding",
    module: "packages/engine/emergence/binding.js",
    fn: "bindLinks",
    op: "CON",
    grain: "Figure",
    verb: "bind",
    what: "the modality-blind Link: co-arrival binding over entity registers, displacement null, direction and polarity — same cell as perceiver/text/relations, with no English in it",
  },
  {
    id: "perceiver/text/admit",
    module: "packages/engine/perceiver/text/admit.js",
    fn: "admitFromPrior",
    op: "DEF",
    grain: "Ground",
    verb: "refuse",
    what: "received priors into DEF.admit events; a prior must name its giver",
  },
  {
    id: "referents/index",
    module: "packages/engine/referents/index.js",
    fn: "projectReferents",
    op: "CON",
    grain: "Figure",
    verb: "bind",
    what: "the projection over DEF.admit / CON.identity / SYN.merge / SEG.split events",
  },
  {
    id: "referents/entity/void",
    module: "packages/engine/referents/entity.js",
    fn: "clearEntityVoid",
    op: "NUL",
    grain: "Figure",
    verb: "receive",
    what: "the nothing a being is seen against — a ground conditioned on the candidate's own extent, never a shared threshold",
  },
  {
    id: "referents/entity/sense",
    module: "packages/engine/referents/entity.js",
    fn: "senseEntity",
    op: "SIG",
    grain: "Figure",
    verb: "scout",
    what: "is this being here, and is its ground fit to see against — aperture is the warmth you check for, never a gate",
  },
  {
    id: "referents/entity/admit",
    module: "packages/engine/referents/entity.js",
    fn: "admitEntity",
    op: "INS",
    grain: "Figure",
    verb: "admit",
    what: "a being comes into existence; the witness gate is the birth condition — a difference that recurs, not one that merely scored well",
  },
  {
    id: "referents/entity/carry",
    module: "packages/engine/referents/entity.js",
    fn: "carryEntities",
    op: "REC",
    grain: "Figure",
    verb: "rezero",
    what: "the register the next turn receives, in birth order — never ranked by count or by aperture",
  },
  {
    id: "referents/consequence",
    module: "packages/engine/referents/consequence.js",
    fn: "identityByConsequence",
    op: "CON",
    grain: "Pattern",
    verb: "bind",
    what: "binding surfaces that point at one being — identity by consequence, never by appearance; two surfaces are one being iff their combined arrivals alone clear the birth condition",
  },
  {
    id: "competency/ledger",
    module: "packages/engine/competency/ledger.js",
    fn: "competencyGain",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "the prequential fold: competency against declared baselines, never nothing",
  },
  {
    id: "emergence/kinds",
    module: "packages/engine/emergence/kinds.js",
    fn: "induceKinds",
    op: "SYN",
    grain: "Pattern",
    verb: "compile",
    what: "kinds induced from relation-term records; one SIG→CON→EVA→DEF→INS→SYN chain, height discovered by the two Born gates, peer first-class",
  },
  {
    id: "emergence/kinds/ins",
    module: "packages/engine/emergence/kinds.js",
    fn: "induceKinds",
    op: "INS",
    grain: "Pattern",
    verb: "admit",
    what: "instantiate the kind's members from the material; a kind admits exactly what it earned",
  },
  {
    id: "emergence/coverage",
    module: "packages/engine/emergence/coverage.js",
    fn: "coverageReport",
    op: "EVA",
    grain: "Ground",
    verb: "evaluate",
    what: "the instrument's own occupancy: which cells are earned, which are open questions; measured, never classified",
  },
  {
    id: "emergence/declaration",
    module: "packages/engine/emergence/declaration.js",
    fn: "declare",
    op: "DEF",
    grain: "Ground",
    verb: "refuse",
    what: "an act names the organ that performed it, or it is not in the record — the record refuses anonymity (frame.note), the roster refuses imposture (here); same cell as perceiver/text/admit and the same sentence, one grain down from a prior naming its giver",
  },
  {
    id: "emergence/people",
    module: "packages/engine/emergence/people.js",
    fn: "understand",
    op: "EVA",
    grain: "Pattern",
    verb: "evaluate",
    what: "does this population already have a kind — the check, addressed and mechanical; a missing prior is the typed gap missing_kind_prior, never a silently wrong number",
  },
  {
    id: "emergence/people/invent",
    module: "packages/engine/emergence/people.js",
    fn: "inventKind",
    op: "SYN",
    grain: "Pattern",
    verb: "compile",
    what: "the kind the reader had no prior for, induced from the material's own structural facts — the same SIG→CON→EVA→DEF→INS→SYN chain, stamped invented",
  },
  {
    id: "emergence/kind-void/nul",
    module: "packages/engine/emergence/kind-void.js",
    fn: "kindVoid",
    op: "NUL",
    grain: "Pattern",
    verb: "receive",
    what: "the nothing a kind is seen against — attribute distribution shuffled as null",
  },
  {
    id: "emergence/kind-void/sig",
    module: "packages/engine/emergence/kind-void.js",
    fn: "kindCoOccurrence",
    op: "SIG",
    grain: "Pattern",
    verb: "scout",
    what: "kind co-occurrence signals — which kinds appear together, tested against permutation null",
  },
  {
    id: "emergence/segment/fig",
    module: "packages/engine/emergence/segment.js",
    fn: "connectedComponents",
    op: "SEG",
    grain: "Figure",
    verb: "segment",
    what: "connected components in the graph — the natural partition at Link grain",
  },
  {
    id: "emergence/segment/pat",
    module: "packages/engine/emergence/segment.js",
    fn: "communityDetection",
    op: "SEG",
    grain: "Pattern",
    verb: "segment",
    what: "community detection by label propagation — subgraphs internally dense, externally sparse",
  },
  {
    id: "emergence/segment/con",
    module: "packages/engine/emergence/segment.js",
    fn: "detectCoOccurrences",
    op: "CON",
    grain: "Ground",
    verb: "bind",
    what: "initial co-occurrence relating — which raw units appear together in the same frame",
  },
  {
    id: "emergence/segment/syn",
    module: "packages/engine/emergence/segment.js",
    fn: "composeTransitive",
    op: "SYN",
    grain: "Figure",
    verb: "compile",
    what: "composing new links from existing ones — transitive inference, one hop, not a flood",
  },
  {
    id: "emergence/paradigm/def",
    module: "packages/engine/emergence/paradigm.js",
    fn: "refuseParadigm",
    op: "DEF",
    grain: "Pattern",
    verb: "refuse",
    what: "paradigm unraveling — coherent received material with zero placement against the paradigm's cores is a frame refusal, never a lowered threshold; a paradigm that can no longer speak, unravelled by the measured exact conjunction",
  },
  {
    id: "emergence/paradigm/rec",
    module: "packages/engine/emergence/paradigm.js",
    fn: "rezeroParadigm",
    op: "REC",
    grain: "Pattern",
    verb: "rezero",
    what: "paradigm composing — re-induce over the accumulated material only after the unravel was measured; the new paradigm must hold the loss or it concedes nothing",
  },
  {
    id: "emergence/field/syn",
    module: "packages/engine/emergence/field.js",
    fn: "composeField",
    op: "SYN",
    grain: "Ground",
    verb: "compile",
    what: "the arena as one extent — the whole field composed from its addressed parts, byte-exact and contiguous; a missing part is a typed gap, never a silent fill",
  },
]);

export const organsByOp = (op) => ORGANS.filter((o) => o.op === op);
export const organsByModule = (module) =>
  ORGANS.filter((o) => o.module === module);
export const organIds = () => ORGANS.map((o) => o.id);

export const CURRENT_OPERATOR_EPOCH = "eo-2026-07";

/**
 * The one dependency order a chain may run in. Each operator consumes the
 * previous one's output: NUL constructs the received ground; SEG splits the
 * material; SIG discovers signals; CON binds them into structures; EVA gates
 * them against a null; DEF differentiates what survived into definitions; INS
 * instantiates members; SYN synthesizes the vocabulary; REC recognizes the
 * rules the material taught. A pipeline that violates the order has not read.
 */
export const OPERATOR_ORDER = Object.freeze([
  "NUL",
  "SEG",
  "SIG",
  "CON",
  "EVA",
  "DEF",
  "INS",
  "SYN",
  "REC",
]);

export const isCurrentOperator = (op) =>
  Object.prototype.hasOwnProperty.call(OP_MODE, op);

/** Inverse lookup: which (mode, domain) owns an operator code. Unknown is a typed gap. */
export const operatorOf = (op) => {
  if (!isCurrentOperator(op))
    return gap("unknown_spec", {
      reason: `no such operator: ${op}`,
      known: Object.keys(OP_MODE),
    });
  return Object.freeze({ op, mode: OP_MODE[op], domain: OP_DOMAIN[op] });
};

/**
 * Validate a chain of operator codes against dependency order.
 * Type error before null: an out-of-order chain is not a chain (SEED.md #7).
 */
export const validateChain = (chain) => {
  if (!Array.isArray(chain) || chain.length === 0)
    throw new TypeError(
      "operators: a chain must be a non-empty array of operator codes",
    );
  let pos = -1;
  for (const op of chain) {
    if (!isCurrentOperator(op))
      throw new TypeError(
        `operators: "${op}" is not in epoch ${CURRENT_OPERATOR_EPOCH}`,
      );
    const p = OPERATOR_ORDER.indexOf(op);
    if (p < pos)
      throw new TypeError(
        `operators: chain [${chain.join(" -> ")}] violates dependency order: ${op} before ${OPERATOR_ORDER[pos]}`,
      );
    pos = p;
  }
  return Object.freeze({
    operator_epoch: CURRENT_OPERATOR_EPOCH,
    chain: Object.freeze([...chain]),
  });
};

// Every operator must be claimed by at least one organ — unwired is failing.
const claimed = new Set(ORGANS.map((o) => o.op));
for (const op of Object.keys(OP_MODE))
  if (!claimed.has(op))
    throw new Error(
      `operators: operator ${op} has no organ claiming it — unwired is failing`,
    );
