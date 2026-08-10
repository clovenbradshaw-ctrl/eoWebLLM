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

export interface ModifierRefusal {
  head: string;
  gap: string;
  reason?: string;
}

export interface ReadingResult {
  reading: any;
  refused: ModifierRefusal[];
}

export function buildReading(text: string): ReadingResult {
  return buildReadingImpl(text) as ReadingResult;
}

export function toEOTReader(
  result: ReadingResult,
  opts?: { roomName?: string },
): string {
  return toEOTReaderImpl(result, opts);
}
