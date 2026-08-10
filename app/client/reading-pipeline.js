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

import { createLog, tick, asOf } from "./eo-binary/event_log.js";
import { readDocument } from "./eo-binary/reading.js";
import { MODIFIER_SCOPE_LENS } from "./eo-binary/modifier-order-lens.js";
import { toEvents } from "./eo-binary/modifier-order.js";
import { isGap } from "./eo-binary/nul.js";
import {
  foldNarrowState,
  resolveAgainstLedger,
  recordTicked,
} from "./eo-binary/modifier-order-revision.js";
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
  Object.freeze({
    source: "english-demo",
    extract: extractEnglishModifierStacks,
    typology: ENGLISH_DEMO_TYPOLOGY,
  }),
  Object.freeze({
    source: "induced-prior",
    extract: extractInducedModifierStacks,
    typology: INDUCED_MODIFIER_PRIOR,
  }),
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
 *
 * `log` may be an existing ledger (e.g. loaded back for a source that was
 * already read once) instead of a fresh one. When it is, every fresh
 * SEG.narrow candidate is resolved against what the ledger already holds
 * for that (subject, object) — via modifier-order-revision.js's
 * resolveAgainstLedger, following eoreader6's emergence/voice.js::
 * reviseVoice precedent: a disagreement never overwrites the prior entry,
 * it ticks a SEG.revise event that supersedes it (returned in
 * `revisions`); agreement still ticks — a SEG.confirm event pointing back
 * at what it confirmed — because the master log is append-only and holds
 * every act, not only the ones that changed something (folding that down
 * to "current state" is the projection layer's job — see
 * MODIFIER_SCOPE_CURRENT_LENS — never the ledger's). A brand-new log
 * (log.tick === 0, true for every caller today) skips this resolution
 * entirely and ticks every candidate directly, exactly as before — this
 * function's output for a fresh log is unchanged.
 *
 * A refusal is a witnessed act too, not a non-event: the ledger is
 * meant to hold everything the system did while reading, not only its
 * successful narrows, so every refusal ticks a real SEG.refuse event
 * (kept out of MODIFIER_SCOPE_LENS.reads, so it never shows up as a
 * narrowing edge — only as an honestly-reported discardedTypes entry for
 * a caller reading through that lens, and as first-class provenance for
 * a caller who reads SEG.refuse directly) in addition to being collected
 * in the `refused` array for convenience.
 *
 * `lenses` defaults to the single historical Link-terrain lens
 * (MODIFIER_SCOPE_LENS — every SEG.narrow tick ever made, unfolded). A
 * caller who wants the ledger's CURRENT state instead (history folded to
 * one edge per node, per the append-only-log-vs-projection split above)
 * passes `[{ lensDef: MODIFIER_SCOPE_CURRENT_LENS, terrain: "Link" }]`
 * explicitly — received, never inferred, matching this codebase's
 * discipline everywhere else a lens is chosen.
 */
export function buildReading(
  text,
  {
    log = createLog(),
    lenses = [{ lensDef: MODIFIER_SCOPE_LENS, terrain: "Link" }],
  } = {},
) {
  const cursorBeforeThisRun = log.tick;
  const priorState = foldNarrowState(asOf(log, cursorBeforeThisRun));
  const refused = [];
  const revisions = [];

  for (const { source, extract, typology } of TAGGERS) {
    for (const stack of extract(text)) {
      const events = toEvents(stack.tags, typology, { head: stack.head });
      if (isGap(events)) {
        const entry = {
          source,
          head: stack.head,
          gap: events.gap,
          reason: events.reason ?? events.why,
        };
        refused.push(entry);
        tick(log, { type: "SEG.refuse", ...entry });
        continue;
      }
      for (const e of events) {
        if (cursorBeforeThisRun === 0) {
          tick(log, e);
          continue;
        }
        const resolved = resolveAgainstLedger(priorState, e);
        const ticked = tick(log, resolved.event);
        recordTicked(priorState, ticked);
        if (resolved.action === "revise") {
          revisions.push({
            subject: ticked.subject,
            object: ticked.object,
            class: ticked.class,
            polarity: ticked.polarity,
            priorClass: resolved.event.priorClass,
            priorPolarity: resolved.event.priorPolarity,
            event_id: ticked.event_id,
          });
        }
      }
    }
  }

  const cursor = log.tick;
  const reading = readDocument(log, lenses, cursor);
  return { reading, refused, revisions, log, cursorBeforeThisRun };
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
