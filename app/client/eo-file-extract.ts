// eo-file-extract.ts — best-effort plain-text extraction for a small set of
// common container formats (PDF, XLSX/XLS) whose bytes are not themselves
// valid UTF-8 (so isReadableUtf8 rejects them) but which do wrap real text.
//
// This is upload-time work only: it turns a file's bytes into a text
// string, nothing more. The result is handed back to chat.tsx's uploadFile,
// which then runs it through the SAME text pipeline (modifier graph,
// buildReading, textReadable: true) any plain .txt file already gets — so
// once extracted, this content is only ever surfaced later through the
// existing turn-time corpus/hypergraph surf, never injected directly here.
// A file this module cannot extract from (extraction throws, or yields
// nothing) falls back to today's binary-structure-only path unchanged.
//
// Both underlying libraries (pdfjs-dist, xlsx) were already project
// dependencies, unused until now (see git history) — no new dependency
// added for this.

import * as XLSX from "xlsx";

export type ExtractableFormat = "pdf" | "xlsx";

/**
 * Magic-byte + extension sniff. file.type (browser-supplied) is often empty
 * or wrong for these formats, so this never trusts it — the PDF signature
 * and the ZIP signature (xlsx is a zip of XML parts) are read directly off
 * the bytes, same discipline findBinaryStructure already applies to the
 * bytes themselves rather than to reported metadata.
 */
export function detectExtractableFormat(
  bytes: Uint8Array,
  fileName: string,
): ExtractableFormat | null {
  const isPdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d; // -
  if (isPdf) return "pdf";

  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (isZip && (ext === "xlsx" || ext === "xlsm" || ext === "xls")) {
    return "xlsx";
  }
  return null;
}

const MAX_EXTRACT_CHARS = 200_000;

/** Renders every sheet as CSV, sheet name as a heading, in workbook order. */
export function extractXlsxText(bytes: Uint8Array): string | null {
  const workbook = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (!csv) continue;
    parts.push(`# Sheet: ${sheetName}\n${csv}`);
  }
  const text = parts.join("\n\n").trim();
  if (!text) return null;
  return text.length > MAX_EXTRACT_CHARS
    ? text.slice(0, MAX_EXTRACT_CHARS)
    : text;
}

let workerConfigured = false;

/** pdfjs needs a worker script URL before its first getDocument() call. */
async function ensurePdfWorker() {
  if (workerConfigured) return;
  // The plain (non-"legacy") build: it targets modern browsers only, which
  // is what this app already requires for WebGPU/WebLLM anyway, and unlike
  // the legacy build it carries no Node-oriented `canvas`/`path2d-polyfill`
  // dependencies to fight the bundler over.
  const pdfjsLib = await import("pdfjs-dist/build/pdf");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url,
  ).toString();
  workerConfigured = true;
}

/** Concatenates every page's extracted text items, page breaks as blank lines. */
export async function extractPdfText(
  bytes: Uint8Array,
): Promise<string | null> {
  await ensurePdfWorker();
  const pdfjsLib = await import("pdfjs-dist/build/pdf");
  // pdfjs detaches/transfers the buffer it's given; hand it an owned copy so
  // the caller's own `bytes` (already persisted to OPFS separately) is
  // never at risk of being neutered by this read.
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const doc = await pdfjsLib.getDocument({ data: owned }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) pages.push(pageText);
      if (pages.join("\n\n").length > MAX_EXTRACT_CHARS) break;
    }
    const text = pages.join("\n\n").trim();
    if (!text) return null;
    return text.length > MAX_EXTRACT_CHARS
      ? text.slice(0, MAX_EXTRACT_CHARS)
      : text;
  } finally {
    await doc.destroy();
  }
}

/**
 * Dispatches on the sniffed format. Returns null (never throws) on anything
 * unrecognised, unparseable, or textless — the caller's existing binary
 * path is always a safe fallback, so a bad/corrupt PDF or a
 * password-protected workbook just means no extraction, not a broken
 * upload.
 */
export async function tryExtractText(
  bytes: Uint8Array,
  fileName: string,
): Promise<string | null> {
  const format = detectExtractableFormat(bytes, fileName);
  if (!format) return null;
  try {
    if (format === "pdf") return await extractPdfText(bytes);
    if (format === "xlsx") return extractXlsxText(bytes);
    return null;
  } catch {
    return null;
  }
}
