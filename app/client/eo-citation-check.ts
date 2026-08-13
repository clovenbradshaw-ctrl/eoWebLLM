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
  // Which warrant channels this check actually covered (see eo-warrant.ts).
  // "clean" means clean AGAINST THESE — a report that doesn't say what it
  // checked reads as a whole-answer verdict when it is a partial one
  // (LAWS.md L6 — no implied completeness).
  channels: string[];
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
  // Discourse adverbs a small model loves to open sentences with. They are
  // never proper names, so a capitalized "Unfortunately" is grammar, not a
  // claim — flagging it makes the reader pay for the model's mannerisms.
  "unfortunately",
  "fortunately",
  "thankfully",
  "regrettably",
  "admittedly",
  "sadly",
  "luckily",
  "ironically",
  "surprisingly",
  "honestly",
  "interestingly",
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

export function wordSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const w of String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (w) set.add(w);
  }
  return set;
}

const NUM_IN_TEXT_RE = /\d[\d,]*(?:\.\d+)?/g;
export function numberSet(s: string): Set<string> {
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
export function hasWord(words: Set<string>, word: string): boolean {
  const w = word.toLowerCase();
  if (words.has(w)) return true;
  if (w.length < MIN_STEM) return false;
  for (const hw of words) {
    if (hw.length >= MIN_STEM && (hw.startsWith(w) || w.startsWith(hw)))
      return true;
  }
  return false;
}

export function hasNumber(numbers: Set<string>, token: string): boolean {
  return numbers.has(String(token).replace(/,/g, ""));
}

export interface Index {
  words: Set<string>;
  numbers: Set<string>;
}

// ── Closed-class paraphrase: the abbreviation table ────────────────────────
//
// The check is deliberately literal — a number or name must exist in the
// bytes cited. But "literal" is not "dumb": a source that says "Chief
// Executive" supports an answer that says "CEO", and a source that says "CEO"
// supports an answer that says "Chief Executive". These are fixed, well-known
// equivalences — general knowledge, which in this pipeline is a PRIOR, and the
// point of a prior is that it is applied without asking the model (LAWS.md
// L11d: no second, looser guess). The table is closed-form and symmetric: it
// is applied to the union index at build time in both directions, so the check
// itself stays the exact string-containment test it always was. Deliberately
// conservative — office roles only, nothing that collides with ordinary prose
// ("us", "est", "gov") where expanding would fabricate support.
const ABBREV_EXPANSIONS: Record<string, string[]> = {
  ceo: ["chief", "executive"],
  coo: ["chief", "operating", "officer"],
  cfo: ["chief", "financial", "officer"],
  cto: ["chief", "technology", "officer"],
  cio: ["chief", "information", "officer"],
  cmo: ["chief", "marketing", "officer"],
  vp: ["vice", "president"],
};

/** Expansion words for an abbreviation, if it is one of the closed class. */
export function abbreviationExpansion(word: string): string[] | null {
  const key = String(word || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return ABBREV_EXPANSIONS[key] ?? null;
}

export function buildUnionIndex(citations: CitationEntry[]): Index {
  const words = new Set<string>();
  const numbers = new Set<string>();
  for (const c of citations) {
    for (const w of wordSet(c.text)) words.add(w);
    for (const n of numberSet(c.text)) numbers.add(n);
  }
  // Both directions, so a disagreement that is only an abbreviation resolves
  // whichever way the source wrote it.
  for (const w of [...words]) {
    const exp = abbreviationExpansion(w);
    if (exp) for (const e of exp) words.add(e);
  }
  for (const [key, phrase] of Object.entries(ABBREV_EXPANSIONS)) {
    if (phrase.every((p) => hasWord(words, p))) words.add(key);
  }
  return { words, numbers };
}

/**
 * Whether one checkable token is supported by an index — exact bytes, or the
 * closed-class abbreviation of those bytes (both directions, per the table
 * above). Never a looser guess: the expansion list is fixed and small.
 */
export function tokenSupported(
  index: Index,
  isNumber: boolean,
  token: string,
): boolean {
  if (isNumber) return hasNumber(index.numbers, token);
  if (hasWord(index.words, token)) return true;
  const exp = abbreviationExpansion(token);
  if (exp) return exp.every((e) => hasWord(index.words, e));
  return false;
}

/**
 * Which of a check's findings a DIFFERENT set of citations actually supports.
 *
 * This is the surprise-driven re-surf's resolution test (the System-2 pass in
 * chat.ts): the draft asserted "CEO"; the first surf's passages lack it, so it
 * was reported unsupported — but a re-surf keyed on the draft's own unusual
 * word choice can surface the passage that says "Chief Executive", and then
 * the finding resolves and the reader is never shown a note about it. Same
 * index, same token support as the original check; only the material changed.
 * If it resolves, it was never really unsupported — it was un-surfaced.
 */
export function resolveFindingsAgainst(
  findings: GroundingFinding[],
  citations: CitationEntry[],
): GroundingFinding[] {
  if (!citations.length) return [];
  const index = buildUnionIndex(citations);
  return findings.filter((f) =>
    f.absent.every((t) => tokenSupported(index, f.atomKind === "number", t)),
  );
}

const ABBREV =
  /(?:\b(?:mr|mrs|ms|dr|st|prof|rev|hon|vol|no|pp?|ch|ed|fig|cf|vs|etc|al|inc|ltd|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)|\b[A-Z])\.$/i;

export function splitSentences(
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

export interface Atom {
  kind: "number" | "name";
  text: string;
  tokens: string[];
  start: number;
  end: number;
}

export function extractAtoms(sentence: string, absoluteStart: number): Atom[] {
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
 * How many checkable atoms — figures and proper names — a finished draft
 * asserts, using the same extraction the grounding check itself uses.
 *
 * This is the mechanical signal System 2 monitors the System-1 draft with
 * (see reviewDraft in eo-warrant.ts). A turn can look unremarkable going in
 * and come back full of specific numbers; that count, not the wording of the
 * question, is what says the answer made claims someone could check. Deriving
 * it from the same extractAtoms the checker uses is the point — a second,
 * looser claim detector would just be another guess (LAWS.md L11d).
 */
export function countClaimAtoms(content: string): number {
  let n = 0;
  for (const s of splitSentences(String(content || "")))
    n += extractAtoms(s.text, s.start).length;
  return n;
}

export interface ClaimAtom {
  atomKind: "number" | "name";
  text: string;
  start: number;
  end: number;
  echoesQuestion: boolean;
}

/**
 * The same atoms checkGrounding looks for, but standalone — for the turn
 * that never searched or read a source at all, so there is no citation set
 * to check them against yet. This is what eo-revision.ts's post-display
 * pass targets: not "unsupported by evidence already gathered" (there is
 * none) but "specific enough to be worth going and looking up now".
 *
 * `question` is threaded through for the same reason checkGrounding takes
 * one: a figure the reader supplied themselves ("was it built in 1887?" →
 * "yes, in 1887") isn't a claim the model is asserting on its own account,
 * and searching to "fact-check" the reader's own words back at them is
 * both wasted work and a strange thing to show them.
 */
export function extractClaimAtoms(content: string, question = ""): ClaimAtom[] {
  const questionWords = wordSet(question);
  const out: ClaimAtom[] = [];
  for (const s of splitSentences(String(content || "")))
    for (const a of extractAtoms(s.text, s.start))
      out.push({
        atomKind: a.kind,
        text: a.text,
        start: a.start,
        end: a.end,
        echoesQuestion: a.tokens.every((t) =>
          questionWords.has(t.toLowerCase()),
        ),
      });
  return out;
}

/**
 * Check the model's finished answer against everything this turn actually
 * surfaced. No citation numbers to resolve here (eoWebLLM strips [n] brackets
 * before this runs) — every checkable atom (name or figure) in a sentence
 * must occur SOMEWHERE across the material retrieved this turn, or it's
 * flagged as unsupported by the evidence that was supposed to ground it.
 *
 * The citations passed in are no longer web-only: any external warrant
 * channel surfaced this turn contributes them (see corpusCitations in
 * eo-corpus.ts). A reader's uploaded document was the conspicuous gap — the
 * answer was checked when a search ran and not when the answer was about
 * their own file, which is precisely backwards.
 */
export function checkGrounding(
  content: string,
  citations: CitationEntry[],
  opts: { question?: string; channels?: string[] } = {},
): GroundingReport {
  const channels = opts.channels ?? [];
  if (!citations.length) {
    return {
      sentences: 0,
      citedSentences: 0,
      atomsChecked: 0,
      findings: [],
      clean: true,
      truncated: null,
      channels,
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
        if (!tokenSupported(index, atom.kind === "number", token))
          absent.push(token);
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
    channels,
  };
}

// The marker names what was actually consulted rather than always saying
// "search results" — a claim about the reader's own uploaded file that says
// "not in search results" tells them nothing about where it was looked for.
function voidMarker(channels: string[]): string {
  if (!channels.length) return "[⊘ unsupported]";
  return `[⊘ not in ${channels.join(" or ")}]`;
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
  const marker = voidMarker(report.channels ?? []);
  let out = content;
  for (const f of [...report.findings].sort((a, b) => b.start - a.start)) {
    if (f.echoesQuestion) continue;
    out = out.slice(0, f.end) + ` ${marker}` + out.slice(f.end);
  }
  return out;
}

/**
 * A mechanical replacement value for one unsupported claim, found by matching
 * the draft sentence that made the claim against sentences of the material
 * actually consulted this turn — never by asking the model what the right
 * value is (LAWS.md L5: a compliance-critical fact is never left to the
 * model's own instruction-following).
 *
 * Deliberately conservative: a candidate sentence must share at least
 * SNIP_MIN_SIGNIFICANT_WORDS non-numeric words with the draft sentence (so
 * the match is topical, not coincidental), and the winning sentence must
 * contain exactly one atom of the claim's own kind — two or more candidate
 * numbers/names in the best-matching sentence means there's no way to pick
 * the right one mechanically, so this returns null rather than guess.
 */
export function findMechanicalCorrection(
  atom: { text: string; atomKind: "number" | "name" },
  draftSentence: string,
  consultedText: string[],
): string | null {
  const draftWords = new Set(
    [...significantWords(draftSentence)].filter((w) => !/^\p{N}+$/u.test(w)),
  );
  if (draftWords.size < SNIP_MIN_SIGNIFICANT_WORDS) return null;

  let best: { text: string; overlap: number } | null = null;
  for (const passage of consultedText) {
    for (const s of splitSentences(passage)) {
      if (s.text.toLowerCase().includes(atom.text.toLowerCase())) continue;
      const candWords = significantWords(s.text);
      let overlap = 0;
      for (const w of draftWords) if (candWords.has(w)) overlap++;
      if (overlap < SNIP_MIN_SIGNIFICANT_WORDS) continue;
      if (!best || overlap > best.overlap) best = { text: s.text, overlap };
    }
  }
  if (!best) return null;

  const atoms = extractAtoms(best.text, 0).filter(
    (a) => a.kind === atom.atomKind,
  );
  if (atoms.length !== 1) return null;
  if (atoms[0].text.trim().toLowerCase() === atom.text.trim().toLowerCase())
    return null;
  return atoms[0].text;
}

// ── Snipping: show the exact words that grounded the reply, not the whole
// source ──────────────────────────────────────────────────────────────────
//
// Ported from citation-check.js's bestClause/significantWords/autoAttach-
// Citations family. The disclosure panel used to dump a whole search
// snippet per result regardless of whether the reply used it — correct but
// noisy: the reader has to read the full snippet to find the sentence that
// actually did the grounding. This finds, per citation, the ONE clause of
// its own text with the highest vocabulary overlap against the reply —
// literal bytes from the source, never a paraphrase — so the panel can show
// "here is the exact sentence that backed this" instead of everything that
// was fetched.

const SNIP_MIN_SIGNIFICANT_WORDS = 3;
const SNIP_MAX_CHARS = 160;
const SNIP_MIN_SOURCE_CHARS = 20;

export function significantWords(s: string): Set<string> {
  const set = new Set<string>();
  for (const w of String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    // A run of digits ("482", "2026") is exactly the literal, checkable
    // evidence this overlap is meant to surface — a dollar figure or date
    // the reply quoted verbatim from the source. The >=4-char floor exists
    // to filter noise out of prose vocabulary; it was silently zeroing out
    // every short numeric token too (most amounts/years are 2-4 digits),
    // so a reply that reproduced the source's numbers exactly still scored
    // zero overlap and got shown as "read, but nothing... drew on it."
    if (/^\p{N}+$/u.test(w)) {
      if (w.length >= 2) set.add(w);
      continue;
    }
    if (w.length >= 4 && !CLAIM_STOPWORDS.has(w)) set.add(w);
  }
  return set;
}

export interface Snippet {
  index: number;
  clause: string | null;
  score: number;
}

/**
 * The clause of `citation.text` (split on sentence-ish boundaries) whose own
 * vocabulary overlaps `replyWords` the most. Returns null when no clause
 * clears the significance floor — silence is correct there, not a guess at
 * which sentence "must" be the relevant one.
 */
function bestClause(
  sourceText: string,
  wordsWanted: Set<string>,
): { clause: string; hits: number } | null {
  const clauses = String(sourceText || "")
    .split(/(?<=[.!?;])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
  let best: string | null = null;
  let bestHits = 0;
  for (const c of clauses) {
    if (c.length < SNIP_MIN_SOURCE_CHARS) continue;
    const cWords = significantWords(c);
    if (!cWords.size) continue;
    let hits = 0;
    for (const w of wordsWanted) if (cWords.has(w)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = c;
    }
  }
  if (!best) return null;
  if (best.length <= SNIP_MAX_CHARS) return { clause: best, hits: bestHits };
  const cut = best.slice(0, SNIP_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + "…";
  return { clause: trimmed, hits: bestHits };
}

/**
 * For each citation, the single clause of its own text that most overlaps
 * the reply's vocabulary — the "here is the exact sentence that grounded
 * this" a reader wants instead of a full snippet. A citation with no clause
 * clearing SNIP_MIN_SIGNIFICANT_WORDS gets `clause: null`, meaning nothing
 * in the reply drew from it specifically (it may still have been read).
 */
export function snipCitations(
  reply: string,
  citations: CitationEntry[],
): Snippet[] {
  const replyWords = significantWords(reply);
  return citations.map((c) => {
    if (
      replyWords.size < SNIP_MIN_SIGNIFICANT_WORDS ||
      c.text.length < SNIP_MIN_SOURCE_CHARS
    ) {
      return { index: c.index, clause: null, score: 0 };
    }
    const best = bestClause(c.text, replyWords);
    if (!best) return { index: c.index, clause: null, score: 0 };
    return { index: c.index, clause: best.clause, score: best.hits };
  });
}

// ── Mechanical consistency check: the citation modal's "does this line up"
// pass ─────────────────────────────────────────────────────────────────────
//
// Deliberately narrow, same discipline as checkGrounding above: this checks
// two cheap textual features a short verbatim/near-verbatim overlap can
// most easily hide a mismatch behind — polarity (did a "not" get dropped or
// added) and numbers (did the reply assert a figure the source clause never
// states) — never whether the two sentences mean the same thing. That's a
// semantic judgment this file has no way to make, and the UI showing this
// result must say so, not imply more than a word/number diff was checked.

const NEGATION_WORDS = new Set([
  "not",
  "no",
  "never",
  "without",
  "neither",
  "nor",
  "n't",
]);

function negationCount(s: string): number {
  const lower = ` ${String(s || "").toLowerCase()} `;
  let count = 0;
  for (const w of NEGATION_WORDS) {
    if (w === "n't") {
      count += (lower.match(/n't/g) || []).length;
    } else if (lower.includes(` ${w} `)) {
      count++;
    }
  }
  return count;
}

export interface ConsistencyCheck {
  /** True when the two sentences' negation-word counts disagree in a way
   *  that could flip polarity — a cheap parity check, not a real polarity
   *  parser (double negatives, "not uncommon", etc. can still slip past). */
  negationMismatch: boolean;
  /** Numbers the reply sentence states that the source sentence's own
   *  number set doesn't contain — empty when every reply number is present
   *  in the source (or the reply states no numbers at all). */
  unsupportedNumbers: string[];
}

/**
 * Compare a reply sentence against the source sentence a citation modal is
 * showing as its "snip", on exactly the two mechanical features described
 * above. Pure, zero model/network calls — same tier as buildGroundingSpans.
 */
export function checkConsistency(
  replySentence: string,
  sourceSentence: string,
): ConsistencyCheck {
  const negationMismatch =
    negationCount(replySentence) > 0 !== negationCount(sourceSentence) > 0;
  const sourceNumbers = numberSet(sourceSentence);
  const unsupportedNumbers = [...numberSet(replySentence)].filter(
    (n) => !sourceNumbers.has(n),
  );
  return { negationMismatch, unsupportedNumbers };
}

// ── detectMaterialEvasion: denial-vs-bytes ────────────────────────────────

const EVASION_VERBS =
  "mention|say|state|specify|provide|give|tell|address|indicate|reveal|" +
  "list|detail|contain|include|cover|discuss|record|report|identify|note|" +
  "describe|name|cite|appear";
const EVASION_VERBS_BARE =
  "mention|provide|specify|give|contain|include|cover|address|discuss|" +
  "record|report|note|describe|name|cite|list|detail|indicate|reveal|appear";
const EVASION_PARTICIPLES =
  "mentioned|specified|found|addressed|stated|given|provided|discussed|" +
  "documented|recorded|available|known|noted|indicated|listed|revealed|" +
  "detailed|included|covered|described|named|cited|identified";
const EVASION_NOUNS =
  "mention|information|details?|data|figures?|record|indication|reference|" +
  "discussion|statement|answer|listing|coverage";
const SOURCE_NOUNS =
  "text|document|passage|passages|material|source|corpus|report|article|" +
  "chapter|section|page|answer|file|record|documents?";
const NEGATED =
  "(?:doesn[''’]?t|does not|didn[''’]?t|did not|won[''’]?t|will not)";

const EVASION_PATTERNS: RegExp[] = [
  // "the document does not mention / say / provide ..." — subject explicitly
  // the material, any denial verb.
  new RegExp(
    `\\b(?:the\\s+)?(?:${SOURCE_NOUNS})\\s+${NEGATED}\\s+(?:${EVASION_VERBS})\\b`,
    "i",
  ),
  // bare "doesn't mention / does not provide ..." (optionally "it does not").
  // Deliberately narrower than the subject-anchored list: "doesn't say X but
  // says Y" is ordinary rhetoric, "doesn't mention X" is a coverage denial.
  new RegExp(`\\b(?:it\\s+)?${NEGATED}\\s+(?:${EVASION_VERBS_BARE})\\b`, "i"),
  // "isn't mentioned / was not given / is not known ..."
  new RegExp(
    `\\b(?:isn[''’]?t|is not|wasn[''’]?t|was not|weren[''’]?t|were not)\\s+(?:${EVASION_PARTICIPLES})\\b`,
    "i",
  ),
  // bare "not specified / not found / not available ..."
  new RegExp(`\\bnot\\s+(?:${EVASION_PARTICIPLES})\\b`, "i"),
  // "no mention / no information / no details / no data / no figures ..."
  new RegExp(`\\bno\\s+(?:${EVASION_NOUNS})\\b`, "i"),
  // "nothing about / on / regarding"
  /\bnothing\s+(?:about|on|regarding)\b/i,
  // "couldn't find / cannot determine / cannot be determined / unable to say ..."
  new RegExp(
    `\\b(?:couldn[''’]?t|could not|can[''’]?t|cannot|unable to|` +
      `wasn[''’]?t able to|was not able to|weren[''’]?t able to|` +
      `were not able to|is unable to|are unable to|am unable to)\\s+` +
      `(?:be\\s+)?(?:find|determine|ascertain|establish|confirm|verify|` +
      `identify|locate|say|provide|give|recover|discover|decide|found|` +
      `determined|verified|ascertained|established|confirmed|identified|` +
      `located|decided)\\b`,
    "i",
  ),
  // "not in the document / not in the text / not in the records"
  new RegExp(`\\bnot\\s+in\\s+the\\s+(?:${SOURCE_NOUNS})\\b`, "i"),
  // "it is not clear / not certain / not known which|whether|how ..."
  new RegExp(
    `\\bit\\s+(?:is|[''’]s)\\s+not\\s+(?:clear|certain|known|obvious|specified)\\s+` +
      `(?:which|whether|how|what|when|where|who)\\b`,
    "i",
  ),
  // "not sure which / whether / how ..."
  new RegExp(
    `\\bnot\\s+sure\\s+(?:which|whether|how|what|when|where|who)\\b`,
    "i",
  ),
  // "no specific / no explicit information ..."
  new RegExp(`\\bno\\s+(?:specific|explicit)\\s+(?:${EVASION_NOUNS})\\b`, "i"),
  // "fails to mention / fail to provide ..."
  new RegExp(`\\bfails?\\s+to\\s+(?:${EVASION_VERBS})\\b`, "i"),
  // "without mentioning / without providing ..."
  new RegExp(
    `\\bwithout\\s+(?:mentioning|providing|giving|stating|specifying|addressing|covering|discussing)\\b`,
    "i",
  ),
];

/**
 * Detect an evasion in a draft: a claim that the reader's own material does
 * not cover something, phrased as a denial ("doesn't mention", "not
 * specified", "no information about"). A denial alone is cheap to state and
 * models state them reflexively; this only counts as an EVASION when the
 * mechanical retrieval returned passages this turn — when the bytes disagree
 * with the prose, the retrieval wins. Returns the first matched denial phrase
 * (lowercased) or null. Pure, zero model/network calls — same tier as
 * checkGrounding.
 */
export function detectMaterialEvasion(
  draft: string,
  retrievedPassages: number,
): string | null {
  if (!draft || retrievedPassages < 1) return null;
  for (const re of EVASION_PATTERNS) {
    const m = String(draft).match(re);
    if (m) return m[0].toLowerCase();
  }
  return null;
}
