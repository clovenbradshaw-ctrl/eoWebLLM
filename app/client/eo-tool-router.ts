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

const ROUTER_SYSTEM_PROMPT_HEADER = `You are the tool router for a chat assistant. Read the reader's latest message and the short list of tools below, then decide which of them (if any) this ONE message actually needs. Most messages need none.

TOOLS AVAILABLE THIS TURN:
`;

const ROUTER_SYSTEM_PROMPT_FOOTER = `
Pick a tool only when answering well genuinely depends on it — a specific, checkable, possibly-time-sensitive fact for web_search; a file the reader just attached for file_context. Do NOT pick a tool for greetings, small talk, opinions, follow-ups about what the assistant already said, or questions about the assistant itself — invoking a tool there just pulls in noise.

Reply with ONLY a JSON object, no prose, no code fences:
{"tools":["tool_name", "..."],"reason":"one short sentence"}
An empty tools array is a normal, common answer.`;

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
