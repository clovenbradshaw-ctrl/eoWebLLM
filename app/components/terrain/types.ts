import type { ChatSession } from "../../store";

// Shared shapes for the terrain panel — see docs/citey-structured-grounding.md.
//
// Field/Entity/Link/Network/Atmosphere are real cards, backed by data that
// already exists in eo-hypergraph.ts/eo-corpus.ts. Kind/Lens/Paradigm render
// as permanent, honest gap-state cards (placeholder-card.tsx) — no engine
// export exists for Kind or full Paradigm content, and Lens cross-source
// comparison is an unsolved design problem. See that spec doc's §8 for why.

export type TerrainCardKind =
  | "field"
  | "entity"
  | "link"
  | "network"
  | "atmosphere"
  | "kind"
  | "lens"
  | "paradigm";

export const TERRAIN_CARD_KINDS: TerrainCardKind[] = [
  "entity",
  "link",
  "network",
  "atmosphere",
  "field",
  "kind",
  "lens",
  "paradigm",
];

/** Every trigger site (a chat citation chip, a cross-link inside an already
 *  open card) funnels into the same shape — one reference, resolved by the
 *  card itself from `params`. */
export interface TerrainCardRef {
  kind: TerrainCardKind;
  params: Record<string, string>;
}

/** Threaded down into every card so a cross-link (Entity's relation row,
 *  Link's "compare framing", Network's node click) opens the next card
 *  through the SAME history-owning entry point in chat.tsx, including a
 *  hop that lands on a placeholder — nav history stays consistent even
 *  when what it lands on isn't built yet. */
export type OnNavigate = (ref: TerrainCardRef) => void;

export interface TerrainCardProps {
  /** Full session, not just its id — Field needs session.eoSources to
   *  resolve a citation's source name back to its OPFS source id. */
  session: ChatSession;
  params: Record<string, string>;
  onNavigate: OnNavigate;
}

export const TERRAIN_TAB_LABEL: Record<TerrainCardKind, string> = {
  entity: "Entity",
  link: "Link",
  network: "Network",
  atmosphere: "Atmosphere",
  field: "Field",
  kind: "Kind",
  lens: "Lens",
  paradigm: "Paradigm",
};

/** Kind/Lens/Paradigm have no live data path today — see types.ts header. */
export const TERRAIN_GAP_KINDS: ReadonlySet<TerrainCardKind> = new Set([
  "kind",
  "lens",
  "paradigm",
]);

/** A docId ("turn:<id>" | "source:<id>", eo-hypergraph.ts's own admitOnce
 *  shapes) resolved to something a reader recognizes — which turn's message,
 *  or which uploaded source's name — rather than an opaque id. Returns null
 *  only when the id genuinely isn't found (e.g. a source shared in from
 *  another session of the same project isn't in THIS session's own
 *  eoSources list — acceptable degradation, not an error). */
export function resolveDocLabel(
  session: ChatSession,
  docId: string | null,
): string | null {
  if (!docId) return null;
  const i = docId.indexOf(":");
  if (i < 0) return null;
  const kind = docId.slice(0, i);
  const id = docId.slice(i + 1);
  if (kind === "source") {
    const source = session.eoSources?.find((s) => s.id === id);
    return source ? source.name : null;
  }
  if (kind === "turn") {
    const idx = session.messages.findIndex((m) => m.id === id);
    return idx >= 0 ? `turn ${idx + 1}` : null;
  }
  return null;
}
