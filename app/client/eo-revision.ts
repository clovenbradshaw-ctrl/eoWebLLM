// eo-revision.ts — Citey's async resolve pass: search (and, numbers only,
// judge) the spans eo-grounding-spans.ts marked "checking", once generation
// has finished. This module never touches message content — it only ever
// returns what it found, per span; the caller (chat.ts) writes each result
// into that span's own fields. That split is deliberate: an earlier version
// of this pass spliced corrections directly into the message string, and a
// live run of it proved that unsafe — two overlapping passes on the same
// message produced nested, duplicated garbage. A side-channel array has no
// such failure mode: each span is an independent slot, resolved once.
//
// Numbers get judged; names don't. Verified live, twice, on two different
// topics: even at the judge's forced low temperature (see eoJudgeClaim in
// chat.ts), asking it to confirm/contradict a NAME atom against a search
// snippet is unreliable in a way asking about a NUMBER isn't — a search for
// a sentence mentioning "Albert Einstein" can surface an unrelated
// Wikipedia page ("Scientific method", "Certainty") whose snippet has
// nothing to do with him, and the judge still said "contradicted". A wrong
// date is a comparison of two numbers; a wrong name is a judgment about
// identity, and this pipeline isn't reliable enough at that yet. So a name
// span still gets searched — the reader still gets a verbatim clause to
// check against, the "go get proof" affordance — it just never gets an
// asserted verdict.

import type { WebSearchResult } from "./eo-websearch";

export type ClaimVerdict = "confirmed" | "contradicted" | "unrelated";

export interface ClaimSpan {
  text: string;
  start: number;
  end: number;
  atomKind: "number" | "name" | null;
}

export interface SpanCheck {
  span: ClaimSpan;
  clause?: string;
  source?: { title: string; url: string };
  judged: boolean;
  verdict?: ClaimVerdict;
  correction?: string;
}

export interface ResolveResult {
  checks: SpanCheck[];
  // LAWS.md L3 — no silent truncation (same discipline as checkGrounding's
  // own `truncated` field): a capped check list must say it was capped.
  truncated: { checked: number; total: number; dropped: number } | null;
}

// Each check is a search, and (numbers only) a judgment call — bounded so
// one wordy draft can't turn into a dozen sequential round trips.
const MAX_CHECKS = 6;

// The bare atom ("1969") finds nothing on its own; the sentence it sits in
// ("the moon landing happened in 1969") is what makes the search and the
// judgment call meaningful. Windowed AROUND the atom rather than truncated
// from the sentence's start — a long sentence with the atom near its end
// must not truncate the very fact being checked out of its own context.
const CONTEXT_WINDOW = 200;
function contextSentence(content: string, f: ClaimSpan): string {
  const sentenceStart = content.lastIndexOf(".", f.start) + 1;
  const enders = [".", "!", "?"]
    .map((c) => content.indexOf(c, f.end))
    .filter((i) => i !== -1);
  const sentenceEnd = enders.length ? Math.min(...enders) + 1 : content.length;
  const sentence = content.slice(sentenceStart, sentenceEnd).trim();
  if (sentence.length <= CONTEXT_WINDOW) return sentence;
  const half = CONTEXT_WINDOW / 2;
  const atomStart = f.start - sentenceStart;
  const atomEnd = f.end - sentenceStart;
  const windowStart = Math.max(0, atomStart - half);
  const windowEnd = Math.min(sentence.length, atomEnd + half);
  return sentence.slice(windowStart, windowEnd);
}

// `atom` is the exact fact to verify ("1887"); `sentence` is only context —
// a sentence can carry more than one atom ("The Eiffel Tower was completed
// in 1887"), and a judge asked to check the whole sentence at once has no
// way to say which part it's condemning. Separating them keeps a contested
// date from also contradicting an unrelated, correct name in the same
// clause.
export type Judge = (
  atom: string,
  sentence: string,
  snippet: string,
) => Promise<{ verdict: ClaimVerdict; correction?: string }>;

export type Search = (
  query: string,
  opts?: { numResults?: number },
) => Promise<WebSearchResult[]>;

/**
 * Resolve each "checking" span: search for it, and — numbers only — ask
 * the judge whether the top result confirms or contradicts it. Returns one
 * SpanCheck per span attempted; never mutates any text.
 *
 * Takes `search` as a required argument (rather than defaulting to
 * eo-websearch.ts's webSearch) so this module carries no runtime dependency
 * of its own — the caller (chat.ts) already has webSearch in scope for the
 * turn's other lookups and wires it through explicitly.
 */
export async function resolveSpans(
  content: string,
  spans: ClaimSpan[],
  judge: Judge,
  search: Search,
): Promise<ResolveResult> {
  const checks: SpanCheck[] = [];
  const candidates = spans.slice(0, MAX_CHECKS);

  for (const span of candidates) {
    const sentence = contextSentence(content, span);
    let results: WebSearchResult[] = [];
    try {
      results = await search(sentence, { numResults: 2 });
    } catch {
      // A failed lookup says nothing about the claim — record that a check
      // was attempted (so the caller can tell "tried, found nothing" from
      // "never tried"), with nothing further to show.
      checks.push({ span, judged: false });
      continue;
    }
    if (!results.length) {
      checks.push({ span, judged: false });
      continue;
    }
    const top = results[0];
    const clause = top.snippet;
    const source = { title: top.title, url: top.url };

    if (span.atomKind !== "number") {
      // Names: hand back the verbatim clause for the reader to judge
      // themselves — no asserted verdict (see module header).
      checks.push({ span, clause, source, judged: false });
      continue;
    }

    try {
      const { verdict, correction } = await judge(span.text, sentence, clause);
      checks.push({
        span,
        clause,
        source,
        judged: true,
        verdict,
        correction: verdict === "contradicted" ? correction : undefined,
      });
    } catch {
      checks.push({ span, clause, source, judged: false });
    }
  }

  return {
    checks,
    truncated:
      spans.length > candidates.length
        ? {
            checked: candidates.length,
            total: spans.length,
            dropped: spans.length - candidates.length,
          }
        : null,
  };
}
