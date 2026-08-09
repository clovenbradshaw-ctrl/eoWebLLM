// eoreader6's relation-belief graph (packages/engine/emergence/graph.js),
// vendored verbatim into ./eo-binary/ — same pattern turn.js/nul.js already
// use in this directory. Depends only on ./surprise.js (also vendored here).
//
// Source: eoreader6/packages/engine/emergence/graph.js
//   https://github.com/clovenbradshaw-ctrl/eoreader6 (local: eoreader6/)

// eoreader6 · emergence/graph — THE PRIOR IS A GRAPH, and it evolves.
//
// Every earlier attempt in this repo made the reader's belief a word
// frequency distribution. A reader does not believe "which words are
// likely." A reader believes WHO IS PRESENT AND WHAT THEY DO TO WHOM, and
// Bayesian surprise is how far a passage moves THAT.
//
// The graph is the STRUCTURE tier, which the ladder diagram had as unbuilt:
//   nodes  = Entity   (Existence · Figure)
//   edges  = Link     (Structure · Figure)
//   whole  = Network  (Structure · Pattern)
//
// MODALITY-AGNOSTIC BY CONSTRUCTION. It consumes (subject, verb, object,
// polarity) triples and never learns where they came from. English SVO comes
// from perceiver/text/relations.js; a video perceiver supplying
// actor-action-target would not change a line here.
//
// Belief movement reuses `bayesianSurprise` unchanged — the "forms" are
// simply edges rather than words, which is the whole reason that function
// takes Maps and totals rather than text.
//
// gamma is the graph's forgetting: a relation not restated fades. That is
// what makes this a reader's evolving belief rather than a cumulative
// transcript, and it is why a motif returning after long enough away can
// move belief again. Declared, never defaulted.
//
// IDENTITY IS WHATEVER IT IS GIVEN. Subjects and objects are keyed by the
// string handed in. Feed it raw surfaces and it builds a surface graph; feed
// it resolved referent ids and it builds a referent graph. The graph does not
// resolve identity and must not — that is coref's job, upstream, and the seam
// is deliberate: it is where an injected eoPriors coref prior wires in.
//
// A5: STRUCTURAL EDGEKEY. Binding-derived links carry polarity but no verb
// — the "co-occur" verb is the machinery's own name, not content. The
// structural key `a|polarity|b` (no verb) runs alongside the verb-inclusive
// key so that both text-derived and binding-derived relations coexist in the
// same Network. The structural key is behind the `structural` flag; when
// reading Link records, both keyings run. `promote` decides using the
// structural key.

import { bayesianSurprise } from "./surprise.js";

// The cell this organ occupies on the operator grid (engine/operators.js):
// SYN · Network · Composing — the prior is a graph; nodes are Entity, edges
// Link, whole Network. Declared, checked by conformance.
export const CELL = Object.freeze({ op: "SYN", grain: "Pattern" });

export const createGraph = ({ gamma, pruneBelow }) => {
  if (!Number.isFinite(gamma) || gamma <= 0 || gamma > 1)
    throw new TypeError(
      "createGraph: gamma is declared in (0,1], never defaulted — it is the rate of forgetting",
    );
  // A second, silent forgetting parameter: a relation decayed past this is
  // forgotten outright rather than carried as noise. It sat as a bare module
  // constant while gamma, right beside it, was already required — declared
  // and validated the same way gamma is, not defaulted.
  if (!Number.isFinite(pruneBelow) || pruneBelow <= 0)
    throw new TypeError(
      "createGraph: pruneBelow is declared, never defaulted — it is the floor below which a relation is forgotten outright",
    );
  return {
    nodes: new Map(),
    edges: new Map(),
    edgeTotal: 0,
    gamma,
    pruneBelow,
    tick: 0,
    provenance: [],
  };
};

export const edgeKey = ({ subject, verb, object, polarity }) =>
  `${String(subject).toLowerCase()}|${polarity === "−" || polarity === "-" ? "!" : ""}${verb}|${String(object).toLowerCase()}`;

/**
 * Structural edge key: `a|polarity|b` — no verb. Binding-derived links
 * carry polarity but the verb ("co-occur") is the machinery's own name,
 * not content. This key runs alongside the verb-inclusive key so that
 * both text-derived and binding-derived relations coexist in the same
 * Network.
 */
export const structuralKey = ({ subject, polarity, object }) =>
  `${String(subject).toLowerCase()}|${polarity === "−" || polarity === "-" ? "!" : ""}|${String(object).toLowerCase()}`;

/**
 * Extract triples from a Link record (from emergence/binding.js).
 * The link's direction determines subject/object; polarity is carried
 * through. Returns an array of triple-shaped objects.
 */
const linkToTriples = (link) => {
  if (!link.direction) return [];
  const subject = link.direction === "a→b" ? link.a.id : link.b.id;
  const object = link.direction === "a→b" ? link.b.id : link.a.id;
  return [{ subject, verb: "co-occur", object, polarity: link.polarity }];
};

/**
 * Read one frame's triples. Returns the belief movement BEFORE advancing —
 * the frame is never part of the prior it is measured against.
 *
 * Accepts either bare triples (subject, verb, object, polarity) or Link
 * records from binding.js. Link records are converted to triples internally;
 * both the verb-inclusive key and the structural key run when `structural`
 * is true.
 */
export const readTriples = (
  graph,
  triples,
  { alpha = 1, structural = false } = {},
) => {
  const arrival = new Map();
  const structuralArrival = structural ? new Map() : null;

  for (const t of triples) {
    // Link records: extract triples first. Skip undirected links.
    if (t.a && t.b && !t.direction) continue;
    const ts = t.direction ? linkToTriples(t) : [t];
    for (const triple of ts) {
      const k = edgeKey(triple);
      arrival.set(k, (arrival.get(k) ?? 0) + 1);
      if (structuralArrival) {
        const sk = structuralKey(triple);
        structuralArrival.set(sk, (structuralArrival.get(sk) ?? 0) + 1);
      }
    }
  }
  const arrivalTotal = triples.length;

  let belief = null;
  if (graph.edgeTotal > 0 && arrivalTotal > 0) {
    belief = bayesianSurprise(
      graph.edges,
      graph.edgeTotal,
      arrival,
      arrivalTotal,
      { gamma: graph.gamma, alpha },
    );
  }

  // What is genuinely new, kept apart from how far belief moved: a passage
  // can restate known relations and still shift belief (by re-weighting), or
  // introduce a new one that barely registers (in a dense graph).
  let newEdges = 0,
    newNodes = 0;
  for (const k of arrival.keys()) if (!graph.edges.has(k)) newEdges++;

  // ── advance ───────────────────────────────────────────────────────────────
  // EVERY edge decays, not only the restated ones. Decaying the total while
  // leaving absent edges untouched makes the distribution stop summing to 1
  // and drives KL negative — a real bug, fixed once already in this repo.
  for (const [k, w] of graph.edges) graph.edges.set(k, w * graph.gamma);
  graph.edgeTotal *= graph.gamma;

  for (const [k, c] of arrival) {
    graph.edges.set(k, (graph.edges.get(k) ?? 0) + c);
    graph.edgeTotal += c;
  }
  for (const [k, w] of graph.edges) {
    if (w < graph.pruneBelow) {
      graph.edgeTotal -= w;
      graph.edges.delete(k);
    }
  }

  // Structural edges: advance alongside verb-inclusive edges.
  if (structuralArrival) {
    for (const [k, c] of structuralArrival) {
      graph.edges.set(k, (graph.edges.get(k) ?? 0) + c);
      graph.edgeTotal += c;
    }
  }

  for (const t of triples) {
    if (t.a && t.b && !t.direction) continue;
    const ts = t.direction ? linkToTriples(t) : [t];
    for (const triple of ts) {
      for (const side of [triple.subject, triple.object]) {
        const id = String(side).toLowerCase();
        if (!graph.nodes.has(id)) {
          graph.nodes.set(id, { id, mentions: 0, firstSeen: graph.tick });
          newNodes++;
        }
        graph.nodes.get(id).mentions++;
        graph.nodes.get(id).lastSeen = graph.tick;
      }
    }
  }

  graph.tick++;
  return {
    belief,
    stated: arrivalTotal,
    newEdges,
    newNodes,
    nodes: graph.nodes.size,
    edges: graph.edges.size,
  };
};

/**
 * Received priors — eoPriors and anything else with a named giver. Injected,
 * never derived: this is witness-tier knowledge about the world, and the
 * engine refuses to invent it. `giver` is required for the same reason
 * `received()` in nul demands provenance: a prior whose origin cannot be
 * named is indistinguishable from a fabrication.
 */
export const injectPrior = (graph, triples, { giver, weight = 1 }) => {
  if (!giver) throw new TypeError("injectPrior: a prior must name its giver");
  for (const t of triples) {
    const k = edgeKey(t);
    graph.edges.set(k, (graph.edges.get(k) ?? 0) + weight);
    graph.edgeTotal += weight;
    for (const side of [t.subject, t.object]) {
      const id = String(side).toLowerCase();
      if (!graph.nodes.has(id))
        graph.nodes.set(id, {
          id,
          mentions: 0,
          firstSeen: graph.tick,
          fromPrior: giver,
        });
    }
  }
  graph.provenance.push({ giver, triples: triples.length, atTick: graph.tick });
  return graph;
};

/** The strongest relations currently believed, for inspection. */
export const strongestEdges = (graph, n = 10) =>
  [...graph.edges.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, w]) => ({ edge: k, weight: w }));
