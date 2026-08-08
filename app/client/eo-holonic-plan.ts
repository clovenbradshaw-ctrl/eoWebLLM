// eo-holonic-plan.ts — browser port of eochat's server/holonic-chat.js
// DEFINE → EVALUATE → RECONCILE planner core.
//
// eochat's full holonic-chat.js also sections a long answer into per-unit
// research/write/reconcile passes (runHolonicEssay) — NOT ported here. That
// needs its own retrieval fan-out (per-section local + web evidence) and
// would mean rearchitecting eoWebLLM's turn loop around multi-section
// assembly; a bigger, separate change. What IS ported is the part that
// applies unmodified to a single-shot turn: one small model call (DEFINE)
// decides what SHAPE this ask needs — kind, form (prose/screenplay/code),
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

2. form — how the answer is DELIVERED:
   - "prose": normal paragraphs.
   - "screenplay": scene-based script with INT./EXT. scene headings, action lines, and ALL-CAPS character dialogue. Only when the reader asks for a script or screenplay.
   - "code": working source (JavaScript/CSS/HTML). Only when the reader asks for code.
   - "reply": a direct answer, no special structure.

3. compliance — YOUR OWN definition of what would make this specific answer complete:
   - "minWords": the length THIS answer actually needs — could be under ten words for a greeting. Never copy a template number.
   - "require": any structural requirements this ask specifically calls for (scene headings, dialogue blocks, runnable code, etc.) — empty when nothing applies.
   - "forbid": anything the answer must specifically avoid — empty when nothing applies.

Reply with ONLY a JSON object. No prose, no code fences, no commentary. The values below illustrate field TYPES, not recommended settings:

{"kind":"a few words","form":"prose"|"screenplay"|"code"|"reply","reason":"one short sentence justifying kind and form","compliance":{"minWords":42,"require":["..."],"forbid":["..."]}}`;

export interface AnswerCompliance {
  minWords: number;
  require: string[];
  forbid: string[];
  language: string | null;
}

export interface AnswerSpec {
  kind: string;
  form: "prose" | "screenplay" | "code" | "reply";
  reason: string;
  compliance: AnswerCompliance;
}

function normalizeCompliance(c: any, form: string): AnswerCompliance {
  const minWords = Number.isFinite(c?.minWords)
    ? Math.max(0, Math.min(2000, Math.floor(c.minWords)))
    : form === "code"
      ? 2
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
    language:
      form === "code" && /^(js|css|html)$/i.test(String(c?.language || ""))
        ? String(c.language).toLowerCase()
        : form === "code"
          ? "js"
          : null,
  };
}

function normalizeSpec(p: any): AnswerSpec {
  const form = /^(prose|screenplay|code|reply)$/i.test(p?.form || "")
    ? (String(p.form).toLowerCase() as AnswerSpec["form"])
    : "reply";
  const kind =
    String(p?.kind || "")
      .trim()
      .slice(0, 60) || form;
  return {
    kind,
    form,
    reason: String(p?.reason || "").slice(0, 240),
    compliance: normalizeCompliance(p?.compliance, form),
  };
}

function isSpecShaped(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.kind === "string" && obj.kind.trim()) return true;
  if (typeof obj.form === "string") return true;
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
  const formM = text.match(/"form"\s*:\s*"(prose|screenplay|code|reply)"/i);
  const reasonM = text.match(/"reason"\s*:\s*"([^"]*)"/i);
  const minWordsM = text.match(/"minWords"\s*:\s*(\d+)/i);
  if (kindM || formM) {
    return normalizeSpec({
      kind: kindM ? kindM[1] : undefined,
      form: formM ? formM[1] : undefined,
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

// A short, ordinary chat turn ("hi", "thanks", "what about the beater
// motor?") never needed form/compliance shaping in the first place — the
// default "reply" spec IS what defineAnswerSpec would return for it, just
// paid for with a full extra background model round-trip before the
// visible answer can even start streaming. LAWS.md L11c: exhaust a
// mechanical, no-model-call signal before reaching for a model. This is
// that signal — a short allowlist of the cases where form genuinely
// differs from plain prose (an explicit code/screenplay ask) or where the
// ask is long enough that a real compliance contract (a minWords floor
// beyond the default, a "must include X") plausibly matters. Everything
// else skips DEFINE entirely: zero added latency for the common case.
const FORM_SIGNAL_RE =
  /\b(screenplay|script|scene|dialogue|write (?:me )?(?:some |a )?(?:code|function|component|class|html|css|javascript|typescript|python|program)|\.js\b|\.css\b|\.html\b)\b/i;
const SUBSTANTIAL_WORD_COUNT = 25;

export function needsPlanning(question: string): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  if (FORM_SIGNAL_RE.test(q)) return true;
  return q.split(/\s+/).filter(Boolean).length >= SUBSTANTIAL_WORD_COUNT;
}

/**
 * The DEFINE evaluation: one small model call decides form and the
 * compliance contract for this turn. `generate` is the caller's model
 * seam (same background-call pattern as planTools/planSearchQuery). Call
 * this only when needsPlanning(question) is true — see its header for why.
 */
export async function defineAnswerSpec({
  question,
  webEnabled = false,
  generate,
}: {
  question: string;
  webEnabled?: boolean;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<AnswerSpec> {
  const user = [
    `Question: ${question}`,
    `Web research enabled: ${webEnabled ? "yes" : "no"}`,
  ].join("\n");
  const raw = await generate(PLANNER_SYSTEM_PROMPT, user);
  return parsePlannerReply(raw);
}

function formDirective(form: string): string {
  if (form === "screenplay") {
    return "Write this as a SCREENPLAY scene: a scene heading (an INT./EXT. line), action lines, and character dialogue with the speaker's name in ALL CAPS on its own line.";
  }
  if (form === "code") {
    return "Write this as CODE only — no prose, no explanation, no commentary about the code.";
  }
  return "";
}

/** The system-block addition for this turn's decided form/compliance — empty for the common "reply" case, so most turns add nothing. */
export function buildFormBlock(spec: AnswerSpec): string | null {
  const lines: string[] = [];
  const directive = formDirective(spec.form);
  if (directive) lines.push(directive);
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

function codeSyntaxFloor(
  language: string,
  content: string,
): { ok: boolean; reason?: string } {
  if (language === "js") {
    try {
      new Function(content);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
  if (language === "css") {
    const open = (content.match(/{/g) ?? []).length;
    const close = (content.match(/}/g) ?? []).length;
    return open === close
      ? { ok: true }
      : { ok: false, reason: `unbalanced braces: ${open} { vs ${close} }` };
  }
  if (language === "html") {
    const hasHtml = /<html[\s>]/i.test(content);
    const hasClose = /<\/html>/i.test(content);
    return hasHtml && hasClose
      ? { ok: true }
      : { ok: false, reason: "missing <html>...</html>" };
  }
  return { ok: true };
}

export function evaluateCompliance(
  draft: string,
  spec: AnswerSpec,
): ComplianceReport {
  const raw = String(draft || "");
  const violations: ComplianceViolation[] = [];
  const words = raw.split(/\s+/).filter(Boolean).length;
  const { form, compliance } = spec;

  if (form !== "code") {
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
  if (form === "screenplay") {
    const shaped =
      /^\s*(?:INT\.?\s*\.?|EXT\.?\s*\.?|INT\.?\s*\/\s*EXT\.?)\s+[A-Z0-9]/im.test(
        raw,
      ) || /^\s*[A-Z][A-Z0-9 '.-]{1,30}$/m.test(raw);
    if (!shaped) {
      violations.push({
        type: "structure",
        severity: "blocker",
        detail:
          "no scene heading or dialogue block — this was not written as a screenplay",
      });
    }
  } else if (form === "code") {
    const lang = compliance.language || "js";
    const s = codeSyntaxFloor(lang, raw);
    if (!s.ok)
      violations.push({
        type: "structure",
        severity: "blocker",
        detail: `code syntax floor: ${s.reason}`,
      });
  }

  return {
    compliant: !violations.some((v) => v.severity === "blocker"),
    violations,
  };
}

// ── REC: one bounded revision toward the flagged violations ────────────

export async function reconcileDraft({
  question,
  form,
  draft,
  violations,
  generate,
}: {
  question: string;
  form: string;
  draft: string;
  violations: ComplianceViolation[];
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<string> {
  const sys = `You are rewriting an answer to pass its compliance review. Fix ONLY the violations listed. Keep the assigned form (${form}). Never mention sources, citations, or "the material" in the writing.`;
  const user = [
    `Reader's question: ${question}`,
    "",
    "YOUR DRAFT — rewrite it, fixing ONLY the listed violations:",
    String(draft || ""),
    "",
    "REVIEW FLAGS:",
    violations.map((v) => `- [${v.type}] ${v.detail}`).join("\n") || "(none)",
  ].join("\n");
  return generate(sys, user);
}
