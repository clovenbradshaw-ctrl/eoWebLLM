// eo-reading.ts — thin typed wrapper around reading-pipeline.js, which does
// the actual work in plain JS (testable directly with `node --test`,
// consistent with the vendored eoreader6 modules it composes).
//
// This is the "get a read document out of it, in EOT" pipeline: text ->
// the disclosed-scope English tagger -> modifier-order's toEvents ->
// ticked into a real event_log -> composed by reading.js into one
// Link-terrain projection at a named cursor -> formatted as an EOT `reader`
// surface (room + narrowing-chain links + reader, per the
// writing-code-in-eo skill's grammar).
//
// See reading-pipeline.js's header for what this deliberately does NOT do
// (run an EOT kernel — there isn't one in scope; this emits well-formed
// EOT text, following the skill's grammar exactly, for whatever renders or
// validates EOT elsewhere to consume).

import {
  buildReading as buildReadingImpl,
  toEOTReader as toEOTReaderImpl,
} from "./reading-pipeline.js";
import { readSourceLedger, persistSourceLedger } from "./eo-corpus";

export interface ModifierRefusal {
  head: string;
  gap: string;
  reason?: string;
}

export interface RevisionEntry {
  subject: string;
  object: string;
  class: string;
  polarity: string;
  priorClass: string;
  priorPolarity: string;
  event_id: string;
}

export interface EventLog {
  events: any[];
  tick: number;
}

export interface ReadingResult {
  reading: any;
  refused: ModifierRefusal[];
  revisions: RevisionEntry[];
  log: EventLog;
  /** The log's own tick count before this run started -- 0 for a fresh log. */
  cursorBeforeThisRun: number;
}

// reading-pipeline.js is plain, untyped JS (deliberately -- see its own
// header) and TypeScript infers buildReading's `opts.log` parameter type
// from its default value's literal shape (`createLog()`'s `events: []`
// narrows to `never[]`), which has nothing to do with this file's own
// EventLog type. Cast once at the boundary, same as eo-hypergraph.ts does
// for eoreader6, rather than fighting the inference call by call.
const buildReadingUntyped: (text: string, opts?: unknown) => ReadingResult =
  buildReadingImpl as any;

/**
 * `log`: an existing ledger to read this text against (e.g. a source's
 * ledger loaded back from OPFS), instead of starting a fresh one. See
 * reading-pipeline.js::buildReading's own docs for what passing an
 * existing log changes (SEG.revise routing) vs. a fresh one (unchanged
 * behavior).
 */
export function buildReading(
  text: string,
  opts?: { log?: EventLog },
): ReadingResult {
  return buildReadingUntyped(text, opts);
}

export function toEOTReader(
  result: ReadingResult,
  opts?: { roomName?: string },
): string {
  return toEOTReaderImpl(result, opts);
}

export interface ReReadResult extends ReadingResult {
  isFirstRead: boolean;
}

/**
 * Loads a source's persisted ledger back (if any), reads `text` against
 * it, persists the result, and reports whether this was the source's
 * first read. Kept out of reading-pipeline.js on purpose: that file does
 * no I/O and stays testable under plain `node --test`
 * (navigator.storage doesn't exist there); this is the OPFS-aware
 * orchestration layer above it. A missing ledger is treated as a first
 * read, not a refusal -- there is nothing yet to disagree with.
 */
export async function reReadSource(
  id: string,
  text: string,
): Promise<ReReadResult> {
  const existing = await readSourceLedger(id);
  const result = existing
    ? buildReading(text, { log: existing })
    : buildReading(text);
  await persistSourceLedger(id, result.log);
  return { ...result, isFirstRead: existing === null };
}

/**
 * A breakdown of the ledger's own contents, straight from log.events --
 * the append-only record, not the folded projection. Every event type
 * this pipeline mints (SEG.narrow/confirm/revise/refuse) is counted, so
 * the source panel can show what the ledger actually holds rather than a
 * single "revisions" number. Shared by eo-source-ingest.ts (first read)
 * and chat.tsx's rereadSource (subsequent reads) so both compute it the
 * same way.
 */
export function ledgerStats(log: { events: any[]; tick: number }): {
  cursor: number;
  narrowCount: number;
  confirmCount: number;
  revisionCount: number;
  refuseCount: number;
} {
  const counts = {
    narrowCount: 0,
    confirmCount: 0,
    revisionCount: 0,
    refuseCount: 0,
  };
  for (const e of log.events) {
    if (e.type === "SEG.narrow") counts.narrowCount++;
    else if (e.type === "SEG.confirm") counts.confirmCount++;
    else if (e.type === "SEG.revise") counts.revisionCount++;
    else if (e.type === "SEG.refuse") counts.refuseCount++;
  }
  return { cursor: log.tick, ...counts };
}
