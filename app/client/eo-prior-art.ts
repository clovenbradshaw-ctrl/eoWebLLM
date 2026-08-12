// eo-prior-art.ts — browser-safe port of eochat's eval/agent/crispr-search.mjs
// archetype search (CRISPR.md's retrieve-before-hand-coding pipeline,
// stage 5: "is the whole task a known archetype", e.g. "a Reddit clone" —
// not "is there a utility function for this").
//
// Two things were measured and fixed in eochat before this port, and both
// fixes carry over unchanged rather than being re-derived:
//
// 1. Naive keyword extraction over-ANDs search terms and returns zero hits
//    on natural phrasing ("hacker news clone card layout social feed" -> 0
//    hits; "hacker news clone" alone -> 23 hits). A positional backoff
//    (drop trailing keywords, retry) only fixes this when the archetype
//    LEADS the sentence — it does not fix "a social media site like hacker
//    news but for dolphins", where the archetype is buried mid-sentence.
//    extractComparisonPhrase below is the real fix: a regex-based ENGLISH
//    GRAMMAR pattern ("X but for Y", "like X", "a clone of X", "X clone"),
//    not a hardcoded vocabulary — it finds "hacker news" and "reddit"
//    without either name appearing anywhere in this file. This is also why
//    the backoff machinery from the eochat version is NOT ported here: once
//    the phrase extractor is the trigger, over-constrained queries don't
//    happen in the first place.
//
// 2. A model-assisted version of the SAME extraction (one small bounded
//    call asking a model to name the archetype) was tried FIRST in eochat
//    and measured to fail on every small model actually available locally
//    (wrong answer, or no answer, or too slow). Per this app's own
//    constraint that the local model stays small, that path was demoted —
//    extractComparisonPhrase is mechanical, not model-steered, matching
//    eo-tool-router.ts's own precedent (hasExplicitSearchIntent bypasses
//    the LLM-judged router entirely for unambiguous cases).
//
// Source of the ported logic: eochat/eval/agent/crispr-search.mjs
//   https://github.com/clovenbradshaw-ctrl/eochat

export interface ArchetypeCandidate {
  repo: string;
  stars: number;
  language: string | null;
  description: string;
  license: string;
  url: string;
}

const FETCH_TIMEOUT_MS = 10_000;

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

// Ordered by specificity, not just "first match wins": a "but for" contrast
// names the comparison target most unambiguously, so it's checked first even
// though "like X" (last) would also match the same sentence. `appendClone:
// true` marks patterns where the source text ITSELF used the word "clone" —
// that qualifier is real search signal, not label noise (MEASURED in
// eochat: dropping it made "hacker news clone" search bare "hacker news"
// and lose the one genuinely relevant clone repo in favor of a generic
// curated list that merely mentions Hacker News).
const COMPARISON_PATTERNS: { re: RegExp; appendClone: boolean }[] = [
  {
    re: /\blike\s+([a-z0-9][a-z0-9 ]{1,28}?)\s+but\s+for\b/i,
    appendClone: false,
  },
  {
    re: /\bsimilar to\s+([a-z0-9][a-z0-9 ]{1,28}?)(?:,|\.|;| but| for| with|$)/i,
    appendClone: false,
  },
  {
    re: /\ba?\s*clone\s+of\s+([a-z0-9][a-z0-9 ]{1,28}?)(?:,|\.|;| but| for| with|$)/i,
    appendClone: true,
  },
  { re: /\b([a-z0-9][a-z0-9 ]{1,28}?)[\s-]clone\b/i, appendClone: true },
  {
    re: /\blike\s+([a-z0-9][a-z0-9 ]{1,28}?)(?:,|\.|;| but| for| with|$)/i,
    appendClone: false,
  },
];
const LEADING_ARTICLE_RE = /^(a|an|the)\s+/i;

/**
 * The mechanical trigger for the whole prior-art pipeline — returning
 * non-null IS the "physics" gate (a deterministic condition on the message
 * itself), never an LLM JSON tool-call decision. Callers should check this
 * before doing anything else; a null result means the pipeline does not run
 * this turn, full stop.
 */
export function extractComparisonPhrase(taskPrompt: string): string | null {
  const text = String(taskPrompt ?? "");
  for (const { re, appendClone } of COMPARISON_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const name = m[1].trim().toLowerCase().replace(LEADING_ARTICLE_RE, "");
      return appendClone ? `${name} clone` : name;
    }
  }
  return null;
}

// CRISPR.md's L2 license gate, ported as a real check, not decoration: a
// candidate with an unknown or copyleft license fails closed — refused
// before it's ever a code-quality question, not silently cloned anyway.
const LICENSE_ALLOWLIST = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

export function isLicenseAllowed(spdxId: string | null | undefined): boolean {
  return !!spdxId && LICENSE_ALLOWLIST.has(spdxId);
}

const MIN_ARCHETYPE_STARS = 50;
const MAX_CANDIDATES = 5;

/**
 * GitHub repository search for a named archetype phrase. Best-match
 * relevance ranking (no `&sort=stars`), NOT forced star-sort — MEASURED in
 * eochat: star-sort buried real hits under raw popularity for short
 * queries (a 2-word "hacker news" search surfaced an 82k-star unrelated NLP
 * repo ahead of any real clone). The star floor (`stars:>N`) stays as the
 * quality/existence gate; only the ranking changed.
 *
 * Direct client fetch(), no proxy needed — GitHub's REST search API sends
 * permissive CORS headers on public read requests, the same reason
 * eo-websearch.ts's Wikipedia/DuckDuckGo backends work unmodified from a
 * browser tab.
 */
export async function searchGithubArchetype(
  phrase: string,
  { minStars = MIN_ARCHETYPE_STARS }: { minStars?: number } = {},
): Promise<{ candidates: ArchetypeCandidate[]; error: string | null }> {
  if (!phrase) return { candidates: [], error: null };
  const query = encodeURIComponent(`${phrase} stars:>${minStars}`);
  const url = `https://api.github.com/search/repositories?q=${query}&per_page=${MAX_CANDIDATES}`;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok)
      return { candidates: [], error: `GitHub search HTTP ${resp.status}` };
    const data = await resp.json();
    if (data?.message) return { candidates: [], error: String(data.message) }; // rate-limited/blocked — GitHub's error shape has no "items"
    const items: any[] = data?.items || [];
    const candidates: ArchetypeCandidate[] = items
      .slice(0, MAX_CANDIDATES)
      .map((r) => ({
        repo: r.full_name,
        stars: r.stargazers_count,
        language: r.language ?? null,
        description: String(r.description ?? "").slice(0, 200),
        license: r.license?.spdx_id || "UNKNOWN",
        url: r.html_url,
      }));
    return { candidates, error: null };
  } catch (err) {
    return { candidates: [], error: (err as Error).message };
  }
}

/**
 * The first candidate whose license passes the allowlist gate — CRISPR.md
 * treats this as the actual permit, not the search itself. Returns null
 * (not the top candidate regardless) when nothing licensed was found, so a
 * caller never silently clones something it shouldn't.
 */
export function pickLicensedCandidate(
  candidates: ArchetypeCandidate[],
): ArchetypeCandidate | null {
  return candidates.find((c) => isLicenseAllowed(c.license)) ?? null;
}
