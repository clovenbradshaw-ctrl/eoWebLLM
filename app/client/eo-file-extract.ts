// eo-file-extract.ts — best-effort plain-text extraction for common
// container formats whose bytes are not themselves valid UTF-8 (so
// isReadableUtf8 rejects them) but which do wrap real text: PDF, XLSX/XLS,
// DOCX, PPTX, ODT/ODP/ODS, EPUB, and RTF.
//
// This is upload-time work only: it turns a file's bytes into a text
// string, nothing more. The result is handed back to chat.tsx's uploadFile
// (via eo-source-ingest.ts's ingestFile), which then runs it through the
// SAME text pipeline (modifier graph, buildReading, textReadable: true)
// any plain .txt file already gets — so once extracted, this content is
// only ever surfaced later through the existing turn-time corpus/hypergraph
// surf, never injected directly here. A file this module cannot extract
// from (extraction throws, or yields nothing) falls back to today's
// binary-structure-only path unchanged.
//
// pdfjs-dist and xlsx were already project dependencies (see git history).
// The DOCX/PPTX/ODF/EPUB/RTF extractors below add none: DOCX/PPTX/ODF/EPUB
// are all ZIP containers of XML, read with the platform's own
// DecompressionStream (deflate-raw) and DOMParser — the same zero-dependency
// approach eochat's ui/file-formats.js uses, ported here.

import * as XLSX from "xlsx";

export type ExtractableFormat =
  "pdf" | "xlsx" | "docx" | "pptx" | "odf" | "epub" | "rtf";

const MAX_EXTRACT_CHARS = 200_000;
const MAX_ARCHIVE_ENTRIES = 4000;

// ── ZIP reading (DOCX/PPTX/ODF/EPUB are all ZIPs of XML) ────────────────────
// Ported from eochat's ui/file-formats.js — EOCD + ZIP64 central directory
// parse, stored/deflate member read via the platform's own
// DecompressionStream. No dependency.

interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  localOffset: number;
  dir: boolean;
}

const ZIP_EOCD = 0x06054b50;
const ZIP64_EOCD_LOC = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP_CD = 0x02014b50;

function u16(dv: DataView, o: number) {
  return dv.getUint16(o, true);
}
function u32(dv: DataView, o: number) {
  return dv.getUint32(o, true);
}
function u64(dv: DataView, o: number) {
  // ZIP64 sizes are 64-bit; JS numbers are exact to 2^53, which is 8
  // petabytes — beyond anything a browser tab is going to hold, so the
  // low/high split is safe here without BigInt.
  return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 0x100000000;
}

function findEOCD(dv: DataView, len: number): number {
  const scan = Math.min(len, 66560); // 64KB comment ceiling + the record itself
  for (let i = len - 22; i >= len - scan && i >= 0; i--) {
    if (u32(dv, i) === ZIP_EOCD) return i;
  }
  return -1;
}

function readZipDirectory(buf: ArrayBuffer): ZipEntry[] {
  const dv = new DataView(buf);
  const len = buf.byteLength;
  const eocd = findEOCD(dv, len);
  if (eocd < 0) {
    throw new Error("not a ZIP container (no end-of-central-directory record)");
  }

  let count = u16(dv, eocd + 10);
  let cdOffset = u32(dv, eocd + 16);

  // ZIP64: the 32-bit fields saturate and the real values live in a
  // separate record pointed at by a locator immediately before the EOCD.
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locOff = eocd - 20;
    if (locOff >= 0 && u32(dv, locOff) === ZIP64_EOCD_LOC) {
      const z64 = u64(dv, locOff + 8);
      if (z64 >= 0 && z64 + 56 <= len && u32(dv, z64) === ZIP64_EOCD) {
        count = u64(dv, z64 + 32);
        cdOffset = u64(dv, z64 + 48);
      }
    }
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const nameDec = new TextDecoder("utf-8");
  for (let i = 0; i < count && p + 46 <= len; i++) {
    if (u32(dv, p) !== ZIP_CD) break;
    const method = u16(dv, p + 10);
    let compressedSize = u32(dv, p + 20);
    let size = u32(dv, p + 24);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    let localOffset = u32(dv, p + 42);
    const name = nameDec.decode(new Uint8Array(buf, p + 46, nameLen));

    // ZIP64 extended information extra field (0x0001) supplies whichever of
    // the three fields saturated, in a fixed order, only for those that did.
    if (
      size === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = u16(dv, e);
        const sz = u16(dv, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) {
            size = u64(dv, q);
            q += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = u64(dv, q);
            q += 8;
          }
          if (localOffset === 0xffffffff) {
            localOffset = u64(dv, q);
            q += 8;
          }
          break;
        }
        e += 4 + sz;
      }
    }

    entries.push({
      name,
      size,
      compressedSize,
      method,
      localOffset,
      dir: name.endsWith("/"),
    });
    p += 46 + nameLen + extraLen + commentLen;
    if (entries.length >= MAX_ARCHIVE_ENTRIES) break;
  }
  return entries;
}

async function inflateRaw(u8: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "this browser has no DecompressionStream — deflated ZIP members cannot be read",
    );
  }
  const stream = new Blob([u8 as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(
  buf: ArrayBuffer,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const dv = new DataView(buf);
  const lo = entry.localOffset;
  if (lo + 30 > buf.byteLength || u32(dv, lo) !== 0x04034b50) {
    throw new Error(
      `local header for "${entry.name}" is not where the directory says it is`,
    );
  }
  const nameLen = u16(dv, lo + 26);
  const extraLen = u16(dv, lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = new Uint8Array(
    buf,
    start,
    Math.min(entry.compressedSize, buf.byteLength - start),
  );
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(
    `compression method ${entry.method} is not supported (only stored and deflate are)`,
  );
}

interface Zip {
  entries: ZipEntry[];
  bytes(name: string): Promise<Uint8Array | null>;
  text(name: string): Promise<string | null>;
  has(name: string): boolean;
}

// A ZIP opened once, with its members read on demand and cached. Every
// container format below (DOCX/PPTX/ODF/EPUB) is a ZIP with a known layout,
// so they all share this.
async function openZip(buf: ArrayBuffer): Promise<Zip> {
  const entries = readZipDirectory(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const cache = new Map<string, Uint8Array>();
  const bytes = async (name: string): Promise<Uint8Array | null> => {
    if (cache.has(name)) return cache.get(name)!;
    const e = byName.get(name);
    if (!e) return null;
    const b = await readZipEntry(buf, e);
    cache.set(name, b);
    return b;
  };
  const text = async (name: string): Promise<string | null> => {
    const b = await bytes(name);
    if (!b) return null;
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(b);
    } catch {
      return null;
    }
  };
  return { entries, bytes, text, has: (n: string) => byName.has(n) };
}

function zipSubtype(
  entries: ZipEntry[],
): "docx" | "pptx" | "xlsx" | "epub" | "odf" | null {
  const names = new Set(entries.map((e) => e.name));
  if (names.has("word/document.xml")) return "docx";
  if ([...names].some((n) => n.startsWith("ppt/slides/slide"))) return "pptx";
  if (names.has("xl/workbook.xml")) return "xlsx";
  if (
    names.has("META-INF/container.xml") &&
    [...names].some((n) => /\.opf$/.test(n))
  )
    return "epub";
  if (
    names.has("mimetype") &&
    names.has("content.xml") &&
    names.has("styles.xml")
  )
    return "odf";
  return null;
}

// ── XML → text ───────────────────────────────────────────────────────────
// DOMParser does the parsing (entities, namespaces, CDATA); what varies
// between formats is only which element names mean "paragraph", "line
// break" and "tab", so that is the only thing callers configure.

function parseXml(xml: string, mime = "application/xml"): Document | null {
  const doc = new DOMParser().parseFromString(
    xml,
    mime as DOMParserSupportedType,
  );
  if (doc.getElementsByTagName("parsererror").length) return null;
  return doc;
}

interface XmlToTextRules {
  block?: Set<string>;
  brk?: Set<string>;
  tab?: Set<string>;
  cell?: Set<string>;
  skip?: Set<string>;
}

// `cell` is what makes a table come out as a table: a DOCX row of three
// cells is otherwise three unrelated paragraphs in the extracted text.
// Inside a cell, paragraph breaks become spaces and the cell itself ends
// with a tab, so a row stays a row.
function xmlToText(root: Node, rules: XmlToTextRules): string {
  const block = rules.block ?? new Set<string>();
  const brk = rules.brk ?? new Set<string>();
  const tab = rules.tab ?? new Set<string>();
  const cell = rules.cell ?? new Set<string>();
  const skip = rules.skip ?? new Set<string>();
  const out: string[] = [];
  const walk = (node: Node, inCell: boolean) => {
    if (node.nodeType === 3) {
      out.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const ln = (el.localName || el.nodeName || "").toLowerCase();
    if (skip.has(ln)) return;
    if (brk.has(ln)) {
      out.push(inCell ? " " : "\n");
      return;
    }
    if (tab.has(ln)) {
      out.push("\t");
      return;
    }
    const isCell = cell.has(ln);
    for (let c = node.firstChild; c; c = c.nextSibling)
      walk(c, inCell || isCell);
    if (isCell) out.push("\t");
    else if (block.has(ln)) out.push(inCell ? " " : "\n");
  };
  walk(root, false);
  return out
    .join("")
    .replace(/ +\t/g, "\t")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\t+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Office Open XML (DOCX/PPTX) ─────────────────────────────────────────────

async function extractDocx(zip: Zip): Promise<string | null> {
  // The body, then footnotes and endnotes — all three are text the author
  // wrote, and leaving the notes out silently loses content the reader can
  // see in Word. Headers and footers are deliberately excluded: they
  // repeat per page and would show up in search as dozens of identical
  // passages.
  const parts: { path: string; label: string | null }[] = [
    { path: "word/document.xml", label: null },
    { path: "word/footnotes.xml", label: "Footnotes" },
    { path: "word/endnotes.xml", label: "Endnotes" },
  ];
  const rules: XmlToTextRules = {
    block: new Set(["p", "tr"]),
    brk: new Set(["br", "cr"]),
    tab: new Set(["tab"]),
    cell: new Set(["tc"]),
    skip: new Set([
      "instrtext",
      "delete",
      "prooferr",
      "bookmarkstart",
      "bookmarkend",
    ]),
  };
  const sections: string[] = [];
  for (const part of parts) {
    if (!zip.has(part.path)) continue;
    const xml = await zip.text(part.path);
    if (!xml) continue;
    const doc = parseXml(xml);
    if (!doc) continue;
    const text = xmlToText(doc.documentElement, rules);
    if (!text.trim()) continue;
    sections.push(part.label ? `--- ${part.label} ---\n\n${text}` : text);
  }
  if (!sections.length) return null;
  return sections.join("\n\n");
}

async function extractPptx(zip: Zip): Promise<string | null> {
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const notesRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
  const slides = zip.entries
    .map((e) => ({ e, m: slideRe.exec(e.name) }))
    .filter((x): x is { e: ZipEntry; m: RegExpExecArray } => !!x.m)
    .map((x) => ({ name: x.e.name, n: parseInt(x.m[1], 10) }))
    .sort((a, b) => a.n - b.n);
  if (!slides.length) return null;

  const notesByN = new Map(
    zip.entries
      .map((e) => ({ e, m: notesRe.exec(e.name) }))
      .filter((x): x is { e: ZipEntry; m: RegExpExecArray } => !!x.m)
      .map((x): [number, string] => [parseInt(x.m[1], 10), x.e.name]),
  );

  const rules: XmlToTextRules = { block: new Set(["p"]), brk: new Set(["br"]) };
  const out: string[] = [];
  for (const s of slides) {
    const xml = await zip.text(s.name);
    const doc = xml ? parseXml(xml) : null;
    const body = doc ? xmlToText(doc.documentElement, rules) : "";
    let block = `--- Slide ${s.n} ---\n\n${body}`;
    const notesPath = notesByN.get(s.n);
    if (notesPath) {
      const nxml = await zip.text(notesPath);
      const ndoc = nxml ? parseXml(nxml) : null;
      const notes = ndoc ? xmlToText(ndoc.documentElement, rules) : "";
      // Notes repeat the slide body in the OOXML notes part; only add what
      // is actually additional, so speaker notes don't double every slide.
      const extra = notes
        .split("\n")
        .filter((l) => l.trim() && !body.includes(l.trim()))
        .join("\n");
      if (extra.trim()) block += `\n\nNotes:\n${extra.trim()}`;
    }
    out.push(block);
  }
  return out.join("\n\n");
}

// ── OpenDocument (ODT/ODP/ODS) ───────────────────────────────────────────────

async function extractOdf(zip: Zip, fileName: string): Promise<string | null> {
  const xml = await zip.text("content.xml");
  if (!xml) return null;
  const doc = parseXml(xml);
  if (!doc) return null;
  const body =
    doc.getElementsByTagName("office:body")[0] || doc.documentElement;

  // What kind of OpenDocument package this is comes from the `mimetype`
  // member it is required to store first and uncompressed, falling back to
  // the extension where that's silent — the same precedence eochat's
  // file-formats.js uses.
  const odfMime = zip.has("mimetype")
    ? ((await zip.text("mimetype")) || "").trim()
    : "";
  const ext = extOf(fileName);
  const isSpreadsheet = /spreadsheet/.test(odfMime) || ext === "ods";

  if (isSpreadsheet) {
    // ODS cells carry repeat counts; expanding them is what makes column
    // positions line up with the header row instead of drifting left.
    const rows: string[] = [];
    for (const row of Array.from(
      body.getElementsByTagName("table:table-row"),
    )) {
      const cells: string[] = [];
      for (const cell of Array.from(row.children)) {
        const rep = Math.min(
          parseInt(
            cell.getAttribute("table:number-columns-repeated") || "1",
            10,
          ) || 1,
          1024,
        );
        const val = (cell.textContent || "").trim();
        const rendered = /[",\n]/.test(val)
          ? `"${val.replace(/"/g, '""')}"`
          : val;
        for (let i = 0; i < rep; i++) cells.push(rendered);
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      rows.push(cells.join(","));
    }
    while (rows.length && !rows[rows.length - 1]) rows.pop();
    return rows.length ? rows.join("\n") : null;
  }

  const text = xmlToText(body, {
    block: new Set(["p", "h", "table-row", "list-item"]),
    brk: new Set(["line-break"]),
    tab: new Set(["tab"]),
    cell: new Set(["table-cell"]),
  });
  return text || null;
}

// ── EPUB ─────────────────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  const doc =
    parseXml(html, "application/xhtml+xml") ||
    new DOMParser().parseFromString(html, "text/html");
  const root = doc.body || doc.documentElement;
  if (!root) return "";
  return xmlToText(root, {
    block: new Set([
      "p",
      "div",
      "section",
      "article",
      "li",
      "tr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
      "figcaption",
    ]),
    brk: new Set(["br", "hr"]),
    cell: new Set(["td", "th"]),
    skip: new Set(["script", "style", "noscript", "svg", "head"]),
  });
}

async function extractEpub(zip: Zip): Promise<string | null> {
  const container = await zip.text("META-INF/container.xml");
  if (!container) return null;
  const cdoc = parseXml(container);
  const rootfile = cdoc?.getElementsByTagName("rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) return null;

  const opfXml = await zip.text(opfPath);
  const opf = opfXml ? parseXml(opfXml) : null;
  if (!opf) return null;

  const dir = opfPath.includes("/") ? opfPath.replace(/\/[^/]*$/, "/") : "";
  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of Array.from(opf.getElementsByTagName("item"))) {
    manifest.set(item.getAttribute("id") || "", {
      href: item.getAttribute("href") || "",
      type: item.getAttribute("media-type") || "",
    });
  }
  // Spine order is the book's reading order — the difference between a
  // book and a pile of chapters in whatever order the ZIP happened to
  // store them.
  const spine = Array.from(opf.getElementsByTagName("itemref"))
    .map((r) => manifest.get(r.getAttribute("idref") || ""))
    .filter(
      (it): it is { href: string; type: string } =>
        !!it && /xhtml|html/.test(it.type),
    );
  if (!spine.length) return null;

  const titleEl =
    opf.getElementsByTagName("dc:title")[0] ||
    opf.getElementsByTagName("title")[0];
  const bookTitle = titleEl ? (titleEl.textContent || "").trim() : "";

  const resolve = (href: string): string | null => {
    const raw = decodeURIComponent(String(href).split("#")[0]);
    if (zip.has(raw)) return raw;
    const joined = (dir + raw).replace(/\/\.\//g, "/");
    if (zip.has(joined)) return joined;
    // Last resort: match on basename. EPUBs in the wild carry relative
    // hrefs that don't normalise cleanly; the alternative to this is
    // losing chapters.
    const base = raw.replace(/^.*\//, "");
    const hit = zip.entries.find(
      (e) => e.name.endsWith("/" + base) || e.name === base,
    );
    return hit ? hit.name : null;
  };

  const chunks: string[] = [];
  for (const item of spine) {
    const path = resolve(item.href);
    if (!path) continue;
    const html = await zip.text(path);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.trim()) chunks.push(text);
  }
  if (!chunks.length) return null;
  const head = bookTitle ? `${bookTitle}\n\n` : "";
  return head + chunks.join("\n\n");
}

// ── RTF ──────────────────────────────────────────────────────────────────────
// RTF is text with control words, so this is a real parse rather than a
// guess: groups nest, \'hh is a code-page byte, \uN is a Unicode codepoint
// with a skip-count, and destinations opened with \* carry data no reader
// displays.

function extractRtfText(src: string): string | null {
  let out = "";
  let i = 0;
  const skipStack: number[] = [];
  let skipping = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      skipStack.push(skipping);
      i++;
      continue;
    }
    if (ch === "}") {
      skipping = skipStack.pop() || 0;
      i++;
      continue;
    }
    if (ch === "\\") {
      const esc = src[i + 1];
      if (esc === "\\" || esc === "{" || esc === "}") {
        if (!skipping) out += esc;
        i += 2;
        continue;
      }
      if (esc === "*") {
        skipping = 1;
        i += 2;
        continue;
      }
      if (esc === "'") {
        const hex = src.substr(i + 2, 2);
        if (!skipping) out += String.fromCharCode(parseInt(hex, 16) || 0);
        i += 4;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const word = m[1];
      const arg = m[2] != null ? parseInt(m[2], 10) : null;
      if (word === "par" || word === "line" || word === "sect") {
        if (!skipping) out += "\n";
      } else if (word === "tab") {
        if (!skipping) out += "\t";
      } else if (word === "u" && arg != null) {
        if (!skipping) out += String.fromCharCode(arg < 0 ? arg + 65536 : arg);
        i += m[0].length + 1;
        continue;
      } else if (
        [
          "fonttbl",
          "colortbl",
          "stylesheet",
          "info",
          "pict",
          "object",
          "themedata",
          "datastore",
          "listtable",
          "rsidtbl",
          "generator",
        ].includes(word)
      ) {
        skipping = 1;
      }
      i += m[0].length;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (!skipping) out += ch;
    i++;
  }
  const text = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

// ── Kind taxonomy (for the document explorer's grid icons) ─────────────────
// A "kind" answers one question: how should the explorer show this? Ported
// (trimmed to the formats this app actually renders/extracts) from
// eochat's ui/file-formats.js EXT_KIND/KIND_LABEL.

const EXT_KIND: Record<string, string> = {
  txt: "text",
  text: "text",
  md: "text",
  markdown: "text",
  mdx: "text",
  rst: "text",
  adoc: "text",
  org: "text",
  tex: "text",
  log: "text",
  diff: "text",
  patch: "text",
  js: "code",
  mjs: "code",
  cjs: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  py: "code",
  rb: "code",
  rs: "code",
  go: "code",
  java: "code",
  kt: "code",
  swift: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  sql: "code",
  css: "code",
  scss: "code",
  html: "code",
  htm: "code",
  xml: "code",
  vue: "code",
  svelte: "code",
  json: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  ini: "data",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xls: "spreadsheet",
  ods: "spreadsheet",
  pdf: "pdf",
  docx: "document",
  docm: "document",
  dotx: "document",
  doc: "document",
  odt: "document",
  rtf: "document",
  pptx: "presentation",
  pptm: "presentation",
  ppt: "presentation",
  odp: "presentation",
  epub: "ebook",
  mobi: "ebook",
  fb2: "ebook",
  ipynb: "notebook",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  ico: "image",
  tif: "image",
  tiff: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  flac: "audio",
  ogg: "audio",
  zip: "archive",
  jar: "archive",
  tar: "archive",
  gz: "archive",
  "7z": "archive",
};

const KIND_LABEL: Record<string, string> = {
  text: "Text",
  code: "Code",
  data: "Data",
  pdf: "PDF",
  document: "Document",
  presentation: "Slides",
  ebook: "Book",
  notebook: "Notebook",
  spreadsheet: "Sheet",
  image: "Image",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  binary: "File",
};

function extOf(name: string): string {
  const base = String(name || "")
    .replace(/^.*[/\\]/, "")
    .toLowerCase();
  const m = base.match(/\.([a-z0-9_]+)$/);
  return m ? m[1] : "";
}

/** How the document explorer should show this file: a kind + a short label. */
export function kindOf(
  name: string,
  mimeType?: string,
): { kind: string; label: string } {
  if (mimeType?.startsWith("image/"))
    return { kind: "image", label: KIND_LABEL.image };
  if (mimeType?.startsWith("video/"))
    return { kind: "video", label: KIND_LABEL.video };
  if (mimeType?.startsWith("audio/"))
    return { kind: "audio", label: KIND_LABEL.audio };
  const ext = extOf(name);
  const kind = EXT_KIND[ext] || "binary";
  return { kind, label: KIND_LABEL[kind] || "File" };
}

// ── Detection + dispatch ─────────────────────────────────────────────────────

/**
 * Magic-byte + extension sniff. file.type (browser-supplied) is often empty
 * or wrong for these formats, so this never trusts it — signatures are
 * read directly off the bytes, same discipline findBinaryStructure already
 * applies to the bytes themselves rather than to reported metadata.
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

  const isRtf =
    bytes.length >= 6 &&
    bytes[0] === 0x7b && // {
    bytes[1] === 0x5c && // \
    bytes[2] === 0x72 && // r
    bytes[3] === 0x74 && // t
    bytes[4] === 0x66; // f
  if (isRtf) return "rtf";

  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (!isZip) return null;

  // A ZIP's own internal layout decides its real subtype — DOCX, XLSX,
  // PPTX, ODF and EPUB are all ZIPs, and the file extension alone would be
  // guessing at something the container already declares structurally.
  try {
    const entries = readZipDirectory(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    const subtype = zipSubtype(entries);
    if (subtype) return subtype;
  } catch {
    // Not a well-formed ZIP (or truncated) — fall through to the extension.
  }
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "xlsx";
  if (ext === "docx" || ext === "docm") return "docx";
  if (ext === "pptx" || ext === "pptm") return "pptx";
  if (ext === "odt" || ext === "odp" || ext === "ods") return "odf";
  if (ext === "epub") return "epub";
  return null;
}

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

function truncate(text: string | null): string | null {
  if (!text) return null;
  return text.length > MAX_EXTRACT_CHARS
    ? text.slice(0, MAX_EXTRACT_CHARS)
    : text;
}

async function extractZipFormatText(
  bytes: Uint8Array,
  fileName: string,
  format: "docx" | "pptx" | "odf" | "epub",
): Promise<string | null> {
  const zip = await openZip(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
  );
  if (format === "docx") return truncate(await extractDocx(zip));
  if (format === "pptx") return truncate(await extractPptx(zip));
  if (format === "odf") return truncate(await extractOdf(zip, fileName));
  return truncate(await extractEpub(zip));
}

/**
 * Dispatches on the sniffed format. Returns null (never throws) on anything
 * unrecognised, unparseable, or textless — the caller's existing binary
 * path is always a safe fallback, so a bad/corrupt file just means no
 * extraction, not a broken upload.
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
    if (format === "rtf") {
      return truncate(
        extractRtfText(new TextDecoder("windows-1252").decode(bytes)),
      );
    }
    return await extractZipFormatText(bytes, fileName, format);
  } catch {
    return null;
  }
}
