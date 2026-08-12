// eo-math-check.ts — deterministic math extraction and validation.
//
// Not a port: eochat (the sibling project eo-holonic-plan.ts was ported
// from) has no KINDS/math.js mechanism to port — checked, nothing there.
// This is a new module built to the same discipline the TODO called for:
// the model never performs the arithmetic itself. One small background
// call (DEFINE-shaped, same seam as eo-holonic-plan.ts) extracts the
// expression the turn is actually asking about — e.g. "4 * 125" out of
// "how much for 4 of them?" following up on an earlier $125 — and mathjs
// evaluates it. The computed value is then handed to the model as a fact
// to state, and checked mechanically afterward (EVALUATE-shaped): if the
// draft's stated number doesn't match, one bounded reconcile rewrite
// (reusing eo-holonic-plan's reconcileDraft) is given the correct value
// and asked to restate it, never to recompute it.

import { evaluate as mathEvaluate } from "mathjs";
import type { ComplianceViolation } from "./eo-holonic-plan";

// ── mechanical gate ──────────────────────────────────────────────────
//
// Same shape as eo-holonic-plan's needsPlanning: a cheap regex check so
// the common turn ("hi", "what's the capital of France") never pays for
// a background extraction call. Triggers on digits paired with an
// operator word/symbol, or a currency amount — the two shapes arithmetic
// questions actually take.
const MATH_SIGNAL_RE =
  /\d.*(?:[+\-*/×÷x]|\btimes\b|\bplus\b|\bminus\b|\bdivided\b|\bpercent\b|%).*\d|\$\s?\d/i;

export function needsMathCheck(question: string): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  return MATH_SIGNAL_RE.test(q);
}

// ── DEFINE: extract the expression ──────────────────────────────────

const MATH_EXTRACT_SYSTEM_PROMPT = `You are a mechanical math-expression extractor for a chat assistant. Read the reader's question (and the conversation it follows up on) and decide whether it is actually asking for a calculation.

Reply with ONLY a JSON object, no prose, no code fences:

{"hasMath":true|false,"expression":"a plain arithmetic expression using only numbers and + - * / ( ) . , e.g. 4*125","currency":true|false}

If the question restates a number from earlier in the conversation (e.g. "how much for 4 of them" after a $125 price was given), resolve it into the literal numeric expression — do not leave words or references in "expression". If there is no calculation to do, reply {"hasMath":false,"expression":"","currency":false}.`;

export interface MathSpec {
  hasMath: boolean;
  expression: string;
  currency: boolean;
}

function normalizeSpec(p: any): MathSpec {
  const expression =
    typeof p?.expression === "string" ? p.expression.trim().slice(0, 200) : "";
  return {
    hasMath: !!p?.hasMath && expression.length > 0,
    expression,
    currency: !!p?.currency,
  };
}

function isSpecShaped(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return typeof obj.hasMath === "boolean" || typeof obj.expression === "string";
}

/** Same tolerant JSON strategy as eo-holonic-plan's parsePlannerReply. */
export function parseMathReply(raw: string): MathSpec {
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

  const exprM = text.match(/"expression"\s*:\s*"([^"]*)"/i);
  const hasMathM = text.match(/"hasMath"\s*:\s*(true|false)/i);
  if (exprM) {
    return normalizeSpec({
      hasMath: hasMathM ? hasMathM[1] === "true" : true,
      expression: exprM[1],
      currency: /\bcurrency"\s*:\s*true/i.test(text),
    });
  }

  return normalizeSpec({ hasMath: false, expression: "" });
}

export async function defineMathSpec({
  question,
  generate,
}: {
  question: string;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<MathSpec> {
  const raw = await generate(
    MATH_EXTRACT_SYSTEM_PROMPT,
    `Question: ${question}`,
  );
  return parseMathReply(raw);
}

// ── deterministic calculation ───────────────────────────────────────

export interface MathResult {
  ok: boolean;
  value: number | null;
  formatted: string | null;
}

/** Pure mathjs evaluation — no model involved. Fails closed (ok:false) on anything mathjs can't evaluate to a finite number, so a bad extraction never fabricates a wrong "ground truth". */
export function computeMath(expression: string, currency: boolean): MathResult {
  const expr = String(expression || "")
    .replace(/,/g, "")
    .replace(/\$/g, "");
  if (!expr.trim()) return { ok: false, value: null, formatted: null };
  try {
    const value = mathEvaluate(expr);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, value: null, formatted: null };
    }
    const rounded = Math.round(value * 100) / 100;
    const formatted = currency
      ? `$${rounded.toFixed(2)}`
      : Number.isInteger(rounded)
        ? String(rounded)
        : String(rounded);
    return { ok: true, value: rounded, formatted };
  } catch {
    return { ok: false, value: null, formatted: null };
  }
}

// ── direct calculator bypass ─────────────────────────────────────────
//
// The extract-then-correct pass above still lets the model produce (and,
// with thinking on, visibly reason through) the arithmetic itself before
// mathjs's answer overrides it — for a turn that is NOTHING BUT a
// calculation ("17 * 23", "what's 4*125?") that's pure theater: there is
// no reading comprehension step for the model to earn its keep on. This
// is the strict, no-model-call gate for that case: only a bare expression
// (optionally wrapped in "what is"/"calculate"/etc.) qualifies — anything
// with an un-stripped word left over falls through to the normal turn.
const CALC_WRAPPER_RE =
  /^(?:what(?:'s| is)|calculate|compute|solve|evaluate)\s*[:\-]?\s*/i;
const CALC_EXPR_ONLY_RE = /^[\d\s+\-*/().,%]+$/;

export interface DirectCalculation extends MathResult {
  expression: string;
}

/** No model involved at all, not even the extractor above — a plain regex
 * strip plus mathjs. Returns null for anything that isn't purely a bare
 * arithmetic expression once the wrapper phrase and trailing "?" are gone. */
export function tryDirectCalculation(
  question: string,
): DirectCalculation | null {
  let q = String(question || "").trim();
  if (!q) return null;
  q = q
    .replace(CALC_WRAPPER_RE, "")
    .replace(/\?+\s*$/, "")
    .trim();
  q = q
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\btimes\b/gi, "*")
    .replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "-")
    .replace(/\bdivided by\b/gi, "/");
  if (!q || !/\d/.test(q) || !CALC_EXPR_ONLY_RE.test(q)) return null;
  const result = computeMath(q, false);
  if (!result.ok) return null;
  return { ...result, expression: q };
}

// ── system-block directive ──────────────────────────────────────────

/** Handed to the model as a fact, not a task — it states the number, it never computes it. */
export function buildMathBlock(
  spec: MathSpec,
  result: MathResult,
): string | null {
  if (!spec.hasMath || !result.ok || result.formatted === null) return null;
  return `The correct computed answer to this turn's arithmetic (${spec.expression} = ${result.formatted}) is ${result.formatted}. State this exact value — do not recompute or alter it.`;
}

// ── EVALUATE: does the draft state the right number ────────────────

/** Pure string check: does the draft contain the computed value (or a very close numeric match)? No model grades its own arithmetic. */
export function checkMathCompliance(
  draft: string,
  result: MathResult,
): ComplianceViolation[] {
  if (!result.ok || result.value === null) return [];
  const raw = String(draft || "");
  const value = result.value;
  const numbers = raw.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  const stated = numbers.some((n) => {
    const parsed = Number(n.replace(/,/g, ""));
    return Number.isFinite(parsed) && Math.abs(parsed - value) < 0.005;
  });
  if (stated) return [];
  return [
    {
      type: "math",
      severity: "blocker",
      detail: `the answer does not state the correct computed value (${result.formatted})`,
    },
  ];
}
