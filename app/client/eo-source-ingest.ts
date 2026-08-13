// eo-source-ingest.ts — turns a raw uploaded File into a persisted EoSource.
//
// Factored out of chat.tsx's uploadFile so the same ingest pipeline (OPFS
// persist -> binary-structure analysis -> decode/extract -> modifier-graph
// enrichment -> EOT reading -> ledger persist -> EoSource construction) is
// available to any upload surface, not only the chat session's own upload
// button -- the project document explorer (document-explorer.tsx) uses it
// too, registering the resulting source onto a project session rather than
// "the current session".
//
// Original bytes are retained losslessly in OPFS; no prefix is sent as if
// it were the entire source. PDF/XLSX/DOCX/PPTX/ODF/EPUB/RTF bytes get a
// best-effort text extraction (eo-file-extract.ts) and, once extracted, are
// treated exactly like any other text file from here on -- same
// modifier-graph/EOT pipeline, same textReadable: true, same eligibility
// for eo-corpus.ts's turn-time corpus surf. What actually reaches a chat
// turn is always decided later, at turn time, by surf (eo-corpus.ts for
// text, eo-binary-structure.ts for the rest) -- never here.

import { nanoid } from "nanoid";
import {
  findBinaryStructure,
  formatBinaryStructureBlock,
} from "./eo-binary-structure";
import { tryExtractText } from "./eo-file-extract";
import {
  createModifierGraph,
  enrichModifierGraphFromText,
  formatModifierGraphBlock,
} from "./eo-modifier-graph";
import { buildReading, toEOTReader, ledgerStats } from "./eo-reading";
import {
  isReadableUtf8,
  persistRawSource,
  persistSourceLedger,
} from "./eo-corpus";
import type { EoSource } from "./eo-corpus";

// Above this many raw bytes, skip the CPU-heavy passes (UTF-8 decode,
// modifier tagging, PDF/XLSX/DOCX/... extraction) and keep only the
// lossless OPFS write plus the O(byteLength) entropy scan (already
// block-capped by findBinaryStructure's own chooseBlockSize) — a large
// file is still "uploaded" in full, it just isn't analyzed on the main
// thread.
const MAX_ANALYSIS_BYTES = 50 * 1024 * 1024;
// Above this many decoded characters, skip modifier-graph/EOT reading
// specifically (the two regex-based taggers over the whole document) — the
// source still registers as textReadable and stays fully surfable by
// eo-corpus.ts's retrieveCorpus, it just doesn't also get a reading. Kept
// well under a novel-length document (a full "War and Peace" upload is
// ~3.2M characters and was freezing the tab for the whole regex pass before
// this was lowered) since this pass is pure enrichment, not required for the
// source to be usable.
const MAX_READING_CHARS = 300_000;

// A single synchronous phase below (entropy scan, UTF-8 decode, regex
// tagging) can still take a noticeable moment even under its own cap; yield
// to the event loop between phases so the tab can paint the "uploading"
// indicator and stay responsive to input instead of appearing to hang for
// the sum of every phase at once.
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface IngestedSource {
  source: EoSource;
  /** channel/text pairs for the caller's own EOT log, in emission order. */
  logLines: { channel: "file"; text: string }[];
}

/**
 * Ingests one File: persists its bytes, analyzes/extracts/reads it, and
 * returns the resulting EoSource plus log lines for the caller to push
 * through its own pushEoLog. Never throws for a bad/unsupported file body
 * -- callers should still guard the OPFS write itself, since a full disk
 * or a browser without OPFS support can throw there.
 */
export async function ingestFile(file: File): Promise<IngestedSource> {
  const logLines: IngestedSource["logLines"] = [];
  const buffer = new Uint8Array(await file.arrayBuffer());
  const id = nanoid();
  await persistRawSource(id, buffer);

  const withinAnalysisBudget = buffer.length <= MAX_ANALYSIS_BYTES;

  // A decoded string this function can treat as the source's text: either
  // it's already valid UTF-8, or a format-specific extractor (PDF/XLSX/
  // DOCX/PPTX/ODF/EPUB/RTF) pulled text out of a container that isn't.
  // isReadableUtf8 only samples the first 128KB, so this check is cheap even
  // for a very large file — it's what lets a large plain-text upload (e.g. a
  // full novel) skip the binary-structure entropy pass below entirely,
  // rather than spending CPU on a structure summary that's discarded for
  // text-readable sources anyway (see structureSummary below).
  let decoded: string | null = null;
  let textReadable = false;
  if (withinAnalysisBudget) {
    if (isReadableUtf8(buffer)) {
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        textReadable = true;
      } catch {
        // Coarser isReadableUtf8 sample passed but the full decode didn't;
        // falls through to the binary path below.
      }
    } else {
      decoded = await tryExtractText(buffer, file.name);
      textReadable = decoded !== null;
    }
  }

  await yieldToMain();

  // The binary-structure entropy/boundary pass: only meaningful (and only
  // kept, via structureSummary below) for a source that ISN'T text-readable,
  // so skip it entirely once decode above already succeeded — no point
  // spending CPU analyzing a large novel's bytes as an opaque blob when its
  // real text is what gets surfaced. Wrapped in try/catch so a pathological
  // binary can't abort an otherwise-successful upload.
  let structure:
    | ReturnType<typeof findBinaryStructure>
    | {
        byteLength: number;
        blockSize: number;
        blockCount: number;
        clearings: { block: number; byteOffset: number }[];
        gap?: string;
      };
  if (textReadable) {
    structure = {
      byteLength: buffer.length,
      blockSize: 0,
      blockCount: 0,
      clearings: [],
    };
  } else if (!withinAnalysisBudget) {
    structure = {
      byteLength: buffer.length,
      blockSize: 0,
      blockCount: 0,
      clearings: [],
      gap: "too_large_for_analysis",
    };
  } else {
    try {
      structure = findBinaryStructure(buffer);
    } catch {
      structure = {
        byteLength: buffer.length,
        blockSize: 0,
        blockCount: 0,
        clearings: [],
        gap: "analysis_failed",
      };
    }
  }

  await yieldToMain();

  // Modifier-order graph enrichment + EOT reading: only for text that
  // decoded cleanly (whether native UTF-8 or extracted), and only ever the
  // disclosed-scope English demo tagger (see eo-modifier-graph.ts) — a
  // non-English document simply yields zero stacks, never a guess. Skipped
  // above MAX_READING_CHARS: the source is still textReadable and still
  // fully corpus-surfable, it just doesn't also carry a reading.
  let modifierGraphSummary:
    | { applied: number; refusedCount: number; entityNodes: string[] }
    | undefined;
  let readerEOT: string | undefined;
  let readLedger: EoSource["readLedger"] | undefined;
  if (decoded && decoded.length <= MAX_READING_CHARS) {
    try {
      const graph = createModifierGraph();
      const report = enrichModifierGraphFromText(graph, decoded);
      modifierGraphSummary = {
        applied: report.applied,
        refusedCount: report.refused.length,
        entityNodes: report.entityNodes,
      };
      if (report.applied > 0) {
        logLines.push({
          channel: "file",
          text: formatModifierGraphBlock(file.name, report),
        });
      }
      const readingResult = buildReading(decoded);
      const eotText = toEOTReader(readingResult, {
        roomName: `source_${id}`,
      });
      if (readingResult.reading && !("gap" in readingResult.reading)) {
        readerEOT = eotText;
        logLines.push({
          channel: "file",
          text: `file: "${file.name}" — read as EOT: a room + ${
            readingResult.reading.lenses?.find((l: any) => l.terrain === "Link")
              ?.view?.length ?? 0
          } narrowing link(s), cursor ${readingResult.reading.cursor}`,
        });
      }
      // Persist the ledger itself, not just the rendered EOT text — every
      // source gets a real read log from first upload, so a later
      // "Re-read" always has something to resolve against.
      await persistSourceLedger(id, readingResult.log);
      readLedger = ledgerStats(readingResult.log);
    } catch {
      // A reading failure just means no modifier-graph enrichment for this
      // file, not a broken upload.
    }
  }

  // A source's structureSummary is the ONLY material
  // eo-binary-structure.ts's turn-time surf can later score and show for
  // it — computed once, here, never re-derived per turn. Only non-text
  // sources carry one: a text source's real content is what gets
  // surfaced, not a structural summary of it.
  const structureSummary = textReadable
    ? undefined
    : formatBinaryStructureBlock(file.name, structure);

  const source: EoSource = {
    id,
    name: file.name || "(unnamed file)",
    byteLength: buffer.length,
    mimeType: file.type || "application/octet-stream",
    textReadable,
    enabled: true,
    addedAt: Date.now(),
    structure: {
      clearings: structure.clearings.length,
      blockCount: structure.blockCount,
    },
    structureSummary,
    modifierGraph: modifierGraphSummary,
    readerEOT,
    readLedger,
  };

  logLines.push({
    channel: "file",
    text:
      `file: ingested "${file.name}" — ${buffer.length} raw byte(s) in OPFS, ` +
      `${structure.clearings.length} clearing(s), ` +
      `${textReadable ? "UTF-8 corpus" : "binary corpus"}` +
      (withinAnalysisBudget ? "" : " (too large for analysis)"),
  });

  return { source, logLines };
}
