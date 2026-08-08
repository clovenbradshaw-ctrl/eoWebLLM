// eo-discourse.ts — browser-safe port of eochat's conversation-summary.js
// (the "fold" half of surf/fold/prompt).
//
// Each turn gets folded to its discourse contribution (what changed in the
// conversation because of this turn). A running summary tracks how the
// conversation evolved turn by turn, and only the summary + a bounded number
// of short folds (~100 chars each) are ever placed in the context window — the
// raw message history beyond a small recency window is never resent, so the
// context window never grows with the conversation.
//
// This module is pure: no IO, no model calls. The model calls (foldTurn,
// updateSummary) are executed by the caller through the app's own LLM layer,
// which is what keeps this testable and browser-safe.
//
// Source of the algorithm: eochat/server/conversation-summary.js
//   https://github.com/clovenbradshaw-ctrl/eochat

export interface EoSummary {
  topic: string | null;
  entities: string[];
  context: string | null;
  language: string | null;
  turnCount: number;
  flow: string | null;
  folds: string[];
}

export const SUMMARY_MAX_CHARS = 200;
export const ENTITIES_MAX = 8;
export const CONTEXT_MAX_CHARS = 150;
export const FLOW_MAX_CHARS = 200;
export const FOLD_MAX_CHARS = 100;
export const MAX_FOLDS_IN_PROMPT = 12;

export function emptySummary(): EoSummary {
  return {
    topic: null,
    entities: [],
    context: null,
    language: null,
    turnCount: 0,
    flow: null,
    folds: [],
  };
}

export function buildSummarySystemMessage(
  summary: EoSummary | null | undefined,
): string | null {
  if (!summary || !summary.topic) return null;
  const parts: string[] = [];
  parts.push(
    "PAST DISCOURSE — context from earlier turns ONLY. It is background for threads that started earlier, not the subject of the current turn. Answer the user's current question as a fresh request; use this only to follow along when it clearly refers to something already discussed.",
  );
  parts.push(`Topic: ${summary.topic}`);
  if (summary.flow) parts.push(`Flow: ${summary.flow}`);
  if (summary.entities?.length)
    parts.push(`Entities: ${summary.entities.join(", ")}`);
  if (summary.context) parts.push(`Carried context: ${summary.context}`);
  return parts.join("\n");
}

export function buildSummaryUpdatePrompt(
  prev: EoSummary,
  folds: string[],
): string {
  const prevBlock = prev.topic
    ? `PREV: ${prev.topic} | ${prev.flow || ""} | ${prev.entities?.join(",") || ""} | ${prev.context || ""}`
    : "First turn.";

  const foldLines = folds.map((f, i) => `Turn ${i + 1}: ${f}`).join("\n");

  return `${prevBlock}

TURNS:
${foldLines}

Update the summary to include the latest turn. Track DISCOURSE FLOW — how the conversation evolved turn by turn, not message details. Every field stays short. Reply with a JSON object only (no markdown, no extra text), where:
- topic: one short phrase naming what the conversation is about now
- flow: one short sentence on how the thread evolved across all turns
- entities: only the people, organizations, or works actually named so far (max 8) — never turn labels, never prose
- context: what the reader must still know from earlier turns to follow along
- language: ISO 639-1 code of the dominant language
- turnCount: integer, now ${prev.turnCount + 1}

{"topic":"<what this conversation is about now>","flow":"<how the thread evolved>","entities":["<entity>","<entity>"],"context":"<what carries forward>","language":"<ISO code>","turnCount":${prev.turnCount + 1}}`;
}

export function buildFoldPrompt(question: string, answer: string): string {
  return `Fold this turn to its DISCOURSE CONTRIBUTION (what changed in the conversation). Max ${FOLD_MAX_CHARS} chars. One line.

Q: ${truncate(question, 300)}
A: ${truncate(answer, 300)}

Fold (one line, what this turn added to the conversation flow):`;
}

function parseSummaryResponse(
  response: string,
): Record<string, unknown> | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// The fold is a plain-text one-liner, but a caller may hand every model call
// the same JSON-forced prompt; peel a JSON wrapper when one appears so the
// fold is the bare sentence either way.
function extractPlainText(raw: string): string {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return raw.split("\n")[0];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    for (const key of ["fold", "contribution", "result", "summary", "text"]) {
      if (typeof parsed[key] === "string") return parsed[key];
    }
  } catch {
    /* not JSON after all — keep raw */
  }
  return raw.split("\n")[0];
}

// Fold one completed turn into its discourse contribution (plain one-liner).
export function parseFold(raw: string): string {
  return truncate(extractPlainText(raw), FOLD_MAX_CHARS);
}

// Roll a new turn fold into the running summary. Returns the next summary
// state, with the bounded fold list carried forward.
export function updateSummaryWithFold(
  prev: EoSummary | null | undefined,
  turnFold: string,
  rawResponse?: string,
): EoSummary {
  const prevSummary = prev || emptySummary();
  const folds = [...(prevSummary.folds || []), turnFold];
  const recentFolds = folds.slice(-MAX_FOLDS_IN_PROMPT);
  const parsed = rawResponse ? parseSummaryResponse(rawResponse) : null;
  return normalizeSummary(parsed, prevSummary, recentFolds);
}

// When the summary-update model call is not worth the latency (e.g. the fold
// was the only thing that changed), carry the summary forward unchanged but
// append the fold.
export function advanceSummaryFold(
  prev: EoSummary | null | undefined,
  turnFold: string,
): EoSummary {
  const prevSummary = prev || emptySummary();
  const folds = [...(prevSummary.folds || []), turnFold];
  return {
    ...prevSummary,
    folds: folds.slice(-MAX_FOLDS_IN_PROMPT),
    turnCount: prevSummary.turnCount + 1,
  };
}

function normalizeSummary(
  parsed: Record<string, unknown> | null,
  prev: EoSummary,
  folds: string[],
): EoSummary {
  if (!parsed) return { ...prev, folds, turnCount: prev.turnCount + 1 };
  return {
    topic: truncate(
      typeof parsed.topic === "string" ? parsed.topic : prev.topic,
      SUMMARY_MAX_CHARS,
    ),
    flow: truncate(
      typeof parsed.flow === "string" ? parsed.flow : prev.flow,
      FLOW_MAX_CHARS,
    ),
    entities: Array.isArray(parsed.entities)
      ? parsed.entities
          .slice(0, ENTITIES_MAX)
          .map((e) => String(e).slice(0, 40))
      : prev.entities,
    context: truncate(
      typeof parsed.context === "string" ? parsed.context : prev.context,
      CONTEXT_MAX_CHARS,
    ),
    language:
      typeof parsed.language === "string" ? parsed.language : prev.language,
    turnCount:
      typeof parsed.turnCount === "number" && Number.isFinite(parsed.turnCount)
        ? parsed.turnCount
        : prev.turnCount + 1,
    folds,
  };
}

export function truncate(text: string | null | undefined, max: number): string {
  const s = String(text || "").trim();
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}
