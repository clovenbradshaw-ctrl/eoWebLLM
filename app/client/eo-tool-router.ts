// eo-tool-router.ts — decide WHICH tools a turn needs by asking the model,
// not by matching the question against a regex/keyword list.
//
// The web-search toggle used to be the whole decision: on means every turn
// searches, off means never. That's a blunt instrument — "thanks, that's
// clearer" doesn't need a search just because the session has search on, and
// a keyword scan for "what/when/how" over- and under-fires in ways a reader
// can't predict or fix. eochat's answer to the identical problem (its
// defineAnswerSpec planner, server/holonic-chat.js) is not a classifier at
// all: it is one small, cheap model call that reads the actual question and
// says what it needs, in its own words, as JSON. That is "mechanics" in the
// sense meant here — the decision comes out of the model's own generative
// dynamics for THIS question, not a static pattern compiled in advance.
//
// This is the general form of that seam: a registry of tools (today:
// web_search; anything added later — a second search backend, a
// re-run-the-binary-structure-pass tool — plugs in the same way), one prompt
// listing them, and the same tolerant JSON-or-salvage parse eochat's planner
// uses so a small local model's near-miss reply still steers correctly
// instead of silently falling back to "search everything" or "search
// nothing".
//
// Source of the parsing pattern: eochat/server/holonic-chat.js
// (parsePlannerReply / salvagePlan / normalizePlan)
//   https://github.com/clovenbradshaw-ctrl/eochat

export interface ToolSpec {
  name: string;
  /** shown to the model verbatim — what this tool is for and when to reach for it */
  description: string;
}

export interface ToolDecision {
  tools: string[];
  reason: string;
  /** true when nothing parsed and every offered tool was kept by fail-open default */
  fellBack: boolean;
}

// Kept deliberately short: this runs on a local in-browser model with no
// max_tokens control available (see EO_ROUTER_TIMEOUT_MS in chat.ts) — a
// long system prompt invites a long, rambling reply on a small model, which
// is exactly what a background routing call can't afford.
const ROUTER_SYSTEM_PROMPT_HEADER = `Tool router. Tools available:
`;

const ROUTER_SYSTEM_PROMPT_FOOTER = `
Pick a tool only if the message genuinely needs it. Most messages need none.
Reply with ONLY this JSON, nothing else, under 20 words total:
{"tools":[],"reason":"..."}`;

function buildRouterPrompt(tools: ToolSpec[]): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  return `${ROUTER_SYSTEM_PROMPT_HEADER}${list}\n${ROUTER_SYSTEM_PROMPT_FOOTER}`;
}

// Whole-object parse, then scan every '{' outward to its balanced '}' for
// the first object carrying a "tools" array — survives prose wrapping,
// stray code fences, and a second JSON blob in the reply.
function extractToolsObject(raw: string): any | null {
  const text = String(raw || "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "");

  try {
    const whole = JSON.parse(text);
    if (whole && Array.isArray(whole.tools)) return whole;
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
            if (p && Array.isArray(p.tools)) return p;
          } catch {
            // keep scanning
          }
          break;
        }
      }
    }
  }

  // A near-miss reply (unbalanced brace, stray quote) still names its tools
  // as `"tools": [...]` more often than it breaks that specific fragment —
  // salvage the array by regex when nothing above parsed.
  const arrM = text.match(/"tools"\s*:\s*\[([^\]]*)\]/i);
  if (arrM) {
    const names = [...arrM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const reasonM = text.match(/"reason"\s*:\s*"([^"]*)"/i);
    return { tools: names, reason: reasonM ? reasonM[1] : "" };
  }

  return null;
}

// `generate` is the caller's model seam — in eoWebLLM this is the same
// single-flight background call chat.ts already uses for topic-naming and
// discourse folds (eoRunBackground), so the router never races the visible
// streaming answer for engine time.
export async function planTools({
  question,
  tools,
  generate,
}: {
  question: string;
  tools: ToolSpec[];
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<ToolDecision> {
  if (!tools.length)
    return { tools: [], reason: "no tools registered", fellBack: false };

  const raw = await generate(
    buildRouterPrompt(tools),
    `Reader's message: ${question}`,
  );
  const parsed = extractToolsObject(raw);
  const validNames = new Set(tools.map((t) => t.name));

  if (parsed) {
    const chosen = (parsed.tools as unknown[])
      .map((t) => String(t))
      .filter((t) => validNames.has(t));
    return {
      tools: chosen,
      reason: String(parsed.reason || "").slice(0, 240),
      fellBack: false,
    };
  }

  // Nothing parsed at all: fail open, same reasoning eochat's planner uses
  // for its own `lookup` field — a missing/unparseable verdict only ever
  // ADDS a tool call back in, it never invents a new failure mode by
  // silently going quiet on a turn that actually needed one.
  return {
    tools: tools.map((t) => t.name),
    reason:
      "router reply unparseable — fell back to running every offered tool",
    fellBack: true,
  };
}

// A raw conversational question ("what's wrong with my Taylor C709 shake
// machine, it keeps giving E-4") makes a bad search-engine query verbatim —
// too long, too conversational, buries the actual noun phrase a search index
// matches against. eo-websearch.ts's distillQuery handles the mechanical
// case (strip "what is"/"how do I" scaffolding) but has no way to shorten a
// long, meandering question to its real subject, or to pull the right terms
// out of a follow-up ("what about the beater motor?") that only makes sense
// with the prior turn in view. Same seam as planTools above: one small,
// cheap background model call that reads the actual question and writes the
// query, rather than a regex trying to guess it.
const QUERY_SYSTEM_PROMPT = `Search query writer. Read the reader's message and write the best short web-search-engine query for it: specific, keyword-rich, no question words, no punctuation, under 12 words. Reply with ONLY the query text, nothing else — no quotes, no JSON, no explanation.`;

// A near-miss reply (the model adds quotes, a leading "Query:", or wraps in
// a code fence despite the instruction) is still one line worth keeping —
// strip the wrapping rather than discarding the whole reply and falling
// back to the unrewritten question.
function extractQueryText(raw: string): string {
  let q = String(raw || "").trim();
  q = q.split("\n")[0].trim();
  q = q
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  q = q.replace(/^(query|search)\s*:\s*/i, "").trim();
  q = q.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return q;
}

// planTools above hands the decision to the model because most turns are
// genuinely ambiguous — "thanks, that's clearer" needs a judgment call, not
// a keyword match. But some turns aren't ambiguous at all: "research
// dolphins", "look up the Taylor C709 manual", "google the current Fed
// rate" are the reader naming the tool they want in their own words. Routing
// those through a model-judged call still works when the model is strong,
// but the web_search tool description above is written for "specific,
// checkable, possibly time-sensitive fact" lookups — a small local model
// asked to weigh a broad "research X" ask against that description can
// reasonably (and, from the reader's seat, wrongly) decide the topic is too
// broad to need a search at all. An explicit ask should never be overruled
// by an implicit judgment call the reader never asked the model to make —
// same "a positive signal wins" principle as the fail-open default below,
// just applied one step earlier, before the model gets a vote.
const EXPLICIT_SEARCH_INTENT_RE =
  /^(please\s+)?(search(\s+the\s+web)?\s+for|look\s+up|google|research|find\s+(out\s+)?(about|info(rmation)?\s+(on|about)))\b/i;

// A small local model's own frozen training data is the single least
// reliable source for "who currently holds this role" — it will answer
// fluently and wrong (observed: a 1B model confidently naming a Prime
// Minister who'd already left office, with no grounding attempt, because
// the model-judged router below decided this ordinary-sounding question
// didn't need a search). "current/latest X" questions are inherently
// volatile facts regardless of phrasing politeness, so — same principle as
// EXPLICIT_SEARCH_INTENT_RE above — this is caught mechanically rather than
// left to the router's own small-model judgment call.
const TIME_SENSITIVE_FACT_RE =
  /\b(current|currently|latest|newest|right now|these days|nowadays)\b/i;

export function hasExplicitSearchIntent(question: string): boolean {
  const q = String(question || "").trim();
  return EXPLICIT_SEARCH_INTENT_RE.test(q) || TIME_SENSITIVE_FACT_RE.test(q);
}

// Both patterns above are English written in Latin script. Against a question
// with no Latin letters in it they cannot match — not "did not match", CANNOT.
// 「イルカについて調べてください」 asks for a lookup as plainly as "look up
// dolphins" does, and returns false here for a reason that has nothing to do
// with what it says.
//
// That difference matters because of what the caller does with a false: it
// hands the decision to a model-judged route (planTools), and a 1B local model
// judges least reliably in exactly the languages this gate is blind to. So the
// reader whose question the gate could not read gets BOTH the weaker mechanism
// AND no mechanical backstop, which is II.20's shape (proposed, eo-constitution
// #9): a capability difference produced entirely inside the instrument.
//
// The fix is not a Japanese pattern list plus an Arabic one — that is the same
// mistake in more languages. It is to stop treating silence as a verdict.
// LAWS.md's own distinction: "checked, nothing there" and "never checked" are
// different facts and must not render alike. This says which one happened, and
// it is decidable language-neutrally — the question is whether the patterns
// could apply at all, not what they mean.
export function searchIntentUndecidable(question: string): boolean {
  const q = String(question || "").trim();
  if (!q) return false;
  // A single Latin letter anywhere is enough for the patterns to have had a
  // chance — a code-switched "essay について書いて" is readable by them even
  // if they happen not to fire. Only a question with no Latin letters at all
  // was never actually examined.
  return !/\p{Script=Latin}/u.test(q);
}

/**
 * Ask the model (the same background seam planTools uses) to rewrite the
 * reader's message into a search-engine query. Falls back to `fallback`
 * (the caller's regex-based distillQuery result) on empty/unparseable reply
 * or a failed/timed-out call — same fail-open reasoning as planTools: a
 * missing rewrite never blocks the search, it just runs the plainer query.
 */
export async function planSearchQuery({
  question,
  fallback,
  generate,
}: {
  question: string;
  fallback: string;
  generate: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<{ query: string; rewritten: boolean }> {
  try {
    const raw = await generate(
      QUERY_SYSTEM_PROMPT,
      `Reader's message: ${question}`,
    );
    const q = extractQueryText(raw).slice(0, 200);
    if (q) return { query: q, rewritten: true };
  } catch {
    // fall through to fallback
  }
  return { query: fallback, rewritten: false };
}
