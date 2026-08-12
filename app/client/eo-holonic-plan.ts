// eo-holonic-plan.ts — browser port of eochat's server/holonic-chat.js
// DEFINE → EVALUATE → RECONCILE planner core.
//
// eochat's full holonic-chat.js also sections a long answer into per-unit
// research/write/reconcile passes (runHolonicEssay) — NOT ported here. That
// needs its own retrieval fan-out (per-section local + web evidence) and
// would mean rearchitecting eoWebLLM's turn loop around multi-section
// assembly; a bigger, separate change. What IS ported is the part that
// applies unmodified to a single-shot turn: one small model call (DEFINE)
// decides what SHAPE this ask needs — an emergent kind and delivery contract,
// and a compliance contract (minWords/require/forbid) — and after the
// reply is generated, a pure mechanical check (EVALUATE) measures the
// reply against that contract and against whatever evidence this turn
// actually had (turnWebResults), with one bounded rewrite (RECONCILE) if
// it fails. No model grades its own answer: EVALUATE is regex/string work,
// same discipline as eo-citation-check.ts.
//
// Source of the algorithm: eochat/server/holonic-chat.js
//   https://github.com/clovenbradshaw-ctrl/eochat

import { bayesianSurprise } from "./eo-binary/surprise.js";

// ── bounds ─────────────────────────────────────────────────────────────
export const DEFAULT_MIN_WORDS = 15;
export const DEFAULT_RECONCILE_ROUNDS = 1;

// ── the DEFINE evaluation ──────────────────────────────────────────────
//
// Trimmed from eochat's PLANNER_SYSTEM_PROMPT: the `units` field (per-
// section breakdown) is dropped since this port never sections an answer —
// kind/lookup/form/compliance apply to the whole single-shot reply.
const PLANNER_SYSTEM_PROMPT = `You are the evaluator-planner for a writing assistant. Read the reader's question and decide, plainly: what does the reader want, and what would a PROPER response actually be? There is no fixed template for "a good answer."

DECIDE:

1. kind — a short label, in your own words, for what this response actually is. Examples: greeting, small talk, factual question, how-to, opinion, code request, creative writing.

2. delivery — how the answer is DELIVERED, in your own words. Do not choose
   from a preset taxonomy. Name the concrete form the reader asked for, such
   as a terse answer, implementation patch, scene, decision memo, proof, or
   something else the request itself calls for.

3. compliance — YOUR OWN definition of what would make this specific answer complete:
   - "minWords": the length THIS answer actually needs — could be under ten words for a greeting. Never copy a template number.
   - "require": any structural requirements this ask specifically calls for (scene headings, dialogue blocks, runnable code, etc.) — empty when nothing applies.
   - "forbid": anything the answer must specifically avoid — empty when nothing applies.

Reply with ONLY a JSON object. No prose, no code fences, no commentary. The values below illustrate field TYPES, not recommended settings:

{"kind":"an emergent name for this response","delivery":"the concrete delivery form","reason":"one short sentence justifying the kind and delivery","compliance":{"minWords":42,"require":["..."],"forbid":["..."]}}`;

export interface AnswerCompliance {
  minWords: number;
  require: string[];
  forbid: string[];
  language: string | null;
}

export interface AnswerSpec {
  kind: string;
  delivery: string;
  reason: string;
  compliance: AnswerCompliance;
}

function normalizeCompliance(c: any): AnswerCompliance {
  const minWords = Number.isFinite(c?.minWords)
    ? Math.max(0, Math.min(2000, Math.floor(c.minWords)))
    : DEFAULT_MIN_WORDS;
  const list = (x: any): string[] =>
    Array.isArray(x)
      ? x
          .map((v) => String(v).slice(0, 160))
          .filter(Boolean)
          .slice(0, 12)
      : [];
  return {
    minWords,
    require: list(c?.require),
    forbid: list(c?.forbid),
    language: null,
  };
}

// A small model asked to fill this JSON template sometimes scrambles which
// field is which — observed live: a 1B model put its actual multi-sentence
// answer into "delivery" (a label like "prose" or "a scene" is a few words,
// never a full answer) and left "reason" as the schema's own placeholder
// hint text, verbatim, unfilled. Neither is a parse failure — both are
// valid JSON strings — so parsePlannerReply's structural checks can't catch
// it; this is a content sanity check on top of it. A real delivery LABEL is
// short; anything long enough to be prose is data that leaked into the
// wrong field, not a legitimate emergent label, and is discarded rather
// than shown to the reader as if it were one.
const MAX_LABEL_WORDS = 8;
const PLACEHOLDER_REASON =
  "one short sentence justifying the kind and delivery";
const PLACEHOLDER_KIND = "an emergent name for this response";

function looksLikeLabel(s: string): boolean {
  return s.split(/\s+/).filter(Boolean).length <= MAX_LABEL_WORDS;
}

function normalizeSpec(p: any): AnswerSpec {
  const rawDelivery = String(p?.delivery || p?.form || "").trim();
  const delivery =
    rawDelivery && looksLikeLabel(rawDelivery)
      ? rawDelivery.slice(0, 160)
      : "direct response";
  const rawKind = String(p?.kind || "").trim();
  const kind =
    rawKind &&
    rawKind.toLowerCase() !== PLACEHOLDER_KIND &&
    looksLikeLabel(rawKind)
      ? rawKind.slice(0, 60)
      : delivery;
  const rawReason = String(p?.reason || "").trim();
  const reason =
    rawReason.toLowerCase() === PLACEHOLDER_REASON
      ? ""
      : rawReason.slice(0, 240);
  return {
    kind,
    delivery,
    reason,
    compliance: normalizeCompliance(p?.compliance),
  };
}

function isSpecShaped(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.kind === "string" && obj.kind.trim()) return true;
  if (typeof obj.delivery === "string" || typeof obj.form === "string")
    return true;
  return false;
}

/**
 * Robust JSON extraction, same tolerant strategy eo-tool-router.ts uses:
 * whole-object parse, then a balanced-brace scan, then a regex salvage —
 * so a small model's near-miss reply (prose wrapper, unbalanced brace)
 * still steers correctly instead of falling back to the flattest default.
 */
export function parsePlannerReply(raw: string): AnswerSpec {
  const text = String(raw || "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "");

  try {
    const whole = JSON.parse(text);
    if (isSpecShaped(whole)) return normalizeSpec(whole);
  } catch {
    // scan below
  }

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const p = JSON.parse(text.slice(i, j + 1));
            if (isSpecShaped(p)) return normalizeSpec(p);
          } catch {
            // keep scanning
          }
          break;
        }
      }
    }
  }

  // Salvage: pull kind/form/reason/compliance straight off the raw text
  // when nothing parsed as valid JSON.
  const kindM = text.match(/"kind"\s*:\s*"([^"]*)"/i);
  const deliveryM = text.match(/"(?:delivery|form)"\s*:\s*"([^"]*)"/i);
  const reasonM = text.match(/"reason"\s*:\s*"([^"]*)"/i);
  const minWordsM = text.match(/"minWords"\s*:\s*(\d+)/i);
  if (kindM || deliveryM) {
    return normalizeSpec({
      kind: kindM ? kindM[1] : undefined,
      delivery: deliveryM ? deliveryM[1] : undefined,
      reason: reasonM
        ? reasonM[1]
        : "planner reply was malformed JSON — salvaged",
      compliance: minWordsM ? { minWords: Number(minWordsM[1]) } : undefined,
    });
  }

  return normalizeSpec({
    reason: "planner reply unparseable — defaulted to plain reply",
  });
}

// System 1 / System 2 (Kahneman), not a mechanical pre-gate: the earlier
// version of this file gated DEFINE behind a regex guessing which turns
// "needed" it, so ordinary chat could skip the round trip and stay fast.
// That guess was itself the problem — a fixed pattern deciding in advance
// what a question needs is exactly the kind of judgment this file exists
// to hand to the model instead. The fix is not a smarter regex; it's
// moving DEFINE to run AFTER the fast, unshaped System-1 draft already
// exists (see chat.ts's onFinish) — unconditionally, every turn — so
// nothing ever blocks the first token, and the only cost that can still
// show up is System 2's own bounded reconcile rewrite, paid only when its
// own judgment of the draft finds something wrong with it.

/**
 * The DEFINE evaluation, run against the System-1 draft that already
 * exists (`draft`) rather than before it — the model judges what a good
 * answer to this question looks like having already seen what it wrote,
 * which is also just how a person self-edits. `generate` is the caller's
 * model seam (same background-call pattern as planTools/planSearchQuery).
 */
export async function defineAnswerSpec({
  question,
  draft,
  webEnabled = false,
  generate,
}: {
  question: string;
  draft: string;
  webEnabled?: boolean;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<AnswerSpec> {
  const user = [
    `Question: ${question}`,
    `Web research enabled: ${webEnabled ? "yes" : "no"}`,
    "",
    "The answer already given:",
    String(draft || "").slice(0, 4000),
  ].join("\n");
  const raw = await generate(PLANNER_SYSTEM_PROMPT, user);
  return parsePlannerReply(raw);
}

/** The system-block addition for this turn's decided form/compliance — empty for the common "reply" case, so most turns add nothing. */
export function buildFormBlock(spec: AnswerSpec): string | null {
  const lines: string[] = [];
  if (spec.delivery !== "direct response")
    lines.push(`Deliver this as: ${spec.delivery}.`);
  if (spec.compliance.require.length) {
    lines.push(`This answer must: ${spec.compliance.require.join("; ")}.`);
  }
  if (spec.compliance.forbid.length) {
    lines.push(`This answer must NOT: ${spec.compliance.forbid.join("; ")}.`);
  }
  return lines.length ? lines.join("\n") : null;
}

// ── EVA: the mechanical compliance evaluator ────────────────────────────
//
// Pure function of {form, draft, compliance} — no model call, nothing the
// writer could have influenced. Trimmed from eochat's evaluateUnit: the
// "carry" check (specificsResidual against per-unit folded evidence) isn't
// ported — eoWebLLM's checkGrounding (eo-citation-check.ts) already covers
// that same ground for web-search turns, more precisely (per-atom, not a
// residual ratio). What's kept: the leak check (does the reply mention its
// own machinery) and the structure check (word count floor, form shape).

const LEAK_HARD =
  /\b(?:cited|citing|citation(?:s)?|verbatim|(?:the|this|that|these|those|provided|given|above)\s+(?:source\s+material|source(?:s)?|material(?:s)?|passage(?:s)?))\b/i;
const LEAK_SOFT =
  /\b(evidence|research(ed|ing)?|the web|online search|brackets?)\b/i;

export interface ComplianceViolation {
  type: "leak" | "structure" | "math" | "truncated" | "non-sequitur-refusal";
  severity: "blocker" | "warning";
  detail: string;
}

// Observed live: a substantial multi-part answer streamed out and just
// stopped mid-sentence ("...3:00 pm -"), with no error, no violation raised,
// and no reconcile rewrite offered — a small local model running long on a
// multi-constraint request can trail off exactly like this, and nothing
// upstream of evaluateCompliance was checking for it. Deliberately narrow:
// only flagged for a substantive draft (short/terse replies and code blocks
// legitimately end without sentence punctuation), so this can't misfire on
// a one-line answer or a fenced snippet.
const SENTENCE_CLOSE_RE = /[.!?:;)\]"'`*_]\s*$/;

function looksTruncated(raw: string, words: number, minWords: number): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.includes("```")) return false;
  if (words < Math.max(minWords, 20)) return false;
  return !SENTENCE_CLOSE_RE.test(trimmed);
}

// Observed live: an ordinary trip-planning message ("My name is Marcus and
// I'm traveling with my partner Priya... My budget is $2000") got refused
// outright — "I cannot provide information or guidance on illegal or
// adverse activities, including rape." A small instruction-tuned model's
// refusal template can recite a stock disallowed-topic example that has
// nothing to do with what was actually asked; this is not this app's own
// system prompt (it's a generic "you are an AI assistant" line, nothing
// safety-related in it) — it's the base model hallucinating a non-sequitur.
// A LEGITIMATE refusal shares vocabulary with the request it's declining
// (asking about X and getting "I can't help with X" cites X); a refusal
// whose own cited example topic is ABSENT from the reader's actual message
// is the tell that it's a hallucinated non-sequitur, not a real judgment
// call this app should defer to. Deliberately conservative: only flags a
// refusal-shaped opening that names a specific example topic, and only
// when that named topic has zero presence in the reader's own words —
// never touches a refusal that's actually responsive to what was asked.
const REFUSAL_OPENER_RE =
  /^\s*i\s+(?:cannot|can't|won'?t|will not|am (?:not able|unable)|'m (?:not able|unable))\b/i;
const REFUSAL_TOPIC_RE =
  /\b(?:including|such as|like)\s+([a-z][a-z\s,]{2,60}?)[.,!?]/i;

function looksLikeNonSequiturRefusal(
  raw: string,
  question: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !REFUSAL_OPENER_RE.test(trimmed)) return null;
  const topicMatch = REFUSAL_TOPIC_RE.exec(trimmed);
  if (!topicMatch) return null;
  const topics = topicMatch[1]
    .split(/,|\band\b|\bor\b/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);
  if (!topics.length) return null;
  const q = String(question || "").toLowerCase();
  const unrelated = topics.filter((t) => !q.includes(t));
  return unrelated.length === topics.length ? unrelated.join(", ") : null;
}

export interface ComplianceReport {
  compliant: boolean;
  violations: ComplianceViolation[];
}

export function evaluateCompliance(
  draft: string,
  spec: AnswerSpec,
  question?: string,
): ComplianceReport {
  const raw = String(draft || "");
  const violations: ComplianceViolation[] = [];
  const words = raw.split(/\s+/).filter(Boolean).length;
  const { compliance } = spec;

  {
    const hard = LEAK_HARD.exec(raw);
    if (hard) {
      violations.push({
        type: "leak",
        severity: "blocker",
        detail: `the writing mentions the machinery it was built from ("${hard[0]}")`,
      });
    } else {
      const soft = LEAK_SOFT.exec(raw);
      if (soft) {
        violations.push({
          type: "leak",
          severity: "warning",
          detail: `the writing mentions the machinery it was built from ("${soft[0]}")`,
        });
      }
    }
  }

  if (words < compliance.minWords) {
    violations.push({
      type: "structure",
      severity: "blocker",
      detail: `only ${words} words — needs at least ${compliance.minWords}`,
    });
  }

  if (looksTruncated(raw, words, compliance.minWords)) {
    violations.push({
      type: "truncated",
      severity: "blocker",
      detail: `the answer appears to cut off mid-sentence instead of finishing`,
    });
  }

  const nonSequiturTopic = looksLikeNonSequiturRefusal(raw, question ?? "");
  if (nonSequiturTopic) {
    violations.push({
      type: "non-sequitur-refusal",
      severity: "blocker",
      detail: `refused citing "${nonSequiturTopic}", which the reader's own message never mentioned`,
    });
  }

  return {
    compliant: !violations.some((v) => v.severity === "blocker"),
    violations,
  };
}

// ── REC: one bounded revision toward the flagged violations ────────────

// A small model asked to rewrite a draft sometimes echoes the PROMPT's own
// framing back instead of producing just the rewritten answer -- "Reader's
// question: ... YOUR DRAFT ..." reappearing, paraphrased, as if it were the
// reply (observed live: "YOUR DRAFT" restated in first person as "MY
// DRAFT"). A regex list over the exact wording only catches a verbatim
// echo -- paraphrase slides straight through it, because a regex asks
// "does this text CONTAIN these words," not "does this text's own word
// usage look statistically like the scaffold's." The latter is what
// Bayesian surprise measures directly: KL(revised's word distribution ||
// the scaffold's own word distribution), in bits, using the same
// Map<token,count> machinery this codebase already uses for exactly this
// "did belief move" question (eo-binary/surprise.js, used the same way by
// eo-binary/graph.js to decide whether a passage moved a reader's belief).
// gamma: 0 is the documented full-commitment boundary in surprise.js's own
// header -- the posterior is `revised`'s own distribution alone, since a
// rewrite is a fresh utterance being checked AGAINST the scaffold, not the
// scaffold's evolving belief. A real answer's vocabulary (question- and
// domain-specific words the scaffold never held) drives KL up; an echo's
// vocabulary is close to entirely the scaffold's own recurring framing
// words, which drives KL down toward zero.
const WORD_RE = /[\p{L}\p{N}']+/gu;

function wordFrequency(text: string): {
  counts: Map<string, number>;
  total: number;
} {
  const counts = new Map<string, number>();
  let total = 0;
  for (const w of String(text || "")
    .toLowerCase()
    .match(WORD_RE) ?? []) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
    total += 1;
  }
  return { counts, total };
}

// ── the decomposition gate ──────────────────────────────────────────────
//
// Replaces the earlier `AnswerSpec.decomposes` field: DEFINE used to ask a
// small model to fill a 4th JSON boolean deciding whether eo-task-plan.ts's
// multi-task decomposition should run for this turn. Observed live: on a
// genuinely 4-constraint request the model's JSON reply came back malformed,
// the tolerant salvage parser above had no way to tell "the model looked and
// judged false" apart from "the field just wasn't in the object," and
// silently defaulted to false — defeating decomposition exactly on the turns
// most likely to need it. There is no way to fix that from inside the
// parser: once the reply is text, a missing field and a considered "no" are
// the same shape.
//
// So this asks the question's own words instead of asking the model, the
// same way echoesPromptScaffold just above already asks a REVISED text's own
// words whether it diverged from a scaffold — no model call, so it costs an
// ordinary turn nothing and it cannot come back malformed because it never
// leaves this process. bayesianSurprise itself was tried here first (KL
// between successive clauses' word distributions, gamma=0, same call shape
// as echoesPromptScaffold) and measured, not assumed, against real
// (question) examples — at the word counts a single clause actually has (a
// handful of words), alpha=1 smoothing dominates the estimate and every
// clause pair came back in a narrow 0.2-0.35 bit band whether or not the
// clauses were actually about different things, so it could not separate
// the 4-constraint offsite example from a single-topic control. Reusing the
// KL machinery here would have been decoration, not signal, so the actual
// gate below is the same discipline needsMathCheck (eo-math-check.ts) and
// hasExplicitSearchIntent (eo-tool-router.ts) already use: cheap, mechanical
// pattern-matching on the text, not a borrowed physics term standing in for
// one that doesn't fit.
//
// The shape being detected: a proper response to "budget is $2000, we need
// wifi, everyone eats vegetarian, and our CFO can't attend on the 14th"
// genuinely has to work through several separately-anchored facts before it
// can be reconciled into one answer; a proper response to one elaborated
// ask does not, even when that ask is long or comma-heavy. Clause count
// alone over-fires on a long single-topic sentence; requiring several of
// those clauses to each pin down their OWN concrete anchor (a dollar
// figure, a date, a named person) is what actually distinguishes "many
// dependent parts" from "one ask with many words."
const CLAUSE_SPLIT_RE =
  /[,;]|(?:\.\s+)|(?:\band\b)|(?:\bbut\b)|(?:\bwhile\b)/gi;
const MIN_CLAUSE_WORDS = 3;
const MIN_SUBSTANTIVE_CLAUSES = 3;
const NAMED_QUANTITY_RE =
  /\$\s?\d|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{4}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i;

/** A clause "pins an anchor" when it names a concrete fact beyond its first word — a dollar figure, a date, or a proper noun mid-clause (sentence-initial capitals don't count, they're just grammar). */
function clausePinsAnchor(clause: string): boolean {
  if (NAMED_QUANTITY_RE.test(clause)) return true;
  const rest = clause.replace(/^\s*\S+/, "");
  return /\b[A-Z][a-z]+\b/.test(rest);
}

/**
 * Mechanical stand-in for the old `decomposes` field: true when the
 * question itself has the shape of several dependent parts, computed
 * straight off the text with no model call. Cheap-bails on the very first
 * check (fewer than 3 substantive clauses) — a greeting or single-sentence
 * ask never reaches the anchor scan at all, so trivial turns pay nothing
 * beyond one regex split, strictly less than the JSON round trip this
 * replaces. eo-task-plan.ts's own `plan.tasks.length < 2` bail-out is still
 * the second, cheap gate downstream — this only decides whether it's worth
 * asking the fold-planner to try.
 */
export function needsDecomposition(question: string): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  const clauses = q
    .split(CLAUSE_SPLIT_RE)
    .map((c) => c.trim())
    .filter((c) => c.split(/\s+/).filter(Boolean).length >= MIN_CLAUSE_WORDS);
  if (clauses.length < MIN_SUBSTANTIVE_CLAUSES) return false;
  if (clauses.length >= 4) return true;
  const anchors = clauses.filter(clausePinsAnchor).length;
  return anchors >= 2;
}

// The scaffold's OWN fixed framing text -- never the per-call question/
// draft/violations, which would contaminate "does this look like the
// SCAFFOLD's words" with real content words.
const RECONCILE_SCAFFOLD_TEXT = [
  `You are rewriting an answer to pass its compliance review. Fix ONLY the violations listed. Keep the assigned delivery. Never mention sources, citations, or "the material" in the writing. Output ONLY the rewritten answer itself -- never repeat the question, the draft, or these instructions.`,
  `Reader's question:`,
  `YOUR DRAFT — rewrite it, fixing ONLY the listed violations:`,
  `REVIEW FLAGS:`,
].join(" ");
const RECONCILE_SCAFFOLD_PRIOR = wordFrequency(RECONCILE_SCAFFOLD_TEXT);

// A measured starting point (per surprise.js's own discipline: a threshold
// is measured from the caller's own history, never declared as a law) --
// tune against real (question, revised) pairs, not treated as fixed.
const RECONCILE_ECHO_KL_THRESHOLD_BITS = 0.75;

function echoesPromptScaffold(revised: string): {
  echo: boolean;
  klBits: number | null;
} {
  const arrival = wordFrequency(revised);
  if (arrival.total === 0) return { echo: true, klBits: null };
  const kl = bayesianSurprise(
    RECONCILE_SCAFFOLD_PRIOR.counts,
    RECONCILE_SCAFFOLD_PRIOR.total,
    arrival.counts,
    arrival.total,
    // surprise.js is plain JS (vendored verbatim from eoreader6, no JSDoc
    // types): TS's allowJs inference for a destructured options param only
    // picks up properties with a default value ({ alpha = 1 }), so it
    // infers this options type as `{ alpha?: number }` and drops `gamma`
    // even though the function reads and validates it at runtime. Not a
    // real type mismatch — a gap in inferring untyped JS, cast around it.
    { gamma: 0, alpha: 1 } as { gamma: number; alpha?: number },
  );
  if (kl == null) return { echo: true, klBits: null };
  return { echo: kl < RECONCILE_ECHO_KL_THRESHOLD_BITS, klBits: kl };
}

export interface ReconcileResult {
  text: string;
  echoDetected: boolean;
  echoKLBits: number | null;
}

export async function reconcileDraft({
  question,
  delivery,
  draft,
  violations,
  generate,
}: {
  question: string;
  delivery: string;
  draft: string;
  violations: ComplianceViolation[];
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<ReconcileResult> {
  const sys = `You are rewriting an answer to pass its compliance review. Fix ONLY the violations listed. Keep the assigned delivery (${delivery}). Never mention sources, citations, or "the material" in the writing. Output ONLY the rewritten answer itself -- never repeat the question, the draft, or these instructions.`;
  const user = [
    `Reader's question: ${question}`,
    "",
    "YOUR DRAFT — rewrite it, fixing ONLY the listed violations:",
    String(draft || ""),
    "",
    "REVIEW FLAGS:",
    violations.map((v) => `- [${v.type}] ${v.detail}`).join("\n") || "(none)",
  ].join("\n");
  const revised = await generate(sys, user);
  // A corrupted rewrite (the model echoing its own prompt) is worse than
  // the original, merely non-compliant draft -- the caller's own existing
  // discipline is "ships as-is, flagged, never silently" when a rewrite
  // doesn't clear review; a rewrite that isn't even a real answer gets the
  // same treatment, one level earlier.
  const echoCheck = echoesPromptScaffold(revised);
  if (echoCheck.echo) {
    return { text: draft, echoDetected: true, echoKLBits: echoCheck.klBits };
  }
  return { text: revised, echoDetected: false, echoKLBits: echoCheck.klBits };
}
