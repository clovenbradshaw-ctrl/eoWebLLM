// eo-search-query.ts — what to search for, when the message alone does not say.
//
// "prove it" and "find examples of that" contain nothing to search. Their
// subject is in the conversation, not in the sentence. So does 「証明して」,
// and «докажи это», and "أثبت ذلك" — the problem is not English's, and the fix
// must not be either.
//
// ── This module does not know what "prove it" means ─────────────────────
//
// That is deliberate and it is the whole design. There is no phrase list here,
// no deictic table, no "referential markers" set to fall behind in the next
// language. Nothing in this file inspects the message to decide whether it
// refers backwards — because any rule that could would be a rule about one
// language's function words, which is exactly what eo-constitution II.20
// (proposed) refuses and what eo-citation-check.ts's English stopword table
// already demonstrates the cost of.
//
// Instead the question is asked, in prose, of something that reads discourse,
// and the ANSWER is validated mechanically. `resolveReferent` is injected the
// way eo-revision.ts takes its `judge` and `search` — "so this module carries
// no runtime dependency of its own" — which is also what makes this testable
// with no model at all.
//
// ── Why an answer can be trusted without trusting the answerer ──────────
//
// A resolved referent must appear VERBATIM in the conversation. That is a
// closed-set check, the same property that makes eo-stigmergy.ts's marks safe:
// the resolver can only ever point at words the conversation already contains,
// so it cannot invent a subject, and a reply that names nothing real
// contributes nothing rather than contributing a guess (LAWS.md L5 — a model's
// output is a draft to check, never a value to trust).
//
// Containment is checked as a substring, not by token match, on purpose:
// substring works identically in Thai and Japanese, which have no word
// delimiters to tokenize on. A tokenizer here would reintroduce the assumption
// this module exists to avoid.
//
// ── Additive only ───────────────────────────────────────────────────────
//
// The returned query always BEGINS with the reader's own message, byte for
// byte. Carried terms are appended, never substituted. That preserves
// eo-websearch.ts's measured rule — the whole sentence disambiguates and a
// reduced subject does not (「イルカ」 alone returns a folk singer) — and it
// means the worst case of a wrong resolution is a slightly noisier query, not
// a query about the wrong thing.

/** Most carried terms to append. The horizon law: a bounded mouth. */
export const MAX_CARRIED = 4;

/** Longest a single carried term may be, so a resolver that echoes a whole
 *  paragraph cannot drown the reader's own words. */
const MAX_TERM_CHARS = 60;

export interface ResolvedQuery {
  /** What to search. Always starts with `message`, unchanged. */
  query: string;
  /** Terms appended from the conversation, in order. Empty when standalone. */
  carried: string[];
  /** True when nothing was carried — the message stood on its own, or the
   *  resolver had nothing usable to add. The two are distinguished by
   *  `reason`, never collapsed. */
  standalone: boolean;
  reason: string;
}

/**
 * Reads a resolver's free-text reply and keeps only what the conversation
 * actually contains.
 *
 * No JSON is requested or parsed — a small local model is not reliable at
 * structured output, and eo-holonic-plan.ts already records that lesson. The
 * reply is split on punctuation and whitespace common to every script, and the
 * whole trimmed reply is tried too, so a resolver answering with a single
 * unspaced phrase (「イルカの反響定位」) is not lost by a splitter that
 * assumed spaces.
 */
export function groundReferent(reply: string, conversation: string): string[] {
  const hay = String(conversation || "");
  if (!hay.trim()) return [];
  const hayLower = hay.toLowerCase();

  const raw = String(reply || "").trim();
  if (!raw) return [];

  const candidates = [
    raw,
    ...raw.split(/[\s,;:.!?、。，；：！？「」『』()（）"'`]+/u),
  ];

  const out: string[] = [];
  for (const c of candidates) {
    const term = c.trim();
    if (!term || term.length > MAX_TERM_CHARS) continue;
    // A single character is never evidence of a referent — in a cased script
    // it is noise, and in an unspaced one it is a fragment.
    if ([...term].length < 2) continue;
    if (!hayLower.includes(term.toLowerCase())) continue;
    if (out.some((t) => t.toLowerCase() === term.toLowerCase())) continue;
    // Prefer the longest match: if the whole reply is present verbatim, its
    // pieces add nothing.
    if (out.some((t) => t.toLowerCase().includes(term.toLowerCase()))) continue;
    out.push(term);
    if (out.length >= MAX_CARRIED) break;
  }
  return out;
}

export type ReferentResolver = (input: {
  message: string;
  conversation: string;
}) => Promise<string>;

/**
 * The query for this turn.
 *
 * Fails open at every step: no conversation, no resolver, a resolver that
 * throws, times out, or answers with something the conversation does not
 * contain — all produce the message alone, which is exactly today's behaviour.
 * A resolution can only ever add.
 */
export async function resolveSearchQuery({
  message,
  conversation = "",
  resolveReferent,
}: {
  message: string;
  conversation?: string;
  resolveReferent?: ReferentResolver | null;
}): Promise<ResolvedQuery> {
  const msg = String(message ?? "");
  const alone = (reason: string): ResolvedQuery => ({
    query: msg,
    carried: [],
    standalone: true,
    reason,
  });

  if (!msg.trim()) return alone("empty message");
  if (!conversation.trim()) return alone("no conversation to refer back to");
  if (!resolveReferent) return alone("no resolver configured");

  let reply = "";
  try {
    reply = await resolveReferent({ message: msg, conversation });
  } catch {
    return alone("resolver failed — message searched on its own");
  }

  const carried = groundReferent(reply, conversation);
  if (!carried.length)
    return alone("resolver named nothing the conversation contains");

  return {
    query: `${msg} ${carried.join(" ")}`,
    carried,
    standalone: false,
    reason: `carried ${carried.length} term(s) found verbatim in the conversation`,
  };
}
