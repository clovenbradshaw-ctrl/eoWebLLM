import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(
  new URL("../app/store/chat.ts", import.meta.url),
  "utf8",
);
const chatUi = readFileSync(
  new URL("../app/components/chat.tsx", import.meta.url),
  "utf8",
);

test("one spoken reply permits at most one earned System 2 addition", () => {
  assert.match(chat, /const EO_MAX_SYSTEM2_RESPONSES = 1/);
  assert.doesNotMatch(chat, /await\s+probeReading/);
  assert.match(chat, /no hidden probe response/);
});

test("deleting the transcript resets only derived conversation state", () => {
  const deletion = chatUi.slice(chatUi.indexOf("const deleteMessage"));
  assert.match(deletion, /session\.messages\.length === 0/);
  assert.match(deletion, /session\.eoSummary = null/);
  assert.match(deletion, /session\.eoLastFoldIndex = 0/);
  assert.match(deletion, /session\.eoMemory = undefined/);
  assert.doesNotMatch(deletion.slice(0, 1200), /eoSources\s*=/);
});

test("normal maintenance folds only under pressure and has explicit ablations", () => {
  const fold = chat.slice(chat.indexOf("foldNextTurn(llm"));
  assert.match(fold, /eoRunConsciousUnspoken/);
  assert.match(fold, /parseFold\(raw\)/);
  assert.match(fold, /completedTurns <= EO_HISTORY_TURNS/);
  assert.match(fold, /EO_FOLD_MODE === "none"/);
  assert.match(fold, /EO_FOLD_MODE === "mechanical"/);
  assert.doesNotMatch(fold, /buildSummaryUpdatePrompt|updateSummaryWithFold/);
  assert.match(chat, /EO_FOLD_TIMEOUT_MS = 12_000/);
});

test("a timed-out unspoken response is aborted before fallback", () => {
  const hidden = chat.slice(chat.indexOf("function eoRunConsciousUnspoken"));
  const timeout = hidden.slice(0, hidden.indexOf("llm.chat"));
  assert.match(timeout, /eoEngineBusy = false/);
  assert.match(timeout, /void llm\.abort\(\)/);
});
