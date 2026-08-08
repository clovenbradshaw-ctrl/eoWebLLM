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
const SUB_WORD = 1;
const SUB_PHRASE = 1.5;
const SUB_TITLE_WORD = 0.5;

function scoreChannel(
  fold: InstructionFold,
  words: Set<string> | null,
  lower: string | null,
  tag: string | null,
  cap: number,
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
      score += phrase ? (tag ? SUB_PHRASE : 3) : tag ? SUB_WORD : 2;
      matched.push(pre + s);
    }
  }
  for (const w of String(fold.title).toLowerCase().split(/\s+/)) {
    if (w.length > 3 && words.has(w)) {
      score += tag ? SUB_TITLE_WORD : 1;
      matched.push(pre + `title:${w}`);
    }
  }
  return { score: Math.min(score, cap), matched };
}

function scoreFold(
  fold: InstructionFold,
  cueWords: Set<string>,
  cueLower: string,
  historyWords: Set<string> | null,
  historyLower: string | null,
  evidenceWords: Set<string> | null,
  evidenceLower: string | null,
): { score: number; matched: string[] } {
  const cue = scoreChannel(fold, cueWords, cueLower, null, Infinity);
  const hist = scoreChannel(
    fold,
    historyWords,
    historyLower,
    "hist",
    HISTORY_CAP_PER_FOLD,
  );
  const ev = scoreChannel(
    fold,
    evidenceWords,
    evidenceLower,
    "ev",
    EVIDENCE_CAP_PER_FOLD,
  );
  return {
    score: cue.score + hist.score + ev.score,
    matched: [...cue.matched, ...hist.matched, ...ev.matched],
  };
}

// The static framing that surrounds the fold list, plus per-fold renderers, so
// the budget can be an honest ceiling on the WHOLE instruction block.
const DEFAULT_LABEL = "RULES IN FORCE THIS TURN";
const gateHeader = (label: string) =>
  `${"=".repeat(label.length + 8)}
===== ${label} =====
The rules below are the complete set of additional rules in force for this turn. Follow them, and no others.`;
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
): string {
  const parts = [gateHeader(label)];
  parts.push(`--- RULES (${surfaced.length}) ---`);
  for (const fold of surfaced) parts.push(activeLine(fold));
  if (gap) parts.push(GAP_MARKER);
  parts.push(gateFooter(label));
  return parts.join("\n");
}

function framingTokens(nActive: number, gap: boolean, label: string): number {
  const text = `${gateHeader(label)}\n--- RULES (${nActive}) ---\n${gap ? GAP_MARKER + "\n" : ""}${gateFooter(label)}`;
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
  };
}

export function createInstructionGate(
  folds: InstructionFold[],
  budgetTokens: number = DEFAULT_INSTRUCTION_BUDGET,
) {
  const alwaysOn = folds
    .filter((f) => f.always)
    .sort((a, b) => b.weight - a.weight);
  const conditional = folds.filter((f) => !f.always);

  const gate = (opts: {
    question?: string;
    history?: string[];
    evidence?: string[];
    budgetTokens?: number;
    debug?: boolean;
    label?: string;
  }): GateReport => {
    const label = opts.label || DEFAULT_LABEL;
    const budget = Number.isFinite(opts.budgetTokens)
      ? opts.budgetTokens!
      : budgetTokens;

    const questionCue = String(opts.question ?? "");
    const cueWords = new Set(splitTerms(questionCue));
    const cueLower = questionCue.toLowerCase();

    const historyCue = (opts.history || []).join(" ");
    const historyWords = historyCue ? new Set(splitTerms(historyCue)) : null;
    const historyLower = historyCue ? historyCue.toLowerCase() : null;

    const evidenceText = Array.isArray(opts.evidence)
      ? opts.evidence.join(" ")
      : String(opts.evidence ?? "");
    const evidenceWords = evidenceText
      ? new Set(splitTerms(evidenceText))
      : null;
    const evidenceLower = evidenceText ? evidenceText.toLowerCase() : null;

    const scored = conditional
      .map((fold) => ({
        fold,
        ...scoreFold(
          fold,
          cueWords,
          cueLower,
          historyWords,
          historyLower,
          evidenceWords,
          evidenceLower,
        ),
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
    let blockTokens = framingTokens(surfaced.length, gap, label) + used;

    for (const { fold, score } of scored) {
      if (score <= 0) break;
      const delta = countTokens(activeLine(fold));
      if (blockTokens + delta > budget) continue;
      surfaced.push(fold);
      used += delta;
      blockTokens += delta;
    }

    const activeIds = new Set(surfaced.map((f) => f.id));
    const folded = folds.filter((f) => !activeIds.has(f.id));
    const blockTokensFinal = framingTokens(surfaced.length, gap, label) + used;
    const crowdedOut = scored.filter(
      (s) => s.score > 0 && !activeIds.has(s.fold.id),
    );
    const rejectedByBudget = crowdedOut.length;

    return {
      activeIds: surfaced.map((f) => f.id),
      foldedIds: folded.map((f) => f.id),
      surfaced,
      folded,
      systemMessage: buildSystemBlock(surfaced, gap, label),
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
        overflow: blockTokensFinal > budget ? blockTokensFinal - budget : 0,
        gap,
        rejectedByBudget,
        crowdedOutIds: crowdedOut.map((s) => s.fold.id),
      },
    };
  };

  return { folds, budgetTokens, gate };
}
