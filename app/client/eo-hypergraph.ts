// eo-hypergraph.ts — wires eoreader6's per-document relation graph into
// eochat's surf/fold pipeline as a third grounding channel, alongside the
// corpus fold (eo-corpus.ts) and the discourse fold (eo-discourse.ts).
//
// Every source uploaded to this chat, AND every turn of the conversation
// itself (both sides), is admitted into one running eoreader6 session per
// chat session — so the graph accumulates entities and relations discussed
// IN the conversation, not only in uploaded files.
//
// TWO STAGES, the same System-1/System-2 split the rest of this app runs
// on:
//   1. NAVIGATE (mechanical, no model call): eoreader6's own surf
//      (executePrompt) and fold (foldSpans/searchSpans) over the
//      accumulated corpus, plus the graph nodes/edges that actually touch
//      this turn's own words. Structured data — never sent to the talking
//      model.
//   2. THOUGHT (one small background model call, the same eoRunBackground
//      seam eo-math-check.ts and eo-tool-router.ts already use): reads that
//      structured navigation and writes ONE OR TWO PLAIN SENTENCES. Only
//      that prose reaches the talking model, and only when the navigation
//      found something that actually bears on this turn's own words — a
//      standing dump of the graph's strongest edges, re-announced turn
//      after turn regardless of relevance, is bloat, not signal.
//
// The full navigation (every node/edge/span considered, not just what
// cleared the relevance gate) is always reported to the eo-log's
// "hypergraph" channel, so a reader can see the whole search even on a turn
// where nothing bounded reached the model.
//
// eo-warrant.ts's "hypergraph" channel marks a drafted thought
// kind: "paraphrase", canWarrant: false — it can orient the model, it can
// never be the evidence for a claim.

// eoreader6 ships no type declarations (it is a plain-JS library, deliberately
// undeclared per its own package.json) and TypeScript's JSDoc-driven
// inference over its destructured-parameter functions produces spurious
// required/optional mismatches that have nothing to do with this file's own
// correctness — so the boundary is cast once, here, rather than fought
// call by call.
import * as eoreaderHost from "../../eoreader6/packages/host/index.js";
const eoreader: any = eoreaderHost;
import { extractSelfFacts } from "./eo-self-facts";

export interface HypergraphMovement {
  newEdges: number;
  newNodes: number;
  stated: number;
}

export interface HypergraphNavigation {
  /** Graph nodes whose id shares a token with this turn's own words. */
  relevantNodes: { id: string; mentions: number }[];
  /** Graph edges (subject|verb|object strings) touching this turn's words. */
  relevantEdges: { edge: string; weight: number }[];
  /** Lexical fold over the corpus — up to a few short passages. */
  foldSummary: string;
  /** eoreader6's mechanical NL-prompt surf: one address, or a typed gap. */
  surfSnip: string | null;
  /** Total graph size, for the log — never sent to the model. */
  graphNodeCount: number;
  graphEdgeCount: number;
}

interface HypergraphWrapper {
  session: any;
  admitted: Set<string>;
  hydrated: boolean;
}

const wrappers = new Map<string, HypergraphWrapper>();

function wrapperFor(chatSessionId: string): HypergraphWrapper {
  let w = wrappers.get(chatSessionId);
  if (!w) {
    w = {
      session: eoreader.createSession(),
      admitted: new Set(),
      hydrated: false,
    };
    wrappers.set(chatSessionId, w);
  }
  return w;
}

/**
 * Admit one piece of content (an uploaded source, or one conversation turn)
 * into the session's corpus AND fold its relations into the running graph.
 * Guarded by `docId` — eoreader6's admitChunked is itself content-addressed
 * and safe to call twice, but admitGraph's readTriples is NOT (see
 * packages/host/graph.js's own header: a repeat admission is real belief
 * movement, by design, so the caller — this file — is the one place that
 * must not admit the same immutable turn or source twice).
 */
// Fixed, declared — not Date.now()/a random session id — the same standing
// this app's other eoreader6 callers already hold (host/tiers.js itself
// throws rather than default one): a tier stack's seed does not need to be
// UNIQUE across chat sessions, only declared, so every session's stack is a
// reproducible reading of that session's own turns.
const TIER_SEED = 20260810;

function admitOnce(
  w: HypergraphWrapper,
  docId: string,
  text: string,
): HypergraphMovement | null {
  if (!text.trim() || w.admitted.has(docId)) return null;
  w.admitted.add(docId);
  eoreader.admitChunked(w.session, { text, sourceId: docId });
  eoreader.attachTiers(w.session, { seed: TIER_SEED });
  const { admitted } = eoreader.admitTiers(w.session, { sourceId: docId });
  const result = admitted[0]?.admitted;
  if (!result) return null;
  return {
    newEdges: result.newEdges ?? 0,
    newNodes: result.newNodes ?? 0,
    stated: result.stated ?? 0,
  };
}

export function admitHypergraphSource(
  chatSessionId: string,
  source: { id: string; text: string },
): HypergraphMovement | null {
  return admitOnce(
    wrapperFor(chatSessionId),
    `source:${source.id}`,
    source.text,
  );
}

export function admitHypergraphTurn(
  chatSessionId: string,
  turn: { id: string; content: string },
): HypergraphMovement | null {
  const movement = admitOnce(
    wrapperFor(chatSessionId),
    `turn:${turn.id}`,
    turn.content,
  );
  // Self-facts are extracted from every turn's own text, not gated on
  // admitOnce's dedup above: a duplicate docId (unusual, but not this
  // function's business to assume against) still names its own content,
  // and extraction is pure/idempotent on unchanged text either way — the
  // real dedup that matters is per-VERB inside admitSelfFacts's own
  // injectPrior call, which is intentionally NOT deduped (a restated fact
  // is real, if redundant, evidence, the same standing readTriples holds
  // everywhere else in this codebase).
  const facts = extractSelfFacts(turn.content);
  if (facts.length) admitSelfFacts(chatSessionId, facts);
  return movement;
}

// ── Self-facts: a received prior injected directly, never re-derived ────
//
// eo-self-facts.ts's extraction is pure (no eoreader6 import); this is the
// one place its output actually reaches a graph, and it reaches the SAME
// graph admitHypergraphTurn already builds — a self-declared name and a
// name discovered through ordinary relation extraction canonicalise onto
// one node, not two. injectPrior (emergence/graph.js) is eoreader6's own
// mechanism for exactly this: a fact whose origin is not "found in the
// text" but "handed in," and it refuses to run without a named giver.

const SELF_FACT_GIVER = "eo-self-facts:user-stated";

export function admitSelfFacts(
  chatSessionId: string,
  facts: { verb: string; object: string }[],
): void {
  if (!facts.length) return;
  const w = wrapperFor(chatSessionId);
  const graph = eoreader.attachGraph(w.session);
  const triples = facts.map((f) => ({
    subject: "user",
    verb: f.verb,
    object: f.object,
  }));
  eoreader.injectPrior(graph, triples, { giver: SELF_FACT_GIVER });
}

/**
 * Mechanistic — no token-overlap gate, no model call. Every edge whose
 * subject canonicalises to "user" is a fact about the user, by construction
 * (the only thing that ever writes such an edge is admitSelfFacts above),
 * so this is a direct read, not a search.
 */
export function queryUserFacts(
  chatSessionId: string,
): { verb: string; object: string }[] {
  const w = wrappers.get(chatSessionId);
  const graph = w?.session?.graph;
  if (!graph?.edges) return [];
  const out: { verb: string; object: string }[] = [];
  for (const key of graph.edges.keys()) {
    const parts = String(key).split("|");
    if (parts.length !== 3 || parts[0] !== "user") continue;
    out.push({ verb: parts[1], object: parts[2] });
  }
  return out;
}

// ── Terminal exposure: the graph and tier stack, as data, and one fold ──
//
// "Pivot" is not a new mechanism: it is the SAME fold this file's own
// click-to-fold entity narrowing already performs on the eo-log terminal
// (renderEotEntryText / eotFoldEntity in chat.tsx), applied to the graph
// instead of the log — and it has the same cursor that fold always had,
// namely the graph's own `tick` (emergence/graph.js's append-only advance
// counter, incremented once per admission), never a separately-invented
// position. Folding to an entity does not mutate the graph; it is a
// read-only projection over graph.edges as they stand at the current tick,
// exactly as `readDocument(log, lenses, cursor)` projects the modifier-
// order ledger at a named cursor elsewhere in this app.

export interface GraphTerrainSnapshot {
  nodeCount: number;
  edgeCount: number;
  cursor: number;
  nodes: { id: string; mentions: number }[];
  edges: { edge: string; weight: number }[];
}

/** Plain-data graph view for the terminal's Graph tab — never the live Maps. */
export function hypergraphSnapshot(
  chatSessionId: string,
  { limit = 60 }: { limit?: number } = {},
): GraphTerrainSnapshot | null {
  const w = wrappers.get(chatSessionId);
  if (!w?.session?.graph) return null;
  const snap = eoreader.sessionGraphSnapshot(w.session, { limit });
  return {
    nodeCount: snap.nodeCount,
    edgeCount: snap.edgeCount,
    cursor: snap.tick,
    nodes: snap.nodes,
    edges: snap.edges,
  };
}

/**
 * Fold the graph terrain to one entity's own neighbourhood — every edge
 * whose subject or object names it, at the current cursor. Read-only;
 * `null` entity returns the unfolded snapshot's own edges unchanged.
 */
export function foldGraphOnEntity(
  chatSessionId: string,
  entity: string | null,
  { limit = 60 }: { limit?: number } = {},
): GraphTerrainSnapshot | null {
  const snap = hypergraphSnapshot(chatSessionId, { limit: 1000 });
  if (!snap) return null;
  if (!entity) return { ...snap, edges: snap.edges.slice(0, limit) };
  const needle = entity.toLowerCase();
  const edges = snap.edges
    .filter((e) => e.edge.toLowerCase().includes(needle))
    .slice(0, limit);
  const touched = new Set<string>();
  for (const e of edges)
    for (const part of e.edge.split("|")) touched.add(part);
  const nodes = snap.nodes.filter((n) => touched.has(n.id)).slice(0, limit);
  return { ...snap, nodes, edges };
}

export interface TierShiftRecord {
  at: number;
  tier: string;
  surprise: number;
  rank: number | null;
  censored: string | null;
  reZero: boolean;
  forms: string[];
}

export interface TierTerrainSnapshot {
  seeded: boolean;
  cursor: number;
  tiers: {
    name: string;
    observations: number;
    shifts: number;
    novelRate: number;
    recentShifts: TierShiftRecord[];
  }[];
}

/** Plain-data tier-stack view for the terminal's Graph tab — the Atmosphere/Lens/Paradigm reading alongside the graph, from the same session. */
export function hypergraphTiersSnapshot(
  chatSessionId: string,
): TierTerrainSnapshot | null {
  const w = wrappers.get(chatSessionId);
  if (!w?.session?.tiers) return null;
  const snap = eoreader.sessionTiersSnapshot(w.session);
  const cursor = w.session.tiersAdmitted?.size ?? 0;
  return { ...snap, cursor };
}

/**
 * Backfill a resumed chat session's graph from what it already has on first
 * use this page-load — its registered sources and its past messages — so
 * the graph is not empty every time the app reloads. A no-op past the first
 * call (tracked on the wrapper), since every source/turn id is admitted at
 * most once regardless.
 */
export function isHypergraphHydrated(chatSessionId: string): boolean {
  return !!wrappers.get(chatSessionId)?.hydrated;
}

export function ensureHypergraphHydrated(
  chatSessionId: string,
  sources: { id: string; text: string }[],
  turns: { id: string; content: string }[],
): void {
  const w = wrapperFor(chatSessionId);
  if (w.hydrated) return;
  w.hydrated = true;
  for (const s of sources) admitOnce(w, `source:${s.id}`, s.text);
  for (const t of turns) admitOnce(w, `turn:${t.id}`, t.content);
}

const tokenize = (s: string): string[] => [
  ...new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
];

/** Stage 1 — mechanical navigation. No model call anywhere in this function. */
export function navigateHypergraph(
  chatSessionId: string,
  query: string,
): HypergraphNavigation | null {
  const w = wrappers.get(chatSessionId);
  if (!w || !query.trim()) return null;

  const snapshot = eoreader.sessionGraphSnapshot(w.session, { limit: 60 });
  const tokens = tokenize(query);
  const touches = (s: string) => tokens.some((t) => s.includes(t));

  const relevantNodes = snapshot.nodes
    .filter((n: { id: string }) => touches(n.id))
    .slice(0, 8)
    .map((n: { id: string; mentions: number }) => ({
      id: n.id,
      mentions: n.mentions,
    }));
  const relevantEdges = snapshot.edges
    .filter((e: { edge: string }) => touches(e.edge))
    .slice(0, 8);

  let foldSummary = "";
  try {
    const { spans } = eoreader.searchSpans(w.session, { query, limit: 6 });
    const units = eoreader.spanUnits(w.session, spans);
    foldSummary = eoreader.foldSpans(w.session, {
      units,
      query,
      tokenBudget: 600,
      maxUnits: 3,
    }).summary;
  } catch {
    // Mechanical retrieval failing closed costs this turn a fold, not a crash.
  }

  let surfSnip: string | null = null;
  try {
    const surf = eoreader.executePrompt(w.session, query);
    if (surf && !surf.gap && typeof surf.text === "string")
      surfSnip = surf.text.slice(0, 500);
  } catch {
    surfSnip = null;
  }

  return {
    relevantNodes,
    relevantEdges,
    foldSummary,
    surfSnip,
    graphNodeCount: snapshot.nodeCount,
    graphEdgeCount: snapshot.edgeCount,
  };
}

/** Is there anything in this turn's own words the graph actually knows about? The gate: no signal, no background call, nothing added to the prompt. */
export function hasHypergraphSignal(nav: HypergraphNavigation | null): boolean {
  return (
    !!nav && (nav.relevantNodes.length > 0 || nav.relevantEdges.length > 0)
  );
}

/** Full detail, for the eo-log "hypergraph" channel — never sent to the model. */
export function describeHypergraphNavigation(
  nav: HypergraphNavigation,
): string {
  const parts = [
    `graph: ${nav.graphNodeCount} node(s), ${nav.graphEdgeCount} edge(s) total`,
  ];
  if (nav.relevantNodes.length) {
    parts.push(
      `relevant entities: ${nav.relevantNodes.map((n) => `${n.id} (${n.mentions})`).join(", ")}`,
    );
  }
  if (nav.relevantEdges.length) {
    parts.push(
      `relevant relations: ${nav.relevantEdges.map((e) => `${e.edge} [${e.weight.toFixed(2)}]`).join("; ")}`,
    );
  }
  if (nav.surfSnip)
    parts.push(
      `surf: ${nav.surfSnip.slice(0, 160)}${nav.surfSnip.length > 160 ? "…" : ""}`,
    );
  if (!nav.relevantNodes.length && !nav.relevantEdges.length)
    parts.push("no relation in the graph touches this turn's own words");
  return parts.join(" · ");
}

// ── Stage 2 — the targeted background call ──────────────────────────────

const THOUGHT_SYSTEM_PROMPT = `You are a background note-writer for a chat assistant. You are given a list of known entities and relations (gathered mechanically from documents and this conversation, not written by you) that share words with the reader's current question, plus a short passage or two.

Write ONE OR TWO PLAIN SENTENCES of background orientation the assistant might find useful — never a list, never a citation, never a quotation. If nothing here actually helps answer the question, reply with exactly: NONE.`;

function buildThoughtUserPrompt(
  nav: HypergraphNavigation,
  question: string,
): string {
  const lines: string[] = [`Question: ${question}`];
  if (nav.relevantEdges.length) {
    lines.push(
      "Known relations:",
      ...nav.relevantEdges.map((e) => `- ${e.edge.replace(/\|/g, " ")}`),
    );
  }
  if (nav.relevantNodes.length) {
    lines.push(
      `Known entities: ${nav.relevantNodes.map((n) => n.id).join(", ")}`,
    );
  }
  if (nav.foldSummary) lines.push("Passage:", nav.foldSummary.slice(0, 800));
  return lines.join("\n");
}

const THOUGHT_MAX_CHARS = 400;

export async function draftHypergraphThought({
  navigation,
  question,
  generate,
}: {
  navigation: HypergraphNavigation;
  question: string;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<string | null> {
  const raw = await generate(
    THOUGHT_SYSTEM_PROMPT,
    buildThoughtUserPrompt(navigation, question),
  );
  const thought = raw.trim();
  if (!thought || /^none\.?$/i.test(thought)) return null;
  return thought.slice(0, THOUGHT_MAX_CHARS);
}

/** Bounded, prose-only — the only piece of this module the talking model ever sees. */
export function buildHypergraphThoughtBlock(thought: string): string {
  return `HYPERGRAPH THOUGHT — a background model's own synthesis over entities and relations gathered from this conversation and its sources. Not a quotation of anything and not a citable source; it may orient you, it may never be the evidence for a claim.\n${thought}`;
}
