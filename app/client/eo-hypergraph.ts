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
  /** The docId this admission was for (`source:<id>` or `turn:<id>`) — so a
   *  caller logging several movements at once can say which is which. */
  docId: string;
  newEdges: number;
  newNodes: number;
  stated: number;
  /** Which Interpretation-tier terrains this admission's own evidence
   *  climbed, in order (e.g. ["atmosphere"], or ["atmosphere","lens",
   *  "paradigm"] on an admission whose surprise survived all the way up) —
   *  emergence/tiers.js::foldThrough's own `results`/`reached`/`top`,
   *  never invented here. Empty when nothing folded (no relations stated).
   */
  reached: string[];
  /** The highest terrain this admission's evidence reached, or null. */
  top: string | null;
  /** Whether that top terrain's own gate passed — i.e. this admission
   *  registered as a genuine SHIFT at its highest reached terrain, not
   *  merely an observation that arrived and was absorbed without moving
   *  anything. */
  shiftedAtTop: boolean;
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
  /** verb|object (lowercased object) -> turns this self-fact was (re)stated on. */
  selfFactTurns: Map<string, { firstTurn: number; lastTurn: number }>;
  /** graph.tick (as it stood immediately after that tick's own admission) ->
   *  the docId admitted at that tick. admitGraph's readTriples advances
   *  graph.tick by exactly one per admitOnce call, so this is a plain,
   *  exact index — not a heuristic — from a node's own firstSeen/lastSeen
   *  tick (emergence/graph.js) back to which source or turn was admitted
   *  then. Populated in admitOnce, nowhere else. */
  tickToDocId: Map<number, string>;
  /** node id -> every docId whose admission created it or raised its
   *  mentions. eoreader6 itself only keeps firstSeen/lastSeen (one tick,
   *  not a history) on a node, so full per-doc provenance — which a
   *  source/conversation enable-toggle needs to filter the graph view — is
   *  tracked here instead, at the one place (admitOnce) that already knows
   *  which docId is being admitted. Populated by diffing graph.nodes
   *  immediately before/after each admission; nowhere else writes to this. */
  nodeDocIds: Map<string, Set<string>>;
  /** edge key -> every docId whose admission created it or changed its
   *  weight. Same reasoning/diffing as nodeDocIds above. */
  edgeDocIds: Map<string, Set<string>>;
}

function addProvenance(
  map: Map<string, Set<string>>,
  key: string,
  docId: string,
): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(docId);
}

/**
 * Which key a session's hypergraph reading lives under. Sources are already
 * project-scoped (`projectSources`, eo-corpus.ts's own sharing model — a
 * file uploaded in one session of a project is answerable from any other
 * session in the same project); the reading built FROM those sources — the
 * graph, the tier stack, the EOT admission log — now follows the same rule:
 * every session in a project shares ONE hypergraph, not one each. A session
 * with no `projectId` keeps exactly its own, as it always has. Every caller
 * below MUST go through this rather than reading `session.id` directly, or
 * a project's chats silently diverge into separate readings of what the
 * reader sees as one shared corpus.
 */
export function hypergraphScopeId(session: {
  id: string;
  projectId?: string;
}): string {
  return session.projectId ?? session.id;
}

const wrappers = new Map<string, HypergraphWrapper>();

function wrapperFor(chatSessionId: string): HypergraphWrapper {
  let w = wrappers.get(chatSessionId);
  if (!w) {
    w = {
      session: eoreader.createSession(),
      admitted: new Set(),
      hydrated: false,
      selfFactTurns: new Map(),
      tickToDocId: new Map(),
      nodeDocIds: new Map(),
      edgeDocIds: new Map(),
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
  // Snapshot mentions/weights BEFORE this admission so the diff below can
  // tell which nodes/edges this specific docId actually touched — the
  // engine's own graph.nodes/edges carry no per-doc history, only a
  // node's firstSeen/lastSeen tick, which isn't enough for "did docId X
  // contribute to this node" once a node has been touched more than once.
  const graphBefore = w.session?.graph;
  const mentionsBefore = new Map<string, number>();
  const weightsBefore = new Map<string, number>();
  if (graphBefore) {
    for (const [id, n] of graphBefore.nodes as Map<
      string,
      { mentions: number }
    >)
      mentionsBefore.set(id, n.mentions);
    for (const [key, weight] of graphBefore.edges as Map<string, number>)
      weightsBefore.set(key, weight);
  }
  eoreader.admitChunked(w.session, { text, sourceId: docId });
  eoreader.attachTiers(w.session, { seed: TIER_SEED });
  const { admitted } = eoreader.admitTiers(w.session, { sourceId: docId });
  const graphAfter = w.session?.graph;
  if (graphAfter) {
    for (const [id, n] of graphAfter.nodes as Map<
      string,
      { mentions: number }
    >) {
      if (n.mentions > (mentionsBefore.get(id) ?? 0))
        addProvenance(w.nodeDocIds, id, docId);
    }
    for (const [key, weight] of graphAfter.edges as Map<string, number>) {
      const prev = weightsBefore.get(key);
      if (prev === undefined || weight !== prev)
        addProvenance(w.edgeDocIds, key, docId);
    }
  }
  const one = admitted[0];
  const result = one?.admitted;
  if (!result) return null;
  // one.folded is emergence/tiers.js::foldThrough's own return shape
  // ({results, reached, top}) when this admission's evidence moved the
  // graph at all, or null when nothing was stated to fold (packages/host/
  // tiers.js::admitTiers, "folded: arrival.size > 0 ? foldThrough(...) :
  // null"). Read straight from it — never re-derived, never guessed —
  // so Amendment XXVI's "say which terrain, honestly" has something real
  // to report.
  const folded = one?.folded ?? null;
  const results: { tier: string; passed: boolean }[] = folded?.results ?? [];
  // graph.tick has already advanced past the tick this admission was
  // recorded at (admitGraph's readTriples increments once, after stamping
  // firstSeen/lastSeen on the nodes it touched) — so the tick this docId
  // owns is one behind wherever the counter now sits.
  const graphTick = w.session?.graph?.tick;
  if (typeof graphTick === "number") w.tickToDocId.set(graphTick - 1, docId);
  return {
    docId,
    newEdges: result.newEdges ?? 0,
    newNodes: result.newNodes ?? 0,
    stated: result.stated ?? 0,
    reached: results.map((r) => r.tier),
    top: folded?.top ?? null,
    shiftedAtTop:
      results.length > 0 ? results[results.length - 1]?.passed === true : false,
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
  turnIndex?: number,
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
  if (facts.length) admitSelfFacts(chatSessionId, facts, turnIndex);
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
  turnIndex?: number,
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
  for (const f of facts) {
    // Matches emergence/graph.js's own edgeKey exactly: subject/object
    // lowercased, verb left as-is — a mismatch here would silently make
    // these edges invisible to the enabled-source filter (no provenance
    // entry found -> the "unknown -> show" default saves it, but "always
    // shown, deliberately" is a different, correct claim than "shown by
    // accident").
    addProvenance(w.nodeDocIds, "user", SELF_FACT_GIVER);
    addProvenance(w.nodeDocIds, f.object.toLowerCase(), SELF_FACT_GIVER);
    addProvenance(
      w.edgeDocIds,
      `user|${f.verb}|${f.object.toLowerCase()}`,
      SELF_FACT_GIVER,
    );
  }
  if (Number.isFinite(turnIndex)) {
    for (const f of facts) {
      const key = `${f.verb}|${f.object.toLowerCase()}`;
      const prev = w.selfFactTurns.get(key);
      w.selfFactTurns.set(key, {
        firstTurn: prev ? prev.firstTurn : turnIndex!,
        lastTurn: turnIndex!,
      });
    }
  }
}

/**
 * Mechanistic — no token-overlap gate, no model call. Every edge whose
 * subject canonicalises to "user" is a fact about the user, by construction
 * (the only thing that ever writes such an edge is admitSelfFacts above),
 * so this is a direct read, not a search.
 */
export function queryUserFacts(
  chatSessionId: string,
  oldestVerbatimTurn?: number,
): { verb: string; object: string }[] {
  const w = wrappers.get(chatSessionId);
  const graph = w?.session?.graph;
  if (!graph?.edges) return [];
  const out: { verb: string; object: string }[] = [];
  for (const key of graph.edges.keys()) {
    const parts = String(key).split("|");
    if (parts.length !== 3 || parts[0] !== "user") continue;
    const verb = parts[1];
    const object = parts[2];
    if (oldestVerbatimTurn) {
      const turns = w?.selfFactTurns.get(`${verb}|${object.toLowerCase()}`);
      // No recorded turn (e.g. admitted via ensureHypergraphHydrated's bulk
      // admitOnce path, which bypasses admitSelfFacts, or before this
      // instrumentation existed) — unknown means we can't prove it's still
      // visible raw, so the safe default is to keep it.
      if (turns && turns.lastTurn >= oldestVerbatimTurn) continue;
    }
    out.push({ verb, object });
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
  /** How many nodes/edges actually matched this snapshot's own query, BEFORE
   *  the `nodes`/`edges` arrays above were sliced to `limit` for rendering —
   *  the correct baseline for "is this rendering incomplete", which is NOT
   *  `nodeCount`/`edgeCount` (the whole graph's totals) once a fold has
   *  narrowed things to one entity's small neighbourhood. Equal to
   *  `nodes.length`/`edges.length` when nothing was cut. */
  matchedNodeCount: number;
  matchedEdgeCount: number;
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
    // Unfolded: what's "matched" is just this snapshot's own strongest-N
    // window — the true totals (nodeCount/edgeCount) are the honest
    // "more exists" signal here, not a second matched count.
    matchedNodeCount: snap.nodes.length,
    matchedEdgeCount: snap.edgeCount,
  };
}

/**
 * Fold the graph terrain to one entity's own neighbourhood — every edge
 * whose subject or object names it, at the current cursor. Read-only;
 * `null` entity returns the unfolded snapshot's own edges unchanged.
 *
 * Reads `graph.edges`/`graph.nodes` directly (entityDetail's own pattern),
 * NOT the windowed "1000 strongest" `hypergraphSnapshot` — a fold is asking
 * about ONE entity, and a match on a low-weight edge must not go invisible
 * just because it missed the strongest-edges cut a whole-graph view uses.
 */
export function foldGraphOnEntity(
  chatSessionId: string,
  entity: string | null,
  { limit = 60 }: { limit?: number } = {},
): GraphTerrainSnapshot | null {
  if (!entity) {
    const snap = hypergraphSnapshot(chatSessionId, { limit: 1000 });
    if (!snap) return null;
    return {
      ...snap,
      edges: snap.edges.slice(0, limit),
      matchedNodeCount: snap.nodes.length,
      matchedEdgeCount: snap.edgeCount,
    };
  }

  const w = wrappers.get(chatSessionId);
  const graph = w?.session?.graph;
  if (!graph?.nodes || !graph?.edges) return null;

  const needle = entity.toLowerCase();
  const allEdges: { edge: string; weight: number }[] = [];
  for (const [key, weight] of graph.edges as Map<string, number>) {
    if (String(key).toLowerCase().includes(needle))
      allEdges.push({ edge: key, weight });
  }
  const edges = allEdges.slice(0, limit);
  // Only the subject/object (index 0/2) are node ids — the verb (index 1)
  // is a relation label, never a key in graph.nodes, and folding it into
  // "touched" inflated matchedNodeCount with entries that can never
  // resolve to a real node below.
  const endpoints = (edge: string) => {
    const parts = edge.split("|");
    return parts.length === 3 ? [parts[0], parts[2]] : [];
  };
  const allTouched = new Set<string>();
  for (const e of allEdges)
    for (const id of endpoints(e.edge)) allTouched.add(id);
  const touched = new Set<string>();
  for (const e of edges) for (const id of endpoints(e.edge)) touched.add(id);
  const nodes = [...touched]
    .map((id) => graph.nodes.get(id))
    .filter((n): n is { id: string; mentions: number } => Boolean(n))
    .map((n) => ({ id: n.id, mentions: n.mentions }));

  return {
    nodeCount: graph.nodes.size,
    edgeCount: graph.edges.size,
    cursor: graph.tick,
    nodes,
    edges,
    matchedNodeCount: allTouched.size,
    matchedEdgeCount: allEdges.length,
  };
}

export interface EntityDetail {
  id: string;
  mentions: number;
  firstSeenDocId: string | null;
  lastSeenDocId: string | null;
  /** Every edge touching this node — unlike hypergraphSnapshot/foldGraphOnEntity, not capped for a terminal render. */
  edges: { edge: string; weight: number }[];
}

/**
 * One entity's own detail — mentions, first/last-admitted docId, every edge
 * that names it. Reads emergence/graph.js's live nodes/edges Maps directly
 * (the same Maps queryUserFacts already reads), not the capped/flattened
 * hypergraphSnapshot, since a terrain card wants the whole neighbourhood,
 * not a terminal-sized slice of it.
 */
export function entityDetail(
  chatSessionId: string,
  entity: string,
): EntityDetail | null {
  const w = wrappers.get(chatSessionId);
  const graph = w?.session?.graph;
  if (!graph?.nodes) return null;
  const id = entity.toLowerCase();
  const node = graph.nodes.get(id);
  if (!node) return null;
  const edges: { edge: string; weight: number }[] = [];
  for (const [key, weight] of graph.edges as Map<string, number>) {
    const parts = String(key).split("|");
    if (parts.length === 3 && (parts[0] === id || parts[2] === id))
      edges.push({ edge: key, weight });
  }
  return {
    id: node.id,
    mentions: node.mentions,
    firstSeenDocId: w!.tickToDocId.get(node.firstSeen) ?? null,
    lastSeenDocId: w!.tickToDocId.get(node.lastSeen) ?? null,
    edges,
  };
}

export interface LinkDetail {
  edge: string;
  subject: string;
  verb: string;
  object: string;
  weight: number;
  /** DERIVED bound (min/max over the two endpoint nodes' own firstSeen/
   *  lastSeen ticks), NOT an authoritative per-edge timestamp — readTriples
   *  (emergence/graph.js) never timestamps an edge itself, only the nodes
   *  it touches. Render as "seen between X and Y", never "stated on X". */
  firstSeenDocId: string | null;
  lastSeenDocId: string | null;
}

/**
 * One link's own detail. `edgeOrKey` accepts either the flattened
 * "subject|verb|object" edge string GraphTerrainSnapshot already hands out
 * (verb may carry a leading "!" for negative polarity, per graph.js's
 * edgeKey) or a bare "subject|verb|object" the caller assembled itself —
 * both are the same lookup key into graph.edges.
 */
export function linkDetail(
  chatSessionId: string,
  edgeOrKey: string,
): LinkDetail | null {
  const w = wrappers.get(chatSessionId);
  const graph = w?.session?.graph;
  if (!graph?.edges) return null;
  const weight = (graph.edges as Map<string, number>).get(edgeOrKey);
  if (weight === undefined) return null;
  const parts = edgeOrKey.split("|");
  if (parts.length !== 3) return null;
  const [subject, verb, object] = parts;
  const subjectNode = graph.nodes.get(subject);
  const objectNode = graph.nodes.get(object);
  const firstSeenTick =
    subjectNode && objectNode
      ? Math.min(subjectNode.firstSeen, objectNode.firstSeen)
      : (subjectNode ?? objectNode)?.firstSeen;
  const lastSeenTick =
    subjectNode && objectNode
      ? Math.max(subjectNode.lastSeen, objectNode.lastSeen)
      : (subjectNode ?? objectNode)?.lastSeen;
  return {
    edge: edgeOrKey,
    subject,
    verb,
    object,
    weight,
    firstSeenDocId:
      typeof firstSeenTick === "number"
        ? (w!.tickToDocId.get(firstSeenTick) ?? null)
        : null,
    lastSeenDocId:
      typeof lastSeenTick === "number"
        ? (w!.tickToDocId.get(lastSeenTick) ?? null)
        : null,
  };
}

/** Pure string parsing — a docId is always "turn:<id>" or "source:<id>" (admitOnce's own docId shapes), never anything else. */
export function resolveDocId(
  docId: string,
): { kind: "turn" | "source"; id: string } | null {
  const i = docId.indexOf(":");
  if (i < 0) return null;
  const kind = docId.slice(0, i);
  if (kind !== "turn" && kind !== "source") return null;
  return { kind, id: docId.slice(i + 1) };
}

/** Minimal session shape the enabled-source/conversation filter below needs
 *  — never the full ChatSession type (that lives in app/store/chat.ts, and
 *  this file must not import it back). */
export interface DocEnabledSession {
  eoSources?: { id: string; enabled: boolean }[];
  eoConversationEnabled?: boolean;
}

/**
 * Is a docId's own source (an uploaded file, or the conversation itself)
 * currently enabled? A docId that isn't "turn:"/"source:" shaped (right
 * now, only SELF_FACT_GIVER) is never hidden — a self-declared fact has no
 * corresponding toggle in the UI, so filtering it would silently disappear
 * something the reader has no way to bring back.
 */
export function isDocEnabled(
  docId: string,
  session: DocEnabledSession,
): boolean {
  const resolved = resolveDocId(docId);
  if (!resolved) return true;
  if (resolved.kind === "turn") return session.eoConversationEnabled !== false;
  const source = session.eoSources?.find((s) => s.id === resolved.id);
  // A source id this session doesn't recognise (e.g. a project-shared
  // reading whose source list this particular session object hasn't
  // loaded) is a "can't prove it's disabled" case, not a "hide it" case.
  return source ? source.enabled : true;
}

/**
 * Is a node/edge visible under the current enabled-source/conversation
 * toggles? Visible if ANY docId that contributed to it is enabled, or if
 * it has no recorded provenance at all (nothing here should regress to
 * "invisible" just because provenance tracking — added after the graph
 * already existed in some sessions — never saw this one admitted).
 */
export function isNodeVisible(
  chatSessionId: string,
  nodeId: string,
  session: DocEnabledSession,
): boolean {
  const docs = wrappers.get(chatSessionId)?.nodeDocIds.get(nodeId);
  if (!docs || docs.size === 0) return true;
  for (const d of docs) if (isDocEnabled(d, session)) return true;
  return false;
}

export function isEdgeVisible(
  chatSessionId: string,
  edgeKey: string,
  session: DocEnabledSession,
): boolean {
  const docs = wrappers.get(chatSessionId)?.edgeDocIds.get(edgeKey);
  if (!docs || docs.size === 0) return true;
  for (const d of docs) if (isDocEnabled(d, session)) return true;
  return false;
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
 * Backfill a chat session's graph from whatever it hasn't admitted yet —
 * its registered sources and its past messages — so the graph is never
 * missing something the reader can already see attached to this chat.
 *
 * FIXED, same session as this comment: this used to short-circuit after
 * its first call (`if (w.hydrated) return`), which meant a source uploaded
 * AFTER a chat's first message was silently never admitted — the outer
 * `hydrated` flag was a stale optimization on top of a check (`admitOnce`'s
 * own `w.admitted.has(docId)`) that already makes re-running this loop
 * cheap and correct. Removed; every call now re-scans and admits only what
 * is genuinely new, which is exactly what admitOnce already guarantees.
 *
 * Returns the real per-admission movement for each newly-admitted source or
 * turn (Amendment XXVI, eoreader6/SEED.md — "a host must say which terrain
 * it is reporting from, not silently pretend to a depth it has not
 * earned") — callers push these to the EOT log themselves, since only the
 * caller knows the right session to log against.
 */
export function isHypergraphHydrated(chatSessionId: string): boolean {
  return !!wrappers.get(chatSessionId)?.hydrated;
}

export function ensureHypergraphHydrated(
  chatSessionId: string,
  sources: { id: string; text: string }[],
  turns: { id: string; content: string }[],
): HypergraphMovement[] {
  const w = wrapperFor(chatSessionId);
  w.hydrated = true;
  const movements: HypergraphMovement[] = [];
  for (const s of sources) {
    const m = admitOnce(w, `source:${s.id}`, s.text);
    if (m) movements.push(m);
  }
  // Mirrors admitHypergraphTurn's own reasoning below: eoreader6's
  // proper-noun relation extractor (packages/engine/perceiver/text/
  // surfaces.js) skips a sentence's first token and requires capitalised
  // multi-word surfaces — sound for narrative documents, but it routinely
  // finds nothing in ordinary short chat turns ("My name is Marcus",
  // "Priya's date conflict"). admitHypergraphTurn compensates for the
  // LIVE turn by also running extractSelfFacts/admitSelfFacts; this bulk
  // backfill path used to skip that compensation entirely, so a session
  // hydrated from history (every turn already in session.messages when a
  // chat is opened or re-loaded, not just the one being typed right now)
  // fell back to eoreader6's raw admission alone and silently produced a
  // graph with (near) zero nodes/edges for conversations full of exactly
  // the self-stated facts this feature exists to capture. Every historical
  // turn now gets the same self-facts pass the live turn always got.
  for (const t of turns) {
    const m = admitOnce(w, `turn:${t.id}`, t.content);
    if (m) movements.push(m);
    const facts = extractSelfFacts(t.content);
    if (facts.length) admitSelfFacts(chatSessionId, facts);
  }
  return movements;
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

/**
 * One EOT log line for a single admission — Amendment XXVI (eoreader6/
 * SEED.md): say which terrain a reading actually reached, honestly, every
 * time, not only in aggregate at query time (describeHypergraphNavigation,
 * above). Shared by every call site that admits something, so an admission
 * is never logged two different ways depending on which path it came in
 * through (a source at hydration time, a turn admitted mid-conversation).
 */
export function describeHypergraphMovement(m: HypergraphMovement): string {
  const climb = m.reached.length
    ? `climbed to ${m.top}${m.shiftedAtTop ? " (shifted)" : " (observed, no shift)"} via ${m.reached.join("->")}`
    : "no relations stated — nothing to fold";
  return `admitted ${m.docId}: ${m.newNodes} new node(s), ${m.newEdges} new edge(s), ${m.stated} relation(s) stated — ${climb}`;
}

// ── Stage 2 — the targeted background call ──────────────────────────────

const THOUGHT_SYSTEM_PROMPT = `You are a background note-writer for a chat assistant. You are given a list of known entities and relations (gathered mechanically from documents and this conversation, not written by you) that share words with the reader's current question, plus a short passage or two.

Write ONE OR TWO PLAIN SENTENCES of background orientation the assistant might find useful — never a list, never a citation, never a quotation. If nothing here actually helps answer the question, reply with exactly: NONE.`;

export function buildThoughtUserPrompt(
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
