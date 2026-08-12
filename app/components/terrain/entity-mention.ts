import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";

// Entity mentions in chat message text — a third trigger site for the
// terrain panel (docs/citey-structured-grounding.md §6, alongside the chat
// citation chip and cross-links inside an already-open card). The SAME
// mechanism as grounding-chip.tsx's remarkGroundingChips: sentinel-wrap
// spans in the raw message text, mint synthetic "eo-entity" elements via
// mdast-util-to-hast's data.hName escape hatch, intercept in markdown.tsx's
// `components` map. The click funnels through chat.tsx's openTerrainCard
// ({ kind: "entity" }), the same entry point every trigger site shares.
// (The rendered chip is entity-mention-chip.tsx — this file is the pure,
// node-testable half.)
//
// Two deliberate differences from grounding chips:
//   - The click target is entities the session's hypergraph has ALREADY
//     admitted (eo-hypergraph.ts's graph nodes, top-N by mentions via
//     hypergraphSnapshot) — never a fresh NLP pass over message text, so
//     the affordance only appears where the app already has a card to open.
//   - Sentinel characters differ (grounding uses \uE050-\uE052) so the two
//     span types never collide. Entity wrapping runs AFTER grounding
//     wrapping in markdown.tsx, and any match that overlaps a grounding
//     chip's own sentinel pair is dropped rather than nested — the remark
//     pipeline renders a grounding chip's inner text as plain text
//     (data.hChildren), never as mdast, so an entity sentinel inside it
//     would leak as literal characters. Evidence outranks navigation when
//     they'd fight over the same slice of text.

const OPEN = "\uE053";
const SEP = "\uE054";
const CLOSE = "\uE055";
const SENTINEL_RE = /\uE053(\d+)\uE054([\s\S]*?)\uE055/g;

// The grounding-chip.tsx pair — entity wrapping must not climb inside it.
const GROUNDING_OPEN = "\uE050";
const GROUNDING_CLOSE = "\uE052";

/** Intervals (in the already-grounding-wrapped content) that a grounding
 *  chip owns. Grounding chips are non-overlapping by construction
 *  (wrapGroundingSpans's own nonOverlapping pass), so scanning to the first
 *  CLOSE after each OPEN is a faithful interval list. */
function protectedIntervals(raw: string): [number, number][] {
  const out: [number, number][] = [];
  let start = raw.indexOf(GROUNDING_OPEN);
  while (start >= 0) {
    const close = raw.indexOf(GROUNDING_CLOSE, start);
    if (close < 0) break;
    out.push([start, close + 1]);
    start = raw.indexOf(GROUNDING_OPEN, close + 1);
  }
  return out;
}

/** Mechanically noise-gated eligible ids — the gates are deliberate and
 *  minimal: an id that's "user" is the self-fact giver's generic subject
 *  (every conversation has a node for it; clicking it opens a card about
 *  nothing), and an id under 3 chars is substring noise, not an entity a
 *  reader would want to navigate on. Everything else the graph admitted is
 *  a legitimate target — no vocabulary, no stopword list to rot. */
function eligibleIds(entityIds: string[]): { id: string; index: number }[] {
  const out: { id: string; index: number }[] = [];
  for (let i = 0; i < entityIds.length; i++) {
    const id = entityIds[i];
    if (id.length >= 3 && id !== "user") out.push({ id, index: i });
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface EntityMatch {
  /** The original index into the caller's entityIds array — the index the
   *  sentinel encodes, so EntityMentionChip can resolve it against the SAME
   *  array the caller passed down (never the noise-gated sublist above). */
  index: number;
  start: number;
  end: number;
}

/** Whole-word, case-insensitive matches of every eligible id against
 *  `raw` (which may already carry grounding sentinels), skipping any match
 *  that overlaps a grounding chip. The boundary lookbehind/lookahead on
 *  [\p{L}\p{N}] keeps "run" from matching inside "running" without needing
 *  a stopword list, and the sentinel chars are PUA — never letters or
 *  digits — so a multi-word id can't match across a sentinel pair. */
function findMatches(
  raw: string,
  ids: { id: string; index: number }[],
  protectedRanges: [number, number][],
): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const overlapsProtected = (start: number, end: number) =>
    protectedRanges.some(([ps, pe]) => start < pe && end > ps);
  for (const { id, index } of ids) {
    let re: RegExp;
    try {
      re = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(id).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`,
        "giu",
      );
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      if (m[0].length === 0) break;
      const start = m.index;
      const end = m.index + m[0].length;
      if (!overlapsProtected(start, end)) matches.push({ index, start, end });
    }
  }
  return matches;
}

/** Wraps each matched mention in entity sentinels. Applied AFTER
 *  wrapGroundingSpans in markdown.tsx, against that output — never against
 *  the raw content — so a mention inside a grounding chip is skipped (see
 *  the header), and before escapeDollarNumber/escapeBrackets, which are
 *  insertion-only and never touch the sentinel markers. */
export function wrapEntityMentions(
  rawContent: string,
  entityIds: string[] | undefined,
): string {
  if (!entityIds?.length) return rawContent;
  const ids = eligibleIds(entityIds);
  if (!ids.length) return rawContent;
  const matches = findMatches(rawContent, ids, protectedIntervals(rawContent));
  if (!matches.length) return rawContent;

  // Longest-first so "metro nashville police department" claims its mention
  // before the shorter "nashville" that is a substring of it. Among
  // non-overlapping mentions ALL are kept — the length ordering must not
  // let a long match on the right silently drop an unrelated mention on
  // the left (a cursor-based pass would), so a candidate is rejected only
  // when it actually overlaps an already-chosen one. Re-sorted by position
  // afterward for the wrap pass.
  matches.sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const chosen: EntityMatch[] = [];
  for (const m of matches) {
    if (chosen.some((c) => m.start < c.end && m.end > c.start)) continue;
    chosen.push(m);
  }
  chosen.sort((a, b) => a.start - b.start);

  let out = "";
  let pos = 0;
  for (const c of chosen) {
    out += rawContent.slice(pos, c.start);
    out += `${OPEN}${c.index}${SEP}${rawContent.slice(c.start, c.end)}${CLOSE}`;
    pos = c.end;
  }
  out += rawContent.slice(pos);
  return out;
}

/** Remark plugin — the exact shape of remarkGroundingChips (grounding-chip
 *  .tsx), for the entity sentinel set: splits any `text` node containing
 *  entity sentinel markers into plain text plus synthetic "eo-entity"
 *  nodes. A pair separated across two text nodes by markdown syntax inside
 *  it stays inert plain text, never a crash — same graceful degradation as
 *  the grounding plugin. */
export function remarkEntityMentions() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      SENTINEL_RE.lastIndex = 0;
      if (!SENTINEL_RE.test(node.value)) return;
      SENTINEL_RE.lastIndex = 0;

      const replacement: any[] = [];
      let cursor = 0;
      let m: RegExpExecArray | null;
      while ((m = SENTINEL_RE.exec(node.value)) !== null) {
        if (m.index > cursor)
          replacement.push({
            type: "text",
            value: node.value.slice(cursor, m.index),
          });
        replacement.push({
          type: "text",
          value: "",
          data: {
            hName: "eo-entity",
            hProperties: { "data-entity-index": m[1] },
            hChildren: [{ type: "text", value: m[2] }],
          },
        });
        cursor = m.index + m[0].length;
      }
      if (cursor < node.value.length)
        replacement.push({ type: "text", value: node.value.slice(cursor) });

      parent.children.splice(index, 1, ...replacement);
      return index + replacement.length;
    });
  };
}
