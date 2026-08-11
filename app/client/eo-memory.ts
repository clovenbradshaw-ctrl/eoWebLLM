// eo-memory.ts — browser port of eochat's server/conversation-memory.js,
// the per-conversation "desk" of verbatim stated facts.
//
// eoWebLLM's own history window (EO_HISTORY_TURNS in chat.ts) only feeds the
// model the last few turns verbatim; older turns survive only as the fuzzy
// PAST DISCOURSE fold (eo-discourse.ts), a summary that paraphrases. A fact
// stated precisely — a serial number, an error code, a measurement — can
// blur or drop out of a paraphrase in a way it never would if kept verbatim.
// This is that verbatim backstop: small, bounded, injected on every turn
// regardless of whether the fold has run yet, quoting stated facts exactly
// as said rather than summarizing them.
//
// Pure: no IO, no model calls, no global state — the chat store owns the
// state object and its persistence; this file only says how the desk
// changes turn by turn and how it renders.
//
// Source of the algorithm: eochat/server/conversation-memory.js
//   https://github.com/clovenbradshaw-ctrl/eochat

import { splitSentences } from "./eo-citation-check";

// ── Budgets ──────────────────────────────────────────────────────────────

export const FACTS_MAX = 14;
export const FACT_CHAR_BUDGET = 2400;
export const FACT_MIN_CHARS = 10;
export const FACT_MAX_CHARS = 220;
export const HOT_MAX = 24;
export const HOT_FLOOR = 0.25;
export const HOT_DECAY_PER_TURN = 0.9;
export const HOT_IN_FOCUS = 8;

// ── Stopwords ────────────────────────────────────────────────────────────
//
// Kept separate from eo-citation-check.ts's CLAIM_STOPWORDS: that table
// filters source-citation prose, this one filters conversational prose, and
// the two jobs pull in different words (this table drops "please"/"could"
// as chatter; that one keeps them since a citation atom never contains them
// either way).
const STOPWORDS = new Set([
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
  "when",
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
  "please",
]);

export function contentTerms(text: string, { cap = 64 } = {}): string[] {
  const terms: string[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  const src = String(text || "").toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null && terms.length < cap) {
    let w = m[0];
    if (/['’]$/.test(w)) w = w.slice(0, -1);
    if (w.length < 3) continue;
    if (/^\d+$/.test(w) && w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    terms.push(w);
  }
  return terms;
}

// ── Hot-trace: what is in focus ─────────────────────────────────────────

export interface HotTerm {
  term: string;
  weight: number;
  lastTurn: number;
}

export function updateHotTerms(
  hot: HotTerm[] = [],
  { userText = "", assistantText = "", turn = 0, confirmed = false } = {},
): HotTerm[] {
  const map = new Map<string, HotTerm>();
  for (const t of hot) map.set(t.term, { ...t });

  const bump = (term: string, weight: number) => {
    const cur = map.get(term);
    if (cur) {
      cur.weight += weight;
      cur.lastTurn = Math.max(cur.lastTurn, turn);
    } else {
      map.set(term, { term, weight, lastTurn: turn });
    }
  };

  const userTerms = new Set(contentTerms(userText));
  for (const term of userTerms) bump(term, 1);
  for (const term of contentTerms(assistantText)) {
    if (userTerms.has(term)) bump(term, confirmed ? 2 : 0.5);
  }

  const out: HotTerm[] = [];
  for (const t of map.values()) {
    const idle = Math.max(0, turn - t.lastTurn);
    const weight = t.weight * Math.pow(HOT_DECAY_PER_TURN, idle);
    if (weight >= HOT_FLOOR)
      out.push({ term: t.term, weight, lastTurn: t.lastTurn });
  }
  out.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.lastTurn - a.lastTurn ||
      a.term.localeCompare(b.term),
  );
  return out.slice(0, HOT_MAX);
}

// ── Stated facts: verbatim, bounded, weighted ───────────────────────────

const TAG_QUESTION =
  /^(.*?),\s*(?:right|correct|isn'?t (?:it|that)|wasn'?t (?:it|that)|didn'?t (?:i|it|you|we)|doesn'?t it|don'?t you think)\?\s*$/i;

function declarativeLeadIn(sentence: string): string | null {
  const dashParts = sentence.split(/\s+[—–]\s+/);
  if (dashParts.length > 1) {
    const lead = dashParts[0].trim();
    const rest = dashParts.slice(1).join(" — ").trim();
    if (lead && !/\?\s*$/.test(lead) && /\?\s*$/.test(rest)) return lead;
  }
  const tag = sentence.match(TAG_QUESTION);
  if (tag && tag[1] && !/\?\s*$/.test(tag[1].trim())) return tag[1].trim();
  return null;
}

export function extractStatedFacts(text: string, { cap = 12 } = {}): string[] {
  const out: string[] = [];
  for (const s of splitSentences(text)) {
    let t = s.text.trim();
    if (/\?\s*$/.test(t)) {
      const lead = declarativeLeadIn(t);
      if (!lead) continue;
      t = lead;
    }
    if (t.length < FACT_MIN_CHARS || t.length > FACT_MAX_CHARS) continue;
    if (isDenialSentence(t)) continue;
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export function normalizeFactText(text: string): string {
  let s = String(text || "").trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/["']/g, "");
  s = s.replace(/[.!?]+$/, "");
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function sameFact(a: string, b: string): boolean {
  const na = normalizeFactText(a);
  const nb = normalizeFactText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return shorter.length >= FACT_MIN_CHARS && longer.includes(shorter);
}

export interface StatedFact {
  text: string;
  turn: number;
  lastTurn: number;
  seen: number;
  confirmed: boolean;
  weight: number;
}

const CONFIRMED_WEIGHT = 10;

export function updateStatedFacts(
  facts: StatedFact[] = [],
  { userText = "", assistantText = "", turn = 0, confirmed = false } = {},
): StatedFact[] {
  const next = facts.map((f) => ({ ...f }));

  const upsertUser = (text: string, weight: number) => {
    for (const raw of extractStatedFacts(text)) {
      const existing = next.find((f) => sameFact(f.text, raw));
      const ack = confirmed;
      if (existing) {
        existing.seen += 1;
        existing.lastTurn = Math.max(existing.lastTurn, turn);
        existing.weight = ack
          ? Math.max(existing.weight, CONFIRMED_WEIGHT)
          : existing.weight + weight;
        if (ack) existing.confirmed = true;
      } else {
        next.push({
          text: raw,
          turn,
          lastTurn: turn,
          seen: 1,
          confirmed: ack,
          weight: ack ? CONFIRMED_WEIGHT : weight,
        });
      }
    }
  };

  // Only existing entries get upgraded by the assistant's reply; an unmatched
  // assistant sentence is never inserted as a new fact — the desk remembers
  // the reader, not the assistant's own prose.
  const acknowledgeFromAssistant = (text: string) => {
    if (!next.length) return;
    const assistantSentences = extractStatedFacts(text, { cap: 40 });
    if (!assistantSentences.length) return;
    for (const existing of next) {
      const isRestated = assistantSentences.some((s) =>
        sameFact(existing.text, s),
      );
      if (!isRestated) continue;
      existing.weight = Math.max(existing.weight, CONFIRMED_WEIGHT);
      existing.confirmed = true;
      existing.lastTurn = Math.max(existing.lastTurn, turn);
    }
  };

  upsertUser(userText, 1);
  acknowledgeFromAssistant(assistantText);

  next.sort(
    (a, b) => b.weight - a.weight || b.lastTurn - a.lastTurn || b.seen - a.seen,
  );
  const kept: StatedFact[] = [];
  let budget = FACT_CHAR_BUDGET;
  for (const f of next) {
    if (kept.length >= FACTS_MAX) break;
    if (kept.length > 0 && budget - f.text.length < 0) break;
    kept.push(f);
    budget -= f.text.length;
  }
  return kept;
}

// ── Rendering ────────────────────────────────────────────────────────────

export function buildMemoryMessage({
  hot = [],
  facts = [],
  oldestVerbatimTurn = 0,
}: {
  hot?: HotTerm[];
  facts?: StatedFact[];
  /**
   * The oldest user-turn number still verbatim in this turn's recency
   * window (see EO_HISTORY_TURNS in chat.ts). A fact whose most recent
   * restatement (lastTurn) falls on or after this boundary is already
   * visible raw in the prompt, so it's skipped here — the desk exists to
   * survive a fact falling OUT of that window, not to duplicate what's
   * already in it. 0 (default) disables the filter, the safe fallback
   * when a caller has no window to supply.
   */
  oldestVerbatimTurn?: number;
} = {}): string | null {
  const deskFacts =
    oldestVerbatimTurn > 0
      ? facts.filter((f) => f.lastTurn < oldestVerbatimTurn)
      : facts;
  const parts: string[] = [];
  if (deskFacts.length) {
    const lines: string[] = [];
    lines.push(
      "CONVERSATION WORKING MEMORY — verbatim statements made in this conversation.",
    );
    lines.push(
      "This record is authoritative for what was said HERE. Never deny or say 'not discussed' about any fact listed below. Anything NOT listed was not stated in this conversation.",
    );
    deskFacts.forEach((f, i) => {
      lines.push(
        `${i + 1}. [${f.confirmed ? "acknowledged" : "stated"}] ${f.text}`,
      );
    });
    parts.push(lines.join("\n"));
  }
  if (hot.length) {
    parts.push(
      `In focus now: ${hot
        .slice(0, HOT_IN_FOCUS)
        .map((t) => t.term)
        .join(", ")}.`,
    );
  }
  return parts.length ? parts.join("\n\n") : null;
}

// ── Recall-denial review ────────────────────────────────────────────────

const DENIAL_VERB =
  /\b(?:didn'?t|did not|wasn'?t|was not|weren'?t|were not|haven'?t|have not|hasn'?t|has not|hadn'?t|never|can'?t|cannot|can not|couldn'?t|could not|isn'?t|is not|aren'?t|are not|n'?t|not)\b/gi;
const DENIAL_SUBJECT =
  /\b(?:information|record|records|mention|mentions|knowledge|recall|remember|codes?|facts?|details?|data|conversation|material|discussed|discussion|stated|provided|given|received|shared|mentioned|recorded|sources?|passages?)\b/gi;
const DENIAL_PROXIMITY_CHARS = 30;

export function isDenialSentence(sentence: string): boolean {
  const text = String(sentence || "");
  const verbMatches = [...text.matchAll(DENIAL_VERB)];
  if (!verbMatches.length) return false;
  const subjectMatches = [...text.matchAll(DENIAL_SUBJECT)];
  if (!subjectMatches.length) return false;
  for (const v of verbMatches) {
    for (const s of subjectMatches) {
      if (Math.abs((v.index ?? 0) - (s.index ?? 0)) <= DENIAL_PROXIMITY_CHARS)
        return true;
    }
  }
  return false;
}

export interface RecallDenialFlag {
  type: "false_denial";
  fact: string;
  confirmed: boolean;
  sharedTerms: string[];
  detail: string;
}

export function checkRecallDenial({
  question = "",
  answer = "",
  facts = [],
}: {
  question?: string;
  answer?: string;
  facts?: StatedFact[];
}): {
  verdict: "PASS" | "FLAGGED";
  flags: RecallDenialFlag[];
  denialSentences: string[];
} {
  const flags: RecallDenialFlag[] = [];
  const denialSentences: string[] = [];
  if (!answer || !facts.length)
    return { verdict: "PASS", flags, denialSentences };

  for (const s of splitSentences(answer)) {
    if (isDenialSentence(s.text)) denialSentences.push(s.text.trim());
  }
  if (!denialSentences.length)
    return { verdict: "PASS", flags, denialSentences };

  const qTerms = new Set(contentTerms(question));
  for (const fact of facts) {
    const fTerms = contentTerms(fact.text);
    const shared = [...qTerms].filter((t) => fTerms.includes(t));
    const codeLike = shared.find((t) => /\d/.test(t) || t.length >= 8);
    const strong = shared.length >= 2 || !!codeLike;
    if (!strong) continue;
    flags.push({
      type: "false_denial",
      fact: fact.text,
      confirmed: fact.confirmed,
      sharedTerms: shared,
      detail: `The answer denies "${shared.slice(0, 3).join(", ")}" was part of this conversation, but it is recorded here verbatim: "${fact.text}".`,
    });
  }
  return { verdict: flags.length ? "FLAGGED" : "PASS", flags, denialSentences };
}

// ── Convenience ──────────────────────────────────────────────────────────

export interface ConversationMemory {
  hot: HotTerm[];
  facts: StatedFact[];
}

export function emptyMemory(): ConversationMemory {
  return { hot: [], facts: [] };
}

export function applyTurn(
  memory: ConversationMemory | null | undefined,
  turn: number,
  { userText = "", assistantText = "", confirmed = false } = {},
): ConversationMemory {
  const state = memory || emptyMemory();
  const hot = updateHotTerms(state.hot, {
    userText,
    assistantText,
    turn,
    confirmed,
  });
  const facts = updateStatedFacts(state.facts, {
    userText,
    assistantText,
    turn,
    confirmed,
  });
  return { hot, facts };
}

export function isAcknowledgment(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(?:(?:ok(?:ay)?|yes|yeah|sure|right|good|great|done|got it|gotcha|understood|noted|acknowledged|received|recorded|saved|confirmed|memorized|logged|keeping? that in mind)\b[^.!?]*)[.!]?$/i.test(
    t,
  );
}
