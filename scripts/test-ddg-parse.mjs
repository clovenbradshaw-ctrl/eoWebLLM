// test-ddg-parse.mjs — the DuckDuckGo HTML backend, migrated from eochat.
//
// The backend was dropped from the original port because a browser cannot
// fetch a page from an origin without CORS headers. A relay removes that, so
// it comes back — and the thing worth testing is the PARSE, which is pure and
// needs no network. scripts/fixtures/ddg/ja-dolphins-essay.html is a real
// captured response, so this runs offline and in CI.
//
// The fixture is deliberately the JAPANESE query. English DDG markup is what
// eochat's regexes were written against; the open question in migrating them
// was whether they survive a non-Latin result page — different title lengths,
// different snippet content, and a `result__a` anchor whose text is CJK.
// Recording the Japanese page makes that an assertion rather than a hope.
//
// Run: node --import ./scripts/register-ts-resolve.mjs --test scripts/test-ddg-parse.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseDuckDuckGoHtml,
  decodeDdgRedirect,
  configureSearchProxy,
  searchProxyConfigured,
  webSearch,
} from "../app/client/eo-websearch.ts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "ddg",
  "ja-dolphins-essay.html",
);
const html = readFileSync(FIXTURE, "utf8");

// ── The redirect unwrap ───────────────────────────────────────────────────

test("decodeDdgRedirect unwraps the uddg= indirection to the real URL", () => {
  assert.equal(
    decodeDdgRedirect(
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fnote.com%2Fpure_iris6383%2Fn%2Fn26b33da75b70&rut=abc",
    ),
    "https://note.com/pure_iris6383/n/n26b33da75b70",
  );
});

test("decodeDdgRedirect leaves an already-direct URL alone, and fixes protocol-relative", () => {
  assert.equal(decodeDdgRedirect("https://example.com/x"), "https://example.com/x");
  assert.equal(decodeDdgRedirect("//example.com/x"), "https://example.com/x");
});

test("decodeDdgRedirect survives an undecodable payload rather than throwing", () => {
  const broken = "//duckduckgo.com/l/?uddg=%E0%A4%A";
  assert.equal(typeof decodeDdgRedirect(broken), "string");
});

// ── The parse, against a real Japanese result page ────────────────────────

test("the parse returns real results from a non-Latin result page", () => {
  const out = parseDuckDuckGoHtml(html, { numResults: 5 });
  assert.ok(out.length >= 4, `expected several results, got ${out.length}`);
  for (const r of out) {
    assert.ok(r.title.length > 0, "every result carries a title");
    assert.match(r.url, /^https?:\/\//, `unwrapped absolute URL, got ${r.url}`);
    assert.equal(r.source, "duckduckgo");
  }
});

test("CJK titles survive tag-stripping and whitespace collapse intact", () => {
  const out = parseDuckDuckGoHtml(html, { numResults: 5 });
  const cjk = out.filter((r) => /[぀-ヿ一-鿿]/.test(r.title));
  assert.ok(
    cjk.length >= 3,
    `expected Japanese titles to survive the parse; got ${cjk.length} of ${out.length}`,
  );
  assert.ok(
    out.some((r) => r.title.includes("イルカ")),
    "the subject term itself should appear in at least one title",
  );
});

test("no result leaks a duckduckgo.com redirect URL", () => {
  for (const r of parseDuckDuckGoHtml(html, { numResults: 8 }))
    assert.ok(
      !/duckduckgo\.com\/l\//.test(r.url),
      `unwrapped redirect leaked: ${r.url}`,
    );
});

test("ranks are 1-based and contiguous", () => {
  const out = parseDuckDuckGoHtml(html, { numResults: 4 });
  assert.deepEqual(
    out.map((r) => r.rank),
    out.map((_, i) => i + 1),
  );
});

test("numResults bounds the output and maxChars bounds each snippet", () => {
  assert.equal(parseDuckDuckGoHtml(html, { numResults: 2 }).length, 2);
  for (const r of parseDuckDuckGoHtml(html, { numResults: 4, maxChars: 200 }))
    assert.ok(r.snippet.length <= 50, `snippet over its share: ${r.snippet.length}`);
});

test("garbage in yields an empty list, never a throw", () => {
  assert.deepEqual(parseDuckDuckGoHtml("", {}), []);
  assert.deepEqual(parseDuckDuckGoHtml("<html><body>nope</body></html>", {}), []);
  assert.deepEqual(parseDuckDuckGoHtml(null, {}), []);
});

// ── The proxy switch ──────────────────────────────────────────────────────

test("no proxy configured means the backend does not run at all", async () => {
  configureSearchProxy(null);
  assert.equal(searchProxyConfigured(), false);

  // With no relay and no network in CI, webSearch must still resolve — every
  // backend failing is an empty result, never a rejection, because a lookup
  // that throws would take the whole turn down with it.
  const out = await webSearch("something nothing will match", { numResults: 1 });
  assert.ok(Array.isArray(out));
});

test("a non-http proxy value is rejected rather than half-configured", () => {
  configureSearchProxy("javascript:alert(1)");
  assert.equal(searchProxyConfigured(), false);
  configureSearchProxy("not a url");
  assert.equal(searchProxyConfigured(), false);
  configureSearchProxy("https://relay.example/webhook/feed");
  assert.equal(searchProxyConfigured(), true);
  configureSearchProxy(null);
});
