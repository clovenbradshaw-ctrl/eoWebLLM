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
// matches stray words, not the subject. This strips the common question
// scaffolding eochat's distillSubject() also strips, without needing that
// module's essay-prompt-specific rules.
export function distillQuery(raw: string): string {
  let q = String(raw || "").trim();
  q = q.replace(
    /^(please\s+)?(what'?s|what\s+is|how\s+(do|can|to)|why\s+(is|does|do)|can\s+you|could\s+you|tell\s+me\s+about|explain|search\s+for|look\s+up|find\s+out\s+about)\s+/i,
    "",
  );
  q = q.replace(/[?!.]+$/, "").trim();
  return q.slice(0, 200);
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
export async function webSearch(
  query: string,
  {
    numResults = 4,
    maxChars = 6000,
  }: { numResults?: number; maxChars?: number } = {},
): Promise<WebSearchResult[]> {
  numResults = Math.min(numResults, 10);

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

// Render results into the same "WEB SEARCH RESULTS" block shape eochat's
// server prompt builder uses, so the model sees the same framing whether the
// search ran in-process or in the browser.
export function formatWebSearchBlock(
  query: string,
  results: WebSearchResult[],
): string {
  if (!results.length) {
    return `WEB SEARCH: no results found for "${query}". Answer from what you already know and say so.`;
  }
  const lines = results.map(
    (r) => `[${r.rank}] ${r.title} (${r.source})\n${r.url}\n${r.snippet}`,
  );
  return (
    `WEB SEARCH RESULTS for "${query}":\n\n${lines.join("\n\n")}\n\n` +
    `Use these results to ground your answer. Cite sources by their [n] number ` +
    `when you rely on one. If the results don't cover the question, say so ` +
    `rather than guessing.`
  );
}
