// eo-project-instructions.ts — compile a project's free-form instruction
// text into folds the existing instruction gate (eo-gate.ts) can surf and
// fold, so a project's standing rules reach the model the same bounded,
// verbatim, per-turn way the built-in instruction set already does.
//
// Ported from eochat's server/project-instructions.js. The problem it
// solves: a reader pastes their project's rules as one document of whatever
// length they like. The model cannot be handed all of it every turn — that
// is exactly the context pressure eo-gate.ts's instruction gate was built
// for — but neither can it be handed a summary, because an instruction that
// is in force has to reach the model word for word, or the model is obeying
// something nobody wrote (the same verbatim discipline eo-corpus.ts's
// citations and eo-memory.ts's desk both already hold to).
//
// So the text is SEGMENTED, never rewritten. Every fold body produced here
// is an exact substring of what the reader typed; compileProjectInstructionFolds
// asserts that before returning. What the gate then does per turn — surface
// the relevant folds verbatim, reduce the rest to a named fingerprint index
// — is the same mechanism the built-in instruction set already uses, not a
// second one.
//
// The length rule is the honest one: if the whole text fits the budget,
// none of it is folded. Folding is a response to not fitting, not a house
// style.

import {
  countTokens,
  createInstructionGate,
  DEFAULT_INSTRUCTION_BUDGET,
  type InstructionFold,
} from "./eo-gate";

// Terms too common to distinguish one section from another. Kept small on
// purpose: this list only has to stop signals that would match every turn,
// not model English.
const STOPWORDS = new Set(
  `
a an the and or but if then than that this these those of in on at to for with
from by as is are was were be been being do does did doing have has had having
it its it's you your yours we our ours they them their i me my mine he she his
her not no nor so such can could should would may might must will shall about
into over under again further once here there when where why how all any both
each few more most other some only own same too very just also let
please make sure use used using when-ever whenever always never
`
    .trim()
    .split(/\s+/),
);

const MAX_SIGNALS = 12;
const MIN_SIGNAL_LENGTH = 4;

// Two constraints pull against each other once instructions get long, and
// both matter. Every folded instruction must be NAMED in the block's index,
// so the reader and the model can always see which rules exist but are out
// of force -- that index costs roughly one line per fold, so its size grows
// with the number of folds. The whole block must also fit its budget.
// Segment a 200-page manual at every heading and the index alone overruns
// the budget before a single rule has been surfaced.
//
// The resolution is that granularity is derived from the budget rather than
// fixed: the index gets a fixed share, that share divided by the cost of a
// line gives the most folds that can all be named, and sections are merged
// until the count fits. Merging keeps bodies contiguous, so the verbatim
// property survives it. A fold must also be small enough to actually
// surface -- one bigger than the budget could never be given verbatim and
// would be a wall -- so bodies get their own ceiling, and when the two
// ceilings cannot both be met the report says so instead of the block
// quietly overflowing.
const INDEX_SHARE = 0.35;
const BODY_SHARE = 0.45;
const INDEX_LINE_TOKENS = 14;

function budgetGeometry(budgetTokens: number) {
  const maxFolds = Math.max(
    4,
    Math.floor((budgetTokens * INDEX_SHARE) / INDEX_LINE_TOKENS),
  );
  const maxFoldTokens = Math.max(120, Math.floor(budgetTokens * BODY_SHARE));
  return { maxFolds, maxFoldTokens };
}

function slugify(text: string | null | undefined, fallback: string): string {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

function words(text: string | null | undefined): string[] {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9'’-]+/i)
    .filter(Boolean);
}

interface Section {
  level: number;
  title: string | null;
  start: number;
  end: number;
  preamble?: boolean;
}

// Split on markdown ATX headings, keeping each heading with the body
// beneath it. Offsets are tracked so every produced body can be proven to
// be a literal slice of the source.
function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let offset = 0;

  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for the newline split removed
    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = {
        level: heading[1].length,
        title: heading[2].trim(),
        start: offset,
        end: offset + lineLength,
      };
    } else if (current) {
      current.end = offset + lineLength;
    } else if (line.trim()) {
      // Preamble: text before any heading.
      current = {
        level: 0,
        title: null,
        start: offset,
        end: offset + lineLength,
        preamble: true,
      };
    }
    offset += lineLength;
  }
  if (current) sections.push(current);
  return sections;
}

// Every offset where a fold may legally end: paragraph breaks AND sentence
// ends, merged. A wall of prose with no blank lines still has sentences,
// and splitting at one keeps the part a contiguous slice -- which is all
// the verbatim property requires. Cutting mid-word is what would break it.
//
// These were once tried in order, falling back to sentences only when there
// were no paragraph breaks at all. That let a single blank line at the end
// of a section count as "this text has paragraph structure" and suppress
// the sentence fallback entirely, so long sections came back unsplit
// against a small ceiling and could never be surfaced. Offering every
// boundary and letting the greedy fill choose is both simpler and correct:
// it still cuts at the coarsest boundary that fits, because it cuts at the
// LAST one that fits.
function breakpoints(body: string): number[] {
  const points = new Set<number>();
  for (const re of [/\n[ \t]*\n/g, /(?<=[.!?])\s+/g]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(body)) !== null) points.add(m.index + m[0].length);
  }
  return [...points].sort((a, b) => a - b);
}

interface Range {
  start: number;
  end: number;
}

// Break one oversized section into contiguous runs, each under the
// per-fold ceiling, preferring the coarsest boundary that works.
function splitOversized(
  text: string,
  start: number,
  end: number,
  maxFoldTokens: number,
): Range[] {
  const body = text.slice(start, end);
  if (countTokens(body) <= maxFoldTokens) return [{ start, end }];

  const points = breakpoints(body);
  if (!points.length) return [{ start, end }];

  const parts: Range[] = [];
  let partStart = start;
  let lastGood = start;
  for (const p of points) {
    const boundary = start + p;
    if (
      countTokens(text.slice(partStart, boundary)) > maxFoldTokens &&
      lastGood > partStart
    ) {
      parts.push({ start: partStart, end: lastGood });
      partStart = lastGood;
    }
    lastGood = boundary;
  }
  if (partStart < end) parts.push({ start: partStart, end });
  return parts.length ? parts : [{ start, end }];
}

interface Piece extends Section {
  partIndex: number;
  partCount: number;
  mergedFrom?: number;
}

// Merge adjacent pieces until there are few enough that every one of them
// can be named in the block's index. Merging is by concatenating
// neighbours, so a merged body is still one contiguous slice of the source
// and still verbatim. Preamble pieces are never merged into a following
// section: the preamble is the standing rule set and has to stay
// separately addressable.
function mergeToFit(pieces: Piece[], maxFolds: number): Piece[] {
  if (pieces.length <= maxFolds) return pieces;
  const head = pieces.filter((p) => p.preamble);
  const rest = pieces.filter((p) => !p.preamble);
  const room = Math.max(1, maxFolds - head.length);
  if (rest.length <= room) return pieces;

  const perGroup = Math.ceil(rest.length / room);
  const merged: Piece[] = [];
  for (let i = 0; i < rest.length; i += perGroup) {
    const group = rest.slice(i, i + perGroup);
    merged.push({
      level: Math.min(...group.map((g) => g.level || 1)),
      title:
        group.length === 1
          ? group[0].title
          : `${group[0].title || "Instructions"} … ${
              group[group.length - 1].title || ""
            }`.trim(),
      start: group[0].start,
      end: group[group.length - 1].end,
      partIndex: 0,
      partCount: 1,
      mergedFrom: group.length,
    });
  }
  return [...head, ...merged];
}

// Distinctive terms: frequent inside this fold, rare across the others. No
// learned system, no model -- a count and a document-frequency divisor,
// which is what makes the surfacing decision inspectable after the fact.
function deriveSignals(
  foldWordLists: string[][],
  index: number,
  titleTerms: string[],
): string[] {
  const own = foldWordLists[index];
  const counts = new Map<string, number>();
  for (const w of own) {
    if (w.length < MIN_SIGNAL_LENGTH || STOPWORDS.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const docFreq = new Map<string, number>();
  for (let i = 0; i < foldWordLists.length; i++) {
    for (const w of new Set(foldWordLists[i])) {
      docFreq.set(w, (docFreq.get(w) || 0) + 1);
    }
  }
  const scored = [...counts.entries()]
    .map(([w, n]): [string, number] => [w, n / (docFreq.get(w) || 1)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);

  // The heading's own words lead: they are the reader's chosen name for
  // this rule and the likeliest thing they will echo when they ask about
  // it.
  const out: string[] = [];
  for (const t of titleTerms) {
    if (t.length >= MIN_SIGNAL_LENGTH && !STOPWORDS.has(t) && !out.includes(t))
      out.push(t);
  }
  for (const w of scored) {
    if (out.length >= MAX_SIGNALS) break;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

function firstSentence(body: string, limit = 120): string {
  const flat = body
    .replace(/^#{1,6}\s+.*\n?/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  const dot = flat.indexOf(". ");
  const raw = dot > 20 ? flat.slice(0, dot + 1) : flat;
  return raw.length > limit ? raw.slice(0, limit - 1).trimEnd() + "…" : raw;
}

// What the block costs before any conditional fold is surfaced: the
// framing, every always-on body, and the full index naming every folded
// rule. This is the floor a turn starts from, and if the floor is already
// over budget no amount of per-turn skipping can save it. Measured by
// asking the real gate with a cue that matches nothing, so the number is
// the gate's own arithmetic rather than a second copy of it that can
// drift.
function baseBlockTokens(
  folds: InstructionFold[],
  budgetTokens: number,
): number {
  if (!folds.length) return 0;
  const probe = createInstructionGate(folds, budgetTokens);
  return probe.gate({ question: " " }).stats.blockTokens;
}

interface BuildFoldsOptions {
  maxFolds: number;
  maxFoldTokens: number;
  idPrefix: string;
  budgetTokens: number;
}

interface BuildFoldsResult {
  folds: InstructionFold[];
  unroutable: string[];
  beforeMerge: number;
  pieces: Piece[];
  preambleAlwaysOn: boolean;
  preambleTokens: number;
}

// Segment, merge and label one candidate granularity. Split out from
// compileProjectInstructionFolds so the fit loop can try several.
function buildFolds(
  source: string,
  { maxFolds, maxFoldTokens, idPrefix, budgetTokens }: BuildFoldsOptions,
): BuildFoldsResult {
  const sections = splitSections(source);
  let pieces: Piece[] = [];
  for (const section of sections) {
    const parts = splitOversized(
      source,
      section.start,
      section.end,
      maxFoldTokens,
    );
    parts.forEach((part, partIndex) => {
      pieces.push({
        ...section,
        start: part.start,
        end: part.end,
        partIndex,
        partCount: parts.length,
      });
    });
  }
  const beforeMerge = pieces.length;
  pieces = mergeToFit(pieces, maxFolds);

  // The preamble -- whatever the reader wrote before their first heading --
  // is the closest thing to "rules that always apply", so it is always-on
  // when it is small enough to afford. When it is not, it is folded like
  // everything else and the report says so rather than letting it silently
  // vanish.
  const preambleBudget = Math.floor(budgetTokens / 2);
  let preambleTokens = 0;
  for (const p of pieces)
    if (p.preamble) preambleTokens += countTokens(source.slice(p.start, p.end));
  const preambleAlwaysOn =
    preambleTokens > 0 && preambleTokens <= preambleBudget;

  const bodies = pieces.map((p) => source.slice(p.start, p.end).trim());
  const wordLists = bodies.map((b) => words(b));

  const folds: InstructionFold[] = [];
  const unroutable: string[] = [];
  const partCounter = new Map<string, number>();

  pieces.forEach((piece, i) => {
    const body = bodies[i];
    if (!body) return;
    const titleTerms = words(piece.title || "");
    const baseSlug = slugify(
      piece.title,
      piece.preamble ? "preamble" : `section-${i + 1}`,
    );
    const seen = partCounter.get(baseSlug) || 0;
    partCounter.set(baseSlug, seen + 1);
    const id = `${idPrefix}-${String(i + 1).padStart(3, "0")}-${baseSlug}${
      seen ? `-part${seen + 1}` : ""
    }`;
    const always = piece.preamble ? preambleAlwaysOn : false;
    const signals = always ? [] : deriveSignals(wordLists, i, titleTerms);

    // A conditional fold with no signals can never be surfaced: it is a
    // wall, not a gap-in-waiting. Rather than drop the reader's text or
    // fail the whole compile, such a fold is promoted to always-on and
    // named in the report, so it is still in force and the reader can see
    // why.
    if (!always && signals.length === 0) {
      unroutable.push(id);
      folds.push({
        id,
        title: piece.title || "Instructions",
        always: true,
        weight: 0,
        signals: [],
        fingerprint: firstSentence(body),
        body,
      });
      return;
    }

    folds.push({
      id,
      title:
        piece.title ||
        (piece.preamble ? "Project instructions (preamble)" : "Instructions"),
      always,
      // Every part of a split section shares its signals, so they tie on
      // score and the tie-break decides which one the reader actually
      // gets. It must favour the HEAD: a section states its rule first and
      // elaborates afterwards, so surfacing part 3 over part 1 hands the
      // model the commentary and withholds the rule.
      weight:
        (piece.preamble ? 100 : Math.max(0, 10 - (piece.level || 1))) -
        (piece.partIndex || 0) * 0.01,
      signals,
      // A continuation's fingerprint is redundant -- it names the same
      // section as its head -- and the index is charged for every one of
      // them. Naming it as a continuation keeps the index honest at a
      // fraction of the tokens, which is budget that goes back to
      // surfacing actual rules.
      fingerprint: piece.partIndex
        ? `(continues ${piece.title || "the previous fold"}, part ${piece.partIndex + 1})`
        : firstSentence(body),
      body,
    });
  });

  return {
    folds,
    unroutable,
    beforeMerge,
    pieces,
    preambleAlwaysOn,
    preambleTokens,
  };
}

export interface CompileInstructionsReport {
  mode: "empty" | "whole" | "folded";
  reason?: string;
  totalTokens: number;
  folds: number;
  alwaysOn: number;
  conditional: number;
  budgetTokens: number;
  preambleAlwaysOn?: boolean;
  preambleTokens?: number;
  maxFolds?: number;
  maxFoldTokens?: number;
  merged?: number;
  unroutable?: string[];
  oversized?: string[];
  warning?: string;
}

/**
 * Compile a project's free-form instruction text into gate folds.
 *
 * @param text            the reader's instructions, verbatim
 * @param opts.budgetTokens  the gate budget these folds will face
 * @param opts.idPrefix      namespace for fold ids
 */
export function compileProjectInstructionFolds(
  text: string,
  {
    budgetTokens = DEFAULT_INSTRUCTION_BUDGET,
    idPrefix = "proj",
  }: { budgetTokens?: number; idPrefix?: string } = {},
): { folds: InstructionFold[]; report: CompileInstructionsReport } {
  const source = String(text ?? "");
  const trimmed = source.trim();
  if (!trimmed) {
    return {
      folds: [],
      report: {
        mode: "empty",
        totalTokens: 0,
        folds: 0,
        alwaysOn: 0,
        conditional: 0,
        budgetTokens,
      },
    };
  }

  const totalTokens = countTokens(source);

  // Short enough to hand over whole: no folding, no signals, no index.
  // Folding exists to fit a budget -- applying it to text that already
  // fits would hide rules behind a relevance test for no reason, and a
  // rule the reader wrote that never surfaces is worse than one they can
  // see is long.
  if (totalTokens <= budgetTokens) {
    return {
      folds: [
        {
          id: `${idPrefix}-all`,
          title: "Project instructions",
          always: true,
          weight: 100,
          signals: [],
          fingerprint: firstSentence(source),
          body: source.trim(),
        },
      ],
      report: {
        mode: "whole",
        reason: `The instructions are ${totalTokens} tokens, within the ${budgetTokens}-token budget, so all of them are in force on every turn — nothing is folded.`,
        totalTokens,
        folds: 1,
        alwaysOn: 1,
        conditional: 0,
        budgetTokens,
      },
    };
  }

  // Granularity is chosen by MEASURING the resulting block, not by
  // predicting it: the estimate is only a starting point, and the real
  // gate is asked what the block actually costs, granularity coarsening
  // until it fits.
  let { maxFolds, maxFoldTokens } = budgetGeometry(budgetTokens);
  let built = buildFolds(source, {
    maxFolds,
    maxFoldTokens,
    idPrefix,
    budgetTokens,
  });
  let fitAttempts = 0;
  while (
    baseBlockTokens(built.folds, budgetTokens) > budgetTokens &&
    maxFolds > 2 &&
    fitAttempts < 8
  ) {
    maxFolds = Math.max(2, Math.floor(maxFolds * 0.6));
    built = buildFolds(source, {
      maxFolds,
      maxFoldTokens,
      idPrefix,
      budgetTokens,
    });
    fitAttempts++;
  }
  const {
    folds,
    unroutable,
    beforeMerge,
    pieces,
    preambleAlwaysOn,
    preambleTokens,
  } = built;

  // The verbatim property is a property of this function's OUTPUT, so it
  // is asserted here rather than trusted: every body must be findable,
  // character for character, in what the reader wrote. A segmentation bug
  // that silently altered an instruction would produce a model obeying a
  // rule nobody authored.
  for (const fold of folds) {
    if (!source.includes(fold.body)) {
      throw new Error(
        `eo-project-instructions: fold ${fold.id} is not a verbatim slice of the source`,
      );
    }
  }

  const alwaysOn = folds.filter((f) => f.always).length;

  // A fold larger than what the gate could ever spend on one body cannot
  // be surfaced, which would make it a wall. That is a real limit of
  // trying to fit this much instruction into this small a budget, and the
  // honest response is to report it -- with the remedy -- not to let the
  // reader believe a rule is in force that can never appear.
  const oversized = folds
    .filter((f) => !f.always && countTokens(f.body) > maxFoldTokens)
    .map((f) => f.id);

  return {
    folds,
    report: {
      mode: "folded",
      reason: `The instructions are ${totalTokens} tokens, over the ${budgetTokens}-token budget, so they are folded: the relevant sections are given to the model verbatim each turn and the rest are listed by name.`,
      totalTokens,
      folds: folds.length,
      alwaysOn,
      conditional: folds.length - alwaysOn,
      budgetTokens,
      preambleAlwaysOn,
      preambleTokens,
      // Granularity is derived from the budget so that every fold can
      // still be named in the index without the block overrunning it.
      maxFolds,
      maxFoldTokens,
      merged: beforeMerge > pieces.length ? beforeMerge - pieces.length : 0,
      // Named, not silent: these had no distinctive terms to route on, so
      // they are always in force instead of being unreachable.
      unroutable,
      oversized,
      ...(oversized.length
        ? {
            warning: `${oversized.length} fold(s) are larger than the ${maxFoldTokens}-token ceiling one fold may spend, so they cannot be surfaced at this budget. Raise the instruction budget or split these sections with more headings.`,
          }
        : {}),
    },
  };
}
