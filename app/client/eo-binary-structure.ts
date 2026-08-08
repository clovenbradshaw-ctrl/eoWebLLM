// eo-binary-structure.ts — wires eoreader6's modality-blind boundary detector
// (packages/engine/loops/turn.js, vendored verbatim into ./eo-binary/) onto
// an uploaded file's raw bytes.
//
// eoreader6's claim (scripts/binary-clearings.mjs): the same DEF·Atmosphere·
// Clearing turn that finds chapter breaks in text also finds structural
// boundaries in a byte stream reduced to nothing but block-level Shannon
// entropy — no tokenizer, no format parser, no notion of "this is a WAV" or
// "this is a JPEG". That is what "find structure in any binary" means here:
// not format-specific parsing (that already exists for images/audio/video
// elsewhere in eoreader6's perceivers), but a format-agnostic pass that works
// on bytes it has never been told the shape of.
//
// Source: eoreader6/scripts/binary-clearings.mjs + packages/engine/loops/turn.js
//   https://github.com/clovenbradshaw-ctrl/eoreader6 (local: eoreader6/)

import { runTurn } from "./eo-binary/turn.js";
import { isGap } from "./eo-binary/nul.js";

export interface BinaryClearing {
  /** block index within the reduced series */
  block: number;
  /** byte offset this block started at */
  byteOffset: number;
}

export interface BinaryStructureReport {
  byteLength: number;
  blockSize: number;
  blockCount: number;
  clearings: BinaryClearing[];
  gap?: string;
}

// Same reduction binary-clearings.mjs found most informative for arbitrary
// bytes: Shannon entropy over the 256-symbol alphabet, per block, scaled to
// microbits to match the text perceiver's convention.
function blockEntropy(bytes: Uint8Array, block: number): number[] {
  const out: number[] = [];
  const counts = new Uint32Array(256);
  for (let i = 0; i + block <= bytes.length; i += block) {
    counts.fill(0);
    for (let j = i; j < i + block; j++) counts[bytes[j]]++;
    let h = 0;
    for (let s = 0; s < 256; s++) {
      if (!counts[s]) continue;
      const p = counts[s] / block;
      h -= p * Math.log2(p);
    }
    out.push(h * 1e6);
  }
  return out;
}

// Same SPEC binary-clearings.mjs runs — window/draws/reseeds/tolerance/hop
// tuned against a known chapter-marked text corpus, kept as-is here since
// this port makes no claim to have retuned it against binary-specific ground
// truth. clearOn: both "surfeit" and "moved" (mode "both" in the script) —
// the mode that treats either failure kind as a boundary.
const SPEC = {
  window: 12,
  draws: 200,
  reseeds: 5,
  tolerance: 3,
  hop: 4,
  seed: 17,
};

// Pick a block size so a small file still yields enough blocks for the
// window/draws spec to have material to work with (runTurn gaps out rather
// than guess when material is too short), and a huge file doesn't produce
// tens of thousands of blocks in a browser tab.
function chooseBlockSize(byteLength: number): number {
  const MIN_BLOCKS = 64;
  const MAX_BLOCKS = 4000;
  let block = 512;
  while (byteLength / block > MAX_BLOCKS) block *= 2;
  while (byteLength / block < MIN_BLOCKS && block > 16)
    block = Math.floor(block / 2);
  return Math.max(block, 16);
}

export function findBinaryStructure(bytes: Uint8Array): BinaryStructureReport {
  const blockSize = chooseBlockSize(bytes.length);
  const series = blockEntropy(bytes, blockSize);
  const blockCount = series.length;

  if (blockCount < 8) {
    return {
      byteLength: bytes.length,
      blockSize,
      blockCount,
      clearings: [],
      gap: "too_small_for_reduction",
    };
  }

  const turn = runTurn({
    material: series,
    ...SPEC,
    clearOn: ["surfeit", "moved"],
  });
  if (isGap(turn)) {
    return {
      byteLength: bytes.length,
      blockSize,
      blockCount,
      clearings: [],
      gap: (turn as any).gap,
    };
  }

  const clearings: BinaryClearing[] = turn.events
    .filter((e: any) => e.op === "REC")
    .map((e: any) => ({ block: e.at, byteOffset: e.at * blockSize }));

  return { byteLength: bytes.length, blockSize, blockCount, clearings };
}

export function formatBinaryStructureBlock(
  fileName: string,
  report: BinaryStructureReport,
): string {
  if (report.gap) {
    return (
      `FILE STRUCTURE for "${fileName}": ${report.byteLength} bytes. ` +
      `No structural read attempted (${report.gap}).`
    );
  }
  if (!report.clearings.length) {
    return (
      `FILE STRUCTURE for "${fileName}": ${report.byteLength} bytes across ` +
      `${report.blockCount} blocks of ${report.blockSize}. No structural boundaries ` +
      `detected — the byte stream reads as internally uniform to a modality-blind pass.`
    );
  }
  const offsets = report.clearings.map((c) => c.byteOffset).join(", ");
  return (
    `FILE STRUCTURE for "${fileName}": ${report.byteLength} bytes across ` +
    `${report.blockCount} blocks of ${report.blockSize}. A format-agnostic entropy-` +
    `boundary pass (no parser, no assumption about file type) found ` +
    `${report.clearings.length} structural boundary/boundaries at byte offsets: ${offsets}. ` +
    `These mark where the byte statistics shift sharply — likely section, header/body, ` +
    `or embedded-object boundaries. Treat them as hints about the file's internal layout, ` +
    `not a guaranteed parse.`
  );
}

// A best-effort UTF-8 decode with a printable-ratio guard, so a text file
// still gets read as text (more useful to a chat model than an entropy
// summary) while binary files fall back to the structure report only.
export function tryDecodeText(
  bytes: Uint8Array,
  maxChars = 20000,
): string | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const text = decoder.decode(
      bytes.subarray(0, Math.min(bytes.length, maxChars * 4)),
    );
    const printable = text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").length;
    if (printable / Math.max(text.length, 1) < 0.85) return null;
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}
