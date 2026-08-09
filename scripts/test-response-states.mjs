import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(
  new URL("../app/store/chat.ts", import.meta.url),
  "utf8",
);

test("one spoken reply permits at most one earned System 2 addition", () => {
  assert.match(chat, /const EO_MAX_SYSTEM2_RESPONSES = 1/);
  assert.doesNotMatch(chat, /await\s+probeReading/);
  assert.match(chat, /no hidden probe response/);
});

test("normal maintenance uses one retained fast fold and no summary rewrite", () => {
  const fold = chat.slice(chat.indexOf("foldNextTurn(llm"));
  assert.match(fold, /eoRunConsciousUnspoken/);
  assert.match(fold, /parseFold\(raw\)/);
  assert.doesNotMatch(fold, /buildSummaryUpdatePrompt|updateSummaryWithFold/);
  assert.match(chat, /EO_FOLD_TIMEOUT_MS = 12_000/);
});
