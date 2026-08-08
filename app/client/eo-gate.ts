// eo-gate.ts — browser-safe port of eochat's instruction-gate.js (the "surf"
// half of surf/fold/prompt).
//
// The full instruction set (instruction-set/*.md) is too large to sit in the
// context window alongside history and the answer. This module decides, per
// turn, which instruction folds are SURFACED (given verbatim) and which are
// FOLDED (reduced to a one-line fingerprint in an audit index).
//
// Surfacing is keyword-signal matching (cheap, deterministic, no learned
// system); folding is lossy by design but the index keeps every folded fold
// NAMED, so absence stays auditable.
//
// Source of the algorithm: eochat/server/instruction-gate.js
//   https://github.com/clovenbradshaw-ctrl/eochat
//
// This port is pure: no fs, no path, no model calls. Folds are supplied as an
// array of parsed { id, title, always, weight, signals, fingerprint, body }.
//
// ── Two surfs, not one surf at two speeds ─────────────────────────────────
//
// The gate runs in a `mode` (see GateOptions below), and the two modes do
// different work rather than the same work with different patience — which is
// the whole content of the System 1 / System 2 distinction. A System 2 pass
// that merely re-ran the same lexical scan with a bigger budget would be
// System 1 with more tokens.
//
//   System 1 — heuristic and associative. One lexical pass over the question
//   and recent history; highest-scoring folds until the budget fills; whatever
//   didn't fit is folded. It is biased the way availability is biased: it finds
//   the rules WORDED like the question. That is the right first pass, and it
//   systematically misses the rule that governs this turn without sharing its
//   vocabulary.
//
//   System 2 — dialogical and rule-based. It scores against the CLAIMS the
//   draft actually made, not only the question, because a rule about citation
//   discipline is triggered by an answer full of figures, not by a question
//   that never mentions figures. It then UNFOLDS: folds that matched and lost
//   the budget race are pulled back in against a raised ceiling, because
//   "matched but did not fit" is the one class of omission we know was
//   relevant (INSTRUCTION-LAW R8). And it hands the rules over framed as
//   obligations to CHECK the draft against, one at a time, rather than as
//   ambient style guidance to write under.

import type { ThinkingSystem } from "./eo-task-plan";

export interface InstructionFold {
  id: string;
  title: string;
  always: boolean;
  weight: number;
  signals: string[];
  fingerprint: string;
  body: string;
}

export const DEFAULT_INSTRUCTION_BUDGET = 2800;

// Same character-per-token estimate the eochat server uses (proxy.js `tok`):
// a rough ceiling, good enough to budget against.
export function countTokens(text: string | null | undefined): number {
  return Math.ceil(String(text ?? "").length / 3.5);
}

// Parse one fold file's front matter (`--- key: value` lines between the top
// `---` markers) from raw markdown text. `always`/`weight` parse as JSON;
// `signals` is a bracket list; `fingerprint` is the raw remainder of its line.
// Anything unparseable in the front matter is a load failure, not a silent
// default.
export function parseSignalList(raw: string): string[] {
  const inner = String(raw).trim();
  const content =
    inner.startsWith("[") && inner.endsWith("]") ? inner.slice(1, -1) : inner;
  if (!content.trim()) return [];
  const terms: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (const ch of content) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ",") {
      terms.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  terms.push(current.trim());
  return terms.filter(Boolean);
}

export function parseFrontMatter(raw: string): {
  fields: Record<string, unknown>;
  body: string;
} {
  const headerEnd = raw.indexOf("\n---");
  if (raw.startsWith("---") && headerEnd > 0) {
    const header = raw.slice(3, headerEnd).trim();
    const fields: Record<string, unknown> = {};
    for (const line of header.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      let value: unknown = line.slice(idx + 1).trim();
      if (key === "signals") {
        value = parseSignalList(String(value));
      } else if (key === "always" || key === "weight") {
        try {
          value = JSON.parse(String(value));
        } catch (err) {
          throw new Error(
            `instruction-set: ${key} not valid JSON in ${key}: ${(err as Error).message}`,
          );
        }
      }
      fields[key] = value;
    }
    return { fields, body: raw.slice(headerEnd + 4).trim() };
  }
  return { fields: {}, body: raw.trim() };
}

// R3 — relevance must be declared. A conditional fold that declares no signals
// can never surface: fail loudly, like a missing id.
export function parseInstructionFolds(rawTexts: string[]): InstructionFold[] {
  const folds: InstructionFold[] = [];
  for (const raw of rawTexts) {
    const { fields, body } = parseFrontMatter(raw);
    const id = fields.id;
    if (typeof id !== "string" || !id) {
      throw new Error("instruction-set: a fold has no front-matter id");
    }
    const always = fields.always === true;
    const signals = Array.isArray(fields.signals)
      ? fields.signals.map((s) => String(s))
      : [];
    if (!always && signals.length === 0) {
      throw new Error(
        `instruction-set: ${id} is conditional but declares no signals — it can never be surfaced`,
      );
    }
    folds.push({
      id,
      title:
        typeof fields.title === "string" && fields.title ? fields.title : id,
      always,
      weight:
        typeof fields.weight === "number" && Number.isFinite(fields.weight)
          ? fields.weight
          : 0,
      signals,
      fingerprint:
        typeof fields.fingerprint === "string" ? fields.fingerprint : "",
      body,
    });
  }
  return folds;
}

function splitTerms(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9'’]/i)
    .filter((w) => w.length > 0);
}

// Mechanical relevance: signal hit count (weighted, phrases count more than
// bare words) plus title-word overlap. Three signal channels, in decreasing
// strength: the QUESTION (full weight), HISTORY (half weight, capped), and
// EVIDENCE (half weight, capped lower). Every non-question hit is tagged in
// the audit (`hist:`/`ev:` prefixes).
const HISTORY_CAP_PER_FOLD = 3;
const EVIDENCE_CAP_PER_FOLD = 2;
// The claim channel is System 2's own, and it is uncapped and full-weight on
// purpose: a rule the ANSWER triggers is as much in force as one the question
// triggered. Capping it would reproduce the exact bias the second pass exists
// to correct.
const SUB_WORD = 1;
const SUB_PHRASE = 1.5;
const SUB_TITLE_WORD = 0.5;

// How far System 2 may raise the instruction budget to pull back folds that
// matched this turn and lost the budget race. Bounded, and the amount actually
// used is reported in stats.unfoldedIds — an unfold nobody can see is just a
// bigger budget with a nicer name.
const SYSTEM2_UNFOLD_MULTIPLIER = 2;

function scoreChannel(
  fold: InstructionFold,
  words: Set<string> | null,
  lower: string | null,
  tag: string | null,
  cap: number,
  // Subordinate channels (history, evidence) score at reduced weight because a
  // stale mention is weaker evidence of relevance than the live question. The
  // claim channel is tagged for the audit trail but weighs full: a rule the
  // answer triggered is in force now, not incidentally recalled.
  full = !tag,
): { score: number; matched: string[] } {
  if (!words || !lower) return { score: 0, matched: [] };
  let score = 0;
  const matched: string[] = [];
  const pre = tag ? `${tag}:` : "";
  for (const signal of fold.signals || []) {
    const s = String(signal).toLowerCase();
    if (!s) continue;
    const phrase = s.includes(" ");
    const hit = phrase ? lower.includes(s) : words.has(s);
    if (hit) {
      score += phrase ? (full ? 3 : SUB_PHRASE) : full ? 2 : SUB_WORD;
      matched.push(pre + s);
    }
  }
  for (const w of String(fold.title).toLowerCase().split(/\s+/)) {
    if (w.length > 3 && words.has(w)) {
      score += full ? 1 : SUB_TITLE_WORD;
      matched.push(pre + `title:${w}`);
    }
  }
  return { score: Math.min(score, cap), matched };
}

interface Cue {
  words: Set<string> | null;
  lower: string | null;
}

function cueOf(text: string | null | undefined): Cue {
  const s = String(text ?? "");
  return s
    ? { words: new Set(splitTerms(s)), lower: s.toLowerCase() }
    : { words: null, lower: null };
}

function scoreFold(
  fold: InstructionFold,
  question: Cue,
  history: Cue,
  evidence: Cue,
  claims: Cue,
): { score: number; matched: string[] } {
  const cue = scoreChannel(
    fold,
    question.words,
    question.lower,
    null,
    Infinity,
  );
  const hist = scoreChannel(
    fold,
    history.words,
    history.lower,
    "hist",
    HISTORY_CAP_PER_FOLD,
  );
  const ev = scoreChannel(
    fold,
    evidence.words,
    evidence.lower,
    "ev",
    EVIDENCE_CAP_PER_FOLD,
  );
  // System 2 only: what the answer committed to. Full weight, no cap — see the
  // note on SUB_WORD above.
  const cl = scoreChannel(
    fold,
    claims.words,
    claims.lower,
    "claim",
    Infinity,
    true,
  );
  return {
    score: cue.score + hist.score + ev.score + cl.score,
    matched: [...cue.matched, ...hist.matched, ...ev.matched, ...cl.matched],
  };
}

// The static framing that surrounds the fold list, plus per-fold renderers, so
// the budget can be an honest ceiling on the WHOLE instruction block.
const DEFAULT_LABEL = "RULES IN FORCE THIS TURN";
const SYSTEM2_LABEL = "RULES TO CHECK THIS ANSWER AGAINST";

// System 1 hands the rules over to write under. System 2 hands the same rules
// over as a checklist to run against something already written — same verbatim
// bodies (R1), different act.
const gateHeader = (label: string, mode: ThinkingSystem = "system1") =>
  `${"=".repeat(label.length + 8)}
===== ${label} =====
${
  mode === "system2"
    ? "An answer already exists. The rules below are the complete set of additional rules in force for it. Take them one at a time and say, for each, whether the answer actually satisfies it — and where it does not, what specifically fails. Do not restate a rule you are not checking."
    : "The rules below are the complete set of additional rules in force for this turn. Follow them, and no others."
}`;
const gateFooter = (label: string) => `===== END ${label} =====`;
const GATE_HEADER = gateHeader(DEFAULT_LABEL);
const GATE_FOOTER = gateFooter(DEFAULT_LABEL);

// R2 — a missing rule is a named gap, never a silence.
const GAP_MARKER = `=== NO ADDITIONAL RULES FOR THIS TURN ===
No additional rules apply this turn beyond the ones above. If the reader's subject is not one they cover, do not supply the answer from general knowledge or habit: say honestly that you do not have that specific rule in front of you and will confirm it. Never present an improvised answer as policy.`;

function activeLine(fold: InstructionFold): string {
  return `\n### ${fold.title}\n${fold.body}`;
}

function buildSystemBlock(
  surfaced: InstructionFold[],
  gap: boolean,
  label: string,
  mode: ThinkingSystem = "system1",
): string {
  const parts = [gateHeader(label, mode)];
  parts.push(`--- RULES (${surfaced.length}) ---`);
  for (const fold of surfaced) parts.push(activeLine(fold));
  if (gap) parts.push(GAP_MARKER);
  parts.push(gateFooter(label));
  return parts.join("\n");
}

function framingTokens(
  nActive: number,
  gap: boolean,
  label: string,
  mode: ThinkingSystem = "system1",
): number {
  const text = `${gateHeader(label, mode)}\n--- RULES (${nActive}) ---\n${gap ? GAP_MARKER + "\n" : ""}${gateFooter(label)}`;
  return countTokens(text);
}

export interface GateReport {
  activeIds: string[];
  foldedIds: string[];
  surfaced: InstructionFold[];
  folded: InstructionFold[];
  systemMessage: string;
  scores?: { id: string; score: number; matched: string[] }[];
  stats: {
    totalFolds: number;
    active: number;
    folded: number;
    usedTokens: number;
    blockTokens: number;
    budget: number;
    overflow: number;
    gap: boolean;
    rejectedByBudget: number;
    crowdedOutIds: string[];
    mode: ThinkingSystem;
    /** The token ceiling this pass was actually allowed (System 2 raises it). */
    ceiling: number;
    /** Folds System 2 pulled back in that System 1's budget had crowded out. */
    unfoldedIds: string[];
  };
}

export interface GateOptions {
  question?: string;
  history?: string[];
  evidence?: string[];
  /**
   * System 2 only: the draft answer whose claims this pass scores against.
   * Ignored in System 1 mode, where no draft exists yet.
   */
  claims?: string[];
  budgetTokens?: number;
  debug?: boolean;
  label?: string;
  mode?: ThinkingSystem;
}

export function createInstructionGate(
  folds: InstructionFold[],
  budgetTokens: number = DEFAULT_INSTRUCTION_BUDGET,
) {
  const alwaysOn = folds
    .filter((f) => f.always)
    .sort((a, b) => b.weight - a.weight);
  const conditional = folds.filter((f) => !f.always);

  const gate = (opts: GateOptions): GateReport => {
    const mode: ThinkingSystem =
      opts.mode === "system2" ? "system2" : "system1";
    const label =
      opts.label || (mode === "system2" ? SYSTEM2_LABEL : DEFAULT_LABEL);
    const budget = Number.isFinite(opts.budgetTokens)
      ? opts.budgetTokens!
      : budgetTokens;

    const question = cueOf(opts.question);
    const history = cueOf((opts.history || []).join(" "));
    const evidence = cueOf(
      Array.isArray(opts.evidence)
        ? opts.evidence.join(" ")
        : String(opts.evidence ?? ""),
    );
    // The claim channel exists only in System 2 — in System 1 there is no
    // draft yet, and a gate that scored against one would be scoring against
    // the previous turn's answer.
    const claims =
      mode === "system2" ? cueOf((opts.claims || []).join(" ")) : cueOf("");

    const scored = conditional
      .map((fold) => ({
        fold,
        ...scoreFold(fold, question, history, evidence, claims),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.fold.weight - a.fold.weight ||
          a.fold.id.localeCompare(b.fold.id),
      );

    const gap = folds.length > 0 && !scored.some((s) => s.score > 0);

    const surfaced = [...alwaysOn];
    let used = countTokens(surfaced.map(activeLine).join(""));
    let blockTokens = framingTokens(surfaced.length, gap, label, mode) + used;

    for (const { fold, score } of scored) {
      if (score <= 0) break;
      const delta = countTokens(activeLine(fold));
      if (blockTokens + delta > budget) continue;
      surfaced.push(fold);
      used += delta;
      blockTokens += delta;
    }

    // The unfold. A fold that scored above zero and lost the budget race is
    // the one omission we positively know was relevant to this turn, so System
    // 2 spends a bounded amount more to read it rather than leaving it in the
    // index. System 1 never does this: staying inside its budget is what makes
    // it the fast pass.
    const unfoldedIds: string[] = [];
    const ceiling =
      mode === "system2" ? budget * SYSTEM2_UNFOLD_MULTIPLIER : budget;
    if (mode === "system2") {
      const seated = new Set(surfaced.map((f) => f.id));
      for (const { fold, score } of scored) {
        if (score <= 0) break;
        if (seated.has(fold.id)) continue;
        const delta = countTokens(activeLine(fold));
        if (blockTokens + delta > ceiling) continue;
        surfaced.push(fold);
        seated.add(fold.id);
        unfoldedIds.push(fold.id);
        used += delta;
        blockTokens += delta;
      }
    }

    const activeIds = new Set(surfaced.map((f) => f.id));
    const folded = folds.filter((f) => !activeIds.has(f.id));
    const blockTokensFinal =
      framingTokens(surfaced.length, gap, label, mode) + used;
    const crowdedOut = scored.filter(
      (s) => s.score > 0 && !activeIds.has(s.fold.id),
    );
    const rejectedByBudget = crowdedOut.length;

    return {
      activeIds: surfaced.map((f) => f.id),
      foldedIds: folded.map((f) => f.id),
      surfaced,
      folded,
      systemMessage: buildSystemBlock(surfaced, gap, label, mode),
      scores: opts.debug
        ? scored.map(({ fold, score, matched }) => ({
            id: fold.id,
            score,
            matched,
          }))
        : undefined,
      stats: {
        totalFolds: folds.length,
        active: surfaced.length,
        folded: folded.length,
        usedTokens: used,
        blockTokens: blockTokensFinal,
        budget,
        // Measured against the ceiling this pass was actually allowed, so a
        // deliberate System 2 unfold does not read as a budget violation —
        // and a real violation still does.
        overflow: blockTokensFinal > ceiling ? blockTokensFinal - ceiling : 0,
        gap,
        rejectedByBudget,
        crowdedOutIds: crowdedOut.map((s) => s.fold.id),
        mode,
        ceiling,
        unfoldedIds,
      },
    };
  };

  return { folds, budgetTokens, gate };
}
