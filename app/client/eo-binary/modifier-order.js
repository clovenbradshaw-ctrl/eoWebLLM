// eoreader6's modifier-order organ (modifier-order/index.js), vendored into
// ./eo-binary/ — TRIMMED, not verbatim: `corpusDirectionTest` and its
// `temporality` dependency are omitted. That function answers a separate,
// genuinely statistical question (is an attested corpus's modifier order
// load-bearing?) this bundle has no use for, and pulling in a second
// Born-null organ (temporality/index.js, plus everything it needs from
// nul/index.js) just to leave it uncalled is not worth the bytes. Everything
// below — `order`, `scopeTree`, `toTriples`, `admissibleTypology` — is
// unchanged from the source.
//
// Source: eoreader6/modifier-order/index.js (PR #50)
//   https://github.com/clovenbradshaw-ctrl/eoreader6 (local: eoreader6/)

// eoreader6 · modifier-order — does a stack of modifiers nest by a received
// rank, or does it invert it?
//
// "The fat black cat" is well-formed and "the black fat cat" is not, in
// English, for a reason no lexicon of English adjectives states: modifiers
// closer to the head classify a narrower kind (color, origin, material —
// SEG on Kind, a boundary drawn tighter); modifiers farther from the head
// evaluate the kind once it is already settled (opinion, size-as-judgment —
// SIG/EVA layered on top). The claim that generalizes across languages is
// the RANK — how classifying vs. evaluative a modifier class is — not the
// SIDE of the head it falls on. Prenominal languages linearize far-to-near
// left-to-right; postnominal languages linearize near-to-far right-to-left.
// Same nesting, mirrored direction.
//
// Per eo-constitution CONSTITUTION.md II.2 (the giver test), which class a
// real-world word belongs to, and which direction a given language
// linearizes, is material knowledge and must be received with a named
// giver. This organ never derives either. It receives a `typology`
// (class -> rank, a `direction`, and a `giver`) and a sequence of
// already-classified modifier tags, and answers one purely structural
// question: does this sequence's rank order nest monotonically toward the
// head, or does it invert somewhere?
//
// `toTriples` maps a nested scope onto the (subject, verb, object, polarity)
// triple shape `./graph.js::readTriples` already consumes — no new graph
// primitive.

import { gap, isGap } from "./nul.js";

export const RELATIONS = Object.freeze(["nested", "inverted"]);
export const DIRECTIONS = Object.freeze(["pre", "post"]);

const isTag = (t) => t && typeof t.class === "string" && t.class.length > 0;

export const admissibleTypology = (typology) => {
  if (!typology || typeof typology !== "object")
    return gap("undeclared", {
      what: "typology",
      why: "class ranks are received, never assumed",
    });
  if (
    !typology.ranks ||
    typeof typology.ranks !== "object" ||
    Object.keys(typology.ranks).length === 0
  )
    return gap("undeclared", {
      what: "typology.ranks",
      why: "a class->rank table must be received",
    });
  if (!DIRECTIONS.includes(typology.direction))
    return gap("undeclared", {
      what: "typology.direction",
      why: "linearization side is received per-language, never assumed prenominal",
    });
  if (typeof typology.giver !== "string" || typology.giver.trim() === "")
    return gap("unreceived_origin", {
      reason:
        "a typology without a named giver is a wall, not a gap-in-waiting (II.2)",
    });
  return null;
};

export const order = (sequence, typology) => {
  const bad = admissibleTypology(typology);
  if (bad) return bad;

  if (!Array.isArray(sequence) || sequence.length === 0)
    return gap("empty_material", { sequence });
  if (!sequence.every(isTag))
    return gap("undeclared", {
      what: "sequence",
      why: "every tag needs a .class string",
    });

  const { ranks, direction, giver } = typology;
  const missing = sequence.map((t) => t.class).filter((c) => !(c in ranks));
  if (missing.length > 0)
    return gap("unknown_spec", {
      reason: "a class outside the received typology cannot be ranked",
      missing,
    });

  const headOutward = direction === "pre" ? [...sequence].reverse() : sequence;

  let violation = null;
  for (let i = 1; i < headOutward.length; i++) {
    const prevRank = ranks[headOutward[i - 1].class];
    const curRank = ranks[headOutward[i].class];
    if (curRank < prevRank) {
      violation = Object.freeze({
        at: i,
        near: headOutward[i - 1].class,
        far: headOutward[i].class,
        why: `${headOutward[i].class} (rank ${curRank}) is more classifying than ${headOutward[i - 1].class} (rank ${prevRank}) but sits farther from the head, inverting the nesting`,
      });
      break;
    }
  }

  return Object.freeze({
    relation: violation ? "inverted" : "nested",
    direction,
    giver,
    headOutward: Object.freeze(headOutward.map((t) => t.class)),
    violation,
  });
};

export const scopeTree = (sequence, typology, { head = "HEAD" } = {}) => {
  const o = order(sequence, typology);
  if (isGap(o)) return o;
  if (o.relation !== "nested")
    return gap("unstable", {
      reason: "a scope tree describes a nesting; this sequence inverts one",
      violation: o.violation,
    });

  return o.headOutward.reduceRight(
    (inner, cls) => Object.freeze({ class: cls, scopes: inner }),
    Object.freeze({ class: head, scopes: null }),
  );
};

export const toTriples = (sequence, typology, { head } = {}) => {
  if (typeof head !== "string" || head.trim() === "")
    return gap("undeclared", {
      what: "head",
      why: "the entity a modifier stack narrows is received, never assumed",
    });

  const o = order(sequence, typology);
  if (isGap(o)) return o;
  if (o.relation !== "nested")
    return gap("unstable", {
      reason: "triples describe a nesting; this sequence inverts one",
      violation: o.violation,
    });

  const { direction } = typology;
  const headOutwardTags =
    direction === "pre" ? [...sequence].reverse() : sequence;

  const triples = [];
  let parent = head;
  for (const tag of headOutwardTags) {
    const label = tag.surface ?? tag.class;
    const child = `${parent}::${label}`;
    triples.push(
      Object.freeze({
        subject: child,
        verb: tag.class,
        object: parent,
        polarity: "+",
      }),
    );
    parent = child;
  }

  return Object.freeze({
    triples: Object.freeze(triples),
    headNode: head,
    entityNode: parent,
  });
};
