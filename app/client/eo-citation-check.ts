// eo-citation-check.ts — browser port of eochat's server/citation-check.js
// (checkGrounding + annotateVoids only; the mechanical fact-check that runs
// AFTER the model's answer is complete, comparing it against the actual web
// search snippets, and is never fed back into the prompt).
//
// The organising idea, unchanged from the source: a claim attached to a
// citation must be backed by bytes that citation actually points at. This
// checks that mechanically — string containment against the search snippet
// text — for numbers and proper names, without judging whether an
// uncited/unciteable claim is *true*.
//
// Source of the algorithm: eochat/server/citation-check.js
//   https://github.com/clovenbradshaw-ctrl/eochat
//
// eoWebLLM never lets the model write [n] brackets (see eo-websearch.ts's
// formatWebSearchBlock/stripCitationBrackets), so there is no per-claim
// citation number to resolve. Every sentence is instead checked against
// the FULL set of this turn's search snippets — the question this port
// answers is narrower than eochat's: not "does this claim's citation check
// out" but "does anything this turn actually searched support this claim".

export interface CitationEntry {
  index: number;
  source_id: string;
  text: string;
}

export interface GroundingFinding {
  kind: "unsupported_claim";
  atomKind: "number" | "name";
  text: string;
  absent: string[];
  start: number;
  end: number;
  echoesQuestion: boolean;
}

export interface GroundingReport {
  sentences: number;
  citedSentences: number;
  atomsChecked: number;
  findings: GroundingFinding[];
  clean: boolean;
  // LAWS.md L3 — no silent truncation: a capped findings list must say it was
  // capped, or it reads as a complete report when it isn't.
  truncated: { reported: number; total: number; dropped: number } | null;
}

// Same stopword table as citation-check.js — a capitalised word is only
// evidence of a claimed reference when its capital isn't explained by
// ordinary sentence-initial grammar.
const CLAIM_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "it",
  "its",
  "he",
  "she",
  "they",
  "them",
  "his",
  "her",
  "hers",
  "their",
  "theirs",
  "we",
  "us",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "i",
  "me",
  "my",
  "mine",
  "who",
  "whom",
  "whose",
  "which",
  "what",
  "where",
  "why",
  "how",
  "and",
  "but",
  "or",
  "nor",
  "so",
  "yet",
  "for",
  "as",
  "if",
  "then",
  "than",
  "when",
  "while",
  "after",
  "before",
  "since",
  "because",
  "although",
  "though",
  "unless",
  "until",
  "whether",
  "in",
  "on",
  "at",
  "by",
  "to",
  "from",
  "with",
  "within",
  "without",
  "of",
  "about",
  "into",
  "onto",
  "over",
  "under",
  "between",
  "among",
  "through",
  "during",
  "against",
  "toward",
  "towards",
  "upon",
  "across",
  "per",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  "let",
  "let's",
  "no",
  "not",
  "yes",
  "both",
  "each",
  "every",
  "either",
  "neither",
  "some",
  "any",
  "all",
  "none",
  "few",
  "many",
  "much",
  "more",
  "most",
  "less",
  "least",
  "several",
  "one",
  "two",
  "three",
  "other",
  "another",
  "same",
  "such",
  "own",
  "very",
  "only",
  "just",
  "also",
  "too",
  "still",
  "already",
  "always",
  "never",
  "often",
  "again",
  "first",
  "second",
  "third",
  "next",
  "last",
  "later",
  "earlier",
  "now",
  "today",
  "however",
  "moreover",
  "therefore",
  "thus",
  "hence",
  "meanwhile",
  "instead",
  "overall",
  "finally",
  "additionally",
  "furthermore",
  "nevertheless",
  "besides",
  "accordingly",
  "consequently",
  "similarly",
  "conversely",
  "notably",
  "indeed",
  "perhaps",
  "maybe",
  "possibly",
  "likely",
  "clearly",
  "importantly",
  "generally",
  "specifically",
  "particularly",
  "essentially",
  "ultimately",
  "together",
  "according",
  "based",
  "note",
  "given",
  "regarding",
  "concerning",
  "despite",
  "well",
  "actually",
  "otherwise",
  "source",
  "sources",
  "passage",
  "passages",
  "text",
  "texts",
  "document",
  "documents",
  "answer",
  "answers",
  "question",
  "questions",
  "reader",
  "material",
  "context",
  "citation",
  "citations",
  "quote",
  "quotes",
  "summary",
  "response",
]);

function wordSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const w of String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (w) set.add(w);
  }
  return set;
}

const NUM_IN_TEXT_RE = /\d[\d,]*(?:\.\d+)?/g;
function numberSet(s: string): Set<string> {
  const set = new Set<string>();
  const src = String(s || "");
  NUM_IN_TEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_IN_TEXT_RE.exec(src)) !== null) {
    set.add(m[0].replace(/,/g, ""));
  }
  return set;
}

const MIN_STEM = 4;
function hasWord(words: Set<string>, word: string): boolean {
  const w = word.toLowerCase();
  if (words.has(w)) return true;
  if (w.length < MIN_STEM) return false;
  for (const hw of words) {
    if (hw.length >= MIN_STEM && (hw.startsWith(w) || w.startsWith(hw)))
      return true;
  }
  return false;
}

function hasNumber(numbers: Set<string>, token: string): boolean {
  return numbers.has(String(token).replace(/,/g, ""));
}

interface Index {
  words: Set<string>;
  numbers: Set<string>;
}

function buildUnionIndex(citations: CitationEntry[]): Index {
  const words = new Set<string>();
  const numbers = new Set<string>();
  for (const c of citations) {
    for (const w of wordSet(c.text)) words.add(w);
    for (const n of numberSet(c.text)) numbers.add(n);
  }
  return { words, numbers };
}

const ABBREV =
  /(?:\b(?:mr|mrs|ms|dr|st|prof|rev|hon|vol|no|pp?|ch|ed|fig|cf|vs|etc|al|inc|ltd|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)|\b[A-Z])\.$/i;

function splitSentences(
  text: string,
): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const src = String(text || "");
  let start = 0;
  const re = /[.!?]+(?=["'”’)\]]*(?:\s|$))|\n{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const end = m.index + m[0].length;
    const head = src.slice(start, end);
    if (ABBREV.test(head.trimEnd())) continue;
    if (head.trim()) out.push({ text: head, start, end });
    start = end;
  }
  if (start < src.length && src.slice(start).trim()) {
    out.push({ text: src.slice(start), start, end: src.length });
  }
  return out;
}

const NUMBER_RE = /\b\d[\d,]*(?:\.\d+)?%?\b/g;
const PROPER_RE =
  /\p{Lu}[\p{L}]*(?:['’][\p{L}]+)?(?:[ -](?:of|the|de|von|van|del|la|le)?[ ]?\p{Lu}[\p{L}]*(?:['’][\p{L}]+)?)*/gu;

interface Atom {
  kind: "number" | "name";
  text: string;
  tokens: string[];
  start: number;
  end: number;
}

function extractAtoms(sentence: string, absoluteStart: number): Atom[] {
  const atoms: Atom[] = [];

  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(sentence)) !== null) {
    const before = sentence.slice(0, m.index);
    const atLineStart = /(^|\n)[\s>*-]*$/.test(before);
    const followedByMarker = /^[.)]\s/.test(
      sentence.slice(m.index + m[0].length),
    );
    if (atLineStart && followedByMarker) continue;
    atoms.push({
      kind: "number",
      text: m[0],
      tokens: [m[0].replace(/[,%]/g, "")],
      start: absoluteStart + m.index,
      end: absoluteStart + m.index + m[0].length,
    });
  }

  PROPER_RE.lastIndex = 0;
  while ((m = PROPER_RE.exec(sentence)) !== null) {
    const phrase = m[0].trim();
    const words = phrase.split(/[\s-]+/).filter(Boolean);
    const contentWords = words.filter(
      (w) => !CLAIM_STOPWORDS.has(w.toLowerCase().replace(/['’]s$/, "")),
    );
    if (!contentWords.length) continue;
    atoms.push({
      kind: "name",
      text: phrase,
      tokens: contentWords.map((w) => w.replace(/['’]s$/, "")),
      start: absoluteStart + m.index,
      end: absoluteStart + m.index + m[0].length,
    });
  }

  atoms.sort((a, b) => a.start - b.start);
  return atoms;
}

const MAX_FINDINGS = 40;

/**
 * Check the model's finished answer against this turn's search snippets.
 * No citation numbers to resolve here (eoWebLLM strips [n] brackets before
 * this runs) — every checkable atom (name or figure) in a sentence must
 * occur SOMEWHERE across the snippets actually retrieved this turn, or it's
 * flagged as unsupported by the search that grounded the reply.
 */
export function checkGrounding(
  content: string,
  citations: CitationEntry[],
  opts: { question?: string } = {},
): GroundingReport {
  if (!citations.length) {
    return {
      sentences: 0,
      citedSentences: 0,
      atomsChecked: 0,
      findings: [],
      clean: true,
      truncated: null,
    };
  }
  const index = buildUnionIndex(citations);
  const questionWords = wordSet(opts.question || "");
  const sentences = splitSentences(content);

  const findings: GroundingFinding[] = [];
  let atomsChecked = 0;

  for (const s of sentences) {
    const atoms = extractAtoms(s.text, s.start);
    for (const atom of atoms) {
      atomsChecked++;
      const absent: string[] = [];
      for (const token of atom.tokens) {
        const supported =
          atom.kind === "number"
            ? hasNumber(index.numbers, token)
            : hasWord(index.words, token);
        if (!supported) absent.push(token);
      }
      if (!absent.length) continue;
      findings.push({
        kind: "unsupported_claim",
        atomKind: atom.kind,
        text: atom.text,
        absent,
        start: atom.start,
        end: atom.end,
        echoesQuestion: atom.tokens.every((t) =>
          questionWords.has(t.toLowerCase()),
        ),
      });
    }
  }

  findings.sort((a, b) => a.start - b.start);
  const total = findings.length;
  const kept = findings.slice(0, MAX_FINDINGS);
  return {
    sentences: sentences.length,
    citedSentences: sentences.filter((s) => extractAtoms(s.text, 0).length > 0)
      .length,
    atomsChecked,
    findings: kept,
    clean: total === 0,
    truncated:
      total > kept.length
        ? { reported: kept.length, total, dropped: total - kept.length }
        : null,
  };
}

/**
 * Write the gap into the answer itself, right-to-left so earlier offsets
 * stay valid. Skips claims that merely echo the reader's own question — the
 * void marker exists to flag what the model added, not what it repeated.
 */
export function annotateVoids(
  content: string,
  report: GroundingReport,
): string {
  if (!content || !report.findings.length) return content;
  let out = content;
  for (const f of [...report.findings].sort((a, b) => b.start - a.start)) {
    if (f.echoesQuestion) continue;
    out = out.slice(0, f.end) + ` [⊘ not in search results]` + out.slice(f.end);
  }
  return out;
}
