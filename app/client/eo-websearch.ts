// eo-websearch.ts — browser-safe port of eochat's server/web-search.js.
//
// eochat's version runs server-side and layers five backends (Brave, Serper,
// Wikipedia, DuckDuckGo HTML scrape, DuckDuckGo Instant Answer), then follows
// a Wikipedia article's own citations out to primary sources via arbitrary
// webFetch() calls. None of that arbitrary cross-origin fetching survives a
// browser: no API keys can live in client bundle (Brave/Serper), and a page
// fetched from an origin without CORS headers is opaque to `fetch()` — the
// DDG HTML scrape and the primary-source webFetch hop both depend on that.
//
// What *does* survive: Wikipedia's action API sets `Access-Control-Allow-
// Origin: *` when called with `origin=*`, and DuckDuckGo's Instant Answer
// API is a plain public JSON GET with permissive CORS. Both return complete
// text in the response itself — no follow-up fetch needed — so this port
// keeps exactly those two backends and drops everything that needs a server.
//
// Source of the algorithm: eochat/server/web-search.js
//   https://github.com/clovenbradshaw-ctrl/eochat

export interface WebSearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  source: "wikipedia" | "duckduckgo";
}

const FETCH_TIMEOUT_MS = 10_000;

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

// A search query must be a noun phrase, not a whole sentence — "what's wrong
// with my Taylor C709 milkshake machine" fed verbatim to Wikipedia's search
// matches stray words, not the subject.
//
// This version's predecessor said it stripped "the common question scaffolding
// eochat's distillSubject() also strips, WITHOUT needing that module's
// essay-prompt-specific rules." That judgment was wrong, and the cost was
// measured: "write me an essay about dolphins" passed through completely
// unchanged (no rule here matched "write me an essay about"), reached
// Wikipedia's search verbatim, and returned Hysterical realism, Margaret
// St. Clair, Larry Csonka and Gale Garnett — four articles, none about
// dolphins, ranked on the scaffolding words. Because that result set was
// non-empty, webSearch returned early and the model was handed a literary
// genre and an NFL fullback to ground an essay about dolphins in.
//
// The essay rules are therefore migrated in from eochat's
// server/holonic-chat.js::distillSubject + cleanSubjectPhrase, whose own
// comment records the identical failure from the other side:
//
//   "the full 'Write me a 5 page essay about dolphins, after researching
//    online first.' fed to the search API matches stray words ('essay' →
//    Voltaire), not the subject."
//
// eochat is legacy and frozen; this is a migration, not a dependency. Its
// order is preserved (trailing clause → politeness → deliverable → direct ask)
// because each pattern assumes the earlier ones already ran, and this port's
// own broader leading-scaffold strip is kept as the fallback so queries that
// already worked keep working.
//
// ── DECLARED LIMIT: every rule below is English ──────────────────────────
//
// Measured, not assumed. The same request in four languages:
//
//   en  "write me an essay about dolphins"        -> "dolphins"
//   ja  「イルカについてのエッセイを書いてください」  -> UNCHANGED
//   de  "schreibe mir einen Aufsatz über Delfine"  -> UNCHANGED
//   ar  "اكتب لي مقالاً عن الدلافين"                 -> UNCHANGED
//
// and the consequence is worse than a passthrough, because fetchWikipedia
// below is hardcoded to en.wikipedia.org. The Japanese sentence returns ZERO
// hits there, so the DDG fallback runs, returns empty too, and the turn gets
// no grounding material at all — which the fold ledger reads as
// checkedEmpty and reports to the reader as "consulted and came back empty."
// The reader is told their own answer is unconfirmed, for a reason that lives
// entirely in this function. Routing to ja.wikipedia.org does not fix it
// either: the undistilled sentence matches on エッセイ/書いて/ください and
// returns a musician, a novel, a lyricist and a music genre.
//
// This limit is DECLARED rather than repaired because a declared bias is
// dischargeable and a hidden one is not (eo-constitution II.20, proposed):
// what is refused is presenting a mechanism as general when it is not. Do NOT
// "fix" this by adding a German rule list and an Arabic one — that is the same
// mistake in more languages, and it is the specific repair II.20's own text
// rules out. The language-neutral replacement is a content-word extraction
// that does not enumerate scaffolding at all; scripts/test-query-distill.mjs
// pins the four cases above so the gap stays visible until then.
function cleanSubjectPhrase(s: string): string {
  let t = String(s)
    .trim()
    .replace(/[.!?;:]+$/g, "")
    .replace(/^(?:an?|the)\s+/i, "");
  // "a 5 page essay about dolphins" — the length belongs to the request, not
  // to the subject, and searching for "dolphins 5 pages" finds nothing.
  t = t
    .replace(/\s+(?:of\s+)?\d+\s*(?:pages?|paragraphs?|words?)$/i, "")
    .trim();
  return t;
}

export function distillQuery(raw: string): string {
  let q = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!q) return "";

  // "..., after researching online first." — a trailing instruction about HOW
  // to answer, never part of what is being asked about.
  q = q.replace(/,\s*(?:after|then|once|using|while|by|and)\s+[^.]*\.?$/i, "");
  q = q
    .replace(/\s+please[.!?]*$/i, "")
    .replace(
      /^\s*(?:please|can you|could you|would you|do you think you can)\s+/i,
      "",
    );

  // A deliverable framing names the ARTIFACT first and the subject after
  // "about"/"on". This is the rule whose absence produced Larry Csonka.
  const deliverable = q.match(
    /\b(?:essay|report|paper|write-?up|summary|article|piece|deep[\s-]?dive|long[\s-]?form)\b[^.]*?\b(?:about|on|covering|regarding|concerning)\s+([^,.;?]+)/i,
  );
  if (deliverable) return cleanSubjectPhrase(deliverable[1]).slice(0, 200);

  const ask = q.match(
    /\b(?:tell me about|what is|what are|what was|explain(?: to me)?|describe)\s+([^,.;?]+)/i,
  );
  if (ask) return cleanSubjectPhrase(ask[1]).slice(0, 200);

  // This port's own leading-scaffold strip, kept as the fallback: it covers
  // forms eochat's two capture patterns do not ("what's", "how do", "why is"),
  // and "research"/"look up" are here rather than there because
  // eo-tool-router.ts's hasExplicitSearchIntent routes on those exact words —
  // so they reach this function attached to the subject and must come off.
  q = q.replace(
    /^(please\s+)?(what'?s|what\s+is|how\s+(do|can|to)|why\s+(is|does|do)|can\s+you|could\s+you|tell\s+me\s+about|explain|research|search(\s+the\s+web)?\s+for|search|look\s+up|google|find\s+(out\s+)?(about|info(rmation)?\s+(on|about))|find\s+out\s+about)\s+/i,
    "",
  );
  return cleanSubjectPhrase(q).slice(0, 200);
}

async function fetchWikipedia(
  query: string,
  numResults: number,
  maxChars: number,
): Promise<WebSearchResult[]> {
  const subject = distillQuery(query) || query;
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(subject)}` +
    `&srlimit=${Math.min(numResults, 5)}&format=json&origin=*`;
  const searchResp = await fetch(searchUrl, {
    signal: withTimeout(FETCH_TIMEOUT_MS),
  });
  if (!searchResp.ok) return [];
  const searchData = await searchResp.json();
  const hits: Array<{ title: string; snippet?: string }> =
    searchData?.query?.search || [];
  if (!hits.length) return [];

  const perResultChars = Math.floor(maxChars / Math.max(numResults, 1));
  const out: WebSearchResult[] = [];
  let rank = 1;
  for (const h of hits.slice(0, numResults)) {
    const title = h.title;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    let text = "";
    try {
      const exUrl =
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&origin=*` +
        `&titles=${encodeURIComponent(title)}`;
      const exResp = await fetch(exUrl, {
        signal: withTimeout(FETCH_TIMEOUT_MS),
      });
      if (exResp.ok) {
        const exData = await exResp.json();
        const pages = exData?.query?.pages || {};
        const page = pages[Object.keys(pages)[0]];
        text = (page?.extract || "").trim();
      }
    } catch {
      // keep snippet-only
    }
    const snippet =
      text.slice(0, perResultChars) ||
      (h.snippet || "")
        .replace(/<[^>]+>/g, " ")
        .trim()
        .slice(0, perResultChars);
    if (!snippet) continue;
    out.push({ rank: rank++, title, url, snippet, source: "wikipedia" });
  }
  return out;
}

// ── DuckDuckGo HTML — migrated from eochat, restored by the proxy ────────
//
// This backend was dropped from the original port for one reason, stated in
// this file's own header: "a page fetched from an origin without CORS headers
// is opaque to `fetch()` — the DDG HTML scrape and the primary-source
// webFetch hop both depend on that." A CORS-passing relay removes exactly
// that constraint, so the backend comes back. The parsing below is eochat's
// server/web-search.js::fetchDuckDuckGoHtml + decodeDdgRedirect, unchanged —
// eochat is legacy and frozen, so this is a migration, not a dependency.
//
// ── Measured: this backend wants the RAW sentence, not a distilled one ───
//
// distillQuery exists because Wikipedia's list=search is a lexical index over
// article text: hand it a whole sentence and it ranks on the scaffolding
// words. A search engine is not that, and the same reduction that helps
// Wikipedia actively hurts here. Measured through the relay, same request:
//
//   「イルカについてのエッセイを書いてください」 (whole sentence)
//     -> イルカとどうやってコミュニケーションをとる？ / 意外と知らないイルカの生態 /
//        イルカは、なぜジャンプするのか？ / 沿岸に生きるイルカたち
//        — every result marine biology.
//
//   「イルカ」 (distilled to the bare subject)
//     -> イルカ (歌手) — Wikipedia  [the FOLK SINGER Iruka]
//        イルカ公式サイト / なごり雪 / 雨の物語  [her site, her songs]
//        — four of five about the singer, not the animal.
//
// Japanese "イルカ" is ambiguous exactly as English "dolphins" is, and the
// surrounding words are what resolve it. Distilling threw away the
// disambiguating context and made the result worse. That is II.20 (proposed)
// read from the other end: the sentence is the level that carries the
// meaning, and reducing to the bare noun descends below it.
//
// There is therefore ONE search function taking ONE query, and that query is
// the reader's own words, untouched. An earlier version of this migration gave
// webSearch a second `rawQuery` parameter so the two backends could be fed
// differently. That was the wrong fix: it made the caller responsible for
// knowing which backend wanted which shape of input, and it put an
// English-only reduction on the path every query travels.
//
// The distillation belongs INSIDE the backend that needs it. fetchWikipedia
// calls distillQuery itself, because list=search is a lexical index and cannot
// read a sentence. Nothing else does, because nothing else needs to. So the
// query reaches this module in whatever language it was written in, and the
// only place an English rule touches it is inside the one backend that is
// already declared English-biased.
//
// The omnilingual guarantee at this layer is exactly that narrow and exactly
// that checkable: nothing between a caller and the search engine inspects,
// rewrites, or reduces the query. ddgSearchUrl is exported so that is an
// assertion (scripts/test-ddg-parse.mjs) rather than a claim.

/** Where a CORS-passing relay lives, if one is configured. Deliberately not
 *  defaulted to any host: an unset proxy means this backend does not run and
 *  behaviour is exactly what it was. A relay is the reader's own
 *  infrastructure and does not belong hardcoded in a client bundle. */
let searchProxyBase: string | null = null;

/** `base` takes the target as a `?url=` parameter and returns its body with
 *  permissive CORS. Pass null to disable. */
export function configureSearchProxy(base: string | null): void {
  searchProxyBase = base && /^https?:\/\//.test(base) ? base : null;
}

export function searchProxyConfigured(): boolean {
  return searchProxyBase !== null;
}

function viaProxy(target: string): string | null {
  if (!searchProxyBase) return null;
  const join = searchProxyBase.includes("?") ? "&" : "?";
  return `${searchProxyBase}${join}url=${encodeURIComponent(target)}`;
}

// Unwrap DDG's /l/?uddg=<urlencoded> redirect to the real article URL.
// eochat/server/web-search.js::decodeDdgRedirect, unchanged.
export function decodeDdgRedirect(url: string): string {
  const s = String(url || "");
  const m = s.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through to the raw form */
    }
  }
  return s.startsWith("//") ? "https:" + s : s;
}

/** The parse, split out from the fetch so it can be tested against a recorded
 *  page with no network (scripts/test-ddg-parse.mjs). Regexes are eochat's. */
export function parseDuckDuckGoHtml(
  html: string,
  {
    numResults = 4,
    maxChars = 6000,
  }: { numResults?: number; maxChars?: number } = {},
): WebSearchResult[] {
  const src = String(html || "");
  const anchors = [
    ...src.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
  ];
  const snippets = [
    ...src.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
  ];

  const out: WebSearchResult[] = [];
  const perResult = Math.floor(maxChars / Math.max(numResults, 1));
  for (let i = 0; i < anchors.length && out.length < numResults; i++) {
    const title = anchors[i][2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const url = decodeDdgRedirect(anchors[i][1]);
    if (!title || !url || !/^https?:\/\//.test(url)) continue;
    const snippet = (snippets[i]?.[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, perResult);
    out.push({
      rank: out.length + 1,
      title,
      url,
      snippet,
      source: "duckduckgo",
    });
  }
  return out;
}

/** The target URL for a query, exported so the "nothing touches the query"
 *  guarantee is testable offline in any script. */
export function ddgSearchUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query ?? ""))}`;
}

async function fetchDuckDuckGoHtml(
  query: string,
  numResults: number,
  maxChars: number,
): Promise<WebSearchResult[]> {
  const relayed = viaProxy(ddgSearchUrl(query));
  if (!relayed) return [];
  const resp = await fetch(relayed, { signal: withTimeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) return [];
  return parseDuckDuckGoHtml(await resp.text(), { numResults, maxChars });
}

// RelatedTopics mixes flat {Text, FirstURL} entries with grouped
// {Name, Topics: [...]} categories at the top level.
function flattenDdgTopics(
  topics: any[],
): Array<{ Text: string; FirstURL: string }> {
  const out: Array<{ Text: string; FirstURL: string }> = [];
  for (const t of topics || []) {
    if (Array.isArray(t?.Topics)) out.push(...flattenDdgTopics(t.Topics));
    else if (t?.Text && t?.FirstURL) out.push(t);
  }
  return out;
}

async function fetchDuckDuckGoInstantAnswer(
  query: string,
  numResults: number,
  maxChars: number,
): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const resp = await fetch(url, { signal: withTimeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) return [];
  const data = await resp.json();

  const entries: Array<{ title: string; url: string; text: string }> = [];
  if (data.AbstractText) {
    entries.push({
      title: data.Heading || query,
      url: data.AbstractURL || "",
      text: data.AbstractText,
    });
  }
  for (const t of flattenDdgTopics(data.RelatedTopics)) {
    if (entries.length >= numResults) break;
    const dash = t.Text.indexOf(" - ");
    entries.push({
      title: dash > -1 ? t.Text.slice(0, dash) : t.Text.slice(0, 80),
      url: t.FirstURL,
      text: t.Text,
    });
  }

  const perResultChars = Math.floor(maxChars / Math.max(numResults, 1));
  return entries.slice(0, numResults).map((e, i) => ({
    rank: i + 1,
    title: e.title,
    url: e.url,
    snippet: e.text.slice(0, perResultChars),
    source: "duckduckgo" as const,
  }));
}

// The default lookup: Wikipedia first (typed API, real article prose), then
// DuckDuckGo's Instant Answer API as breadth fallback when Wikipedia has no
// article for the query. Both backends return complete text inline — no
// second cross-origin hop, so both work unmodified from a browser tab.
/**
 * The one lookup. `query` is the reader's own words, in whatever language they
 * wrote them, and nothing here reduces it — see the DDG header above for why a
 * second "already distilled" parameter was removed rather than kept.
 */
export async function webSearch(
  query: string,
  {
    numResults = 4,
    maxChars = 6000,
  }: { numResults?: number; maxChars?: number } = {},
): Promise<WebSearchResult[]> {
  numResults = Math.min(numResults, 10);

  // DDG first, but ONLY when a relay is configured — unset, this whole branch
  // is skipped and behaviour is exactly what it was. It leads when available
  // because it is the one backend that reads a natural-language question in
  // any language. Wikipedia's list=search, handed the same sentence, ranks on
  // scaffolding: "write me an essay about dolphins" returned Hysterical
  // realism and Larry Csonka, and the Japanese form returned zero hits at all.
  if (searchProxyConfigured()) {
    try {
      const ddg = await fetchDuckDuckGoHtml(query, numResults, maxChars);
      if (ddg.length > 0) return ddg;
    } catch {
      // fall through — a relay that is down must never block the lookup
    }
  }

  try {
    const wiki = await fetchWikipedia(query, numResults, maxChars);
    if (wiki.length > 0) return wiki;
  } catch {
    // fall through
  }

  try {
    const ddg = await fetchDuckDuckGoInstantAnswer(query, numResults, maxChars);
    if (ddg.length > 0) return ddg;
  } catch {
    // fall through
  }

  return [];
}

// Render results into a "WEB SEARCH RESULTS" block for the model to read.
// Deliberately says nothing about citations, brackets, or [n] — a small
// local model asked to self-cite invents references into passages it never
// actually drew from (see eochat/server/citation-check.js's own framing: "a
// model grading its own answer is not a check", and the same holds for a
// model attributing its own answer). The talker only ever gets asked to use
// the results; which sources actually informed the reply is decided and
// attached mechanically afterward — see stripCitationBrackets /
// attachSourcesFooter below, applied to the finished text in chat.ts.
export function formatWebSearchBlock(
  query: string,
  results: WebSearchResult[],
): string {
  if (!results.length) {
    return `WEB SEARCH: no results found for "${query}". Answer from what you already know and say so.`;
  }
  const lines = results.map(
    (r) => `${r.title} (${r.source})\n${r.url}\n${r.snippet}`,
  );
  return (
    `WEB SEARCH RESULTS for "${query}":\n\n${lines.join("\n\n")}\n\n` +
    `Use these results to ground your answer in fact. Do not write citation ` +
    `markers or bracketed numbers — just answer plainly; sources are shown ` +
    `to the reader separately. If the results don't cover the question, say ` +
    `so rather than guessing.`
  );
}

// A model told "don't write brackets" still sometimes writes them anyway —
// this is the mechanical backstop, not a request. Strips any [1]/[1,2]/
// [1-3]-style bracket the model produced despite the instruction above,
// since nothing here ever validated those numbers against real passages
// (unlike eochat's server-side validateCitations, which keeps a bracket the
// model got right) — the browser side offers no per-claim grounding check,
// so any self-authored citation is unverifiable and removed outright.
const CITATION_BRACKET_RE = /\[\s*\d+(?:\s*(?:[,;]|-|–|—|to)\s*\d+)*\s*\]/g;

export function stripCitationBrackets(text: string): string {
  if (!text) return text;
  return text
    .replace(CITATION_BRACKET_RE, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

// The actual attribution: a plain "Sources" list built from the search
// results this turn ran, appended after the model's text — not authored by
// the model, not something it can get wrong or fabricate.
export function attachSourcesFooter(
  text: string,
  results: WebSearchResult[],
): string {
  if (!results.length) return text;
  const lines = results.map((r) => `- [${r.title}](${r.url})`);
  return `${text}\n\n---\n**Sources**\n${lines.join("\n")}`;
}
