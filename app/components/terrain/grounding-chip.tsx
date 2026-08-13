import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";

import type { GroundingSpan } from "../../client/eo-grounding-spans";
import type { CitationEntry } from "../../client/eo-citation-check";

// Renders eo-grounding-spans.ts's already-computed, already-resolved
// GroundingSpan[] (sourced/owned/checking/contradicted, per message) as
// inline chips over the rendered markdown — this is trigger site 1 for the
// terrain panel (docs/citey-structured-grounding.md). Nothing here
// re-derives grounding; it only renders what chat.ts already decided.
//
// react-markdown's `components` prop only overrides tag-name-keyed hast
// ELEMENTS (p, a, code, ...) — there is no "text" key, because plain text
// nodes aren't elements. So a sentinel-wrapped substring can't be picked up
// by a components override the way a real element can; it has to become a
// real (synthetic) element first. This remark plugin does that: it scans
// each mdast `text` node's own value for sentinel-wrapped spans and splits
// the node into plain text plus small custom nodes carrying
// data.hName/hProperties/hChildren — mdast-util-to-hast's own supported
// escape hatch for "render this as a real element", the same mechanism
// remark-gfm's own footnote/task-list nodes use.

const OPEN = "";
const SEP = "";
const CLOSE = "";
const SENTINEL_RE = /(\d+)([\s\S]*?)/g;

/** Sort ascending, drop any pair that overlaps the previous one (defensive
 *  — extractAtoms's own sentence-scoped scan shouldn't produce overlaps,
 *  but a chip that silently ate a wrong slice of text would be worse than
 *  one span quietly losing its chip). */
function nonOverlapping(
  spans: GroundingSpan[],
): { span: GroundingSpan; index: number }[] {
  const withIndex = spans
    .map((span, index) => ({ span, index }))
    .filter((s) => s.span.end > s.span.start)
    .sort((a, b) => a.span.start - b.span.start);
  const out: { span: GroundingSpan; index: number }[] = [];
  let cursor = 0;
  for (const item of withIndex) {
    if (item.span.start < cursor) continue;
    out.push(item);
    cursor = item.span.end;
  }
  return out;
}

/** Wraps each span's own substring in sentinel markers, encoding the
 *  span's index into `spans` — applied to the RAW message content, BEFORE
 *  markdown.tsx's own escapeDollarNumber/escapeBrackets run, so the spans'
 *  [start,end) offsets (computed against that same raw content in
 *  chat.ts) need no translation. Those two escape passes are insertion-only
 *  and only touch `$<digit>`/`\[...\]`/`\(...\)` sequences — patterns that
 *  don't occur inside the sentinel markers themselves — so running them
 *  AFTER this wrap is safe. */
export function wrapGroundingSpans(
  rawContent: string,
  spans: GroundingSpan[] | undefined,
): string {
  if (!spans?.length) return rawContent;
  const ordered = nonOverlapping(spans);
  if (!ordered.length) return rawContent;
  let out = "";
  let cursor = 0;
  for (const { span, index } of ordered) {
    out += rawContent.slice(cursor, span.start);
    out += `${OPEN}${index}${SEP}${rawContent.slice(span.start, span.end)}${CLOSE}`;
    cursor = span.end;
  }
  out += rawContent.slice(cursor);
  return out;
}

/** Remark plugin: splits any `text` node containing sentinel markers into
 *  plain text + synthetic "groundingChip" nodes mdast-util-to-hast will
 *  render as real `<eo-chip>` elements, addressable via react-markdown's
 *  `components["eo-chip"]`. A span whose sentinel pair got separated across
 *  two text nodes by markdown syntax inside it (e.g. a citable sentence
 *  containing `**bold**`) simply won't match here — SENTINEL_RE only
 *  matches within one node — and is left as inert plain text, never a
 *  crash. */
// Typed loosely (not against unified's Plugin<> generic) — the same
// standing markdown.tsx's own remarkPlugins array already holds, cast
// `as PluggableList` at the call site rather than fought plugin-by-plugin.
export function remarkGroundingChips() {
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
        const spanIndex = m[1];
        const text = m[2];
        replacement.push({
          type: "text",
          value: "",
          data: {
            hName: "eo-chip",
            hProperties: { "data-span-index": spanIndex },
            hChildren: [{ type: "text", value: text }],
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

/** The reasoning behind a span's state, in plain language — shared by the
 *  chip's own title tooltip and CiteyNote's inline callout (chat.tsx) so
 *  the two surfaces never drift into saying different things about the
 *  same verdict. */
export function chipReasonText(
  span: GroundingSpan,
  citation?: CitationEntry,
): string {
  switch (span.state) {
    case "contradicted":
      return (
        span.correction ?? "This may not check out against what was found."
      );
    case "sourced":
      return citation?.text ?? "Backed by material gathered this turn.";
    case "echoed":
      return "Echoes wording from a source without every word matching verbatim.";
    case "checking":
      return "Not checked against anything yet.";
    case "stated":
      return "You said this earlier — held on your word, not on a source.";
    case "general":
      return "General knowledge. Nothing external bore on this turn, so nothing was gathered to check it against.";
    case "bleed":
      return "The only thing carrying this is a summary of earlier turns, not a source. Worth checking before relying on it.";
    case "unconfirmed":
      return "Material was gathered this turn and this is not in it.";
    default:
      return "Held as unconfirmed rather than guessed.";
  }
}

export function GroundingChip(props: {
  "data-span-index"?: string;
  children?: React.ReactNode;
  spans: GroundingSpan[];
  citations?: CitationEntry[];
  /** Numbering built by buildCitationNumbering, keyed by citation index —
   *  renders a footnote-style [n] after a chip whose citation has one. */
  citationNumbers?: Map<number, number>;
  /** Opens the citation modal (verbatim snip + mechanical check) for a
   *  sourced/echoed span with a resolvable citation. Field navigation for a
   *  corpus-backed citation is offered inside the modal itself (via
   *  corpusFieldTarget) rather than as a second, competing click target. */
  onOpenCitation?: (span: GroundingSpan, citation: CitationEntry) => void;
}) {
  const idx = Number(props["data-span-index"]);
  const span = Number.isFinite(idx) ? props.spans[idx] : undefined;
  if (!span) return <>{props.children}</>;

  const hasCitationLink =
    (span.state === "sourced" || span.state === "echoed") &&
    span.supportingCitationIndexes.length > 0;
  const citation = hasCitationLink
    ? props.citations?.find(
        (c) => c.index === span.supportingCitationIndexes[0],
      )
    : undefined;
  // A corpus ref ("sourceName#byteStart-byteEnd") used to be the only thing
  // that made a chip clickable, jumping straight to the Field card — a web
  // citation's source_id is a URL, which Field (byte-addressed OPFS reads)
  // can't open. The citation modal has no such restriction, so it's the
  // primary click target whenever a citation is resolvable; Field
  // navigation (via corpusFieldTarget) is offered inside the modal as a
  // secondary action instead of competing with it for the same click.
  const clickable = !!citation && !!props.onOpenCitation;

  const stateClass =
    span.state === "contradicted"
      ? "eo-chip-contradicted"
      : span.state === "sourced"
        ? "eo-chip-sourced"
        : span.state === "echoed"
          ? "eo-chip-echoed"
          : span.state === "checking"
            ? "eo-chip-checking"
            : "eo-chip-owned";

  const title = chipReasonText(span, citation);
  const citationNumber = citation
    ? props.citationNumbers?.get(citation.index)
    : undefined;

  return (
    <span
      className={`eo-chip ${stateClass}${clickable ? " eo-chip-clickable" : ""}`}
      title={title}
      onClick={
        clickable ? () => props.onOpenCitation!(span, citation!) : undefined
      }
    >
      {props.children}
      {citationNumber !== undefined && (
        <sup className="eo-chip-cite-number">[{citationNumber}]</sup>
      )}
    </span>
  );
}

/** Numbers each distinct citation in document order of first appearance
 *  across a message's spans — footnote-style, matching the citation-modal
 *  wiring. A span without a resolvable citation gets no number. Shared
 *  between the chip's own render and anything else that needs to say
 *  "citation [n] is the one attached to source X" (e.g. a "sources used"
 *  summary), the same "one function, two call sites" pattern chipReasonText
 *  already establishes. */
export function buildCitationNumbering(
  spans: GroundingSpan[],
  citations: CitationEntry[] | undefined,
): Map<number, number> {
  const numbering = new Map<number, number>();
  if (!citations?.length) return numbering;
  const ordered = [...spans]
    .filter(
      (s) =>
        (s.state === "sourced" || s.state === "echoed") &&
        s.supportingCitationIndexes.length > 0,
    )
    .sort((a, b) => a.start - b.start);
  for (const span of ordered) {
    const citationIndex = span.supportingCitationIndexes[0];
    if (!citations.some((c) => c.index === citationIndex)) continue;
    if (!numbering.has(citationIndex)) {
      numbering.set(citationIndex, numbering.size + 1);
    }
  }
  return numbering;
}

/** The corpus field-card target for a citation, if it has one — split out
 *  of the click handler so the citation modal can offer the same "open in
 *  Field" secondary action GroundingChip used to perform directly. */
export function corpusFieldTarget(
  citation: CitationEntry | undefined,
): { sourceName: string; byteStart: string; byteEnd: string } | null {
  const m = citation?.source_id.match(/^(.*)#(\d+)-(\d+)$/);
  if (!m) return null;
  return { sourceName: m[1], byteStart: m[2], byteEnd: m[3] };
}
