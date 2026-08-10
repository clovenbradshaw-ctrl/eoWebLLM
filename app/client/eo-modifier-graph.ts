// eo-modifier-graph.ts — wires eoreader6's modifier-order organ (PR #50,
// vendored verbatim except for the trim noted in ./eo-binary/modifier-order.js)
// and its graph adapter onto eoreader6's real relation-belief graph
// (./eo-binary/graph.js, vendored verbatim from packages/engine/emergence/
// graph.js), so an uploaded text source's multi-adjective noun phrases
// become nodes and edges instead of a flat attribute bag.
//
// "The fat black cat" becomes three nodes (cat, cat::black, cat::black::fat)
// and two edges (color, quality) instead of two unordered attributes on one
// node — see modifier-order.js's own header for why that distinction matters
// (coreference, negation scope, conflict severity).
//
// The one piece that is NOT eoreader6 code: ./eo-binary/english-modifier-demo.js,
// a small, disclosed-scope (II.13), English-only fixture that tags a ~50-word
// lexicon of common adjectives so this feature has something real to call
// without a live model round-trip per upload. See that file's header for the
// scope disclosure. The engine mechanism itself (modifier-order.js) stays
// fully general — receiving a typology and a direction, never assuming
// English — only the demo tagger is English-scoped.
//
// Source: eoreader6 (https://github.com/clovenbradshaw-ctrl/eoreader6),
// modifier-order/index.js + packages/engine/emergence/{graph,surprise}.js

import { toTriples } from "./eo-binary/modifier-order.js";
import { createGraph, readTriples, edgeKey } from "./eo-binary/graph.js";
import { isGap } from "./eo-binary/nul.js";
import {
  ENGLISH_DEMO_TYPOLOGY,
  extractEnglishModifierStacks,
} from "./eo-binary/english-modifier-demo.js";

// Declared here, never defaulted inside graph.js itself — same discipline
// createGraph enforces by throwing without them. gamma=0.85 and
// pruneBelow=0.02 are the values used in eoreader6's own conformance tests
// for this organ; this bundle makes no claim to have retuned them against
// browser-corpus-specific ground truth.
const GRAPH_SPEC = { gamma: 0.85, pruneBelow: 0.02 };

export interface ModifierGraphRefusal {
  head: string;
  gap: string;
  reason?: string;
}

export interface ModifierGraphReport {
  applied: number;
  refused: ModifierGraphRefusal[];
  entityNodes: string[];
}

/** One relation-belief graph per source, in the same shape emergence/graph.js builds. */
export function createModifierGraph(): any {
  return createGraph(GRAPH_SPEC);
}

/**
 * Runs the disclosed-scope English tagger over `text`, and for every
 * multi-adjective stack it finds, receives it into `graph` via
 * modifier-order.js's toTriples -> graph.js's readTriples. A stack that
 * inverts (or is otherwise refused) is recorded, never silently dropped —
 * modifier-order.js refuses rather than guesses, and this wrapper preserves
 * that rather than swallowing it.
 */
export function enrichModifierGraphFromText(
  graph: any,
  text: string,
): ModifierGraphReport {
  const stacks = extractEnglishModifierStacks(text);
  const report: ModifierGraphReport = {
    applied: 0,
    refused: [],
    entityNodes: [],
  };

  for (const stack of stacks) {
    const t = toTriples(stack.tags, ENGLISH_DEMO_TYPOLOGY, {
      head: stack.head,
    });
    if (isGap(t)) {
      report.refused.push({
        head: stack.head,
        gap: (t as any).gap,
        reason: (t as any).reason ?? (t as any).why,
      });
      continue;
    }
    readTriples(graph, (t as any).triples);
    report.applied++;
    report.entityNodes.push((t as any).entityNode);
  }

  return report;
}

/** The strongest relations currently believed in a modifier graph, for inspection/debugging. */
export function strongestModifierEdges(graph: any, n = 10) {
  return [...graph.edges.entries()]
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, n)
    .map(([k, w]: any) => ({ edge: k, weight: w }));
}

export function formatModifierGraphBlock(
  fileName: string,
  report: ModifierGraphReport,
): string {
  if (report.applied === 0 && report.refused.length === 0) {
    return (
      `MODIFIER GRAPH for "${fileName}": no multi-adjective noun stacks recognized by the ` +
      `disclosed English-only demo lexicon (app/client/eo-binary/english-modifier-demo.js). ` +
      `This is a scope limit of the fixture, not a claim the text has none.`
    );
  }
  const parts = [
    `MODIFIER GRAPH for "${fileName}": ${report.applied} modifier stack(s) added to this ` +
      `source's kind/evaluation graph (nearer-head modifiers narrow a kind, farther ones evaluate it)`,
  ];
  if (report.entityNodes.length) {
    parts.push(`entities: ${report.entityNodes.slice(0, 10).join(", ")}`);
  }
  if (report.refused.length) {
    parts.push(
      `${report.refused.length} stack(s) refused rather than guessed (${report.refused
        .map((r) => r.gap)
        .join(", ")})`,
    );
  }
  return parts.join(". ") + ".";
}

// Re-exported so callers needing the typology directly (e.g. for a future,
// non-English or model-driven tagger) don't have to reach into ./eo-binary/.
export { ENGLISH_DEMO_TYPOLOGY };
