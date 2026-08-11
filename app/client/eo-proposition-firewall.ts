// The eoreader6 engine remains canonical in the eoreader6 submodule. This
// adapter carries browser-app provenance into its proposition → graph seam.
// A System 1 draft may help formulate retrieval, but cannot become evidence.

import { extractSurfaces } from "../../eoreader6/packages/engine/perceiver/text/surfaces.js";
import {
  discoverRelationVocab,
  extractRelations,
} from "../../eoreader6/packages/engine/perceiver/text/relations.js";
import {
  createGraph,
  readTriples,
} from "../../eoreader6/packages/engine/emergence/graph.js";

type Relation = {
  subject: string;
  verb: string;
  object: string;
  polarity: "+" | "-";
};

// eoreader6 is JavaScript with narrow JSDoc inferred by TypeScript. The
// adapter records the browser-facing contract at this boundary.
const discoverVocabulary = discoverRelationVocab as unknown as (
  text: string,
  options: { surfaces: unknown[]; minSurfaces: number },
) => { verbs: Set<string> };
const extractTriples = extractRelations as unknown as (
  text: string,
  options: { verbs: Set<string> },
) => Relation[];

export type PropositionOrigin = "received" | "retrieved" | "draft-candidate";

export interface SourceSpan {
  sourceId: string;
  byteStart: number;
  byteEnd: number;
  retrievalEvent: string;
  extractionMethod: string;
}

export interface Proposition {
  subject: string;
  verb: string;
  object: string;
  polarity: "+" | "-";
  origin: PropositionOrigin;
  source: SourceSpan;
}

export interface SourceMaterial {
  text: string;
  origin: Exclude<PropositionOrigin, "draft-candidate">;
  source: SourceSpan;
}

export interface EvidenceGraphSpec {
  gamma: number;
  pruneBelow: number;
}

function validSpan(source: SourceSpan): boolean {
  return (
    !!source.sourceId &&
    !!source.retrievalEvent &&
    !!source.extractionMethod &&
    Number.isInteger(source.byteStart) &&
    Number.isInteger(source.byteEnd) &&
    source.byteStart >= 0 &&
    source.byteEnd > source.byteStart
  );
}

/**
 * Extract only from independently received or retrieved material. Every
 * admitted proposition remains attached to its exact source span.
 */
export function extractSourcePropositions(
  material: SourceMaterial,
): Proposition[] {
  if (!validSpan(material.source)) {
    throw new TypeError(
      "proposition admission requires a source id, byte span, retrieval event, and extraction method",
    );
  }
  const surfaces = extractSurfaces([{ text: material.text, order: 0 }]);
  const { verbs } = discoverVocabulary(material.text, {
    surfaces,
    minSurfaces: 1,
  });
  return extractTriples(material.text, { verbs }).map((relation) => ({
    ...relation,
    origin: material.origin,
    source: material.source,
  }));
}

/** Draft text may guide retrieval only; it cannot generate graph evidence. */
export function draftSearchTerms(draft: string): string[] {
  return [
    ...new Set(
      (draft.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? []).map((word) =>
        word.toLowerCase(),
      ),
    ),
  ].slice(0, 12);
}

/**
 * The sole graph-admission gate. It makes a fabricated System 1 entity a
 * no-op: draft-candidate propositions are rejected before readTriples can
 * create nodes, edges, belief movement, or a revision candidate.
 */
export function admitPropositions(
  graph: ReturnType<typeof createGraph>,
  propositions: Proposition[],
) {
  const admitted = propositions.filter(
    (proposition) =>
      proposition.origin !== "draft-candidate" && validSpan(proposition.source),
  );
  const rejected = propositions.length - admitted.length;
  const reading = admitted.length ? readTriples(graph, admitted) : null;
  return { admitted, rejected, reading };
}

/** Extract and admit one independently retrieved, byte-addressed passage. */
export function admitRetrievedMaterial(
  graph: ReturnType<typeof createGraph>,
  material: SourceMaterial,
) {
  return admitPropositions(graph, extractSourcePropositions(material));
}

export { createGraph };
