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

// ── bounds ─────────────────────────────────────────────────────────────
export const DEFAULT_MIN_WORDS = 15;
export const DEFAULT_RECONCILE_ROUNDS = 1;

// ── the DEFINE evaluation ──────────────────────────────────────────────
//
// Trimmed from eochat's PLANNER_SYSTEM_PROMPT: the `units` field (per-
// section breakdown) is dropped since this port never sections an answer —
// kind/lookup/form/compliance apply to the whole single-shot reply.
const PLANNER_SYSTEM_PROMPT = `You are the evaluator-planner for a writing assistant. Read the reader's question and decide how this ONE ask should be answered — there is no fixed template for "a good answer."

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
    rawKind && looksLikeLabel(rawKind) ? rawKind.slice(0, 60) : delivery;
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
  type: "leak" | "structure" | "math";
  severity: "blocker" | "warning";
  detail: string;
}

export interface ComplianceReport {
  compliant: boolean;
  violations: ComplianceViolation[];
}

export function evaluateCompliance(
  draft: string,
  spec: AnswerSpec,
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
  return {
    compliant: !violations.some((v) => v.severity === "blocker"),
    violations,
  };
}

// ── REC: one bounded revision toward the flagged violations ────────────

// A small model asked to rewrite a draft sometimes echoes the PROMPT's own
// framing back instead of producing just the rewritten answer -- "Reader's
// question: ... YOUR DRAFT ..." reappearing verbatim (or near-verbatim) as
// if it were the reply. Checked structurally rather than against the exact
// wording above, so a reworded prompt doesn't silently stop being guarded:
// two or more of this shape's own section markers surviving into the
// output is the signature of an echo, not a real rewrite.
const SCAFFOLD_MARKERS = [
  /reader'?s question\s*:/i,
  /your draft/i,
  /review flags\s*:/i,
  /fixing only the (?:listed )?violations/i,
];

function echoesPromptScaffold(text: string): boolean {
  return SCAFFOLD_MARKERS.filter((re) => re.test(text)).length >= 2;
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
}): Promise<string> {
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
  if (echoesPromptScaffold(revised)) return draft;
  return revised;
}
