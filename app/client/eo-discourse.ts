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

// ── Two folds, not one fold at two resolutions ────────────────────────────
//
// The System 1 fold is the one this file was built around: a ~100-character
// paraphrase of what a turn contributed, rolled into a running summary. It is
// associative and lossy on purpose and it is what a person actually retains
// from a conversation — the gist, not the transcript.
//
// Its limit is not that it is short. It is that a paraphrase has no address.
// Once a turn is folded, the sentence "the report put the figure at 12%" and
// the sentence "the report put the figure at 21%" fold to the same line, and
// nothing in the prompt can tell them apart or get back to the source. That is
// harmless for keeping track of a conversation and disqualifying as evidence,
// which is why eo-warrant.ts marks the discourse channel as unable to warrant
// a claim at all.
//
// The System 2 fold is the answer to that, and it is a different KIND of
// record rather than a longer one: it keeps the address. What the turn
// established, which channels carried it, the byte ranges and URLs the check
// actually ran against, what failed that check, and what was left open. All of
// it is already computed by the time a turn finishes — the grounding report,
// the citations, the warrant demand — so building it costs no model call
// (LAWS.md L11c). A System 2 fold can be re-opened; a System 1 fold can only
// be recalled.

export interface WarrantRecord {
  /** Index of the user turn this record folds. */
  turn: number;
  /** The System 1 gist — a handle for the turn, never its warrant. */
  gist: string;
  /** Warrant channels that actually carried this turn (see eo-warrant.ts). */
  channels: string[];
  /**
   * Addresses the answer was checked against: "file.txt#1200-4200" for source
   * bytes, a URL for web material. These are what make the record re-openable
   * — readRawSourceRange in eo-corpus.ts reads the first kind straight back.
   */
  refs: string[];
  /** Claims that failed the mechanical check, kept verbatim. */
  unsupported: string[];
  /** What this turn could not settle, in its own words. */
  open: string[];
}

export const RECORDS_IN_PROMPT = 8;
export const RECORD_REFS_MAX = 6;
export const RECORD_OPEN_MAX = 4;

export interface EoSummary {
  topic: string | null;
  entities: string[];
  context: string | null;
  language: string | null;
  turnCount: number;
  flow: string | null;
  folds: string[];
  /** The System 2 folds — bounded, addressed, re-openable. */
  records?: WarrantRecord[];
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
    records: [],
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
  // Said here as well as in the warrant block, because this is the block a
  // model is most tempted to mine for a fact: it is the only thing in the
  // prompt that looks like a memory of what was established.
  parts.push(
    "This is a paraphrase, not a record. It cannot support a factual claim: if an answer would rest on something in here, say it would need to be checked rather than restating it as settled.",
  );
  parts.push(`Topic: ${summary.topic}`);
  if (summary.flow) parts.push(`Flow: ${summary.flow}`);
  if (summary.entities?.length)
    parts.push(`Entities: ${summary.entities.join(", ")}`);
  if (summary.context) parts.push(`Carried context: ${summary.context}`);
  return parts.join("\n");
}

/**
 * The System 2 folds, rendered for the prompt. Separate block, separate
 * framing, on purpose: merged into PAST DISCOURSE, an addressed record would
 * inherit the paraphrase's disclaimer, and a paraphrase would inherit the
 * record's authority. Two facts that differ must not read alike
 * (INSTRUCTION-LAW R8).
 */
export function buildRecordSystemMessage(
  summary: EoSummary | null | undefined,
): string | null {
  const records = (summary?.records ?? []).slice(-RECORDS_IN_PROMPT);
  if (!records.length) return null;
  const parts: string[] = [
    "ON RECORD — earlier turns that were checked, with the addresses they were checked against. Unlike PAST DISCOURSE, these can be re-opened: the sources named here still exist and can be read again. You may rely on a line here, and you must not contradict one without saying you are doing so.",
  ];
  for (const r of records) {
    const bits = [`Turn ${r.turn}: ${r.gist}`];
    if (r.channels.length) bits.push(`  carried by: ${r.channels.join(", ")}`);
    if (r.refs.length) bits.push(`  checked against: ${r.refs.join("; ")}`);
    if (r.unsupported.length)
      bits.push(
        `  NOT supported by that material: ${r.unsupported.join("; ")}`,
      );
    if (r.open.length) bits.push(`  left open: ${r.open.join("; ")}`);
    parts.push(bits.join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Build the System 2 fold for a finished turn. Purely mechanical — every field
 * is read off work the turn already did, so a turn's record cannot disagree
 * with its own grounding check.
 */
export function buildWarrantRecord(input: {
  turn: number;
  gist: string;
  channels: string[];
  refs: string[];
  unsupported: string[];
  open: string[];
}): WarrantRecord {
  const clean = (list: string[], max: number, chars: number) =>
    [...new Set(list.filter(Boolean).map((s) => truncate(s, chars)))].slice(
      0,
      max,
    );
  return {
    turn: input.turn,
    gist: truncate(input.gist, FOLD_MAX_CHARS),
    channels: [...new Set(input.channels)],
    refs: clean(input.refs, RECORD_REFS_MAX, 120),
    unsupported: clean(input.unsupported, RECORD_REFS_MAX, 80),
    open: clean(input.open, RECORD_OPEN_MAX, 140),
  };
}

/** Append a record, bounded the same way the fold list is. */
export function addWarrantRecord(
  summary: EoSummary | null | undefined,
  record: WarrantRecord,
): EoSummary {
  const prev = summary || emptySummary();
  return {
    ...prev,
    records: [...(prev.records ?? []), record].slice(-RECORDS_IN_PROMPT),
  };
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
    // The System 2 records are never rewritten by the summary-refresh model
    // call. A model that could edit the record could edit the evidence.
    records: prev.records ?? [],
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
