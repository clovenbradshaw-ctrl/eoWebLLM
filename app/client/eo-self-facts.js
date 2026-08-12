// eo-self-facts.js — durable, structured self-declared facts.
//
// eo-memory.ts's "desk" already captures verbatim sentences for the model
// to read in raw context ("my name is frank." stored as text). That channel
// depends on the model itself re-finding and using the right sentence out
// of a growing block of prose — which is exactly where a small local model
// (Llama-3.2-1B, this app's default) is weakest, and exactly what produced
// the transcript this module exists to fix: the fact was present, twice,
// and the model still denied knowing it.
//
// This module extracts a small, closed set of HIGH-VALUE self-identity
// statements as canonical (subject, verb, object) triples — "user" is
// always the subject — so they can be retrieved MECHANISTICALLY (by shape:
// "every fact about the user") rather than by lexical overlap between the
// current question and the graph's own text. "What is my name?" shares no
// words with "user is-named frank"; a token-overlap retrieval gate (the
// one eo-hypergraph.ts's navigateHypergraph already runs for the broader
// graph) would correctly miss it. This channel does not gate on relevance
// at all — a user's own name is exactly the class of fact that must never
// silently fail to reach the prompt, so it is always included, bounded by
// construction (a handful of short facts, never the whole graph).
//
// Pure: no I/O, no model call, no eoreader6 import. Plain JS, not
// TypeScript — testable directly with `node --test`, the same convention
// reading-pipeline.js's own header states and follows. The triples this
// produces are injected into the SAME belief graph eo-hypergraph.ts
// already builds (via its admitSelfFacts/queryUserFacts, not here), so
// "frank" canonicalises as the same node the conversational graph's own
// relation extraction would use, never a second, disconnected store.

// A capture stops before clause-ending punctuation, a coordinating
// conjunction, or the start of a new "I ..." clause — without this, a
// greedy multi-word object swallows straight through into the NEXT clause
// ("i live in Chicago and i'm 40" would otherwise capture "Chicago and
// i'm"). Shared by every multi-word pattern below so the boundary rule is
// declared once, not copy-pasted per pattern.
const CLAUSE_END = String.raw`(?=[.,;!?]|\s+and\b|\s+but\b|\s+i'?m\b|\s+i\s|$)`;

// Each pattern captures ONE group as the object; the verb names the
// relation as a fixed, canonical string — never the raw text of what
// triggered it — so "I'm called Frank", "call me Frank", and "my name is
// Frank" all land on the same edge instead of three unrelated ones. Every
// pattern is case-insensitive: a name is a proper noun in the OBJECT
// position, but the sentence stating it ("My name's Frank" vs "my name's
// Frank") is not reliably capitalised by a casual chat typist.
const PATTERNS = [
  {
    verb: "is-named",
    re: new RegExp(
      String.raw`\bmy name(?:'s| is)\s+([a-zA-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,2}?)${CLAUSE_END}`,
      "i",
    ),
  },
  {
    verb: "is-named",
    re: new RegExp(
      String.raw`\bcall me\s+([a-zA-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,2}?)${CLAUSE_END}`,
      "i",
    ),
  },
  {
    verb: "is-named",
    re: /\bi'?m\s+([a-zA-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,2}),\s*(?:by the way|nice to meet you)/i,
  },
  {
    verb: "lives-in",
    re: new RegExp(
      String.raw`\bi\s+live\s+in\s+([a-zA-Z][\w'.-]*(?:\s+[a-zA-Z][\w'.-]*){0,3}?)${CLAUSE_END}`,
      "i",
    ),
  },
  {
    verb: "works-at",
    re: new RegExp(
      String.raw`\bi\s+work\s+(?:at|for)\s+([a-zA-Z][\w'.-]*(?:\s+[a-zA-Z][\w'.-]*){0,3}?)${CLAUSE_END}`,
      "i",
    ),
  },
  { verb: "age-is", re: /\bi'?m\s+(\d{1,3})\s+years?\s+old\b/i },
  {
    verb: "email-is",
    re: /\bmy email(?:'s| is)\s+([\w.+-]+@[\w-]+\.[\w.-]+)/i,
  },
  // Below: the same closed-set, high-value discipline extended to a second
  // domain this app's own live QA surfaced as sparse — trip/task planning
  // turns ("my budget is $2000", "I'm traveling with my partner Elena",
  // "we're going to Lisbon", "I love hiking"). eoreader6's own graph
  // extraction (eo-hypergraph.ts's admitOnce) is capitalisation-gated and
  // skips a sentence's own first token as naming evidence
  // (engine/perceiver/text/surfaces.js) — sound for recurring names across
  // a long document, but it means a short, one-off chat turn whose only
  // named thing is a lowercase common noun ("budget") or sits at the start
  // of the sentence never produces a node at all. These patterns are this
  // same self-facts channel's existing answer to that gap (a received
  // prior, not a re-derivation of eoreader6's own proper-noun detector),
  // just no longer limited to name/location/employer/age/email.
  {
    verb: "budget-is",
    re: /\bmy\s+budget(?:'s| is)\s+(?:about\s+|around\s+)?(\$[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:dollars|usd))/i,
  },
  {
    verb: "traveling-to",
    // Stops before a trailing time phrase ("next month", "this weekend",
    // "tomorrow") in addition to CLAUSE_END's own boundaries — otherwise a
    // destination greedily swallows the temporal clause that follows it
    // ("going to Lisbon next month" would otherwise capture "Lisbon next
    // month" as the place name).
    re: new RegExp(
      String.raw`\b(?:traveling|travelling|going|headed|heading|flying)\s+to\s+([A-Za-z][\w'.-]*(?:\s+[A-Za-z][\w'.-]*){0,3}?)(?=[.,;!?]|\s+and\b|\s+but\b|\s+i'?m\b|\s+i\s|\s+(?:next|this|tomorrow|tonight|later|soon)\b|$)`,
      "i",
    ),
  },
  {
    verb: "traveling-with",
    re: new RegExp(
      String.raw`\b(?:traveling|travelling|going)\s+with\s+(?:my\s+)?(?:partner|friend|wife|husband|girlfriend|boyfriend|colleague|sister|brother|family|kids|son|daughter)?\s*([A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*){0,2}?)${CLAUSE_END}`,
      "i",
    ),
  },
  {
    verb: "prefers",
    re: new RegExp(
      String.raw`\bi\s+(?:like|love|enjoy|prefer)\s+([a-zA-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,3}?)${CLAUSE_END}`,
      "i",
    ),
  },
];

// A trailing function word swept in by a greedy-ish match ("frank," / "frank
// by") is trimmed rather than left attached — the object is a value, not a
// clause.
const STOPWORD_TAIL = new Set([
  "a",
  "an",
  "the",
  "very",
  "so",
  "also",
  "just",
  "not",
  "still",
  "and",
  "but",
  "by",
  "to",
]);

function cleanObject(raw) {
  const words = raw
    .trim()
    .replace(/[.,!?;:]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  while (
    words.length &&
    STOPWORD_TAIL.has(words[words.length - 1].toLowerCase())
  )
    words.pop();
  if (!words.length) return null;
  const object = words.join(" ");
  if (object.length < 1 || object.length > 60) return null;
  return object;
}

/**
 * Extract at most one fact per pattern (first match in the text wins) —
 * bounded by construction, since PATTERNS.length is the hard ceiling on
 * how many facts one call can ever return, never a truncation of something
 * larger. Returns [{ verb, object }].
 */
export function extractSelfFacts(text) {
  const out = [];
  const seenVerbs = new Set();
  for (const { verb, re } of PATTERNS) {
    if (seenVerbs.has(verb)) continue;
    const m = text.match(re);
    if (!m || !m[1]) continue;
    const object = cleanObject(m[1]);
    if (!object) continue;
    seenVerbs.add(verb);
    out.push({ verb, object });
  }
  return out;
}

/** Canonical triple shape emergence/graph.js::injectPrior expects. */
export function selfFactsToTriples(facts) {
  return facts.map((f) => ({
    subject: "user",
    verb: f.verb,
    object: f.object,
  }));
}

const VERB_LABEL = {
  "is-named": "name",
  "lives-in": "lives in",
  "works-at": "works at",
  "age-is": "age",
  "email-is": "email",
  "budget-is": "budget",
  "traveling-to": "traveling to",
  "traveling-with": "traveling with",
  prefers: "prefers",
};

/**
 * A short, deterministic block from already-queried user facts — no model
 * call, no relevance gate. Returns null on an empty list so a caller never
 * splices in an empty block.
 */
export function buildSelfFactsBlock(facts) {
  if (!facts.length) return null;
  const lines = facts.map(
    (f) => `- ${VERB_LABEL[f.verb] ?? f.verb}: ${f.object}`,
  );
  return `KNOWN FACTS ABOUT THE USER — stated directly by the user earlier in this conversation. Treat these as true. Never deny, question, or claim not to have this information.\n${lines.join("\n")}`;
}
