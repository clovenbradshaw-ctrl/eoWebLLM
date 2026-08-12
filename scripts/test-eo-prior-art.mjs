import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractComparisonPhrase,
  isLicenseAllowed,
  pickLicensedCandidate,
} from "../app/client/eo-prior-art.ts";

// Every case here was proven live against the real GitHub API in eochat
// (eval/agent/crispr-search.mjs) before this port existed — re-run here as
// pure offline logic, since extractComparisonPhrase has no network
// dependency at all.

test("extractComparisonPhrase: archetype leads the sentence, with deltas after", () => {
  assert.equal(extractComparisonPhrase("hacker news clone card layout social feed"), "hacker news clone");
});

test("extractComparisonPhrase: archetype buried mid-sentence, the case positional backoff alone cannot fix", () => {
  assert.equal(
    extractComparisonPhrase("a social media site like hacker news but for dolphins, with cards instead of rows"),
    "hacker news",
  );
});

test("extractComparisonPhrase: the exact long instructional paragraph that broke naive keyword extraction live", () => {
  const prompt =
    "Build a static HTML/CSS prototype (single index.html file is fine) for a social news site like Hacker News, " +
    "but themed for dolphins/marine life, using a card grid layout instead of Hacker News's stacked rows.";
  assert.equal(extractComparisonPhrase(prompt), "hacker news");
});

test("extractComparisonPhrase: 'a clone of X' keeps the clone qualifier", () => {
  assert.equal(extractComparisonPhrase("a clone of reddit"), "reddit clone");
});

test("extractComparisonPhrase: 'X clone' strips the leading article", () => {
  assert.equal(extractComparisonPhrase("a Trello clone for recipes"), "trello clone");
});

test("extractComparisonPhrase: 'similar to X' with a trailing clause", () => {
  assert.equal(extractComparisonPhrase("build a site similar to reddit, but with images"), "reddit");
});

test("extractComparisonPhrase: no comparison at all -> null, not a guess", () => {
  assert.equal(extractComparisonPhrase("add exponential backoff retry logic to the fetch client"), null);
  assert.equal(extractComparisonPhrase("xyzzy plugh frotz qwzblort mimble wozzle"), null);
});

test("isLicenseAllowed: permissive licenses pass, everything else fails closed", () => {
  assert.equal(isLicenseAllowed("MIT"), true);
  assert.equal(isLicenseAllowed("Apache-2.0"), true);
  assert.equal(isLicenseAllowed("BSD-3-Clause"), true);
  assert.equal(isLicenseAllowed("GPL-3.0"), false);
  assert.equal(isLicenseAllowed("UNKNOWN"), false);
  assert.equal(isLicenseAllowed("NOASSERTION"), false);
  assert.equal(isLicenseAllowed(null), false);
  assert.equal(isLicenseAllowed(undefined), false);
});

test("pickLicensedCandidate: skips an unlicensed leader for a licensed runner-up, never clones on trust", () => {
  const candidates = [
    { repo: "big/unlicensed-star-magnet", stars: 50000, language: "JS", description: "", license: "NOASSERTION", url: "https://x" },
    { repo: "small/real-mit-clone", stars: 200, language: "JS", description: "", license: "MIT", url: "https://y" },
  ];
  const picked = pickLicensedCandidate(candidates);
  assert.equal(picked?.repo, "small/real-mit-clone");
});

test("pickLicensedCandidate: nothing licensed -> null, never falls back to an unlicensed pick", () => {
  const candidates = [
    { repo: "big/unlicensed", stars: 50000, language: "JS", description: "", license: "NOASSERTION", url: "https://x" },
  ];
  assert.equal(pickLicensedCandidate(candidates), null);
});
