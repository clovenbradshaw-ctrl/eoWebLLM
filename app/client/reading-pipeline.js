// reading-pipeline.js — wires eoreader6's event_log + lens + reading
// substrate (PR #50) onto an uploaded text source, and formats the
// resulting projection as EOT surface text (writing-code-in-eo skill
// grammar) — the "read document" this substrate was built for.
//
// Plain JS (not vendored from eoreader6 — this is app-original glue code
// composing several vendored eoreader6 modules; see ./eo-binary/ for the
// vendored pieces themselves) so it can be tested directly with
// `node --test`, same as the vendored modules it composes. eo-reading.ts
// is a thin typed re-export of this file for callers in chat.tsx/chat.ts.
//
// Pipeline: text -> two independent taggers, each producing its own
// {head, tags} stacks over the SAME text -- extractEnglishModifierStacks
// (english-modifier-demo.js, a disclosed, hand-authored ~50-word English
// lexicon) and extractInducedModifierStacks (modifier-order-induced-
// prior.js, a measured prior baked by eoreader6's induction/stacks.js
// against real live_priors text — see that file's header for what it
// covers and its own disclosed limits) -> each stack's tags run through
// toEvents against ITS OWN typology (modifier-order.js) -> every accepted
// stack from both taggers ticks into ONE real event_log (event_log.js) ->
// readDocument (reading.js), one lens (MODIFIER_SCOPE_LENS, Link terrain)
// -> formatted as an EOT `reader` surface over a `room`. Running both
// taggers over the same text is not redundant: the induced prior covers
// specific tokens ("mock", "turtle", "rabbit", ...) the hand lexicon
// never claimed to (it has no entries for proper-noun epithets at all),
// so a document mentioning "Mock Turtle" gets real Link-terrain structure
// from the measured path even though the hand-authored lexicon alone
// would find nothing there.
//
// What this file does NOT do: run an EOT kernel. There is no EOT
// validation/rendering infrastructure in this repo (or in eoreader6/
// eo-constitution/live_priors) — the writing-code-in-eo skill's grammar is
// followed exactly (room -> links -> reader, checkpointed), but `!EVA`
// here is emitted text, not an executed check. Wiring an actual kernel
// (elsewhere, per Article I.4 an application concern) is future work.

import { createLog, tick } from "./eo-binary/event_log.js";
import { readDocument } from "./eo-binary/reading.js";
import { MODIFIER_SCOPE_LENS } from "./eo-binary/modifier-order-lens.js";
import { toEvents } from "./eo-binary/modifier-order.js";
import { isGap } from "./eo-binary/nul.js";
import {
  ENGLISH_DEMO_TYPOLOGY,
  extractEnglishModifierStacks,
} from "./eo-binary/english-modifier-demo.js";
import {
  INDUCED_MODIFIER_PRIOR,
  extractInducedModifierStacks,
} from "./eo-binary/modifier-order-induced-prior.js";

// Every tagger this pipeline runs, paired with its own typology and a
// `source` label carried into `refused` so a caller can tell a hand-
// authored refusal from a measured one. Adding a third tagger later means
// adding one entry here, not touching the loop below.
const TAGGERS = Object.freeze([
  Object.freeze({ source: "english-demo", extract: extractEnglishModifierStacks, typology: ENGLISH_DEMO_TYPOLOGY }),
  Object.freeze({ source: "induced-prior", extract: extractInducedModifierStacks, typology: INDUCED_MODIFIER_PRIOR }),
]);

/**
 * Runs every registered tagger over `text` (the disclosed-scope English
 * lexicon and the measured, live_priors-induced prior — see the taggers'
 * own files for what each covers), ticks every nested stack's SEG.narrow
 * events into one shared log, and reads it back as one Link-terrain
 * reading at the log's own current cursor — named explicitly, never
 * defaulted (II.17). A stack found in an INVERTED order (e.g. real text
 * reading "black fat cat") is refused by toEvents and recorded in
 * `refused` with which tagger found it, never silently dropped or ticked
 * anyway.
 */
export function buildReading(text) {
  const log = createLog();
  const refused = [];

  for (const { source, extract, typology } of TAGGERS) {
    for (const stack of extract(text)) {
      const events = toEvents(stack.tags, typology, { head: stack.head });
      if (isGap(events)) {
        refused.push({
          source,
          head: stack.head,
          gap: events.gap,
          reason: events.reason ?? events.why,
        });
        continue;
      }
      for (const e of events) tick(log, e);
    }
  }

  const cursor = log.tick;
  const reading = readDocument(
    log,
    [{ lensDef: MODIFIER_SCOPE_LENS, terrain: "Link" }],
    cursor,
  );
  return { reading, refused };
}

const dot = (id) => id.replace(/::/g, ".");

/**
 * Formats a `{ reading, refused }` result (from buildReading) as EOT
 * surface text: one room for this document's read log narrowed to what a
 * reading needs, its Link-terrain narrowing chain as `child -> parent`
 * links (the "::" -> "." transliteration modifier-order's own node ids
 * already suggest — EOT addresses nested structure with dots), and one
 * `reader` surface over the room, checkpointed per the skill's watchmaker
 * discipline (declare, assemble, set down, one `!EVA` per assembly).
 */
export function toEOTReader({ reading }, { roomName = "reading" } = {}) {
  if (isGap(reading)) {
    return `# reading refused: ${reading.gap} -- ${reading.reason ?? reading.why ?? ""}`;
  }

  const linkLens = reading.lenses.find((l) => l.terrain === "Link");
  const edges = linkLens ? linkLens.view : [];

  const lines = [];
  lines.push(
    `# ── assembly 1: the room — this document's read log, narrowed to what a reading needs ──`,
  );
  lines.push(`${roomName} : room`);
  lines.push(`${roomName}.contract.ops = NUL, CON, EVA`);
  lines.push(`${roomName}.contract.terrains = Field, Link, Lens`);
  lines.push(`${roomName}.contract.stances = Tending, Binding, Dissecting`);
  lines.push(`!EVA ${roomName}`);
  lines.push("");

  if (edges.length === 0) {
    lines.push(
      `# no Link-terrain structure in this reading — the room stands with no narrowing chain`,
    );
    lines.push("");
  } else {
    lines.push(
      `# ── assembly 2: the narrowing chain, as links (II.17 — cursor ${reading.cursor}, ` +
        `provenance in ${linkLens.provenance.length} SEG.narrow event(s)) ──`,
    );
    for (const e of edges) {
      lines.push(`${dot(e.subject)} -> ${dot(e.object)}`);
      lines.push(`${dot(e.subject)}.class = "${e.class}"`);
    }
    lines.push(`!EVA ${roomName}`);
    lines.push("");
  }

  lines.push(`# ── assembly 3: the reader surface ──`);
  lines.push(`${roomName}_reader : reader`);
  lines.push(`${roomName}_reader.room = ${roomName}`);
  lines.push(`${roomName}_reader.cursor = ${reading.cursor}`);
  lines.push(`!EVA ${roomName}_reader`);

  return lines.join("\n");
}
